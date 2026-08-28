import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LiveTransport,
  LiveTransportEvents,
  LiveTransportOptions,
} from './liveTransport'
import type { MicrophoneCapture } from './audio/microphoneCapture'
import type { PlaybackScheduler } from './audio/playbackScheduler'

const dependencies = vi.hoisted(() => ({
  createPlaybackScheduler: vi.fn(),
  startMicrophoneCapture: vi.fn(),
  connectLiveTransport: vi.fn(),
}))

vi.mock('./audio/playbackScheduler', () => ({
  createPlaybackScheduler: dependencies.createPlaybackScheduler,
}))
vi.mock('./audio/microphoneCapture', () => ({
  startMicrophoneCapture: dependencies.startMicrophoneCapture,
}))
vi.mock('./liveTransport', () => ({
  connectLiveTransport: dependencies.connectLiveTransport,
}))

import { PLAYBACK_ECHO_GUARD_MS } from './config'
import { encodeCaptureChunk } from './audio/pcm'
import { TranslationSession } from './translationSession'
import type { SourceLanguageCode, SupportedLanguageCode } from './types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function playback(): PlaybackScheduler {
  return {
    enqueue: vi.fn(),
    flush: vi.fn(),
    remainingMs: vi.fn(() => 0),
    dispose: vi.fn(async () => undefined),
  }
}

function capture(onStop: () => void = () => undefined): MicrophoneCapture {
  let stopped = false
  return {
    sampleRate: 16_000,
    stop: vi.fn(async () => {
      if (!stopped) {
        stopped = true
        onStop()
      }
    }),
  }
}

function transport(onClose: () => void = () => undefined): LiveTransport {
  let closed = false
  return {
    sendAudioChunk: vi.fn(),
    close: vi.fn(() => {
      if (!closed) {
        closed = true
        onClose()
      }
    }),
  }
}

function session(): TranslationSession {
  return new TranslationSession({
    tokenProvider: vi.fn(async () => ({
      token: 'auth_tokens/test-ephemeral-token',
      model: 'test-live-model',
      systemInstruction: 'Test instruction',
    })),
  })
}

describe('TranslationSession startup ownership', () => {
  beforeEach(() => {
    dependencies.createPlaybackScheduler.mockReset()
    dependencies.startMicrophoneCapture.mockReset()
    dependencies.connectLiveTransport.mockReset()
    dependencies.createPlaybackScheduler.mockImplementation(async () => playback())
  })

  it('waits for a pending microphone factory to clean up before restarting', async () => {
    const firstCapture = deferred<MicrophoneCapture>()
    let activeCaptures = 0
    let maximumCaptures = 0
    const beginCapture = () => {
      activeCaptures += 1
      maximumCaptures = Math.max(maximumCaptures, activeCaptures)
      return capture(() => {
        activeCaptures -= 1
      })
    }

    dependencies.startMicrophoneCapture
      .mockImplementationOnce(() => firstCapture.promise)
      .mockImplementationOnce(async () => beginCapture())
    dependencies.connectLiveTransport.mockImplementation(async () => transport())

    const controller = session()
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(dependencies.startMicrophoneCapture).toHaveBeenCalledTimes(1)
    })

    const stopping = controller.stop()
    const restarting = controller.start('auto', 'ur')
    await Promise.resolve()
    expect(dependencies.startMicrophoneCapture).toHaveBeenCalledTimes(1)

    const lateCapture = beginCapture()
    firstCapture.resolve(lateCapture)
    await Promise.all([firstStart, stopping, restarting])

    expect(lateCapture.stop).toHaveBeenCalledOnce()
    expect(dependencies.startMicrophoneCapture).toHaveBeenCalledTimes(2)
    expect(maximumCaptures).toBe(1)
    expect(controller.getSnapshot()).toMatchObject({
      state: 'listening',
      targetLanguage: 'ur',
    })

    await controller.stop()
    expect(activeCaptures).toBe(0)
  })

  it('waits for a pending playback factory to clean up before restarting', async () => {
    const firstPlayback = deferred<PlaybackScheduler>()
    const latePlayback = playback()
    dependencies.createPlaybackScheduler
      .mockImplementationOnce(() => firstPlayback.promise)
      .mockImplementationOnce(async () => playback())
    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport.mockImplementation(async () => transport())

    const controller = session()
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(dependencies.createPlaybackScheduler).toHaveBeenCalledOnce()
    })

    const stopping = controller.stop()
    const restarting = controller.start()
    await Promise.resolve()
    expect(dependencies.createPlaybackScheduler).toHaveBeenCalledOnce()

    firstPlayback.resolve(latePlayback)
    await Promise.all([firstStart, stopping, restarting])

    expect(latePlayback.dispose).toHaveBeenCalledOnce()
    expect(dependencies.createPlaybackScheduler).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().state).toBe('listening')
    await controller.stop()
  })

  it('does not connect a superseded token request or overlap its restart', async () => {
    const firstToken = deferred<{
      token: string
      model: string
      systemInstruction: string
    }>()
    const tokenProvider = vi
      .fn()
      .mockImplementationOnce(() => firstToken.promise)
      .mockImplementationOnce(async () => ({
        token: 'auth_tokens/replacement-token',
        model: 'test-live-model',
        systemInstruction: 'Test instruction',
      }))
    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport.mockImplementation(async () => transport())

    const controller = new TranslationSession({ tokenProvider })
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(tokenProvider).toHaveBeenCalledOnce()
    })

    const stopping = controller.stop()
    const restarting = controller.start()
    await Promise.resolve()
    expect(tokenProvider).toHaveBeenCalledOnce()
    expect(dependencies.connectLiveTransport).not.toHaveBeenCalled()

    firstToken.resolve({
      token: 'auth_tokens/superseded-token',
      model: 'test-live-model',
      systemInstruction: 'Test instruction',
    })
    await Promise.all([firstStart, stopping, restarting])

    expect(tokenProvider).toHaveBeenCalledTimes(2)
    expect(dependencies.connectLiveTransport).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().state).toBe('listening')
    await controller.stop()
  })

  it('aborts a pending Live handshake before opening the replacement', async () => {
    let activeConnections = 0
    let maximumConnections = 0
    let firstSignal: AbortSignal | undefined

    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport
      .mockImplementationOnce((options: LiveTransportOptions) => {
        firstSignal = options.signal
        activeConnections += 1
        maximumConnections = Math.max(maximumConnections, activeConnections)
        return new Promise<LiveTransport>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => {
              activeConnections -= 1
              reject(new Error('cancelled'))
            },
            { once: true },
          )
        })
      })
      .mockImplementationOnce(async () => {
        activeConnections += 1
        maximumConnections = Math.max(maximumConnections, activeConnections)
        return transport(() => {
          activeConnections -= 1
        })
      })

    const controller = session()
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(dependencies.connectLiveTransport).toHaveBeenCalledTimes(1)
    })

    const stopping = controller.stop()
    const restarting = controller.start()
    await Promise.all([firstStart, stopping, restarting])

    expect(firstSignal?.aborted).toBe(true)
    expect(dependencies.connectLiveTransport).toHaveBeenCalledTimes(2)
    expect(maximumConnections).toBe(1)
    expect(activeConnections).toBe(1)

    await controller.stop()
    expect(activeConnections).toBe(0)
  })

  it('invalidates a queued restart when a later stop represents unmount', async () => {
    const captureStop = deferred<void>()
    const slowCapture: MicrophoneCapture = {
      sampleRate: 16_000,
      stop: vi.fn(() => captureStop.promise),
    }
    dependencies.startMicrophoneCapture.mockResolvedValue(slowCapture)
    dependencies.connectLiveTransport.mockResolvedValue(transport())

    const controller = session()
    await controller.start()

    const firstStop = controller.stop()
    await vi.waitFor(() => {
      expect(slowCapture.stop).toHaveBeenCalledOnce()
    })
    const queuedRestart = controller.start()
    const unmountStop = controller.stop()

    captureStop.resolve()
    await Promise.all([firstStop, queuedRestart, unmountStop])

    expect(dependencies.createPlaybackScheduler).toHaveBeenCalledOnce()
    expect(dependencies.startMicrophoneCapture).toHaveBeenCalledOnce()
    expect(dependencies.connectLiveTransport).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().state).toBe('stopped')
  })

  it('makes concurrent dispose calls wait for the same shutdown', async () => {
    const captureStop = deferred<void>()
    const slowCapture: MicrophoneCapture = {
      sampleRate: 16_000,
      stop: vi.fn(() => captureStop.promise),
    }
    dependencies.startMicrophoneCapture.mockResolvedValue(slowCapture)
    dependencies.connectLiveTransport.mockResolvedValue(transport())

    const controller = session()
    await controller.start()

    const firstDispose = controller.dispose()
    await vi.waitFor(() => {
      expect(slowCapture.stop).toHaveBeenCalledOnce()
    })
    let secondSettled = false
    const secondDispose = controller.dispose().then(() => {
      secondSettled = true
    })
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    captureStop.resolve()
    await Promise.all([firstDispose, secondDispose])
    expect(secondSettled).toBe(true)

    await controller.start()
    expect(dependencies.createPlaybackScheduler).toHaveBeenCalledOnce()
  })

  it('finishes a target-language switch before the new target can connect', async () => {
    let activeConnections = 0
    let maximumConnections = 0
    const connectedTargets: string[] = []

    dependencies.startMicrophoneCapture.mockImplementation(async () => capture())
    dependencies.connectLiveTransport.mockImplementation(
      (options: LiveTransportOptions) => {
        connectedTargets.push(options.targetLanguage)
        activeConnections += 1
        maximumConnections = Math.max(maximumConnections, activeConnections)

        if (connectedTargets.length === 1) {
          return new Promise<LiveTransport>((_resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => {
                activeConnections -= 1
                reject(new Error('cancelled'))
              },
              { once: true },
            )
          })
        }

        return Promise.resolve(
          transport(() => {
            activeConnections -= 1
          }),
        )
      },
    )

    const controller = session()
    const firstStart = controller.start()
    await vi.waitFor(() => {
      expect(dependencies.connectLiveTransport).toHaveBeenCalledOnce()
    })

    await controller.setTargetLanguage('ur')
    await firstStart
    expect(controller.getSnapshot()).toMatchObject({
      state: 'stopped',
      targetLanguage: 'ur',
    })
    expect(activeConnections).toBe(0)

    await controller.start()
    expect(connectedTargets).toEqual(['en', 'ur'])
    expect(maximumConnections).toBe(1)

    await controller.stop()
    expect(activeConnections).toBe(0)
  })
})

/**
 * A two-person conversation driven through a real `TranslationSession`.
 *
 * The point of these tests is who is speaking. Every open route hears the same
 * microphone and reports on the same speech, so each utterance is delivered to
 * all of them and the test says what each one made of it — including the ways
 * the real API gets it wrong, which is what the arbitration exists for.
 */

/** One recognisable byte per language, so playback can be attributed. */
const VOICES: Record<string, number> = {
  en: 1,
  'zh-Hans': 2,
  bn: 3,
  es: 4,
  fr: 5,
}

const voiceOf = (language: string) => new Uint8Array([VOICES[language]])

interface FakeRoute {
  target: SupportedLanguageCode
  events: LiveTransportEvents
  sent: string[]
  closed: boolean
}

/** What one route made of an utterance everybody heard. */
interface RouteOutcome {
  /** Text the model generated. Equal to the source when it is parroting. */
  translation?: string
  /** Whether the model also spoke that text aloud. */
  audio?: boolean
}

interface Conversation {
  controller: TranslationSession
  routes: FakeRoute[]
  /** Targets of the open routes, in the order they were opened. */
  targets: () => string[]
  /** Languages actually played aloud, oldest first. */
  heard: () => string[]
  /** Committed transcript as `kind:text`. */
  rows: () => string[]
  state: () => string
  /** Play the queued translation out to its end. */
  finishPlayback: () => void
  /** Feed one buffer of room audio and return what the routes were sent. */
  hear: (samples: number[]) => string[]
  connectCount: () => number
}

async function conversation({
  source,
  target,
  failTarget,
}: {
  source: SourceLanguageCode
  target: SupportedLanguageCode
  /** Refuse to open the route for this language, once. */
  failTarget?: SupportedLanguageCode
}): Promise<Conversation> {
  const routes: FakeRoute[] = []
  const played: Uint8Array[] = []
  let micChunk: ((samples: Float32Array, sampleRate: number) => void) | null = null
  let playbackActive = false
  let onPlaybackStart = () => {}
  let onPlaybackDrained = () => {}
  let refused = false

  dependencies.createPlaybackScheduler.mockImplementation(
    async (options: {
      onPlaybackStart: () => void
      onPlaybackDrained: () => void
    }) => {
      onPlaybackStart = options.onPlaybackStart
      onPlaybackDrained = options.onPlaybackDrained
      const scheduler: PlaybackScheduler = {
        enqueue: (pcm16) => {
          played.push(pcm16)
          if (!playbackActive) {
            playbackActive = true
            onPlaybackStart()
          }
        },
        flush: () => {
          if (playbackActive) {
            playbackActive = false
            onPlaybackDrained()
          }
        },
        remainingMs: () => (playbackActive ? 1000 : 0),
        dispose: async () => undefined,
      }
      return scheduler
    },
  )

  dependencies.startMicrophoneCapture.mockImplementation(
    async (options: {
      onChunk: (samples: Float32Array, sampleRate: number) => void
    }) => {
      micChunk = options.onChunk
      return capture()
    },
  )

  dependencies.connectLiveTransport.mockImplementation(
    async (options: LiveTransportOptions) => {
      if (options.targetLanguage === failTarget && !refused) {
        refused = true
        throw new Error('route unavailable')
      }
      const route: FakeRoute = {
        target: options.targetLanguage,
        events: options.events,
        sent: [],
        closed: false,
      }
      routes.push(route)
      return {
        sendAudioChunk: (chunk: string) => route.sent.push(chunk),
        close: () => {
          route.closed = true
        },
      } satisfies LiveTransport
    },
  )

  const controller = session()
  await controller.start(source, target)

  return {
    controller,
    routes,
    targets: () =>
      routes.filter((route) => !route.closed).map((route) => route.target),
    heard: () =>
      played.map(
        (chunk) =>
          Object.keys(VOICES).find(
            (language) => VOICES[language] === chunk[0],
          ) ?? 'unknown',
      ),
    rows: () =>
      controller
        .getSnapshot()
        .transcript.map((turn) => `${turn.kind}:${turn.text}`),
    state: () => controller.getSnapshot().state,
    finishPlayback: () => {
      if (playbackActive) {
        playbackActive = false
        onPlaybackDrained()
      }
    },
    hear: (samples) => {
      const open = routes.filter((route) => !route.closed)
      const before = open.map((route) => route.sent.length)
      micChunk?.(new Float32Array(samples), 16_000)
      return open.map((route, index) => route.sent[before[index]])
    },
    connectCount: () => dependencies.connectLiveTransport.mock.calls.length,
  }
}

/**
 * One person speaks, in the order the API reports it: a partial caption, then
 * the model's audio, then the finished transcriptions, then the end of the turn.
 *
 * `reportedAs: null` models the API sending no language code at all, which is
 * ordinary for Latin-script languages.
 */
async function speak(
  conversationUnderTest: Conversation,
  said: { language: string; text: string; reportedAs?: string | null },
  produced: Record<string, RouteOutcome>,
): Promise<void> {
  const languageCode =
    said.reportedAs === null ? undefined : (said.reportedAs ?? said.language)
  const open = conversationUnderTest.routes.filter((route) => !route.closed)

  for (const route of open) {
    const outcome = produced[route.target]
    if (!outcome) continue
    route.events.onInterimTranscript({
      text: said.text.slice(0, Math.ceil(said.text.length / 2)),
      languageCode,
    })
    if (outcome.audio) route.events.onAudio(voiceOf(route.target))
    route.events.onSourceTranscript({ text: said.text, languageCode })
    if (outcome.translation !== undefined) {
      route.events.onTranslationTranscript({ text: outcome.translation })
    }
    route.events.onTurnEnd()
  }

  // Adopting a counterpart opens a route, which is asynchronous.
  await vi.advanceTimersByTimeAsync(0)
}

describe('TranslationSession conversations', () => {
  beforeEach(() => {
    dependencies.createPlaybackScheduler.mockReset()
    dependencies.startMicrophoneCapture.mockReset()
    dependencies.connectLiveTransport.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('interprets an explicit English and Chinese pair in both directions', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })
    expect(talk.targets()).toEqual(['zh-Hans', 'en'])

    await speak(
      talk,
      { language: 'en', text: 'Hello, how are you?' },
      {
        'zh-Hans': { translation: '你好，你好吗？', audio: true },
        // The other route's target is the language being spoken, so all it can
        // do is repeat the speaker.
        en: { translation: 'Hello, how are you?' },
      },
    )

    expect(talk.rows()).toEqual([
      'source:Hello, how are you?',
      'translation:你好，你好吗？',
    ])
    expect(talk.heard()).toEqual(['zh-Hans'])
    expect(talk.state()).toBe('translating')

    talk.finishPlayback()
    expect(talk.state()).toBe('listening')

    await vi.advanceTimersByTimeAsync(3000)
    await speak(
      talk,
      { language: 'zh-Hans', text: '你好，我很好，谢谢。' },
      {
        en: { translation: "Hello, I'm doing well, thank you.", audio: true },
        'zh-Hans': { translation: '你好，我很好，谢谢。' },
      },
    )

    expect(talk.rows()).toEqual([
      'source:Hello, how are you?',
      'translation:你好，你好吗？',
      'source:你好，我很好，谢谢。',
      "translation:Hello, I'm doing well, thank you.",
    ])
    expect(talk.heard()).toEqual(['zh-Hans', 'en'])

    talk.finishPlayback()
    expect(talk.state()).toBe('listening')

    await vi.advanceTimersByTimeAsync(3000)
    await speak(
      talk,
      { language: 'en', text: 'Can we meet on Thursday?' },
      {
        'zh-Hans': { translation: '我们星期四可以见面吗？', audio: true },
        en: { translation: 'Can we meet on Thursday?' },
      },
    )

    expect(talk.rows().at(-1)).toBe('translation:我们星期四可以见面吗？')
    expect(talk.heard()).toEqual(['zh-Hans', 'en', 'zh-Hans'])
    talk.finishPlayback()
    expect(talk.state()).toBe('listening')

    // Three turns in both directions, on the two sockets the session opened.
    expect(talk.connectCount()).toBe(2)
    await talk.controller.stop()
  })

  it('never reads the speaker their own words back', async () => {
    const talk = await conversation({ source: 'en', target: 'bn' })

    // The route that should be silent generates audio anyway: its instruction
    // named a language, and the model identified the speech as that language.
    await speak(
      talk,
      { language: 'en', text: 'Hello, I would like to confirm my appointment.' },
      {
        bn: {
          translation: 'হ্যালো, আমি আমার অ্যাপয়েন্টমেন্ট নিশ্চিত করতে চাই।',
          audio: true,
        },
        en: {
          translation: 'Hello, I would like to confirm my appointment.',
          audio: true,
        },
      },
    )

    expect(talk.heard()).toEqual(['bn'])
    expect(talk.rows()).toEqual([
      'source:Hello, I would like to confirm my appointment.',
      'translation:হ্যালো, আমি আমার অ্যাপয়েন্টমেন্ট নিশ্চিত করতে চাই।',
    ])

    talk.finishPlayback()
    await vi.advanceTimersByTimeAsync(3000)

    await speak(
      talk,
      { language: 'bn', text: 'ধন্যবাদ, বৃহস্পতিবার ঠিক আছে।' },
      {
        en: { translation: 'Thank you, Thursday works.', audio: true },
        bn: { translation: 'ধন্যবাদ, বৃহস্পতিবার ঠিক আছে।' },
      },
    )

    expect(talk.heard()).toEqual(['bn', 'en'])
    expect(talk.rows().at(-1)).toBe('translation:Thank you, Thursday works.')
    await talk.controller.stop()
  })

  it('tells the routes apart when the API reports no language at all', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })

    // Latin-script speech with no language code: the only thing separating the
    // two routes is that one of them handed back the speaker's own words.
    await speak(
      talk,
      { language: 'en', text: 'I would like to confirm my appointment.', reportedAs: null },
      {
        es: { translation: 'Quisiera confirmar mi cita.', audio: true },
        en: { translation: 'I would like to confirm my appointment.', audio: true },
      },
    )

    expect(talk.heard()).toEqual(['es'])
    expect(talk.rows()).toEqual([
      'source:I would like to confirm my appointment.',
      'translation:Quisiera confirmar mi cita.',
    ])
    await talk.controller.stop()
  })

  it('hears the second speaker as soon as the translation has played', async () => {
    const talk = await conversation({ source: 'es', target: 'en' })
    const realAudio = encodeCaptureChunk(
      new Float32Array([0.5, -0.5]),
      16_000,
      16_000,
    )
    const silence = encodeCaptureChunk(new Float32Array(2), 16_000, 16_000)

    await speak(
      talk,
      { language: 'es', text: 'Hola, ¿cómo estás?' },
      {
        en: { translation: 'Hello, how are you?', audio: true },
        es: { translation: 'Hola, ¿cómo estás?' },
      },
    )
    expect(talk.heard()).toEqual(['en'])

    // The translation comes out of the same speakers the microphone is on, so
    // the room is replaced with silence rather than dropped.
    expect(talk.hear([0.5, -0.5])).toEqual([silence, silence])

    talk.finishPlayback()
    await vi.advanceTimersByTimeAsync(PLAYBACK_ECHO_GUARD_MS + 1)
    expect(talk.hear([0.5, -0.5])).toEqual([realAudio, realAudio])
    expect(talk.state()).toBe('listening')

    await vi.advanceTimersByTimeAsync(3000)
    await speak(
      talk,
      { language: 'en', text: 'I am well, thank you.' },
      {
        es: { translation: 'Estoy bien, gracias.', audio: true },
        en: { translation: 'I am well, thank you.' },
      },
    )

    expect(talk.heard()).toEqual(['en', 'es'])
    expect(talk.rows().at(-1)).toBe('translation:Estoy bien, gracias.')
    expect(talk.connectCount()).toBe(2)
    await talk.controller.stop()
  })

  it('learns the other language in auto mode and answers back in it', async () => {
    const talk = await conversation({ source: 'auto', target: 'zh-Hans' })
    // Nothing is known about the other speaker yet, so there is one route.
    expect(talk.targets()).toEqual(['zh-Hans'])

    await speak(
      talk,
      { language: 'en', text: 'Hello, how are you?' },
      { 'zh-Hans': { translation: '你好，你好吗？', audio: true } },
    )

    expect(talk.rows()).toEqual([
      'source:Hello, how are you?',
      'translation:你好，你好吗？',
    ])
    expect(talk.heard()).toEqual(['zh-Hans'])
    // English is now the other side of the conversation.
    expect(talk.targets()).toEqual(['zh-Hans', 'en'])

    talk.finishPlayback()
    await vi.advanceTimersByTimeAsync(3000)

    await speak(
      talk,
      { language: 'zh-Hans', text: '你好，我很好，谢谢。' },
      {
        en: { translation: "Hello, I'm doing well, thank you.", audio: true },
        'zh-Hans': { translation: '你好，我很好，谢谢。' },
      },
    )

    expect(talk.rows().at(-1)).toBe("translation:Hello, I'm doing well, thank you.")
    expect(talk.heard()).toEqual(['zh-Hans', 'en'])

    talk.finishPlayback()
    await vi.advanceTimersByTimeAsync(3000)

    await speak(
      talk,
      { language: 'en', text: 'Can we meet on Thursday?' },
      {
        'zh-Hans': { translation: '我们星期四可以见面吗？', audio: true },
        en: { translation: 'Can we meet on Thursday?' },
      },
    )

    expect(talk.heard()).toEqual(['zh-Hans', 'en', 'zh-Hans'])
    // The pair was settled once and then left alone.
    expect(talk.connectCount()).toBe(2)
    await talk.controller.stop()
  })

  it('holds an auto pair through a single mislabelled turn', async () => {
    const talk = await conversation({ source: 'auto', target: 'zh-Hans' })
    await speak(
      talk,
      { language: 'en', text: 'Hello, how are you?' },
      { 'zh-Hans': { translation: '你好，你好吗？', audio: true } },
    )
    expect(talk.targets()).toEqual(['zh-Hans', 'en'])
    talk.finishPlayback()
    await vi.advanceTimersByTimeAsync(3000)

    // One turn reported as French. Acting on it would close the socket the
    // English speaker is being interpreted on.
    await speak(
      talk,
      { language: 'en', text: 'Can we meet on Thursday?', reportedAs: 'fr' },
      {
        'zh-Hans': { translation: '我们星期四可以见面吗？', audio: true },
        en: { translation: 'Can we meet on Thursday?' },
      },
    )

    expect(talk.targets()).toEqual(['zh-Hans', 'en'])
    expect(talk.connectCount()).toBe(2)
    talk.finishPlayback()
    await vi.advanceTimersByTimeAsync(3000)

    // A second utterance agreeing on it is a different matter.
    await speak(
      talk,
      { language: 'fr', text: 'Bonjour, je voudrais confirmer.' },
      { 'zh-Hans': { translation: '你好，我想确认。', audio: true } },
    )

    expect(talk.targets()).toEqual(['zh-Hans', 'fr'])
    await talk.controller.stop()
  })

  it('keeps an explicit pair when the model reports a third language', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })

    await speak(
      talk,
      { language: 'en', text: 'Hello, how are you?', reportedAs: 'vi' },
      {
        'zh-Hans': { translation: '你好，你好吗？', audio: true },
        en: { translation: 'Hello, how are you?' },
      },
    )

    // A pair the user chose is not replaced by model metadata, and the
    // utterance is still interpreted rather than dropped.
    expect(talk.targets()).toEqual(['zh-Hans', 'en'])
    expect(talk.heard()).toEqual(['zh-Hans'])
    expect(talk.connectCount()).toBe(2)
    await talk.controller.stop()
  })

  it('keeps interpreting when the return route cannot be opened', async () => {
    const talk = await conversation({
      source: 'auto',
      target: 'zh-Hans',
      failTarget: 'en',
    })

    await speak(
      talk,
      { language: 'en', text: 'Hello, how are you?' },
      { 'zh-Hans': { translation: '你好，你好吗？', audio: true } },
    )

    expect(talk.state()).toBe('translating')
    expect(talk.rows()).toEqual([
      'source:Hello, how are you?',
      'translation:你好，你好吗？',
    ])
    expect(talk.targets()).toEqual(['zh-Hans'])

    talk.finishPlayback()
    await vi.advanceTimersByTimeAsync(3000)

    // The claim on English was released, so the next English turn tries again.
    await speak(
      talk,
      { language: 'en', text: 'Can we meet on Thursday?' },
      { 'zh-Hans': { translation: '我们星期四可以见面吗？', audio: true } },
    )
    expect(talk.targets()).toEqual(['zh-Hans', 'en'])
    await talk.controller.stop()
  })

  it('shows both transcripts when the translation is never heard', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })

    // The route that owns this utterance produces text but no audio at all.
    await speak(
      talk,
      { language: 'en', text: 'Hello, how are you?' },
      {
        'zh-Hans': { translation: '你好，你好吗？' },
        en: { translation: 'Hello, how are you?' },
      },
    )

    expect(talk.heard()).toEqual([])
    expect(talk.rows()).toEqual([
      'source:Hello, how are you?',
      'translation:你好，你好吗？',
    ])
    // Nothing played, so nothing is waiting to finish.
    expect(talk.state()).toBe('listening')
    await talk.controller.stop()
  })

  it('returns to listening when playback never reports that it finished', async () => {
    const talk = await conversation({ source: 'es', target: 'en' })
    const silence = encodeCaptureChunk(new Float32Array(2), 16_000, 16_000)
    const realAudio = encodeCaptureChunk(
      new Float32Array([0.5, -0.5]),
      16_000,
      16_000,
    )

    await speak(
      talk,
      { language: 'es', text: 'Hola, ¿cómo estás?' },
      {
        en: { translation: 'Hello, how are you?', audio: true },
        es: { translation: 'Hola, ¿cómo estás?' },
      },
    )
    expect(talk.state()).toBe('translating')
    expect(talk.hear([0.5, -0.5])).toEqual([silence, silence])

    // The completion callback is never delivered. The microphone is silenced
    // for exactly as long as the session believes audio is playing, so this
    // cannot be allowed to last.
    await vi.advanceTimersByTimeAsync(10_000)

    expect(talk.state()).toBe('listening')
    expect(talk.hear([0.5, -0.5])).toEqual([realAudio, realAudio])
    await talk.controller.stop()
  })

  it('drops only the interrupted route’s audio', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })
    const chinese = talk.routes.find((route) => route.target === 'zh-Hans')!
    const english = talk.routes.find((route) => route.target === 'en')!

    chinese.events.onInterimTranscript({ text: 'Hello', languageCode: 'en' })
    chinese.events.onAudio(voiceOf('zh-Hans'))
    expect(talk.state()).toBe('translating')

    // The route that is not being heard being cut off says nothing about the
    // translation that is currently playing.
    english.events.onInterrupted()
    english.events.onTurnEnd()
    expect(talk.state()).toBe('translating')

    chinese.events.onInterrupted()
    expect(talk.state()).toBe('listening')
    await talk.controller.stop()
  })

  it('takes the floor back from a route that turns out to be parroting', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })
    const chinese = talk.routes.find((route) => route.target === 'zh-Hans')!
    const english = talk.routes.find((route) => route.target === 'en')!

    // The English speaker is misidentified as Chinese, so the route that should
    // be silent is the one the language evidence lets in first.
    english.events.onInterimTranscript({
      text: 'Hello, how',
      languageCode: 'zh-Hans',
    })
    english.events.onAudio(voiceOf('en'))
    chinese.events.onInterimTranscript({
      text: 'Hello, how',
      languageCode: 'zh-Hans',
    })
    chinese.events.onAudio(voiceOf('zh-Hans'))
    expect(talk.heard()).toEqual(['en'])

    // What it produced is the speaker's own words, which settles it.
    english.events.onSourceTranscript({
      text: 'Hello, how are you?',
      languageCode: 'zh-Hans',
    })
    english.events.onTranslationTranscript({ text: 'Hello, how are you?' })
    chinese.events.onSourceTranscript({
      text: 'Hello, how are you?',
      languageCode: 'zh-Hans',
    })
    chinese.events.onTranslationTranscript({ text: '你好，你好吗？' })

    // The audio the other route was holding is released, and the parrot stops.
    expect(talk.heard()).toEqual(['en', 'zh-Hans'])
    expect(talk.rows()).toEqual([
      'source:Hello, how are you?',
      'translation:你好，你好吗？',
    ])
    await talk.controller.stop()
  })

  it('never lets a second route speak the utterance after the first', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })
    const chinese = talk.routes.find((route) => route.target === 'zh-Hans')!
    const english = talk.routes.find((route) => route.target === 'en')!

    // Both routes produce a genuine translation of the same speech and neither
    // reports a language. Only one of them may be heard.
    chinese.events.onAudio(voiceOf('zh-Hans'))
    english.events.onAudio(voiceOf('en'))
    chinese.events.onSourceTranscript({ text: 'Bonjour tout le monde.' })
    chinese.events.onTranslationTranscript({ text: '大家好。' })
    english.events.onSourceTranscript({ text: 'Bonjour tout le monde.' })
    english.events.onTranslationTranscript({ text: 'Hello everyone.' })

    expect(talk.heard()).toEqual(['zh-Hans'])

    // Including once both routes have finished with the utterance.
    chinese.events.onTurnEnd()
    english.events.onTurnEnd()
    expect(talk.heard()).toEqual(['zh-Hans'])
    await talk.controller.stop()
  })

  it('keeps one row for a sentence that arrives in fragments', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })
    const chinese = talk.routes.find((route) => route.target === 'zh-Hans')!

    for (const text of ['I need', 'I need to make', 'I need to make an appointment']) {
      chinese.events.onInterimTranscript({ text, languageCode: 'en' })
      expect(talk.rows()).toEqual([])
      expect(talk.controller.getSnapshot().interimTranscript?.text).toBe(text)
    }

    chinese.events.onSourceTranscript({
      text: 'I need to make an appointment.',
      languageCode: 'en',
    })

    expect(talk.rows()).toEqual(['source:I need to make an appointment.'])
    expect(talk.controller.getSnapshot().interimTranscript).toBeNull()
    await talk.controller.stop()
  })

  it('keeps one row when both routes report the same speech', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })

    await speak(
      talk,
      { language: 'en', text: 'Hello, how are you?' },
      {
        'zh-Hans': { translation: '你好，你好吗？', audio: true },
        // Same speech, transcribed slightly differently by the other socket.
        en: { translation: 'Hello how are you' },
      },
    )

    expect(talk.rows()).toEqual([
      'source:Hello, how are you?',
      'translation:你好，你好吗？',
    ])
    await talk.controller.stop()
  })

  it('starts clean after a stop in the middle of a translation', async () => {
    const talk = await conversation({ source: 'en', target: 'zh-Hans' })

    await speak(
      talk,
      { language: 'en', text: 'Hello, how are you?' },
      { 'zh-Hans': { translation: '你好，你好吗？', audio: true } },
    )
    expect(talk.state()).toBe('translating')

    await talk.controller.stop()
    expect(talk.state()).toBe('stopped')
    expect(talk.routes.every((route) => route.closed)).toBe(true)

    await talk.controller.start('en', 'zh-Hans')
    expect(talk.state()).toBe('listening')
    expect(talk.targets()).toEqual(['zh-Hans', 'en'])

    // The suppression the interrupted playback left behind is gone.
    const realAudio = encodeCaptureChunk(
      new Float32Array([0.5, -0.5]),
      16_000,
      16_000,
    )
    expect(talk.hear([0.5, -0.5])).toEqual([realAudio, realAudio])
    await talk.controller.stop()
  })
})

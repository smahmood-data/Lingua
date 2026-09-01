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

import { PLAYBACK_ECHO_GUARD_MS, UTTERANCE_JOIN_MS } from './config'
import { encodeCaptureChunk } from './audio/pcm'
import { TranslationSession } from './translationSession'
import type {
  ConversationTurn,
  SourceLanguageCode,
  SupportedLanguageCode,
} from './types'

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
    enqueue: vi.fn(() => true),
    endStream: vi.fn(),
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

describe('TranslationSession idle protection', () => {
  beforeEach(() => {
    dependencies.createPlaybackScheduler.mockReset()
    dependencies.startMicrophoneCapture.mockReset()
    dependencies.connectLiveTransport.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T20:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function startIdleProtectedSession() {
    const captureResource = capture()
    const playbackResource = playback()
    const transportResource = transport()
    const connectedEvents: LiveTransportEvents[] = []

    dependencies.createPlaybackScheduler.mockResolvedValue(playbackResource)
    dependencies.startMicrophoneCapture.mockResolvedValue(captureResource)
    dependencies.connectLiveTransport.mockImplementation(
      async (options: LiveTransportOptions) => {
        connectedEvents.push(options.events)
        return transportResource
      },
    )

    const controller = new TranslationSession({
      tokenProvider: vi.fn(async () => ({
        token: 'auth_tokens/test-ephemeral-token',
        model: 'test-live-model',
        systemInstruction: 'Test instruction',
      })),
      idleTimeoutMs: 1_000,
      idleWarningLeadMs: 200,
    })
    await controller.start('auto', 'en')
    const events = connectedEvents[0]
    if (!events) throw new Error('The Live route did not expose its events.')

    return {
      controller,
      events,
      captureResource,
      playbackResource,
      transportResource,
    }
  }

  it('warns shortly before a silent session expires', async () => {
    const { controller } = await startIdleProtectedSession()

    await vi.advanceTimersByTimeAsync(799)
    expect(controller.getSnapshot().idleWarningEndsAt).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    expect(controller.getSnapshot()).toMatchObject({
      state: 'listening',
      idleWarningEndsAt: Date.now() + 200,
    })

    await controller.stop()
  })

  it('clears the warning and restarts the deadline when speech begins', async () => {
    const { controller, events } = await startIdleProtectedSession()

    await vi.advanceTimersByTimeAsync(800)
    expect(controller.getSnapshot().idleWarningEndsAt).not.toBeNull()

    events.onSpeechStart(1)
    expect(controller.getSnapshot().idleWarningEndsAt).toBeNull()

    await vi.advanceTimersByTimeAsync(799)
    expect(controller.getSnapshot().idleWarningEndsAt).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(controller.getSnapshot().idleWarningEndsAt).toBe(Date.now() + 200)

    await controller.stop()
  })

  it('stops and releases every resource when inactivity continues', async () => {
    const {
      controller,
      captureResource,
      playbackResource,
      transportResource,
    } = await startIdleProtectedSession()
    const stopped = new Promise<void>((resolveStopped) => {
      const unsubscribe = controller.subscribe((snapshot) => {
        if (snapshot.state !== 'stopped') return
        unsubscribe()
        resolveStopped()
      })
    })

    await vi.advanceTimersByTimeAsync(1_000)
    await stopped

    expect(controller.getSnapshot()).toMatchObject({
      state: 'stopped',
      idleWarningEndsAt: null,
      idleTimeoutEndedAt: Date.now(),
    })
    expect(captureResource.stop).toHaveBeenCalledOnce()
    expect(playbackResource.dispose).toHaveBeenCalledOnce()
    expect(transportResource.close).toHaveBeenCalledOnce()
  })

  it('does not report inactivity when the user ends the session', async () => {
    const { controller } = await startIdleProtectedSession()

    await vi.advanceTimersByTimeAsync(800)
    await controller.stop()

    expect(controller.getSnapshot()).toMatchObject({
      state: 'stopped',
      idleWarningEndsAt: null,
      idleTimeoutEndedAt: null,
    })
  })

  it('clears the inactivity notice when a new session starts', async () => {
    const { controller } = await startIdleProtectedSession()
    const stopped = new Promise<void>((resolveStopped) => {
      const unsubscribe = controller.subscribe((snapshot) => {
        if (snapshot.state !== 'stopped') return
        unsubscribe()
        resolveStopped()
      })
    })

    await vi.advanceTimersByTimeAsync(1_000)
    await stopped
    expect(controller.getSnapshot().idleTimeoutEndedAt).not.toBeNull()

    await controller.start()
    expect(controller.getSnapshot()).toMatchObject({
      state: 'listening',
      idleTimeoutEndedAt: null,
    })

    await controller.stop()
  })
})



/**
 * A two-person conversation driven through a real `TranslationSession`.
 *
 * The point of these tests is who is speaking. Every open route hears the same
 * microphone and reports on the same speech, so each utterance is delivered to
 * all of them and the test says what each one made of it — including the ways
 * the real API gets it wrong, which is what the ownership rules exist for.
 */

/** One recognisable byte per language, so playback can be attributed. */
const VOICES: Record<string, number> = {
  en: 1,
  'zh-Hans': 2,
  bn: 3,
  es: 4,
  fr: 5,
}

const voiceOf = (language: string) => new Uint8Array([VOICES[language], 0])

interface FakeRoute {
  target: SupportedLanguageCode
  events: LiveTransportEvents
  sent: string[]
  closed: boolean
  /** Monotonic id of the human utterance this route is reporting. */
  utterance: number
  /** Monotonic id of the model response this route is producing. */
  generation: number
}

/** What one route made of an utterance everybody heard. */
interface RouteOutcome {
  /** Text the model generated. Equal to the source when it is parroting. */
  translation?: string
  /** Whether the model also spoke that text aloud. */
  audio?: boolean
  /** Suppress this route's own generationComplete, as an interruption does. */
  noCompletion?: boolean
}

interface Conversation {
  controller: TranslationSession
  routes: FakeRoute[]
  /** Targets of the open routes, in the order they were opened. */
  targets: () => string[]
  /** Languages actually played aloud, oldest first. */
  heard: () => string[]
  /** Committed conversation as `sourceLanguage:source > target:translation`. */
  rows: () => string[]
  turns: () => ConversationTurn[]
  state: () => string
  counterpart: () => SupportedLanguageCode | null
  playbackPending: () => boolean
  /** Play the queued translation out to its end, the way the browser does. */
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
  let streamEnded = false
  let onPlaybackStart = () => {}
  let onPlaybackEnd = () => {}
  let refused = false

  const endPlayback = () => {
    if (!playbackActive) return
    playbackActive = false
    streamEnded = false
    onPlaybackEnd()
  }

  dependencies.createPlaybackScheduler.mockImplementation(
    async (options: {
      onPlaybackStart: () => void
      onPlaybackEnd: () => void
    }) => {
      onPlaybackStart = options.onPlaybackStart
      onPlaybackEnd = options.onPlaybackEnd
      const scheduler: PlaybackScheduler = {
        enqueue: (pcm16) => {
          played.push(pcm16)
          streamEnded = false
          if (!playbackActive) {
            playbackActive = true
            onPlaybackStart()
          }
          return true
        },
        // The real scheduler waits for the audio clock to reach the end of what
        // is queued; here the test decides when that happens.
        endStream: () => {
          streamEnded = true
        },
        flush: endPlayback,
        remainingMs: () => (playbackActive ? 1000 : 0),
        // The real scheduler flushes before it closes its AudioContext.
        dispose: async () => endPlayback(),
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
        utterance: 0,
        generation: 0,
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
        .turns.map(
          (turn) =>
            `${turn.sourceLanguage ?? '?'}:${turn.sourceText}` +
            (turn.translatedText
              ? ` > ${turn.targetLanguage ?? '?'}:${turn.translatedText}`
              : ''),
        ),
    turns: () => controller.getSnapshot().turns,
    state: () => controller.getSnapshot().state,
    counterpart: () => controller.getSnapshot().counterpartLanguage,
    playbackPending: () => playbackActive,
    finishPlayback: () => {
      // The browser only reports an end for audio the producer has finished.
      if (playbackActive && streamEnded) endPlayback()
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
    // A new thing was said, so this route moves on to its next utterance.
    route.utterance += 1
    route.events.onInterimTranscript(
      {
        text: said.text.slice(0, Math.ceil(said.text.length / 2)),
        languageCode,
      },
      route.utterance,
    )
    route.events.onSourceTranscript(
      { text: said.text, languageCode },
      true,
      route.utterance,
    )
    if (outcome.translation !== undefined || outcome.audio) {
      route.generation += 1
    }
    if (outcome.translation !== undefined) {
      route.events.onTranslationTranscript(
        { text: outcome.translation },
        route.generation,
      )
    }
    if (outcome.audio) {
      route.events.onAudio(voiceOf(route.target), route.generation)
    }
    if (outcome.audio && !outcome.noCompletion) {
      route.events.onGenerationComplete(route.generation)
    }
    route.events.onTurnEnd(route.utterance, route.generation)
  }

  // Adopting a counterpart opens a route, which is asynchronous.
  await vi.advanceTimersByTimeAsync(0)
}

/** One whole exchange: somebody speaks and the translation plays out. */
async function exchange(
  talk: Conversation,
  said: { language: string; text: string; reportedAs?: string | null },
  produced: Record<string, RouteOutcome>,
): Promise<void> {
  await speak(talk, said, produced)
  talk.finishPlayback()
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

    await exchange(
      talk,
      { language: 'en', text: 'Hello, how are you?' },
      {
        'zh-Hans': { translation: '你好，你好吗？', audio: true },
        en: {},
      },
    )
    await exchange(
      talk,
      { language: 'zh-Hans', text: '我很好，谢谢。' },
      {
        'zh-Hans': {},
        en: { translation: 'I am well, thank you.', audio: true },
      },
    )

    expect(talk.rows()).toEqual([
      'en:Hello, how are you? > zh-Hans:你好，你好吗？',
      'zh-Hans:我很好，谢谢。 > en:I am well, thank you.',
    ])
    expect(talk.heard()).toEqual(['zh-Hans', 'en'])
    expect(talk.state()).toBe('listening')
    // One socket per direction, opened once for the whole conversation.
    expect(talk.connectCount()).toBe(2)
  })

  it('completes six alternating turns without restarting or doubling audio', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })
    const script = [
      ['en', 'Hey, how are you?', 'Hola, ¿cómo estás?'],
      ['es', 'Bien, ¿y tú?', 'Good, and you?'],
      ['en', 'I am good, thanks.', 'Estoy bien, gracias.'],
      ['es', 'Me alegro mucho.', 'I am very glad.'],
      ['en', 'Where are you from?', '¿De dónde eres?'],
      ['es', 'Soy de Madrid.', 'I am from Madrid.'],
    ] as const

    for (const [language, text, translation] of script) {
      const speaking = language === 'en' ? 'es' : 'en'
      await exchange(
        talk,
        { language, text },
        {
          [speaking]: { translation, audio: true },
          [language]: {},
        },
      )
      expect(talk.state()).toBe('listening')
    }

    expect(talk.turns()).toHaveLength(6)
    expect(talk.rows()).toEqual([
      'en:Hey, how are you? > es:Hola, ¿cómo estás?',
      'es:Bien, ¿y tú? > en:Good, and you?',
      'en:I am good, thanks. > es:Estoy bien, gracias.',
      'es:Me alegro mucho. > en:I am very glad.',
      'en:Where are you from? > es:¿De dónde eres?',
      'es:Soy de Madrid. > en:I am from Madrid.',
    ])
    expect(talk.heard()).toEqual(['es', 'en', 'es', 'en', 'es', 'en'])
    expect(talk.connectCount()).toBe(2)
  })

  it('never reads the speaker their own words back', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })

    // The English route mis-identifies the speech and hands it straight back.
    await exchange(
      talk,
      { language: 'en', text: 'Hey, how are you?' },
      {
        es: { translation: 'Hola, ¿cómo estás?', audio: true },
        en: { translation: 'Hey, how are you?', audio: true },
      },
    )

    expect(talk.heard()).toEqual(['es'])
    expect(talk.rows()).toEqual(['en:Hey, how are you? > es:Hola, ¿cómo estás?'])
  })

  it('names the speaker from which route interpreted when no code is reported', async () => {
    const talk = await conversation({ source: 'es', target: 'en' })

    await exchange(
      talk,
      { language: 'es', text: 'Bien, ¿y tú?', reportedAs: null },
      {
        en: { translation: 'Good, and you?', audio: true },
        es: {},
      },
    )

    // Nothing said which language this was, but the route that spoke renders
    // into English, so the speaker used the other side of the pair.
    expect(talk.heard()).toEqual(['en'])
    expect(talk.rows()).toEqual(['es:Bien, ¿y tú? > en:Good, and you?'])
  })

  it('resolves a third-language label onto a side of the configured pair', async () => {
    const talk = await conversation({ source: 'bn', target: 'en' })

    await exchange(
      talk,
      { language: 'en', text: 'Hey, how are you?', reportedAs: 'vi' },
      {
        bn: { translation: 'আপনি কেমন আছেন?', audio: true },
        en: {},
      },
    )

    // There is no Vietnamese speaker in an English/Bengali conversation, and
    // the route that spoke renders into Bengali, so English was spoken.
    expect(talk.rows()).toEqual([
      'en:Hey, how are you? > bn:আপনি কেমন আছেন?',
    ])
    expect(talk.counterpart()).toBe('bn')
  })

  it('keeps Bengali script over a Latin transliteration of the same speech', async () => {
    const talk = await conversation({ source: 'bn', target: 'en' })
    const english = talk.routes.find((route) => route.target === 'en')!
    const bengali = talk.routes.find((route) => route.target === 'bn')!

    for (const route of [english, bengali]) route.utterance += 1
    // The two sockets transcribe one utterance differently: one returns the
    // language's own script, the other a romanisation of it.
    english.events.onSourceTranscript(
      { text: 'আপনি কেমন আছেন?', languageCode: 'bn' },
      true,
      english.utterance,
    )
    bengali.events.onSourceTranscript(
      { text: 'Apni kemon achen? Bhalo to?', languageCode: 'bn' },
      true,
      bengali.utterance,
    )
    english.generation += 1
    english.events.onTranslationTranscript(
      { text: 'How are you?' },
      english.generation,
    )
    english.events.onAudio(voiceOf('en'), english.generation)
    english.events.onGenerationComplete(english.generation)
    for (const route of [english, bengali]) {
      route.events.onTurnEnd(route.utterance, route.generation)
    }
    talk.finishPlayback()

    expect(talk.rows()).toEqual(['bn:আপনি কেমন আছেন? > en:How are you?'])
  })

  it('hears the second speaker as soon as the translation has played', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })

    await speak(
      talk,
      { language: 'en', text: 'Hey, how are you?' },
      { es: { translation: 'Hola, ¿cómo estás?', audio: true }, en: {} },
    )
    expect(talk.state()).toBe('playing')

    talk.finishPlayback()
    expect(talk.state()).toBe('listening')

    await exchange(
      talk,
      { language: 'es', text: 'Bien, ¿y tú?' },
      { en: { translation: 'Good, and you?', audio: true }, es: {} },
    )

    expect(talk.rows()).toEqual([
      'en:Hey, how are you? > es:Hola, ¿cómo estás?',
      'es:Bien, ¿y tú? > en:Good, and you?',
    ])
    expect(talk.heard()).toEqual(['es', 'en'])
  })

  it('learns the other language in auto mode and answers back in it', async () => {
    const talk = await conversation({ source: 'auto', target: 'en' })
    expect(talk.targets()).toEqual(['en'])
    expect(talk.counterpart()).toBeNull()

    await exchange(
      talk,
      { language: 'es', text: 'Bien, ¿y tú?' },
      { en: { translation: 'Good, and you?', audio: true } },
    )

    expect(talk.counterpart()).toBe('es')
    expect(talk.targets()).toEqual(['en', 'es'])

    await exchange(
      talk,
      { language: 'en', text: 'I am good, thanks.' },
      {
        es: { translation: 'Estoy bien, gracias.', audio: true },
        en: {},
      },
    )

    expect(talk.heard()).toEqual(['en', 'es'])
    expect(talk.rows()).toEqual([
      'es:Bien, ¿y tú? > en:Good, and you?',
      'en:I am good, thanks. > es:Estoy bien, gracias.',
    ])
  })

  it('adopts Spanish after an English-only auto turn and keeps the pair', async () => {
    const talk = await conversation({ source: 'auto', target: 'en' })

    // Nothing to interpret and nothing to say: the English speaker is already
    // speaking the language this session renders into.
    await exchange(talk, { language: 'en', text: 'Hey, how are you?' }, { en: {} })
    expect(talk.counterpart()).toBeNull()
    expect(talk.heard()).toEqual([])
    expect(talk.rows()).toEqual(['en:Hey, how are you?'])
    expect(talk.state()).toBe('listening')

    await exchange(
      talk,
      { language: 'es', text: 'Bien, ¿y tú?' },
      { en: { translation: 'Good, and you?', audio: true } },
    )
    expect(talk.counterpart()).toBe('es')

    // A single mislabelled utterance does not move the pair once it is settled.
    await exchange(
      talk,
      { language: 'es', text: 'Muy bien.', reportedAs: 'fr' },
      { en: { translation: 'Very good.', audio: true }, es: {} },
    )
    expect(talk.counterpart()).toBe('es')
    expect(talk.targets()).toEqual(['en', 'es'])
    expect(talk.connectCount()).toBe(2)
  })

  it('keeps an explicit pair when the model reports a third language', async () => {
    const talk = await conversation({ source: 'es', target: 'en' })

    await exchange(
      talk,
      { language: 'es', text: 'Bien, ¿y tú?', reportedAs: 'fr' },
      { en: { translation: 'Good, and you?', audio: true }, es: {} },
    )

    expect(talk.counterpart()).toBe('es')
    expect(talk.targets()).toEqual(['en', 'es'])
    expect(talk.heard()).toEqual(['en'])
  })

  it('keeps interpreting when the return route cannot be opened', async () => {
    const talk = await conversation({
      source: 'auto',
      target: 'en',
      failTarget: 'es',
    })

    await exchange(
      talk,
      { language: 'es', text: 'Bien, ¿y tú?' },
      { en: { translation: 'Good, and you?', audio: true } },
    )

    expect(talk.targets()).toEqual(['en'])
    expect(talk.rows()).toEqual(['es:Bien, ¿y tú? > en:Good, and you?'])
    expect(talk.state()).toBe('listening')
  })

  it('silences the microphone while the translation plays and reopens it after', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })
    const room = [0.5, -0.5, 0.25, -0.25]
    const silent = encodeCaptureChunk(new Float32Array(room.length), 16_000, 16_000)

    expect(talk.hear(room).every((chunk) => chunk !== silent)).toBe(true)

    await speak(
      talk,
      { language: 'en', text: 'Hey, how are you?' },
      { es: { translation: 'Hola, ¿cómo estás?', audio: true }, en: {} },
    )
    expect(talk.state()).toBe('playing')
    expect(talk.hear(room).every((chunk) => chunk === silent)).toBe(true)

    talk.finishPlayback()
    expect(talk.state()).toBe('listening')
    // A brief echo guard, and then the next person is heard normally.
    expect(talk.hear(room).every((chunk) => chunk === silent)).toBe(true)
    vi.setSystemTime(Date.now() + PLAYBACK_ECHO_GUARD_MS + 1)
    expect(talk.hear(room).every((chunk) => chunk !== silent)).toBe(true)
  })

  it('keeps hearing the room while an utterance is being interpreted', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })
    const room = [0.5, -0.5, 0.25, -0.25]
    const silent = encodeCaptureChunk(new Float32Array(room.length), 16_000, 16_000)
    const spanish = talk.routes.find((route) => route.target === 'es')!

    spanish.utterance += 1
    spanish.events.onSourceTranscript(
      { text: 'Hey, how are you?', languageCode: 'en' },
      true,
      spanish.utterance,
    )

    // Nothing is coming out of the speakers between the end of a sentence and
    // the start of its translation, so there is nothing to echo — and this is
    // exactly the moment the other person starts talking. Closing the
    // microphone here is what made the second turn so often never happen.
    expect(talk.state()).toBe('translating')
    expect(talk.hear(room).every((chunk) => chunk !== silent)).toBe(true)
  })

  it('stops saying it is playing when the translation is cut off', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })

    await speak(
      talk,
      { language: 'en', text: 'Hey, how are you?' },
      { es: { translation: 'Hola, ¿cómo estás?', audio: true }, en: {} },
    )
    expect(talk.state()).toBe('playing')

    const spanish = talk.routes.find((route) => route.target === 'es')!
    spanish.events.onInterrupted(spanish.generation)
    expect(talk.state()).toBe('listening')
    expect(talk.playbackPending()).toBe(false)
  })

  it('drops only the interrupted route’s audio', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })

    await speak(
      talk,
      { language: 'en', text: 'Hey, how are you?' },
      { es: { translation: 'Hola, ¿cómo estás?', audio: true }, en: {} },
    )
    const english = talk.routes.find((route) => route.target === 'en')!
    english.events.onInterrupted(english.generation)

    // The English route was never being heard, so nothing it says can stop the
    // translation that is playing.
    expect(talk.state()).toBe('playing')
    expect(talk.playbackPending()).toBe(true)
  })

  it('never lets a second route speak the utterance after the first', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })
    const spanish = talk.routes.find((route) => route.target === 'es')!
    const english = talk.routes.find((route) => route.target === 'en')!

    spanish.utterance += 1
    spanish.generation += 1
    english.generation += 1
    spanish.events.onSourceTranscript(
      { text: 'Hey, how are you?', languageCode: 'en' },
      true,
      spanish.utterance,
    )
    spanish.events.onAudio(voiceOf('es'), spanish.generation)
    english.events.onAudio(voiceOf('en'), english.generation)
    english.events.onAudio(voiceOf('en'), english.generation)

    expect(talk.heard()).toEqual(['es'])
  })

  it('keeps one row for a sentence that arrives in fragments', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })
    const spanish = talk.routes.find((route) => route.target === 'es')!

    spanish.utterance += 1
    for (const text of ['Hey', 'Hey, how', 'Hey, how are', 'Hey, how are you?']) {
      spanish.events.onSourceTranscript(
        { text, languageCode: 'en' },
        false,
        spanish.utterance,
      )
    }
    spanish.events.onTurnEnd(spanish.utterance, spanish.generation)
    const english = talk.routes.find((route) => route.target === 'en')!
    english.events.onTurnEnd(english.utterance, english.generation)

    expect(talk.rows()).toEqual(['en:Hey, how are you?'])
  })

  it('keeps one row when both routes report the same speech', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })

    await exchange(
      talk,
      { language: 'en', text: 'Hey, how are you?' },
      {
        es: { translation: 'Hola, ¿cómo estás?', audio: true },
        // The English route hears it too and says so, but has nothing to add.
        en: {},
      },
    )

    expect(talk.rows()).toEqual(['en:Hey, how are you? > es:Hola, ¿cómo estás?'])
  })

  it('shows the live caption while somebody is speaking and drops it after', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })
    const spanish = talk.routes.find((route) => route.target === 'es')!

    spanish.utterance += 1
    spanish.events.onInterimTranscript(
      { text: 'Hey, how', languageCode: 'en' },
      spanish.utterance,
    )
    expect(talk.controller.getSnapshot().interimTranscript?.text).toBe('Hey, how')

    spanish.events.onSourceTranscript(
      { text: 'Hey, how are you?', languageCode: 'en' },
      true,
      spanish.utterance,
    )
    expect(talk.controller.getSnapshot().interimTranscript).toBeNull()
    expect(talk.rows()).toEqual(['en:Hey, how are you?'])
  })

  it('starts clean after a stop in the middle of a translation', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })

    await speak(
      talk,
      { language: 'en', text: 'Hey, how are you?' },
      { es: { translation: 'Hola, ¿cómo estás?', audio: true }, en: {} },
    )
    expect(talk.state()).toBe('playing')

    await talk.controller.stop()
    expect(talk.state()).toBe('stopped')
    expect(talk.playbackPending()).toBe(false)
    expect(talk.routes.every((route) => route.closed)).toBe(true)

    await talk.controller.start('en', 'es')
    expect(talk.state()).toBe('listening')
    expect(talk.controller.getSnapshot().interimTranscript).toBeNull()
  })

  it('forgets an adopted auto pair and all route runs across stop/start', async () => {
    const talk = await conversation({ source: 'auto', target: 'en' })

    await exchange(
      talk,
      { language: 'es', text: 'Bien, ¿y tú?' },
      { en: { translation: 'Good, and you?', audio: true } },
    )
    expect(talk.counterpart()).toBe('es')
    expect(talk.targets()).toEqual(['en', 'es'])

    await talk.controller.stop()
    expect(talk.counterpart()).toBeNull()
    expect(talk.routes.every((route) => route.closed)).toBe(true)

    await talk.controller.start('auto', 'en')
    expect(talk.targets()).toEqual(['en'])
    expect(talk.counterpart()).toBeNull()

    await exchange(
      talk,
      { language: 'en', text: 'Hello again.' },
      { en: {} },
    )
    await vi.advanceTimersByTimeAsync(UTTERANCE_JOIN_MS)
    expect(talk.turns().at(-1)).toMatchObject({
      sourceLanguage: 'en',
      sourceText: 'Hello again.',
      translatedText: '',
      status: 'complete',
    })
  })

  it('clears the conversation without touching the session', async () => {
    const talk = await conversation({ source: 'en', target: 'es' })

    await exchange(
      talk,
      { language: 'en', text: 'Hey, how are you?' },
      { es: { translation: 'Hola, ¿cómo estás?', audio: true }, en: {} },
    )
    expect(talk.turns()).toHaveLength(1)

    talk.controller.clearTranscript()
    expect(talk.turns()).toEqual([])
    expect(talk.state()).toBe('listening')
  })
})

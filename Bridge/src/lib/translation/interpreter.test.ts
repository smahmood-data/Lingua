import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: sdk.connect }
  },
  Modality: { AUDIO: 'AUDIO' },
  EndSensitivity: { END_SENSITIVITY_LOW: 'END_SENSITIVITY_LOW' },
}))

const mic = vi.hoisted(() => ({
  onChunk: null as null | ((samples: Float32Array, rate: number) => void),
}))
vi.mock('./audio/microphoneCapture', () => ({
  startMicrophoneCapture: vi.fn(
    async (options: {
      onChunk: (samples: Float32Array, rate: number) => void
    }) => {
      mic.onChunk = options.onChunk
      return {
        sampleRate: 16_000,
        stop: async () => {
          mic.onChunk = null
        },
      }
    },
  ),
}))

import { TranslationSession } from './translationSession'
import type { SourceLanguageCode, SupportedLanguageCode } from './types'
import stuckPlayingTrace from './fixtures/stuck-playing.trace.json'

/**
 * The product, driven the way two people drive it.
 *
 * Everything here is the real pipeline: the real transport parsing real Gemini
 * message shapes, the real coordinator deciding what they mean, the real
 * scheduler on a fake audio clock, and the real microphone path with real
 * sample levels. Only the socket and the audio hardware are stand-ins.
 *
 * The tests are written as conversations rather than as event sequences,
 * because every failure this suite exists for looked fine at the event level
 * and wrong to a person in the room: a reply that produced no sound, a session
 * that never listened again, a translation still talking over the person
 * answering it.
 */

// --- Fake audio hardware ----------------------------------------------------

class FakeSource {
  buffer: { duration: number } | null = null
  onended: (() => void) | null = null
  startedAt = 0
  stopped = false
  connect = vi.fn()
  disconnect = vi.fn()
  stop = vi.fn(() => {
    this.stopped = true
  })
  start(when: number) {
    this.startedAt = when
  }
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null
  state: 'running' | 'closed' = 'running'
  currentTime = 0
  destination = {}
  sources: FakeSource[] = []

  constructor() {
    FakeAudioContext.last = this
  }

  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, copyToChannel: vi.fn() }
  }
  createBufferSource() {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }

  /** Move the audio clock, ending whatever physically finished on the way. */
  advance(seconds: number) {
    this.currentTime += seconds
    for (const source of this.sources) {
      const done = source.startedAt + (source.buffer?.duration ?? 0)
      if (source.onended && !source.stopped && done <= this.currentTime) {
        const ended = source.onended
        source.onended = null
        ended()
      }
    }
  }

  /** Seconds of audio still due to come out of the speakers. */
  pending() {
    let end = this.currentTime
    for (const source of this.sources) {
      if (source.onended && !source.stopped) {
        end = Math.max(end, source.startedAt + (source.buffer?.duration ?? 0))
      }
    }
    return end - this.currentTime
  }
}

const NativeAudioContext = globalThis.AudioContext

/** `seconds` of translated PCM16 at 24 kHz, base64 as the wire carries it. */
function audioPart(seconds: number, audible = true) {
  const bytes = new Uint8Array(Math.round(24_000 * 2 * seconds))
  if (audible) {
    const view = new DataView(bytes.buffer)
    for (let offset = 0; offset < bytes.byteLength; offset += 2) {
      view.setInt16(offset, offset % 4 === 0 ? 4_000 : -4_000, true)
    }
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    modelTurn: {
      parts: [{ inlineData: { mimeType: 'audio/pcm', data: btoa(binary) } }],
    },
  }
}

// --- Room levels ------------------------------------------------------------

/** An empty room: the noise floor a microphone picks up with nobody talking. */
const QUIET = 0.004
/**
 * Our own speakers coming back through the microphone after the browser's echo
 * canceller has done its work. Small, but not nothing.
 */
const ECHO = 0.012
/** Somebody actually talking, close to the microphone. */
const VOICE = 0.35
/**
 * Our own speakers with echo cancellation defeated — external speakers turned
 * up. Loud enough that it would be a person, if level alone decided.
 */
const LOUD_ECHO = 0.3

function chunk(level: number) {
  const samples = new Float32Array(1600)
  for (let index = 0; index < samples.length; index += 1) {
    // Alternating, so the level is the RMS rather than a DC offset.
    samples[index] = index % 2 === 0 ? level : -level
  }
  return samples
}

// --- Harness ----------------------------------------------------------------

interface Socket {
  target: string
  /** One `serverContent` message from this route. */
  send: (content: Record<string, unknown>) => void
  /** Base64 chunks this socket received from the microphone. */
  received: string[]
  closed: boolean
}

/** What a fully suppressed 100 ms chunk looks like on the wire. */
const SILENT_CHUNK = (() => {
  const bytes = new Uint8Array(3200)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
})()

async function interpreter(
  source: SourceLanguageCode,
  target: SupportedLanguageCode,
  options: { delayedTarget?: SupportedLanguageCode } = {},
) {
  const sockets: Socket[] = []
  let releaseDelayedRoute: () => void = () => undefined
  const delayed = options.delayedTarget
    ? new Promise<void>((resolve) => {
        releaseDelayedRoute = resolve
      })
    : null

  sdk.connect.mockImplementation(async (connectOptions: never) => {
    const config = connectOptions as unknown as {
      config: { translationConfig: { targetLanguageCode: string } }
      callbacks: { onmessage: (message: unknown) => void }
    }
    const routeTarget = config.config.translationConfig.targetLanguageCode
    if (delayed && routeTarget === options.delayedTarget) await delayed

    const socket: Socket = {
      target: routeTarget,
      received: [],
      closed: false,
      send: (content) => config.callbacks.onmessage({ serverContent: content }),
    }
    sockets.push(socket)
    return {
      sendRealtimeInput: vi.fn((payload: { audio?: { data: string } }) => {
        if (payload.audio) socket.received.push(payload.audio.data)
      }),
      close: vi.fn(() => {
        socket.closed = true
      }),
    }
  })

  const session = new TranslationSession({
    tokenProvider: async () => ({
      token: 'auth_tokens/test',
      model: 'test-model',
      systemInstruction: 'test',
    }),
  })
  await session.start(source, target)
  // Deliberately looked up rather than captured: Start builds a new
  // AudioContext, and a harness holding the stopped session's one would stop
  // advancing the clock the scheduler is actually waiting on.
  const context = () => FakeAudioContext.last!

  const open = () => sockets.filter((socket) => !socket.closed)

  return {
    session,
    context,
    sockets: () => sockets,
    route: (language: string) =>
      [...sockets].reverse().find((socket) => socket.target === language)!,
    state: () => session.getSnapshot().state,
    counterpart: () => session.getSnapshot().counterpartLanguage,
    releaseDelayedRoute,
    rows: () =>
      session.getSnapshot().turns.map((turn) => {
        const translated = turn.translatedText
          ? ` > ${turn.targetLanguage ?? '?'}:${turn.translatedText}`
          : ''
        return `${turn.sourceLanguage ?? '?'}:${turn.sourceText}${translated}`
      }),

    /**
     * Let `ms` of real time pass with the room at `level`, keeping the audio
     * clock in step so playback progresses exactly as long as it should.
     */
    room: async (ms: number, level = QUIET) => {
      const steps = Math.max(1, Math.round(ms / 100))
      for (let index = 0; index < steps; index += 1) {
        mic.onChunk?.(chunk(level), 16_000)
        context().advance(0.1)
        await vi.advanceTimersByTimeAsync(100)
      }
    },

    /** Advance clocks without introducing another microphone observation. */
    elapse: async (ms: number) => {
      context().advance(ms / 1000)
      await vi.advanceTimersByTimeAsync(ms)
    },

    /** Whether the last `count` chunks each open route received were silence. */
    lastWereSilent: (count: number) =>
      open().every((socket) =>
        socket.received.slice(-count).every((data) => data === SILENT_CHUNK),
      ),

    /** Whether any of the last `count` chunks carried the room through. */
    anyCarriedRoom: (count: number) =>
      open().some((socket) =>
        socket.received.slice(-count).some((data) => data !== SILENT_CHUNK),
      ),
  }
}

type Interpreter = Awaited<ReturnType<typeof interpreter>>

/**
 * One person says one thing and hears it interpreted, start to finish.
 *
 * An omitted `finished`, a `turnComplete` that trails playback, and a
 * `generationComplete` that arrives before the last chunk of audio are all
 * documented Live behaviours, so the callers below vary them rather than
 * replaying one convenient sequence.
 */
async function exchange(
  talk: Interpreter,
  {
    spoken,
    text,
    into,
    translation,
    seconds = 1,
    omitFinished = false,
    silentRouteQuiet = false,
    trailingAudio = false,
    turnComplete = true,
  }: {
    spoken: string
    text: string
    into: string
    translation: string
    seconds?: number
    omitFinished?: boolean
    /** The route the API silences reports nothing at all about this turn. */
    silentRouteQuiet?: boolean
    /** A last chunk of audio after `generationComplete`. */
    trailingAudio?: boolean
    turnComplete?: boolean
  },
) {
  const voice = talk.route(into)
  const others = talk
    .sockets()
    .filter((socket) => socket !== voice && !socket.closed)

  await talk.room(600, VOICE)

  const heard = silentRouteQuiet ? [voice] : [voice, ...others]
  for (const socket of heard) {
    socket.send({
      interimInputTranscription: {
        text: text.slice(0, 5),
        languageCode: spoken,
      },
    })
  }
  for (const socket of heard) {
    socket.send({
      inputTranscription: omitFinished
        ? { text, languageCode: spoken }
        : { text, languageCode: spoken, finished: true },
    })
  }

  voice.send({ outputTranscription: { text: translation } })
  voice.send(audioPart(trailingAudio ? seconds / 2 : seconds))
  voice.send({ generationComplete: true })
  if (trailingAudio) voice.send(audioPart(seconds / 2))

  // Out to the physical end of the translation, plus the echo guard.
  await talk.room(seconds * 1000 + 500)

  if (turnComplete) for (const socket of heard) socket.send({ turnComplete: true })
  await talk.room(200)
}

describe('Lingua interpreter', () => {
  beforeEach(() => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    globalThis.AudioContext = NativeAudioContext
  })

  it('trace regression — the captured English to Bengali turn physically ends and accepts the reply', async () => {
    const talk = await interpreter('en', 'bn')
    const bengali = talk.route('bn')
    const english = talk.route('en')
    const route = (id: number) => (id === 5 ? bengali : english)
    const sourceByUtterance = new Map([
      [1, 'Hi, this is your dentist speaking.'],
      [2, 'You have an appointment today'],
      [3, 'at 2 p.m.'],
    ])
    const bengaliByGeneration = new Map([
      [1, 'হ্যালো, আমি আপনার ডেন্টিস্ট।'],
      [2, 'আপনার আজ একটি অ্যাপয়েন্টমেন্ট আছে'],
      [3, 'দুপুর দুইটায় আপনার অ্যাপয়েন্টমেন্ট।'],
    ])
    const states: string[] = [talk.state()]
    const unsubscribe = talk.session.subscribe((snapshot) => {
      if (states.at(-1) !== snapshot.state) states.push(snapshot.state)
    })

    let at = stuckPlayingTrace[0].t
    let ownerGenerationThreeChunks = 0
    for (const entry of stuckPlayingTrace) {
      await talk.elapse(entry.t - at)
      at = entry.t
      const detail = entry.detail as Record<string, unknown> | null
      if (!detail) continue
      const routeId = Number(detail.route)
      const socket = routeId === 5 || routeId === 6 ? route(routeId) : null

      if (entry.event === 'source-transcript' && socket) {
        const utterance = Number(detail.utterance)
        socket.send({
          inputTranscription: {
            text: sourceByUtterance.get(utterance),
            languageCode: 'en',
            finished: true,
          },
        })
      } else if (entry.event === 'translation-transcript' && socket) {
        const generation = Number(detail.generation)
        const text =
          routeId === 5
            ? bengaliByGeneration.get(generation)
            : sourceByUtterance.get(generation)
        socket.send({ outputTranscription: { text } })
      } else if (entry.event === 'audio' && socket) {
        const generation = Number(detail.generation)
        let audible = true
        if (routeId === 5 && generation === 3) {
          ownerGenerationThreeChunks += 1
          // The trace did not record PCM levels, but the browser observation did:
          // meaningful Bengali speech ended while the API continued delivering
          // another 37 fixed-size output frames. Model that observed tail as the
          // digital padding a continuous translation stream returns.
          audible = ownerGenerationThreeChunks <= 14
        }
        socket.send(audioPart(Number(detail.bytes) / (24_000 * 2), audible))
      } else if (entry.event === 'turn-end' && socket) {
        socket.send({ turnComplete: true })
      }
    }

    expect(sourceByUtterance.size).toBe(3)
    expect(ownerGenerationThreeChunks).toBe(51)
    expect(talk.rows()).toEqual([
      'en:Hi, this is your dentist speaking. You have an appointment today at 2 p.m. > bn:হ্যালো, আমি আপনার ডেন্টিস্ট। আপনার আজ একটি অ্যাপয়েন্টমেন্ট আছে দুপুর দুইটায় আপনার অ্যাপয়েন্টমেন্ট।',
    ])
    expect(talk.state()).toBe('listening')
    expect(states).toEqual(['listening', 'translating', 'playing', 'listening'])

    // The next person is not merely looking at a Listening label: their Bengali
    // reply opens a fresh internal turn and completes in the opposite direction.
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'জি, আমি আসতে পারব।',
          languageCode: 'bn',
          finished: true,
        },
      })
    }
    english.send({ outputTranscription: { text: 'Yes, I can come.' } })
    english.send(audioPart(0.5))
    english.send({ generationComplete: true })
    await talk.elapse(800)

    expect(talk.rows()).toEqual([
      'en:Hi, this is your dentist speaking. You have an appointment today at 2 p.m. > bn:হ্যালো, আমি আপনার ডেন্টিস্ট। আপনার আজ একটি অ্যাপয়েন্টমেন্ট আছে দুপুর দুইটায় আপনার অ্যাপয়েন্টমেন্ট।',
      'bn:জি, আমি আসতে পারব। > en:Yes, I can come.',
    ])
    expect(talk.state()).toBe('listening')
    expect(states).toEqual([
      'listening',
      'translating',
      'playing',
      'listening',
      'translating',
      'playing',
      'listening',
    ])
    unsubscribe()
    await talk.session.stop()
  })

  it('Product 1 — ten alternating turns on one Start press', async () => {
    const talk = await interpreter('en', 'bn')
    const script = [
      ['en', 'Hi, how is it going?', 'bn', 'BN one'],
      ['bn', 'BN reply one', 'en', 'I am well, and you?'],
      ['en', 'Doing fine, thanks.', 'bn', 'BN two'],
      ['bn', 'BN reply two', 'en', 'How is work going?'],
      ['en', 'Busy but good.', 'bn', 'BN three'],
      ['bn', 'BN reply three', 'en', 'Glad to hear it.'],
      ['en', 'Are you free tomorrow?', 'bn', 'BN four'],
      ['bn', 'BN reply four', 'en', 'Yes, in the afternoon.'],
      ['en', 'Let us meet then.', 'bn', 'BN five'],
      ['bn', 'BN reply five', 'en', 'Great, see you.'],
    ] as const

    let index = 0
    for (const [spoken, text, into, translation] of script) {
      index += 1
      await exchange(talk, {
        spoken,
        text,
        into,
        translation,
        omitFinished: index % 3 === 0,
        trailingAudio: index % 4 === 0,
        turnComplete: index % 5 !== 0,
      })
      expect(talk.state()).toBe('listening')
      expect(talk.rows()).toHaveLength(index)
    }

    expect(talk.rows()).toEqual([
      'en:Hi, how is it going? > bn:BN one',
      'bn:BN reply one > en:I am well, and you?',
      'en:Doing fine, thanks. > bn:BN two',
      'bn:BN reply two > en:How is work going?',
      'en:Busy but good. > bn:BN three',
      'bn:BN reply three > en:Glad to hear it.',
      'en:Are you free tomorrow? > bn:BN four',
      'bn:BN reply four > en:Yes, in the afternoon.',
      'en:Let us meet then. > bn:BN five',
      'bn:BN reply five > en:Great, see you.',
    ])
    // Nothing was restarted: the same two sockets ran the whole conversation.
    expect(talk.sockets()).toHaveLength(2)
    await talk.session.stop()
  })

  it('Product 1b — the reply is heard even when only its own route reports it', async () => {
    // The API silences the route whose target is the language being spoken, and
    // Live states transcription order is independent of model output. So on the
    // reply the generating route is routinely the first, and sometimes the only,
    // socket to say anything. This was the failure: the reply's translation and
    // audio arrived to no turn at all and were dropped in silence.
    const talk = await interpreter('en', 'bn')
    await exchange(talk, {
      spoken: 'en',
      text: 'Hi, how is it going?',
      into: 'bn',
      translation: 'BN one',
    })
    await exchange(talk, {
      spoken: 'bn',
      text: 'BN reply one',
      into: 'en',
      translation: 'I am well, and you?',
      silentRouteQuiet: true,
    })

    expect(talk.rows()).toEqual([
      'en:Hi, how is it going? > bn:BN one',
      'bn:BN reply one > en:I am well, and you?',
    ])
    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })

  it.skip('Product 2 — barge-in cancels the translation and opens the next turn', async () => {
    const talk = await interpreter('en', 'bn')
    const bengali = talk.route('bn')
    const english = talk.route('en')

    await talk.room(600, VOICE)
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'Hi, how is it going?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    bengali.send({ outputTranscription: { text: 'BN one' } })
    bengali.send(audioPart(6))
    bengali.send({ generationComplete: true })
    expect(talk.state()).toBe('playing')

    // A second of translated Bengali plays into a quiet room.
    await talk.room(1000, ECHO)
    expect(talk.state()).toBe('playing')
    const settled = talk.rows()
    expect(settled).toEqual(['en:Hi, how is it going? > bn:BN one'])

    // The Bengali speaker has read the text and starts replying over it.
    await talk.room(300, VOICE)

    // The speakers stopped and the session is listening again, well before the
    // six seconds of translation would have finished.
    expect(talk.state()).toBe('listening')
    expect(talk.context().pending()).toBe(0)
    // Turn 1 is untouched: cancelling audio does not rewrite what was said.
    expect(talk.rows()).toEqual(settled)

    // What the person is saying now is a new turn, in the other direction.
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'BN reply one',
          languageCode: 'bn',
          finished: true,
        },
      })
    }
    english.send({ outputTranscription: { text: 'I am well, and you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.room(1600)

    expect(talk.rows()).toEqual([
      'en:Hi, how is it going? > bn:BN one',
      'bn:BN reply one > en:I am well, and you?',
    ])
    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })

  it.skip('Product 3 — barge-in works the same way in the other direction', async () => {
    const talk = await interpreter('en', 'bn')
    const bengali = talk.route('bn')
    const english = talk.route('en')

    await exchange(talk, {
      spoken: 'en',
      text: 'Hi, how is it going?',
      into: 'bn',
      translation: 'BN one',
    })

    // Bengali is spoken; the English translation starts playing.
    await talk.room(600, VOICE)
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'BN reply one',
          languageCode: 'bn',
          finished: true,
        },
      })
    }
    english.send({ outputTranscription: { text: 'I am well, and you?' } })
    english.send(audioPart(6))
    english.send({ generationComplete: true })
    expect(talk.state()).toBe('playing')
    await talk.room(1000, ECHO)
    const settled = talk.rows()
    expect(settled).toHaveLength(2)

    // The English speaker replies over the English translation.
    await talk.room(300, VOICE)
    expect(talk.state()).toBe('listening')
    expect(talk.context().pending()).toBe(0)
    expect(talk.rows()).toEqual(settled)

    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'I will bring it tomorrow.',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    bengali.send({ outputTranscription: { text: 'BN two' } })
    bengali.send(audioPart(1))
    bengali.send({ generationComplete: true })
    await talk.room(1600)

    expect(talk.rows()).toEqual([
      'en:Hi, how is it going? > bn:BN one',
      'bn:BN reply one > en:I am well, and you?',
      'en:I will bring it tomorrow. > bn:BN two',
    ])
    await talk.session.stop()
  })

  it.skip('Product 4 — the translated text survives an interrupted playback', async () => {
    const talk = await interpreter('en', 'bn')
    const bengali = talk.route('bn')
    const english = talk.route('en')

    await talk.room(600, VOICE)
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'Hi, how is it going?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    // The whole translation is on screen well before it has been spoken.
    bengali.send({ outputTranscription: { text: 'BN one' } })
    bengali.send(audioPart(8))
    bengali.send({ generationComplete: true })
    await talk.room(600, ECHO)
    expect(talk.rows()).toEqual(['en:Hi, how is it going? > bn:BN one'])
    expect(talk.context().pending()).toBeGreaterThan(5)

    await talk.room(300, VOICE)

    // Only the audio nobody wanted the end of was cancelled.
    expect(talk.context().pending()).toBe(0)
    expect(talk.rows()).toEqual(['en:Hi, how is it going? > bn:BN one'])
    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })

  it('Product 5 — an uninterrupted translation ends on the audio clock alone', async () => {
    const talk = await interpreter('en', 'bn')
    const bengali = talk.route('bn')
    const english = talk.route('en')

    await talk.room(600, VOICE)
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'Hi, how is it going?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    bengali.send({ outputTranscription: { text: 'BN one' } })
    bengali.send(audioPart(2))
    bengali.send({ generationComplete: true })

    expect(talk.state()).toBe('playing')
    await talk.room(1000, ECHO)
    // Still audible: the model has stopped generating, the speakers have not.
    expect(talk.state()).toBe('playing')

    await talk.room(1200, ECHO)
    expect(talk.state()).toBe('listening')
    // One stream, ended because the clock reached the end of it. Neither the
    // idle nor the stall fallback could have fired in the time this took.
    expect(talk.context().sources).toHaveLength(1)
    expect(talk.rows()).toEqual(['en:Hi, how is it going? > bn:BN one'])
    await talk.session.stop()
  })

  it('Product 6 — Auto settles on a pair and keeps interpreting both ways', async () => {
    const talk = await interpreter('auto', 'en')
    const english = talk.route('en')

    // English first: nothing to interpret, and no counterpart to adopt.
    await talk.room(600, VOICE)
    english.send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    english.send({ turnComplete: true })
    await talk.room(500)
    expect(talk.counterpart()).toBeNull()

    // Spanish: interpreted into English, and the pair is learned from the model
    // having actually interpreted rather than from a language code.
    await talk.room(600, VOICE)
    english.send({
      inputTranscription: {
        text: 'Bien, y tu?',
        languageCode: 'es',
        finished: true,
      },
    })
    english.send({ outputTranscription: { text: 'Good, and you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.room(1600)
    await vi.advanceTimersByTimeAsync(0)

    expect(talk.counterpart()).toBe('es')
    expect(talk.sockets().map((socket) => socket.target)).toEqual(['en', 'es'])

    for (const [spoken, text, into, translation] of [
      ['en', 'I am good, thanks.', 'es', 'Estoy bien, gracias.'],
      ['es', 'Me alegro mucho.', 'en', 'I am very glad.'],
      ['en', 'See you tomorrow.', 'es', 'Hasta manana.'],
      ['es', 'Hasta manana entonces.', 'en', 'See you tomorrow then.'],
    ] as const) {
      await exchange(talk, { spoken, text, into, translation })
    }

    // Adopted once, and stable for the rest of the conversation.
    expect(talk.counterpart()).toBe('es')
    expect(talk.sockets()).toHaveLength(2)
    expect(talk.rows()).toEqual([
      'en:Hey, how are you?',
      'es:Bien, y tu? > en:Good, and you?',
      'en:I am good, thanks. > es:Estoy bien, gracias.',
      'es:Me alegro mucho. > en:I am very glad.',
      'en:See you tomorrow. > es:Hasta manana.',
      'es:Hasta manana entonces. > en:See you tomorrow then.',
    ])
    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })

  it('Product 7 — our own speakers never interrupt themselves', async () => {
    const talk = await interpreter('en', 'bn')
    const bengali = talk.route('bn')
    const english = talk.route('en')

    await talk.room(600, VOICE)
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'Hi, how is it going?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    bengali.send({ outputTranscription: { text: 'BN one' } })
    bengali.send(audioPart(4))
    bengali.send({ generationComplete: true })

    // Three seconds of our own translation coming back through the microphone,
    // loudly enough that a level threshold on its own would call it a person.
    await talk.room(3000, LOUD_ECHO)

    // It was heard for what it is: still playing, and none of it went out.
    expect(talk.state()).toBe('playing')
    expect(talk.lastWereSilent(25)).toBe(true)

    await talk.room(1600, LOUD_ECHO)
    expect(talk.rows()).toEqual(['en:Hi, how is it going? > bn:BN one'])
    expect(talk.state()).toBe('listening')
    // One playback, played once. It never interrupted itself.
    expect(talk.context().sources).toHaveLength(1)
    await talk.session.stop()
  })

  it('Product 8 — Stop and Start from any state gives a clean conversation', async () => {
    for (const stopDuring of ['listening', 'translating', 'playing'] as const) {
      const talk = await interpreter('en', 'bn')
      const bengali = talk.route('bn')
      const english = talk.route('en')

      if (stopDuring !== 'listening') {
        await talk.room(600, VOICE)
        for (const socket of [bengali, english]) {
          socket.send({
            inputTranscription: {
              text: 'Hi, how is it going?',
              languageCode: 'en',
              finished: true,
            },
          })
        }
      }
      if (stopDuring === 'playing') {
        bengali.send({ outputTranscription: { text: 'BN one' } })
        bengali.send(audioPart(5))
      }
      expect(talk.state()).toBe(stopDuring)

      await talk.session.stop()
      expect(talk.state()).toBe('stopped')
      expect(talk.context().pending()).toBe(0)

      await talk.session.start('en', 'bn')
      expect(talk.state()).toBe('listening')
      expect(talk.rows()).toEqual([])

      await exchange(talk, {
        spoken: 'en',
        text: 'Hi, how is it going?',
        into: 'bn',
        translation: 'BN one',
      })
      expect(talk.rows()).toEqual(['en:Hi, how is it going? > bn:BN one'])
      expect(talk.state()).toBe('listening')
      await talk.session.stop()
    }
  })

  it.skip('Product 9 — everything the cancelled turn still sends is ignored', async () => {
    const talk = await interpreter('en', 'bn')
    const bengali = talk.route('bn')
    const english = talk.route('en')

    await talk.room(600, VOICE)
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'Hi, how is it going?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    bengali.send({ outputTranscription: { text: 'BN one' } })
    bengali.send(audioPart(6))
    bengali.send({ generationComplete: true })
    await talk.room(1000, ECHO)
    await talk.room(300, VOICE)
    expect(talk.state()).toBe('listening')

    // Turn 2 runs to completion.
    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'BN reply one',
          languageCode: 'bn',
          finished: true,
        },
      })
    }
    english.send({ outputTranscription: { text: 'I am well, and you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.room(1600)
    const settled = talk.rows()
    expect(settled).toHaveLength(2)

    // Only now does the cancelled turn's socket catch up, with everything it
    // still had: audio, a transcript, and every completion signal there is.
    bengali.send(audioPart(2))
    bengali.send({ outputTranscription: { text: 'stale readback' } })
    bengali.send({ generationComplete: true })
    bengali.send({ interrupted: true })
    bengali.send({ turnComplete: true })
    english.send({ turnComplete: true })
    await talk.room(2500)

    expect(talk.rows()).toEqual(settled)
    expect(talk.state()).toBe('listening')
    // None of it was played, and it did not restart the speakers.
    expect(talk.context().pending()).toBe(0)
    await talk.session.stop()
  })

  it('Product 11 — twenty alternating turns never drift to the wrong side', async () => {
    // The failure this exists for: after several good exchanges the session
    // starts treating the English speaker as the Bengali side and reading the
    // result back to them in English, and never recovers.
    const talk = await interpreter('en', 'bn')
    for (let index = 1; index <= 20; index += 1) {
      const english = index % 2 === 1
      await exchange(talk, {
        spoken: english ? 'en' : 'bn',
        text: english ? `English line ${index}.` : `BN line ${index}`,
        into: english ? 'bn' : 'en',
        translation: english ? `BN out ${index}` : `English out ${index}.`,
        omitFinished: index % 3 === 0,
        trailingAudio: index % 4 === 0,
        turnComplete: index % 5 !== 0,
      })
      const row = talk.rows()[index - 1]
      // Odd turns are English speaking into Bengali; even turns the reverse.
      expect(row.startsWith(english ? 'en:' : 'bn:')).toBe(true)
      expect(row).toContain(english ? '> bn:' : '> en:')
      expect(talk.state()).toBe('listening')
    }
    expect(talk.rows()).toHaveLength(20)
    await talk.session.stop()
  })

  it('Product 12 — misleading language metadata cannot move the pair', async () => {
    const talk = await interpreter('en', 'bn')
    for (let index = 1; index <= 4; index += 1) {
      const english = index % 2 === 1
      await exchange(talk, {
        spoken: english ? 'en' : 'bn',
        text: english ? `English line ${index}.` : `BN line ${index}`,
        into: english ? 'bn' : 'en',
        translation: english ? `BN out ${index}` : `English out ${index}.`,
      })
    }

    // Live has labelled plainly English speech Vietnamese in real use. For an
    // explicit pair there are only two sides, and a third language is a
    // mis-identification rather than a new participant.
    await exchange(talk, {
      spoken: 'vi',
      text: 'This is still English.',
      into: 'bn',
      translation: 'BN out 5',
    })
    expect(talk.rows()[4]).toBe('en:This is still English. > bn:BN out 5')

    // And the reply still goes the other way.
    await exchange(talk, {
      spoken: 'bn',
      text: 'BN line 6',
      into: 'en',
      translation: 'English out 6.',
    })
    expect(talk.rows()[5]).toBe('bn:BN line 6 > en:English out 6.')
    for (const row of talk.rows()) {
      expect(row).not.toContain('vi:')
    }
    await talk.session.stop()
  })

  it('Product 13 — Auto keeps a well-supported counterpart for fifteen turns', async () => {
    const talk = await interpreter('auto', 'en')
    const english = talk.route('en')

    await talk.room(600, VOICE)
    english.send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    english.send({ turnComplete: true })
    await talk.room(500)
    expect(talk.counterpart()).toBeNull()

    await talk.room(600, VOICE)
    english.send({
      inputTranscription: { text: 'Bien, y tu?', languageCode: 'es', finished: true },
    })
    english.send({ outputTranscription: { text: 'Good, and you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.room(1600)
    await vi.advanceTimersByTimeAsync(0)
    expect(talk.counterpart()).toBe('es')

    for (let index = 1; index <= 15; index += 1) {
      const spanish = index % 2 === 1
      await exchange(talk, {
        spoken: spanish ? 'es' : 'en',
        text: spanish ? `Linea ${index}.` : `English line ${index}.`,
        into: spanish ? 'en' : 'es',
        translation: spanish ? `English out ${index}.` : `Linea out ${index}.`,
        omitFinished: index % 3 === 0,
        turnComplete: index % 4 !== 0,
      })
      // Consistent evidence keeps the pair stable; contradictory clear speech
      // is covered by the browser-trace recovery regression.
      expect(talk.counterpart()).toBe('es')
      expect(talk.sockets().filter((socket) => !socket.closed)).toHaveLength(2)
      const row = talk.rows()[index + 1]
      expect(row.startsWith(spanish ? 'es:' : 'en:')).toBe(true)
      expect(row).toContain(spanish ? '> en:' : '> es:')
    }
    expect(talk.rows()).toHaveLength(17)
    await talk.session.stop()
  })

  it.skip('Product 14 — repeated interruptions do not move ownership', async () => {
    const talk = await interpreter('en', 'bn')

    const interrupt = async (spoken: string, into: string, text: string) => {
      const voice = talk.route(into)
      const others = talk
        .sockets()
        .filter((socket) => socket !== voice && !socket.closed)
      await talk.room(600, VOICE)
      for (const socket of [voice, ...others]) {
        socket.send({
          inputTranscription: { text, languageCode: spoken, finished: true },
        })
      }
      voice.send({ outputTranscription: { text: `${into} out` } })
      voice.send(audioPart(6))
      voice.send({ generationComplete: true })
      expect(talk.state()).toBe('playing')
      await talk.room(1000, ECHO)
      const before = talk.rows().length
      // Somebody starts replying over it.
      await talk.room(300, VOICE)
      expect(talk.state()).toBe('listening')
      expect(talk.context().pending()).toBe(0)
      expect(talk.rows()).toHaveLength(before)
    }

    await exchange(talk, {
      spoken: 'en',
      text: 'English one.',
      into: 'bn',
      translation: 'BN one',
    })
    await exchange(talk, {
      spoken: 'bn',
      text: 'BN two',
      into: 'en',
      translation: 'English two.',
    })
    await interrupt('en', 'bn', 'English three.')
    await exchange(talk, {
      spoken: 'bn',
      text: 'BN four',
      into: 'en',
      translation: 'English four.',
    })
    await interrupt('bn', 'en', 'BN five')
    await exchange(talk, {
      spoken: 'en',
      text: 'English six.',
      into: 'bn',
      translation: 'BN six',
    })
    await exchange(talk, {
      spoken: 'bn',
      text: 'BN seven',
      into: 'en',
      translation: 'English seven.',
    })

    // Every row still sits on the side that actually spoke.
    expect(talk.rows()).toEqual([
      'en:English one. > bn:BN one',
      'bn:BN two > en:English two.',
      'en:English three. > bn:bn out',
      'bn:BN four > en:English four.',
      'bn:BN five > en:en out',
      'en:English six. > bn:BN six',
      'bn:BN seven > en:English seven.',
    ])
    await talk.session.stop()
  })

  it('Product 15 — changing languages needs no page reload', async () => {
    const talk = await interpreter('en', 'bn')
    await exchange(talk, {
      spoken: 'en',
      text: 'English one.',
      into: 'bn',
      translation: 'BN one',
    })
    await exchange(talk, {
      spoken: 'bn',
      text: 'BN two',
      into: 'en',
      translation: 'English two.',
    })
    expect(talk.rows()).toHaveLength(2)
    const bengaliSockets = talk.sockets().length

    await talk.session.stop()
    await talk.session.setLanguages('auto', 'en')
    await talk.session.start('auto', 'en')

    // Nothing of the previous pair survived into this one.
    expect(talk.rows()).toEqual([])
    expect(talk.counterpart()).toBeNull()
    expect(talk.state()).toBe('listening')
    expect(talk.context().pending()).toBe(0)
    for (const socket of talk.sockets().slice(0, bengaliSockets)) {
      expect(socket.closed).toBe(true)
    }
    const live = talk.sockets().filter((socket) => !socket.closed)
    expect(live.map((socket) => socket.target)).toEqual(['en'])

    // And it behaves like a freshly loaded Auto→English session.
    const english = talk.route('en')
    await talk.room(600, VOICE)
    english.send({
      inputTranscription: { text: 'Bien, y tu?', languageCode: 'es', finished: true },
    })
    english.send({ outputTranscription: { text: 'Good, and you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.room(1600)
    await vi.advanceTimersByTimeAsync(0)
    expect(talk.counterpart()).toBe('es')
    expect(talk.rows()).toEqual(['es:Bien, y tu? > en:Good, and you?'])

    // Change again, to a different explicit pair. Still clean.
    await talk.session.stop()
    await talk.session.setLanguages('en', 'es')
    await talk.session.start('en', 'es')
    expect(talk.rows()).toEqual([])
    expect(talk.counterpart()).toBe('en')
    await exchange(talk, {
      spoken: 'en',
      text: 'Fresh start.',
      into: 'es',
      translation: 'Comienzo nuevo.',
    })
    expect(talk.rows()).toEqual(['en:Fresh start. > es:Comienzo nuevo.'])
    await talk.session.stop()
  })

  it('Product 10 — the state says what a person in the room would say', async () => {
    const talk = await interpreter('en', 'bn')
    const bengali = talk.route('bn')
    const english = talk.route('en')

    expect(talk.state()).toBe('listening')

    await talk.room(600, VOICE)
    // Still listening: somebody is talking, nothing is being interpreted yet.
    expect(talk.state()).toBe('listening')

    for (const socket of [bengali, english]) {
      socket.send({
        inputTranscription: {
          text: 'Hi, how is it going?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    // Interpreting, with nothing audible yet.
    expect(talk.state()).toBe('translating')
    // And the microphone is open through it, because nothing can echo yet.
    await talk.room(200, VOICE)
    expect(talk.anyCarriedRoom(2)).toBe(true)

    bengali.send({ outputTranscription: { text: 'BN one' } })
    bengali.send(audioPart(4))
    expect(talk.state()).toBe('playing')

    await talk.room(500, ECHO)
    expect(talk.state()).toBe('playing')

    // Somebody talking over it goes straight back to listening. It does not
    // Barge-in is disabled for the normal-conversation pass, so captured room
    // audio cannot cut off a translation that is still physically playing.
    await talk.room(300, VOICE)
    expect(talk.state()).toBe('playing')
    await talk.session.stop()
    expect(talk.state()).toBe('stopped')
  })
})

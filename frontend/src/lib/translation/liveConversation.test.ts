import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: sdk.connect }
  },
  Modality: { AUDIO: 'AUDIO' },
  EndSensitivity: { END_SENSITIVITY_LOW: 'END_SENSITIVITY_LOW' },
}))
vi.mock('./audio/microphoneCapture', () => ({
  startMicrophoneCapture: vi.fn(async () => ({
    sampleRate: 16_000,
    stop: async () => undefined,
  })),
}))

import { TranslationSession } from './translationSession'
import type { SourceLanguageCode, SupportedLanguageCode } from './types'

/**
 * The whole pipeline, driven by Gemini Live messages.
 *
 * Nothing here is mocked except the socket and the audio hardware: the real
 * transport parses the messages, the real coordinator decides what they mean,
 * and the real scheduler runs against a fake Web Audio clock. These are the
 * orderings that broke in a browser while every unit test passed — a reply
 * spoken before the server's delayed `turnComplete`, audio after
 * `generationComplete`, a clock that stops moving.
 */

class FakeSource {
  buffer: { duration: number } | null = null
  onended: (() => void) | null = null
  startedAt = 0
  connect = vi.fn()
  disconnect = vi.fn()
  stop = vi.fn()
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

  /** Let the speakers finish everything scheduled, as the browser would. */
  playOut() {
    let end = this.currentTime
    for (const source of this.sources) {
      end = Math.max(end, source.startedAt + (source.buffer?.duration ?? 0))
    }
    this.currentTime = end
    for (const source of this.sources) {
      const ended = source.onended
      source.onended = null
      ended?.()
    }
  }
}

const NativeAudioContext = globalThis.AudioContext

/** `seconds` of silent PCM16 at 24 kHz, base64 as the wire carries it. */
function audioPart(seconds: number) {
  const bytes = new Uint8Array(Math.round(24_000 * 2 * seconds))
  const view = new DataView(bytes.buffer)
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    view.setInt16(offset, offset % 4 === 0 ? 4_000 : -4_000, true)
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    modelTurn: {
      parts: [{ inlineData: { mimeType: 'audio/pcm', data: btoa(binary) } }],
    },
  }
}

interface Socket {
  target: string
  send: (content: Record<string, unknown>) => void
}

async function live(
  source: SourceLanguageCode,
  target: SupportedLanguageCode,
  delayedTarget?: SupportedLanguageCode,
) {
  const sockets: Socket[] = []
  let releaseDelayedRoute: () => void = () => undefined
  const delayedRoute = delayedTarget
    ? new Promise<void>((resolve) => {
        releaseDelayedRoute = resolve
      })
    : null
  sdk.connect.mockImplementation(async (options: never) => {
    const config = options as unknown as {
      config: { translationConfig: { targetLanguageCode: string } }
      callbacks: { onmessage: (message: unknown) => void }
    }
    if (
      delayedRoute &&
      config.config.translationConfig.targetLanguageCode === delayedTarget
    ) {
      await delayedRoute
    }
    sockets.push({
      target: config.config.translationConfig.targetLanguageCode,
      send: (content) => config.callbacks.onmessage({ serverContent: content }),
    })
    return { sendRealtimeInput: vi.fn(), close: vi.fn() }
  })

  const session = new TranslationSession({
    tokenProvider: async () => ({
      token: 'auth_tokens/test',
      model: 'test-model',
      systemInstruction: 'test',
    }),
  })
  await session.start(source, target)
  const context = FakeAudioContext.last!

  return {
    session,
    context,
    route: (language: string) => sockets.find((s) => s.target === language)!,
    routes: () => sockets,
    state: () => session.getSnapshot().state,
    sources: () => session.getSnapshot().turns.map((turn) => turn.sourceText),
    rows: () =>
      session
        .getSnapshot()
        .turns.map(
          (turn) =>
            `${turn.sourceLanguage ?? '?'}:${turn.sourceText}` +
            (turn.translatedText
              ? ` > ${turn.targetLanguage ?? '?'}:${turn.translatedText}`
              : ''),
        ),
    counterpart: () => session.getSnapshot().counterpartLanguage,
    releaseDelayedRoute,
    /** Play the queued translation out to its physical end. */
    finish: async () => {
      context.playOut()
      await vi.advanceTimersByTimeAsync(120)
    },
  }
}

describe('live conversation', () => {
  beforeEach(() => {
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    globalThis.AudioContext = NativeAudioContext
  })

  it('Test 1 — a normal turn ends when the last audio physically stops', async () => {
    const talk = await live('en', 'es')
    const spanish = talk.route('es')
    const english = talk.route('en')

    for (const route of [spanish, english]) {
      route.send({
        inputTranscription: {
          text: 'Hey, how are you?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    spanish.send({ outputTranscription: { text: 'Hola, ¿cómo estás?' } })
    spanish.send(audioPart(1))
    expect(talk.state()).toBe('playing')

    spanish.send({ generationComplete: true })
    // Still audible: the model has stopped generating, the speakers have not.
    expect(talk.state()).toBe('playing')

    await talk.finish()
    expect(talk.state()).toBe('listening')
    expect(talk.rows()).toEqual([
      'en:Hey, how are you? > es:Hola, ¿cómo estás?',
    ])
    // No watchdog was involved: the turn ended on the audio clock alone.
    expect(talk.context.sources).toHaveLength(1)
    await talk.session.stop()
  })

  it('Test 2 — the reply is its own turn, before the delayed turnComplete', async () => {
    const talk = await live('en', 'es')
    const spanish = talk.route('es')
    const english = talk.route('en')

    for (const route of [spanish, english]) {
      route.send({
        inputTranscription: {
          text: 'Hey, how are you?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    spanish.send({ outputTranscription: { text: 'Hola, ¿cómo estás?' } })
    spanish.send(audioPart(1))
    spanish.send({ generationComplete: true })
    await talk.finish()

    // The server has not sent `turnComplete` yet — it waits out its own
    // realtime playback estimate — and the second speaker is already replying.
    for (const route of [spanish, english]) {
      route.send({
        inputTranscription: {
          text: 'Hola, ¿cómo estás?',
          languageCode: 'es',
          finished: true,
        },
      })
    }
    english.send({ outputTranscription: { text: 'Hi, how are you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.finish()

    expect(talk.sources()).toEqual([
      'Hey, how are you?',
      'Hola, ¿cómo estás?',
    ])
    expect(talk.rows()).toEqual([
      'en:Hey, how are you? > es:Hola, ¿cómo estás?',
      'es:Hola, ¿cómo estás? > en:Hi, how are you?',
    ])
    expect(talk.state()).toBe('listening')
    expect(talk.context.sources).toHaveLength(2)
    await talk.session.stop()
  })

  it('Test 3 — everything the finished turn still sends is ignored', async () => {
    const talk = await live('en', 'es')
    const spanish = talk.route('es')
    const english = talk.route('en')

    for (const route of [spanish, english]) {
      route.send({
        inputTranscription: {
          text: 'Hey, how are you?',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    spanish.send({ outputTranscription: { text: 'Hola, ¿cómo estás?' } })
    spanish.send(audioPart(1))
    spanish.send({ generationComplete: true })
    await talk.finish()

    for (const route of [spanish, english]) {
      route.send({
        inputTranscription: {
          text: 'Hola, ¿cómo estás?',
          languageCode: 'es',
          finished: true,
        },
      })
    }
    english.send({ outputTranscription: { text: 'Hi, how are you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.finish()
    const settled = talk.rows()

    // The first turn's socket finally catches up. None of it may land on the
    // turn that is open now.
    spanish.send({ outputTranscription: { text: '你好，你好吗？' } })
    spanish.send(audioPart(1))
    spanish.send({ generationComplete: true })
    spanish.send({ turnComplete: true })
    english.send({ turnComplete: true })
    await vi.advanceTimersByTimeAsync(2000)

    expect(talk.rows()).toEqual(settled)
    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })

  it('Test 4 — auto mode ignores a language code the model never acted on', async () => {
    const talk = await live('auto', 'en')
    const english = talk.route('en')

    english.send({
      inputTranscription: {
        text: 'Hey, how are you? I am doing fine. And you?',
        languageCode: 'vi',
        finished: true,
      },
    })

    // Before the silent route settles, the noisy Latin-script code is not
    // credible enough even for a temporary speaker label.
    expect(talk.rows()).toEqual([
      '?:Hey, how are you? I am doing fine. And you?',
    ])
    expect(talk.counterpart()).toBeNull()

    english.send({ turnComplete: true })
    await vi.advanceTimersByTimeAsync(500)

    expect(talk.counterpart()).toBeNull()
    expect(talk.rows()).toEqual([
      'en:Hey, how are you? I am doing fine. And you?',
    ])
    expect(talk.routes()).toHaveLength(1)
    await talk.session.stop()
  })

  it('Test 5 — auto mode adopts the language it actually interpreted', async () => {
    const talk = await live('auto', 'en')
    const english = talk.route('en')

    english.send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    english.send({ turnComplete: true })
    await vi.advanceTimersByTimeAsync(300)
    expect(talk.counterpart()).toBeNull()

    english.send({
      inputTranscription: {
        text: 'Bien, ¿y tú?',
        languageCode: 'es',
        finished: true,
      },
    })
    english.send({ outputTranscription: { text: 'Good, and you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.finish()
    await vi.advanceTimersByTimeAsync(0)

    expect(talk.counterpart()).toBe('es')
    expect(talk.routes().map((route) => route.target)).toEqual(['en', 'es'])

    const spanish = talk.route('es')
    for (const route of [english, spanish]) {
      route.send({
        inputTranscription: {
          text: 'I am good, thanks.',
          languageCode: 'en',
          finished: true,
        },
      })
    }
    spanish.send({ outputTranscription: { text: 'Estoy bien, gracias.' } })
    spanish.send(audioPart(1))
    spanish.send({ generationComplete: true })
    await talk.finish()

    for (const route of [english, spanish]) {
      route.send({
        inputTranscription: {
          text: 'Me alegro mucho.',
          languageCode: 'es',
          finished: true,
        },
      })
    }
    english.send({ outputTranscription: { text: 'I am very glad.' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.finish()

    expect(talk.rows()).toEqual([
      'en:Hey, how are you?',
      'es:Bien, ¿y tú? > en:Good, and you?',
      'en:I am good, thanks. > es:Estoy bien, gracias.',
      'es:Me alegro mucho. > en:I am very glad.',
    ])
    await talk.session.stop()
  })

  it('does not listen for the first Auto reply before its return route opens', async () => {
    const talk = await live('auto', 'en', 'es')
    const english = talk.route('en')

    english.send({
      inputTranscription: {
        text: 'Bien, ¿y tú?',
        languageCode: 'es',
        finished: true,
      },
    })
    english.send({ outputTranscription: { text: 'Good, and you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.finish()

    expect(talk.counterpart()).toBe('es')
    expect(talk.routes().map((route) => route.target)).toEqual(['en'])
    expect(talk.state()).toBe('translating')

    talk.releaseDelayedRoute()
    await vi.advanceTimersByTimeAsync(0)

    expect(talk.routes().map((route) => route.target)).toEqual(['en', 'es'])
    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })

  it('seals an English auto turn before a Spanish reply without turnComplete', async () => {
    const talk = await live('auto', 'en')
    const english = talk.route('en')

    // Live Translate can omit the optional `finished` field, and its
    // `turnComplete` may trail realtime playback. This was the real browser
    // concatenation: the reply arrived while the first server turn was open.
    english.send({
      inputTranscription: {
        text: 'Hello, how are you?',
        languageCode: 'en',
      },
    })
    expect(talk.sources()).toEqual(['Hello, how are you?'])

    english.send({
      inputTranscription: {
        text: '¿Cómo estás?',
        languageCode: 'es',
      },
    })
    english.send({ outputTranscription: { text: 'How are you?' } })
    english.send(audioPart(0.5))
    english.send({ generationComplete: true })
    await talk.finish()

    expect(talk.sources()).toEqual(['Hello, how are you?', '¿Cómo estás?'])
    expect(talk.rows()).toEqual([
      'en:Hello, how are you?',
      'es:¿Cómo estás? > en:How are you?',
    ])
    expect(talk.sources()[0]).not.toContain('¿Cómo estás?')
    expect(talk.counterpart()).toBe('es')
    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })

  it('Test 6 — Bengali script is classified onto the Bengali side', async () => {
    const talk = await live('bn', 'en')
    const english = talk.route('en')
    const bengali = talk.route('bn')

    for (const route of [english, bengali]) {
      route.send({
        inputTranscription: {
          text: 'আপনি কেমন আছেন?',
          languageCode: 'bn',
          finished: true,
        },
      })
    }
    english.send({ outputTranscription: { text: 'How are you?' } })
    english.send(audioPart(1))
    english.send({ generationComplete: true })
    await talk.finish()

    expect(talk.rows()).toEqual(['bn:আপনি কেমন আছেন? > en:How are you?'])
    expect(talk.counterpart()).toBe('bn')
    await talk.session.stop()
  })

  it('Test 7 — both routes reporting one utterance make one turn', async () => {
    const talk = await live('en', 'es')

    for (const route of [talk.route('es'), talk.route('en')]) {
      route.send({
        interimInputTranscription: { text: 'Hey, how', languageCode: 'en' },
      })
      route.send({
        inputTranscription: {
          text: 'Hey, how are you?',
          languageCode: 'en',
          finished: true,
        },
      })
      route.send({ turnComplete: true })
    }
    await vi.advanceTimersByTimeAsync(500)

    expect(talk.sources()).toEqual(['Hey, how are you?'])
    await talk.session.stop()
  })

  it('Test 8 — the next speaker is heard right after the audio stops', async () => {
    const talk = await live('en', 'es')
    const spanish = talk.route('es')
    const english = talk.route('en')

    spanish.send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    spanish.send(audioPart(1))
    spanish.send({ generationComplete: true })
    await talk.finish()
    expect(talk.state()).toBe('listening')

    // Immediately, inside the echo guard.
    for (const route of [spanish, english]) {
      route.send({
        inputTranscription: {
          text: 'Bien, ¿y tú?',
          languageCode: 'es',
          finished: true,
        },
      })
    }
    expect(talk.sources()).toEqual(['Hey, how are you?', 'Bien, ¿y tú?'])
    await talk.session.stop()
  })

  it('Test 9 — six alternating turns on one Start press', async () => {
    const talk = await live('en', 'es')
    const script = [
      ['en', 'Hey, how are you?', 'es', 'Hola, ¿cómo estás?'],
      ['es', 'Bien, ¿y tú?', 'en', 'Good, and you?'],
      ['en', 'I am good, thanks.', 'es', 'Estoy bien, gracias.'],
      ['es', 'Me alegro mucho.', 'en', 'I am very glad.'],
      ['en', 'Where are you from?', 'es', '¿De dónde eres?'],
      ['es', 'Soy de Madrid.', 'en', 'I am from Madrid.'],
    ] as const

    for (const [spoken, text, into, translation] of script) {
      for (const route of talk.routes()) {
        route.send({
          inputTranscription: { text, languageCode: spoken, finished: true },
        })
      }
      const voice = talk.route(into)
      voice.send({ outputTranscription: { text: translation } })
      voice.send(audioPart(1))
      voice.send({ generationComplete: true })
      await talk.finish()
      expect(talk.state()).toBe('listening')
    }

    expect(talk.rows()).toEqual([
      'en:Hey, how are you? > es:Hola, ¿cómo estás?',
      'es:Bien, ¿y tú? > en:Good, and you?',
      'en:I am good, thanks. > es:Estoy bien, gracias.',
      'es:Me alegro mucho. > en:I am very glad.',
      'en:Where are you from? > es:¿De dónde eres?',
      'es:Soy de Madrid. > en:I am from Madrid.',
    ])
    expect(talk.context.sources).toHaveLength(6)
    await talk.session.stop()
  })

  it('recovers when the audio clock stops moving', async () => {
    const talk = await live('en', 'es')
    const spanish = talk.route('es')

    spanish.send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    spanish.send(audioPart(3))
    spanish.send({ generationComplete: true })
    expect(talk.state()).toBe('playing')

    // The output device goes away and `currentTime` freezes. Waiting on it is
    // waiting forever, and the microphone is silenced for exactly that long.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })

  it('ends the stream on turnComplete when audio trails generationComplete', async () => {
    const talk = await live('en', 'es')
    const spanish = talk.route('es')

    spanish.send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    spanish.send(audioPart(0.5))
    spanish.send({ generationComplete: true })
    // A trailing chunk after the completion signal reopens the stream.
    spanish.send(audioPart(0.5))
    spanish.send({ turnComplete: true })
    await talk.finish()

    expect(talk.state()).toBe('listening')
    await talk.session.stop()
  })
})

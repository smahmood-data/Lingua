import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: sdk.connect }
  },
  Modality: { AUDIO: 'AUDIO' },
  EndSensitivity: { END_SENSITIVITY_HIGH: 'END_SENSITIVITY_HIGH' },
}))

import {
  END_OF_SPEECH_SILENCE_MS,
  TRANSCRIPT_IDLE_FINALIZE_MS,
  TRANSCRIPT_SETTLE_MS,
} from './config'
import { connectLiveTransport, type LiveTransportEvents } from './liveTransport'

const NativeWebSocket = globalThis.WebSocket

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  close = vi.fn()

  constructor(url: string | URL) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }
}

function events(): { [K in keyof LiveTransportEvents]: ReturnType<typeof vi.fn> } {
  return {
    onAudio: vi.fn(),
    onSourceTranscript: vi.fn(),
    onTranslationTranscript: vi.fn(),
    onInterimTranscript: vi.fn(),
    onInterrupted: vi.fn(),
    onTurnEnd: vi.fn(),
    onClosed: vi.fn(),
    onError: vi.fn(),
  }
}

/** Open a transport against the mocked SDK and expose its message callback. */
async function openTransport({
  targetLanguage = 'en',
}: { targetLanguage?: 'en' | 'es' | 'zh-Hans' } = {}) {
  let onmessage!: (message: unknown) => void
  const sendRealtimeInput = vi.fn()
  const closeSession = vi.fn()
  sdk.connect.mockImplementation(async (options) => {
    onmessage = options.callbacks.onmessage
    new WebSocket('wss://example.test/live')
    return { sendRealtimeInput, close: closeSession }
  })

  const listeners = events()
  const transport = await connectLiveTransport({
    token: 'auth_tokens/test-ephemeral-token',
    model: 'test-live-model',
    targetLanguage,
    systemInstruction: 'Test instruction',
    signal: new AbortController().signal,
    events: listeners as unknown as LiveTransportEvents,
  })

  return {
    transport,
    listeners,
    sendRealtimeInput,
    closeSession,
    send: (serverContent: Record<string, unknown>) => onmessage({ serverContent }),
  }
}

const audioPart = (data: string) => ({
  parts: [{ inlineData: { data, mimeType: 'audio/pcm' } }],
})

describe('connectLiveTransport cancellation', () => {
  beforeEach(() => {
    sdk.connect.mockReset()
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = NativeWebSocket
  })

  it('closes the SDK socket while its setup handshake is still pending', async () => {
    let resolveLateConnection!: (session: { close: () => void }) => void
    const closeLateSession = vi.fn()
    sdk.connect.mockImplementation(() => {
      new WebSocket('wss://example.test/live')
      return new Promise((resolve) => {
        resolveLateConnection = resolve
      })
    })

    const abortController = new AbortController()
    const connecting = connectLiveTransport({
      token: 'auth_tokens/test-ephemeral-token',
      model: 'test-live-model',
      targetLanguage: 'ur',
      systemInstruction: 'Test instruction',
      signal: abortController.signal,
      events: events() as unknown as LiveTransportEvents,
    })

    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1)
    })
    expect(globalThis.WebSocket).toBe(FakeWebSocket)

    abortController.abort()

    await expect(connecting).rejects.toMatchObject({
      code: 'live-connection-failed',
    })
    expect(FakeWebSocket.instances[0]?.close).toHaveBeenCalledOnce()

    // If the SDK still resolves after its raw socket was abandoned, the
    // transport closes the late Session rather than leaking it.
    resolveLateConnection({ close: closeLateSession })
    await vi.waitFor(() => {
      expect(closeLateSession).toHaveBeenCalledOnce()
    })
  })

  it('does not ask the SDK to connect when already cancelled', async () => {
    const abortController = new AbortController()
    abortController.abort()

    await expect(
      connectLiveTransport({
        token: 'auth_tokens/test-ephemeral-token',
        model: 'test-live-model',
        targetLanguage: 'en',
        systemInstruction: 'Test instruction',
        signal: abortController.signal,
        events: events() as unknown as LiveTransportEvents,
      }),
    ).rejects.toMatchObject({ code: 'live-connection-failed' })

    expect(sdk.connect).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})

describe('connectLiveTransport endpointing', () => {
  beforeEach(() => {
    sdk.connect.mockReset()
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = NativeWebSocket
  })

  it('leaves end-of-speech sensitivity at the noise-tolerant default', async () => {
    await openTransport()

    // The low setting ends speech less often, which is how steady room noise
    // keeps a turn open indefinitely. Pause tolerance comes from the silence
    // duration instead.
    expect(sdk.connect.mock.calls[0]?.[0].config).toMatchObject({
      realtimeInputConfig: {
        automaticActivityDetection: {
          endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
          silenceDurationMs: END_OF_SPEECH_SILENCE_MS,
        },
      },
    })
  })

  it('updates one live caption while talking without committing rows', async () => {
    const { listeners, send } = await openTransport()

    for (const text of ['I need', 'I need to make', 'I need to make an appointment']) {
      send({ interimInputTranscription: { text, languageCode: 'en' } })
    }

    expect(listeners.onInterimTranscript).toHaveBeenCalledTimes(3)
    expect(listeners.onInterimTranscript.mock.calls.at(-1)?.[0]).toMatchObject({
      text: 'I need to make an appointment',
    })
    expect(listeners.onSourceTranscript).not.toHaveBeenCalled()
    expect(listeners.onTranslationTranscript).not.toHaveBeenCalled()
  })

  it('finalises a turn without waiting for turnComplete', async () => {
    const { listeners, send } = await openTransport()

    // `turnComplete` only arrives once the model has waited out its own
    // playback, several seconds after the speaker stopped. Nothing here may
    // depend on it.
    send({
      inputTranscription: {
        text: 'Hola, necesito una cita para el jueves.',
        languageCode: 'es',
      },
    })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SETTLE_MS)

    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onSourceTranscript.mock.calls[0]?.[0]).toMatchObject({
      text: 'Hola, necesito una cita para el jueves.',
      languageCode: 'es',
    })

    send({
      outputTranscription: { text: 'Hello, I need an appointment for Thursday.' },
      modelTurn: audioPart('AQI='),
      generationComplete: true,
    })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SETTLE_MS)

    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript.mock.calls[0]?.[0]).toMatchObject({
      text: 'Hello, I need an appointment for Thursday.',
    })
    expect(listeners.onAudio).toHaveBeenCalledOnce()
  })

  it('keeps one spoken sentence in one row', async () => {
    const { listeners, send } = await openTransport()

    send({ inputTranscription: { text: 'I need', languageCode: 'en-US' } })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SETTLE_MS - 100)
    send({
      inputTranscription: { text: 'to make an appointment', languageCode: 'en-US' },
    })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SETTLE_MS)

    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onSourceTranscript.mock.calls[0]?.[0]).toMatchObject({
      text: 'I need to make an appointment',
    })
  })

  it('waits for translation text that arrives after generation completed', async () => {
    const { listeners, send } = await openTransport()

    send({ inputTranscription: { text: 'Guten Morgen', languageCode: 'de' } })
    send({ generationComplete: true })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SETTLE_MS)
    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript).not.toHaveBeenCalled()

    // Output transcription is unordered against the rest of the turn, so a
    // late fragment must still reach the transcript rather than waiting for
    // `turnComplete` seconds later.
    send({ outputTranscription: { text: 'Good morning' } })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SETTLE_MS)

    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript.mock.calls[0]?.[0]).toMatchObject({
      text: 'Good morning',
    })
  })

  it('commits what was heard when the API never closes the turn', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: { text: 'Bonjour', languageCode: 'fr' },
      outputTranscription: { text: 'Good morning' },
    })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_IDLE_FINALIZE_MS)

    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
  })

  it('finalises around continuing background activity', async () => {
    const { listeners, send } = await openTransport()

    // Room noise keeps producing interim activity around the sentence. Only the
    // semantic signals may drive finalisation.
    send({ interimInputTranscription: { text: 'necesito', languageCode: 'es' } })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_IDLE_FINALIZE_MS * 2)
    expect(listeners.onSourceTranscript).not.toHaveBeenCalled()

    send({ interimInputTranscription: { text: 'necesito una cita', languageCode: 'es' } })
    send({
      inputTranscription: { text: 'Necesito una cita.', languageCode: 'es' },
      outputTranscription: { text: 'I need an appointment.' },
      generationComplete: true,
    })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SETTLE_MS)

    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()

    // The row is already committed by the time the model gets round to it.
    send({ turnComplete: true })
    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
  })

  it('publishes the text of an interrupted turn', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: { text: '¿Me puede ayudar?', languageCode: 'es' },
      outputTranscription: { text: 'Can you help me?' },
    })
    send({ interrupted: true })

    expect(listeners.onInterrupted).toHaveBeenCalledOnce()
    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
    // The utterance is over, so the session may re-arbitrate the next one.
    expect(listeners.onTurnEnd).toHaveBeenCalledOnce()
  })

  it('corrects an obvious script and language-code mismatch', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: { text: '你好，', languageCode: 'vi' },
      outputTranscription: { text: 'Hello,' },
    })
    send({
      inputTranscription: {
        text: '我想确认明天的预约。',
        languageCode: 'vi',
      },
      outputTranscription: {
        text: 'I want to confirm tomorrow’s appointment.',
      },
      generationComplete: true,
    })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_SETTLE_MS)

    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onSourceTranscript.mock.calls[0]?.[0]).toMatchObject({
      text: '你好，我想确认明天的预约。',
      languageCode: 'zh-Hans',
    })
    expect(listeners.onTranslationTranscript.mock.calls[0]?.[0]).toMatchObject({
      text: 'Hello, I want to confirm tomorrow’s appointment.',
    })
  })

  it('stops the settle windows when the caller closes the transport', async () => {
    const { listeners, send, transport, sendRealtimeInput, closeSession } =
      await openTransport()

    send({ inputTranscription: { text: 'Hola', languageCode: 'es' } })
    transport.close()
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_IDLE_FINALIZE_MS * 2)

    expect(listeners.onSourceTranscript).not.toHaveBeenCalled()
    expect(sendRealtimeInput).toHaveBeenCalledWith({ audioStreamEnd: true })
    expect(closeSession).toHaveBeenCalledOnce()
  })
})

describe('connectLiveTransport turn reporting', () => {
  beforeEach(() => {
    sdk.connect.mockReset()
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = NativeWebSocket
  })

  it('asks for one target language and no readback of it', async () => {
    await openTransport({ targetLanguage: 'zh-Hans' })

    // A route has no source-language setting to give: `translationConfig` only
    // takes a target, and not echoing it is what keeps the other route of the
    // pair the only one that speaks for this utterance.
    expect(sdk.connect.mock.calls[0]?.[0].config.translationConfig).toEqual({
      targetLanguageCode: 'zh-Hans',
      echoTargetLanguage: false,
    })
  })

  it('reports audio without deciding whether it may be heard', async () => {
    const { listeners, send } = await openTransport({ targetLanguage: 'es' })

    // The speaker is using this route's own target language, so the model is
    // parroting rather than translating. Only the session can tell, because
    // only it can see what the other route made of the same speech.
    send({
      inputTranscription: { text: 'Hola', languageCode: 'es' },
      outputTranscription: { text: 'Hola', languageCode: 'es' },
      modelTurn: audioPart('AQI='),
      turnComplete: true,
    })

    expect(listeners.onAudio).toHaveBeenCalledOnce()
    expect(listeners.onAudio.mock.calls[0]?.[0]).toEqual(new Uint8Array([1, 2]))
    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTurnEnd).toHaveBeenCalledOnce()
  })

  it('publishes a finished transcription without waiting out the settle window', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: {
        text: 'Necesito una cita.',
        languageCode: 'es',
        finished: true,
      },
      outputTranscription: { text: 'I need an appointment.', finished: true },
    })

    // The API said both are complete, so there is nothing left to wait for.
    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
  })

  it('closes the turn once, however the API ends it', async () => {
    const { listeners, send } = await openTransport()

    send({ inputTranscription: { text: 'Hola', languageCode: 'es' } })
    send({ generationComplete: true })
    send({ turnComplete: true })
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_IDLE_FINALIZE_MS * 2)

    // A route that reported a turn end it had already reported would release
    // the audio floor out from under the next utterance.
    expect(listeners.onTurnEnd).toHaveBeenCalledOnce()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: sdk.connect }
  },
  Modality: { AUDIO: 'AUDIO' },
  EndSensitivity: { END_SENSITIVITY_LOW: 'END_SENSITIVITY_LOW' },
}))

import {
  END_OF_SPEECH_SILENCE_MS,
  TRANSCRIPT_IDLE_FINALIZE_MS,
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
    onSpeechStart: vi.fn(),
    onSpeechEnd: vi.fn(),
    onAudio: vi.fn(),
    onSourceTranscript: vi.fn(),
    onTranslationTranscript: vi.fn(),
    onInterimTranscript: vi.fn(),
    onInterrupted: vi.fn(),
    onGenerationComplete: vi.fn(),
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
    sendMessage: (message: Record<string, unknown>) => onmessage(message),
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

  it('uses pause-tolerant end-of-speech detection', async () => {
    await openTransport()

    // The real traces split speech on ordinary pauses with HIGH sensitivity.
    // LOW is the API control that ends speech less readily; the explicit
    // silence duration still bounds the turn.
    expect(sdk.connect.mock.calls[0]?.[0].config).toMatchObject({
      realtimeInputConfig: {
        automaticActivityDetection: {
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
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

  it('reports transcription the moment it arrives', async () => {
    const { listeners, send } = await openTransport()

    // No settle window: the coordinator merges fragments into the one turn it
    // has open, so nothing here has to be delayed to keep a sentence together.
    send({
      inputTranscription: { text: 'Bien, ¿y tú?', languageCode: 'es' },
      outputTranscription: { text: 'Fine, and you?' },
      modelTurn: audioPart('AQI='),
    })

    expect(listeners.onSourceTranscript).toHaveBeenCalledOnce()
    expect(listeners.onSourceTranscript.mock.calls[0]).toEqual([
      expect.objectContaining({ text: 'Bien, ¿y tú?', languageCode: 'es' }),
      true,
      1,
    ])
    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
    expect(listeners.onAudio).toHaveBeenCalledOnce()
  })

  it('marks a transcription the API says is complete', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: {
        text: 'Hola, necesito una cita.',
        languageCode: 'es',
        finished: true,
      },
    })

    expect(listeners.onSourceTranscript.mock.calls[0]?.[1]).toBe(true)
  })

  it('reports generated-audio completion without waiting for turnComplete', async () => {
    const { listeners, send } = await openTransport()

    send({ generationComplete: true })

    expect(listeners.onGenerationComplete).toHaveBeenCalledOnce()
    expect(listeners.onTurnEnd).not.toHaveBeenCalled()
  })

  it('accumulates one spoken sentence across fragments', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: {
        text: 'I need',
        languageCode: 'en-US',
        finished: false,
      },
    })
    send({
      inputTranscription: {
        text: 'to make an appointment',
        languageCode: 'en-US',
        finished: true,
      },
    })

    expect(listeners.onSourceTranscript).toHaveBeenCalledTimes(2)
    expect(listeners.onSourceTranscript.mock.calls.at(-1)?.[0]).toMatchObject({
      text: 'I need to make an appointment',
    })
  })

  it('reports translation text that arrives after generation completed', async () => {
    const { listeners, send } = await openTransport()

    send({ inputTranscription: { text: 'Guten Morgen', languageCode: 'de' } })
    send({ generationComplete: true })
    expect(listeners.onTranslationTranscript).not.toHaveBeenCalled()

    // Output transcription is unordered against the rest of the turn, so a
    // late fragment must still be reported rather than waiting for
    // `turnComplete` seconds later.
    send({ outputTranscription: { text: 'Good morning' } })

    expect(listeners.onTranslationTranscript).toHaveBeenCalledOnce()
    expect(listeners.onTranslationTranscript.mock.calls[0]?.[0]).toMatchObject({
      text: 'Good morning',
    })
  })

  it('releases the route when the API never closes the turn', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: { text: 'Bonjour', languageCode: 'fr' },
      outputTranscription: { text: 'Good morning' },
    })
    expect(listeners.onTurnEnd).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(TRANSCRIPT_IDLE_FINALIZE_MS)
    expect(listeners.onTurnEnd).toHaveBeenCalledOnce()
  })

  it('holds a turn open across continuing background activity', async () => {
    const { listeners, send } = await openTransport()

    send({ interimInputTranscription: { text: 'necesito', languageCode: 'es' } })
    send({
      interimInputTranscription: { text: 'necesito una cita', languageCode: 'es' },
    })
    send({
      inputTranscription: { text: 'Necesito una cita.', languageCode: 'es' },
      outputTranscription: { text: 'I need an appointment.' },
      generationComplete: true,
    })
    expect(listeners.onTurnEnd).not.toHaveBeenCalled()

    send({ turnComplete: true })
    expect(listeners.onTurnEnd).toHaveBeenCalledOnce()
  })

  it('never runs two things a person said into one transcription', async () => {
    const { listeners, send } = await openTransport()

    // The reported failure: the server delays `turnComplete` while it waits out
    // its own playback estimate, so the reply is spoken long before it arrives.
    // The accumulator has to reset at the end of the *utterance*, not the turn.
    send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    send({
      inputTranscription: {
        text: 'Hola, ¿cómo estás?',
        languageCode: 'es',
        finished: true,
      },
    })

    const calls = listeners.onSourceTranscript.mock.calls
    expect(calls[0][0].text).toBe('Hey, how are you?')
    expect(calls[1][0].text).toBe('Hola, ¿cómo estás?')
    // ...and they are marked as different utterances.
    expect(calls[0][2]).toBe(1)
    expect(calls[1][2]).toBe(2)
  })

  it('uses server voice activity as the human boundary even when final text is late', async () => {
    const { listeners, send, sendMessage } = await openTransport()

    sendMessage({
      voiceActivity: { voiceActivityType: 'ACTIVITY_START' },
    })
    send({
      inputTranscription: {
        text: 'Hello, how',
        languageCode: 'en',
        finished: false,
      },
    })
    sendMessage({
      voiceActivity: { voiceActivityType: 'ACTIVITY_END' },
    })
    // Input transcription is independent of model output and may finalize after
    // VAD. It still belongs to utterance 1.
    send({
      inputTranscription: {
        text: 'Hello, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })

    sendMessage({
      voiceActivity: { voiceActivityType: 'ACTIVITY_START' },
    })
    // The server's delayed completion for Turn 1 must not close Turn 2.
    send({ turnComplete: true })
    send({
      inputTranscription: {
        text: '¿Cómo estás?',
        languageCode: 'es',
        finished: true,
      },
    })
    send({ turnComplete: true })

    expect(listeners.onSpeechStart.mock.calls.map(([id]) => id)).toEqual([1, 2])
    expect(listeners.onSpeechEnd.mock.calls.map(([id]) => id)).toEqual([1, 2])
    expect(
      listeners.onSourceTranscript.mock.calls.map(([value, , id]) => [
        id,
        value.text,
      ]),
    ).toEqual([
      [1, 'Hello, how'],
      [1, 'Hello, how are you?'],
      [2, '¿Cómo estás?'],
    ])
    expect(listeners.onTurnEnd).toHaveBeenCalledTimes(2)
  })

  it('keeps counting utterances after the server stops sending voice activity', async () => {
    const { listeners, send, sendMessage } = await openTransport()

    // `voiceActivity` is a newer Live feature and is not guaranteed for the
    // whole of a session. Deferring to signals that had stopped arriving froze
    // the utterance id at 1, every later transcription was dropped downstream
    // as already committed, and the conversation ended after one exchange.
    sendMessage({ voiceActivity: { voiceActivityType: 'ACTIVITY_START' } })
    send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    sendMessage({ voiceActivity: { voiceActivityType: 'ACTIVITY_END' } })
    send({ turnComplete: true })

    // No activity signal this time; only the transcription.
    send({
      inputTranscription: {
        text: 'Bien, ¿y tú?',
        languageCode: 'es',
        finished: true,
      },
    })
    send({ turnComplete: true })

    expect(
      listeners.onSourceTranscript.mock.calls.map(([value, , id]) => [
        id,
        value.text,
      ]),
    ).toEqual([
      [1, 'Hey, how are you?'],
      [2, 'Bien, ¿y tú?'],
    ])
    expect(listeners.onTurnEnd).toHaveBeenCalledTimes(2)
  })

  it('does not report a turn end for an utterance that was already over', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: true,
      },
    })
    send({ turnComplete: true })
    expect(listeners.onTurnEnd).toHaveBeenCalledTimes(1)

    // The first message of the next utterance used to mark the route's turn
    // open before asking whether it already was, so this reported a second end
    // for utterance 1 and left the route expecting a server `turnComplete` that
    // had already been consumed — swallowing the real one below.
    send({
      inputTranscription: {
        text: 'Bien, ¿y tú?',
        languageCode: 'es',
        finished: true,
      },
    })
    expect(listeners.onTurnEnd).toHaveBeenCalledTimes(1)

    send({ turnComplete: true })
    expect(listeners.onTurnEnd.mock.calls.map(([id]) => id)).toEqual([1, 2])
  })

  it('closes the utterance at generationComplete when nothing is marked finished', async () => {
    const { listeners, send } = await openTransport()

    // Some responses never set `finished`. The model answering what it heard is
    // still a boundary: whatever is transcribed next is the next utterance.
    send({
      inputTranscription: {
        text: 'Hey, how are you?',
        languageCode: 'en',
        finished: false,
      },
    })
    send({ generationComplete: true })
    send({ inputTranscription: { text: 'Hola, ¿cómo estás?', languageCode: 'es' } })

    const calls = listeners.onSourceTranscript.mock.calls
    expect(calls.at(-1)?.[0].text).toBe('Hola, ¿cómo estás?')
    expect(calls.at(-1)?.[2]).toBe(2)
  })

  it('separates one model response from the next', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: { text: 'Hello', languageCode: 'en', finished: true },
      outputTranscription: { text: 'Hola' },
    })
    send({ generationComplete: true })
    send({
      inputTranscription: { text: 'Hola', languageCode: 'es', finished: true },
      outputTranscription: { text: 'Hi there' },
    })

    const calls = listeners.onTranslationTranscript.mock.calls
    expect(calls[0][0].text).toBe('Hola')
    expect(calls[0][1]).toBe(1)
    expect(calls.at(-1)?.[0].text).toBe('Hi there')
    expect(calls.at(-1)?.[1]).toBe(2)
  })

  it('keeps fragments of one utterance together', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: {
        text: 'Hey,',
        languageCode: 'en',
        finished: false,
      },
    })
    send({ inputTranscription: { text: 'how are you?', languageCode: 'en', finished: true } })

    const calls = listeners.onSourceTranscript.mock.calls
    expect(calls.at(-1)?.[0].text).toBe('Hey, how are you?')
    expect(calls.every((call) => call[2] === 1)).toBe(true)
  })

  it('starts a fresh accumulation after the turn ends', async () => {
    const { listeners, send } = await openTransport()

    send({ inputTranscription: { text: 'Hola', languageCode: 'es' } })
    send({ turnComplete: true })
    send({ inputTranscription: { text: 'Adiós', languageCode: 'es' } })

    expect(listeners.onSourceTranscript.mock.calls.at(-1)?.[0]).toMatchObject({
      text: 'Adiós',
    })
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
    // The utterance is over, so this route may join the next one.
    expect(listeners.onTurnEnd).toHaveBeenCalledOnce()
  })

  it('corrects an obvious script and language-code mismatch', async () => {
    const { listeners, send } = await openTransport()

    send({
      inputTranscription: {
        text: '你好，',
        languageCode: 'vi',
        finished: false,
      },
      outputTranscription: { text: 'Hello,' },
    })
    send({
      inputTranscription: {
        text: '我想确认明天的预约。',
        languageCode: 'vi',
        finished: true,
      },
      outputTranscription: {
        text: 'I want to confirm tomorrow’s appointment.',
      },
      generationComplete: true,
    })

    expect(listeners.onSourceTranscript.mock.calls.at(-1)?.[0]).toMatchObject({
      text: '你好，我想确认明天的预约。',
      languageCode: 'zh-Hans',
    })
    expect(listeners.onTranslationTranscript.mock.calls.at(-1)?.[0]).toMatchObject({
      text: 'Hello, I want to confirm tomorrow’s appointment.',
    })
  })

  it('stops the idle window when the caller closes the transport', async () => {
    const { listeners, send, transport, sendRealtimeInput, closeSession } =
      await openTransport()

    send({ inputTranscription: { text: 'Hola', languageCode: 'es' } })
    transport.close()
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_IDLE_FINALIZE_MS * 2)

    expect(listeners.onTurnEnd).not.toHaveBeenCalled()
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

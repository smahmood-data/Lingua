import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: sdk.connect }
  },
  Modality: { AUDIO: 'AUDIO' },
  EndSensitivity: { END_SENSITIVITY_LOW: 'END_SENSITIVITY_LOW' },
}))

import { connectLiveTransport, type LiveTransportEvents } from './liveTransport'
import {
  CONTESTED_AUDIO_HOLD_MS,
  ConversationCoordinator,
  type ConversationConfig,
} from './conversation'
import type { SupportedLanguageCode } from './types'

/**
 * Regressions taken from a real failed browser session.
 *
 * Source: `lingua-live-trace.json`, 740 events over 44.6 s of an Auto→English
 * session that adopted Spanish. It closed 27 turns for a handful of actual
 * utterances; 33 of its 49 source transcripts were zero-length, and ten turns
 * closed as Spanish interpreted into Spanish.
 *
 * The orderings below are transcribed from that file with their timestamps, not
 * arranged into the order the code finds convenient. Every previous suite
 * passed while the browser did this.
 */

// --- Transport harness ------------------------------------------------------

function events() {
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

async function openTransport(targetLanguage: SupportedLanguageCode = 'en') {
  let onmessage!: (message: unknown) => void
  sdk.connect.mockImplementation(async (options: never) => {
    const config = options as unknown as {
      callbacks: { onmessage: (message: unknown) => void }
    }
    onmessage = config.callbacks.onmessage
    return { sendRealtimeInput: vi.fn(), close: vi.fn() }
  })

  const listeners = events()
  const transport = await connectLiveTransport({
    token: 'auth_tokens/test',
    model: 'test-model',
    targetLanguage,
    systemInstruction: 'test',
    signal: new AbortController().signal,
    events: listeners as unknown as LiveTransportEvents,
  })

  return {
    transport,
    listeners,
    send: (serverContent: Record<string, unknown>) => onmessage({ serverContent }),
  }
}

const audioPart = {
  modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm' } }] },
}

// --- Coordinator harness ----------------------------------------------------

const ROUTE_TO_EN = 1
const ROUTE_TO_ES = 2
const pcm = (marker = 1) => new Uint8Array([marker, 0, marker, 0])

function conversation(config: Partial<ConversationConfig> = {}) {
  const played: number[] = []
  const coordinator = new ConversationCoordinator(
    {
      playAudio: (chunk) => {
        played.push(chunk[0])
        return true
      },
      endAudio: () => undefined,
      flushAudio: () => undefined,
      changed: () => undefined,
      counterpartDetected: () => undefined,
    },
    { targetLanguage: 'en', counterpart: 'es', autoDetect: false, ...config },
  )
  return { coordinator, played }
}

describe('trace regressions (lingua-live-trace.json)', () => {
  beforeEach(() => {
    sdk.connect.mockReset()
  })

  describe('Test A — the empty transcription that manufactured 21 ghost turns', () => {
    it('does not treat a contentless input transcription as somebody speaking', async () => {
      const { listeners, send } = await openTransport('en')

      // t=7124: the real utterance. 18 characters of Spanish.
      send({
        inputTranscription: {
          text: 'Hola, buenos dias.',
          languageCode: 'es',
          finished: true,
        },
      })
      send({ outputTranscription: { text: 'Hello, good day.' } })
      send(audioPart)
      expect(listeners.onSpeechStart).toHaveBeenCalledTimes(1)

      // t=7685 in the trace: Gemini sends a bookkeeping transcription with no
      // text. The old transport read it as a new human utterance — it ended the
      // turn in progress, opened another, and emitted a zero-length source. The
      // trace has 33 of these against 16 real ones.
      send({ inputTranscription: { text: '', languageCode: 'es', finished: true } })

      expect(listeners.onSpeechStart).toHaveBeenCalledTimes(1)
      expect(listeners.onTurnEnd).not.toHaveBeenCalled()
      const lengths = listeners.onSourceTranscript.mock.calls.map(
        ([transcription]) => (transcription.text ?? '').length,
      )
      expect(lengths).toEqual([18])
    })

    it('keeps one model response as one generation while a response streams', async () => {
      const { listeners, send } = await openTransport('en')

      send({
        inputTranscription: {
          text: 'Hola, buenos dias.',
          languageCode: 'es',
          finished: true,
        },
      })
      send(audioPart)
      send({ inputTranscription: { text: '', finished: true } })
      // t=7689: the response was still streaming. Because the utterance counter
      // had moved, every remaining chunk of that one answer was re-stamped with
      // a new generation id and charged to the ghost turn — which is how an
      // empty turn came to own the speakers.
      send(audioPart)
      send(audioPart)

      const generations = listeners.onAudio.mock.calls.map(([, id]) => id)
      expect(generations).toEqual([1, 1, 1])
    })

    it('still separates two genuine responses', async () => {
      const { listeners, send } = await openTransport('en')

      send({ inputTranscription: { text: 'Uno.', languageCode: 'es', finished: true } })
      send(audioPart)
      send({ generationComplete: true })
      send({ turnComplete: true })

      send({ inputTranscription: { text: 'Dos.', languageCode: 'es', finished: true } })
      send(audioPart)

      expect(listeners.onAudio.mock.calls.map(([, id]) => id)).toEqual([1, 2])
      expect(listeners.onSpeechStart.mock.calls.map(([id]) => id)).toEqual([1, 2])
    })
  })

  describe('Test B — the impossible Spanish-into-Spanish turn', () => {
    it('never lets the hold timer hand the turn to the wrong side of the pair', async () => {
      vi.useFakeTimers()
      try {
        // Auto→English that has adopted Spanish, exactly as at t=14463.
        const talk = conversation({
          targetLanguage: 'en',
          counterpart: 'es',
          autoDetect: true,
        })
        talk.coordinator.addRoute(ROUTE_TO_EN, 'en')
        talk.coordinator.addRoute(ROUTE_TO_ES, 'es')

        // t=14463 — route 1 hears three characters of Spanish.
        talk.coordinator.sourceTranscription(
          ROUTE_TO_EN,
          7,
          { text: 'Si.', languageCode: 'es' },
          true,
        )
        // t=14615/14632 — route 2, whose target *is* Spanish, generates first.
        talk.coordinator.translationTranscription(ROUTE_TO_ES, 2, {
          text: 'Si, claro que si.',
        })
        talk.coordinator.audio(ROUTE_TO_ES, 2, pcm(2))
        // t=14734/14749 — route 1 answers too, but its "translation" is the
        // speaker's own three characters, so it reads as a readback and is held.
        talk.coordinator.translationTranscription(ROUTE_TO_EN, 7, { text: 'Si.' })
        talk.coordinator.audio(ROUTE_TO_EN, 7, pcm(1))
        // t=14856 — route 2 again, re-taking the hold buffer.
        talk.coordinator.audio(ROUTE_TO_ES, 2, pcm(2))

        // t=14883 — 251 ms after the hold was armed, it expired. The old code
        // claimed for whoever happened to be holding, which was the route that
        // renders *into* the language being spoken.
        await vi.advanceTimersByTimeAsync(CONTESTED_AUDIO_HOLD_MS + 20)

        expect(talk.played).toEqual([])

        talk.coordinator.routeTurnEnd(ROUTE_TO_EN, 7, 7)
        talk.coordinator.routeTurnEnd(ROUTE_TO_ES, 2, 2)
        await vi.advanceTimersByTimeAsync(500)

        const [turn] = talk.coordinator.turns
        expect(turn.sourceText).toBe('Si.')
        // t=15267 closed this turn as language=es into=es.
        expect(turn.targetLanguage).not.toBe(turn.sourceLanguage)
      } finally {
        vi.useRealTimers()
      }
    })

    it('cannot render a turn whose target is its own source side', () => {
      // Structural, not arbitrated: once a route is the voice, the side that
      // spoke is computed as the opposite of what that route renders into, so
      // the two can never come out equal whatever the metadata claimed.
      for (const reported of ['en', 'es', 'vi', 'und'] as const) {
        for (const voice of [ROUTE_TO_EN, ROUTE_TO_ES]) {
          const talk = conversation({
            targetLanguage: 'en',
            counterpart: 'es',
            autoDetect: false,
          })
          talk.coordinator.addRoute(ROUTE_TO_EN, 'en')
          talk.coordinator.addRoute(ROUTE_TO_ES, 'es')

          talk.coordinator.sourceTranscription(
            ROUTE_TO_EN,
            1,
            { text: 'Something was said.', languageCode: reported },
            true,
          )
          talk.coordinator.translationTranscription(voice, 1, {
            text: 'A genuine interpretation of it.',
          })
          talk.coordinator.audio(voice, 1, pcm(1))
          talk.coordinator.playbackStarted()
          talk.coordinator.playbackEnded()

          const [turn] = talk.coordinator.turns
          if (turn?.targetLanguage) {
            expect(turn.targetLanguage).not.toBe(turn.sourceLanguage)
          }
        }
      }
    })
  })

  describe('Test C — the cancelled generation goes inert', () => {
    it('ignores everything both routes still send after a barge-in', async () => {
      vi.useFakeTimers()
      try {
        const talk = conversation({
          targetLanguage: 'en',
          counterpart: 'es',
          autoDetect: true,
        })
        talk.coordinator.addRoute(ROUTE_TO_EN, 'en')
        talk.coordinator.addRoute(ROUTE_TO_ES, 'es')

        // t=12565..13104 — English spoken, the Spanish route interprets it.
        talk.coordinator.sourceTranscription(
          ROUTE_TO_EN,
          5,
          { text: 'Twenty characters ok', languageCode: 'en' },
          true,
        )
        talk.coordinator.translationTranscription(ROUTE_TO_ES, 1, {
          text: 'Veinte caracteres.',
        })
        talk.coordinator.audio(ROUTE_TO_ES, 1, pcm(2))
        talk.coordinator.playbackStarted()
        expect(talk.played).toEqual([2])

        // t=13165 — somebody talks over it.
        talk.coordinator.bargeIn()
        expect(talk.coordinator.phase).toBe('listening')
        const settled = talk.coordinator.turns.map((turn) => ({ ...turn }))
        expect(settled).toHaveLength(1)

        // t=13183..13602 — both routes carry on with the cancelled response.
        talk.coordinator.audio(ROUTE_TO_EN, 5, pcm(8))
        talk.coordinator.audio(ROUTE_TO_ES, 1, pcm(9))
        talk.coordinator.audio(ROUTE_TO_EN, 5, pcm(8))
        talk.coordinator.translationTranscription(ROUTE_TO_ES, 1, {
          text: 'Veinte caracteres, y algo mas.',
        })
        talk.coordinator.generationComplete(ROUTE_TO_ES, 1)
        talk.coordinator.interrupted(ROUTE_TO_ES, 1)
        talk.coordinator.routeTurnEnd(ROUTE_TO_EN, 5, 5)
        talk.coordinator.routeTurnEnd(ROUTE_TO_ES, 1, 1)
        await vi.advanceTimersByTimeAsync(1000)

        // Nothing played, nothing changed, no ghost row.
        expect(talk.played).toEqual([2])
        expect(talk.coordinator.turns).toEqual(settled)
        expect(talk.coordinator.phase).toBe('listening')

        // t=13581 — and the next real utterance is clean.
        talk.coordinator.sourceTranscription(
          ROUTE_TO_EN,
          6,
          { text: 'Y ahora en espanol.', languageCode: 'es' },
          true,
        )
        talk.coordinator.translationTranscription(ROUTE_TO_EN, 6, {
          text: 'And now in Spanish.',
        })
        talk.coordinator.audio(ROUTE_TO_EN, 6, pcm(3))
        expect(talk.played).toEqual([2, 3])

        const next = talk.coordinator.turns[1]
        expect(next.sourceText).toBe('Y ahora en espanol.')
        expect(next.translatedText).toBe('And now in Spanish.')
        expect(next.targetLanguage).toBe('en')
        expect(next.sourceLanguage).toBe('es')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('Test J — the losing route never takes the turn later', () => {
    it('keeps ownership with the route the pair favours once it has spoken', async () => {
      vi.useFakeTimers()
      try {
        const talk = conversation({
          targetLanguage: 'en',
          counterpart: 'es',
          autoDetect: false,
        })
        talk.coordinator.addRoute(ROUTE_TO_EN, 'en')
        talk.coordinator.addRoute(ROUTE_TO_ES, 'es')

        // Spanish spoken, so the English route is the interpreter.
        talk.coordinator.sourceTranscription(
          ROUTE_TO_EN,
          1,
          { text: 'Bien, y tu?', languageCode: 'es' },
          true,
        )
        talk.coordinator.translationTranscription(ROUTE_TO_EN, 1, {
          text: 'Good, and you?',
        })
        talk.coordinator.audio(ROUTE_TO_EN, 1, pcm(1))
        expect(talk.played).toEqual([1])

        // The losing route catches up afterwards, at length.
        talk.coordinator.translationTranscription(ROUTE_TO_ES, 1, {
          text: 'Bien, y tu? Claro.',
        })
        for (let index = 0; index < 5; index += 1) {
          talk.coordinator.audio(ROUTE_TO_ES, 1, pcm(9))
        }
        await vi.advanceTimersByTimeAsync(CONTESTED_AUDIO_HOLD_MS + 50)

        expect(talk.played).toEqual([1])
        const [turn] = talk.coordinator.turns
        expect(turn.translatedText).toBe('Good, and you?')
        expect(turn.targetLanguage).toBe('en')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('Test G — playback state does not flap on chunk boundaries', () => {
    it('stays on playing across the many chunks of one response', () => {
      const talk = conversation({
        targetLanguage: 'en',
        counterpart: 'es',
        autoDetect: false,
      })
      talk.coordinator.addRoute(ROUTE_TO_EN, 'en')
      talk.coordinator.addRoute(ROUTE_TO_ES, 'es')

      talk.coordinator.sourceTranscription(
        ROUTE_TO_EN,
        1,
        { text: 'Bien, y tu?', languageCode: 'es' },
        true,
      )
      talk.coordinator.translationTranscription(ROUTE_TO_EN, 1, {
        text: 'Good, and you?',
      })
      talk.coordinator.audio(ROUTE_TO_EN, 1, pcm(1))
      talk.coordinator.playbackStarted()

      // The trace carries 287 audio events across 27 turns — one answer is many
      // chunks. None of them is a stream boundary.
      for (let index = 0; index < 12; index += 1) {
        talk.coordinator.audio(ROUTE_TO_EN, 1, pcm(1))
        expect(talk.coordinator.phase).toBe('playing')
      }

      talk.coordinator.generationComplete(ROUTE_TO_EN, 1)
      expect(talk.coordinator.phase).toBe('playing')
      talk.coordinator.playbackEnded()
      expect(talk.coordinator.phase).toBe('listening')
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

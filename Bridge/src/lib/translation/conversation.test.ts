import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONTESTED_AUDIO_HOLD_MS,
  ConversationCoordinator,
  type ConversationConfig,
} from './conversation'
import { UTTERANCE_JOIN_MS } from './config'
import type { TranscriptionLike } from './conversation'
import type { ConversationTurn, SupportedLanguageCode } from './types'

/**
 * Deterministic simulation of a two-person conversation.
 *
 * These tests speak the product's language — someone says something, the other
 * person hears it interpreted — rather than the pipeline's. The Live routes are
 * driven directly, so an ordering that a real browser produced once can be
 * replayed exactly, which is what the previous suite could not do.
 */

const ROUTE_TO_ES = 1
const ROUTE_TO_EN = 2

/** One notional chunk of translated PCM16. */
const pcm = (marker = 1) => new Uint8Array([marker, 0, marker, 0])


/**
 * Drives the coordinator the way the transport does, keeping each route's
 * utterance and response counters so the tests can stay in product language.
 */
class Routes {
  private readonly utterance = new Map<number, number>()
  private readonly generation = new Map<number, number>()
  private readonly coordinator: ConversationCoordinator

  constructor(coordinator: ConversationCoordinator) {
    this.coordinator = coordinator
  }

  /** Begin a new thing the person said, as `inputTranscription.finished` does. */
  nextUtterance(routeId: number): number {
    const next = (this.utterance.get(routeId) ?? 0) + 1
    this.utterance.set(routeId, next)
    return next
  }

  /** Begin a new model response. */
  nextGeneration(routeId: number): number {
    const next = (this.generation.get(routeId) ?? 0) + 1
    this.generation.set(routeId, next)
    return next
  }

  u(routeId: number): number {
    return this.utterance.get(routeId) ?? this.nextUtterance(routeId)
  }

  g(routeId: number): number {
    return this.generation.get(routeId) ?? this.nextGeneration(routeId)
  }

  interim(routeId: number, transcription: TranscriptionLike): void {
    this.coordinator.interimTranscription(routeId, this.u(routeId), transcription)
  }

  source(
    routeId: number,
    transcription: TranscriptionLike,
    finished = true,
  ): void {
    this.coordinator.sourceTranscription(
      routeId,
      this.u(routeId),
      transcription,
      finished,
    )
  }

  translation(routeId: number, transcription: TranscriptionLike): void {
    this.coordinator.translationTranscription(
      routeId,
      this.g(routeId),
      transcription,
    )
  }

  audio(routeId: number, pcm16: Uint8Array): void {
    this.coordinator.audio(routeId, this.g(routeId), pcm16)
  }

  generationComplete(routeId: number): void {
    this.coordinator.generationComplete(routeId, this.g(routeId))
  }

  turnEnd(routeId: number): void {
    this.coordinator.routeTurnEnd(routeId, this.u(routeId), this.g(routeId))
  }
}

interface Spoken {
  played: number[]
  ended: number
  flushed: number
}

function conversation(config: Partial<ConversationConfig> = {}) {
  const spoken: Spoken = { played: [], ended: 0, flushed: 0 }
  const counterparts: SupportedLanguageCode[] = []
  let changes = 0

  const coordinator = new ConversationCoordinator(
    {
      playAudio: (chunk) => {
        spoken.played.push(chunk[0])
        return true
      },
      endAudio: () => {
        spoken.ended += 1
      },
      flushAudio: () => {
        spoken.flushed += 1
      },
      changed: () => {
        changes += 1
      },
      counterpartDetected: (language) => {
        counterparts.push(language)
      },
    },
    {
      targetLanguage: 'es',
      counterpart: 'en',
      autoDetect: false,
      ...config,
    },
  )

  return {
    coordinator,
    routes: new Routes(coordinator),
    spoken,
    counterparts,
    get changes() {
      return changes
    },
  }
}

/** Explicit English <-> Spanish, with both routes already open. */
function englishSpanish() {
  const talk = conversation({ targetLanguage: 'es', counterpart: 'en' })
  talk.coordinator.addRoute(ROUTE_TO_ES, 'es')
  talk.coordinator.addRoute(ROUTE_TO_EN, 'en')
  return talk
}

/**
 * One complete utterance, as the API reports it.
 *
 * `heardBy` are the routes that transcribe the speech — normally both, because
 * both are listening to the same microphone. `interpretedBy` is the route the
 * API lets speak, which is the one whose target is not the language spoken.
 */
function speak(
  talk: { coordinator: ConversationCoordinator; routes: Routes },
  {
    text,
    language,
    heardBy,
    interpretedBy,
    translation,
    chunks = 2,
  }: {
    text: string
    language: string
    heardBy: number[]
    interpretedBy?: number
    translation?: string
    chunks?: number
  },
) {
  // A new thing was said, so every route that hears it moves on to its next
  // utterance — exactly what the transport does at `finished`.
  for (const routeId of heardBy) talk.routes.nextUtterance(routeId)
  for (const routeId of heardBy) {
    talk.routes.interim(routeId, {
      text: text.slice(0, 4),
      languageCode: language,
    })
  }
  for (const routeId of heardBy) {
    talk.routes.source(routeId, { text, languageCode: language }, true)
  }
  if (interpretedBy !== undefined) {
    talk.routes.nextGeneration(interpretedBy)
    if (translation) {
      talk.routes.translation(interpretedBy, { text: translation })
    }
    for (let index = 0; index < chunks; index += 1) {
      talk.routes.audio(interpretedBy, pcm(index + 1))
    }
    talk.routes.generationComplete(interpretedBy)
  }
  for (const routeId of heardBy) talk.routes.turnEnd(routeId)
}

/** The browser finishing the translated audio, which is what ends a turn. */
function finishPlayback(coordinator: ConversationCoordinator) {
  coordinator.playbackStarted()
  coordinator.playbackEnded()
}

function summarize(turns: ConversationTurn[]) {
  return turns.map((turn) => ({
    source: turn.sourceText,
    sourceLanguage: turn.sourceLanguage,
    translated: turn.translatedText,
    targetLanguage: turn.targetLanguage,
    status: turn.status,
  }))
}

describe('Test A — one English turn, explicit English <-> Spanish', () => {
  it('produces one turn with a Spanish translation and one Spanish voice', () => {
    const talk = englishSpanish()

    speak(talk, {
      text: 'Hey, how are you?',
      language: 'en',
      heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_ES,
      translation: 'Hola, ¿cómo estás?',
    })
    finishPlayback(talk.coordinator)

    expect(summarize(talk.coordinator.turns)).toEqual([
      {
        source: 'Hey, how are you?',
        sourceLanguage: 'en',
        translated: 'Hola, ¿cómo estás?',
        targetLanguage: 'es',
        status: 'complete',
      },
    ])
    expect(talk.spoken.played).toEqual([1, 2])
    expect(talk.coordinator.phase).toBe('listening')
  })

  it('never speaks the English back when the English route also generates', () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    // The route whose target is English should stay silent. When it does not,
    // its audio must never reach the speakers.
    talk.routes.translation(ROUTE_TO_EN, {
      text: 'Hey, how are you?',
    })
    talk.routes.audio(ROUTE_TO_EN, pcm(9))
    talk.routes.translation(ROUTE_TO_ES, {
      text: 'Hola, ¿cómo estás?',
    })
    talk.routes.audio(ROUTE_TO_ES, pcm(1))

    expect(talk.spoken.played).toEqual([1])
    expect(talk.coordinator.turns[0].translatedText).toBe('Hola, ¿cómo estás?')
  })
})

describe('Test B — the reverse turn in the same session', () => {
  it('interprets Spanish into English without touching any control', () => {
    const talk = englishSpanish()

    speak(talk, {
      text: 'Hey, how are you?',
      language: 'en',
      heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_ES,
      translation: 'Hola, ¿cómo estás?',
    })
    finishPlayback(talk.coordinator)
    talk.spoken.played.length = 0

    speak(talk, {
      text: 'Bien, ¿y tú?',
      language: 'es',
      heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_EN,
      translation: 'Good, and you?',
    })
    finishPlayback(talk.coordinator)

    expect(summarize(talk.coordinator.turns)).toEqual([
      {
        source: 'Hey, how are you?',
        sourceLanguage: 'en',
        translated: 'Hola, ¿cómo estás?',
        targetLanguage: 'es',
        status: 'complete',
      },
      {
        source: 'Bien, ¿y tú?',
        sourceLanguage: 'es',
        translated: 'Good, and you?',
        targetLanguage: 'en',
        status: 'complete',
      },
    ])
    expect(talk.spoken.played).toEqual([1, 2])
  })
})

describe('Test C — a six-turn conversation on one Start press', () => {
  it('produces exactly six turns, each with one translated playback', () => {
    const talk = englishSpanish()
    const script = [
      ['Hey, how are you?', 'en', 'Hola, ¿cómo estás?'],
      ['Bien, ¿y tú?', 'es', 'Good, and you?'],
      ['I am good, thanks.', 'en', 'Estoy bien, gracias.'],
      ['Me alegro mucho.', 'es', 'I am very glad.'],
      ['Where are you from?', 'en', '¿De dónde eres?'],
      ['Soy de Madrid.', 'es', 'I am from Madrid.'],
    ] as const

    let playbacks = 0
    for (const [text, language, translation] of script) {
      speak(talk, {
        text,
        language,
        heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
        interpretedBy: language === 'en' ? ROUTE_TO_ES : ROUTE_TO_EN,
        translation,
      })
      finishPlayback(talk.coordinator)
      playbacks += 1
    }

    expect(talk.coordinator.turns).toHaveLength(6)
    expect(playbacks).toBe(6)
    expect(talk.coordinator.turns.map((turn) => turn.sourceText)).toEqual(
      script.map(([text]) => text),
    )
    expect(talk.coordinator.turns.map((turn) => turn.translatedText)).toEqual(
      script.map(([, , translation]) => translation),
    )
    expect(talk.coordinator.turns.every((turn) => turn.status === 'complete')).toBe(
      true,
    )
    expect(talk.coordinator.phase).toBe('listening')
  })
})

describe('Test D — duplicate route events', () => {
  it('makes one turn out of identical transcription from both routes', () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.turnEnd(ROUTE_TO_ES)
    talk.routes.turnEnd(ROUTE_TO_EN)

    expect(talk.coordinator.turns).toHaveLength(1)
    expect(talk.coordinator.turns[0].sourceText).toBe('Hey, how are you?')
  })

  it('takes source text only from the authoritative route', () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Hey how are you', languageCode: 'en' }, true)
    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you? Really.', languageCode: 'en' }, true)
    talk.routes.turnEnd(ROUTE_TO_ES)
    talk.routes.turnEnd(ROUTE_TO_EN)

    // Text similarity is not what keeps this to one row. The first route is the
    // source authority; the other route may translate but cannot rewrite what
    // the human said.
    expect(talk.coordinator.turns).toHaveLength(1)
    expect(talk.coordinator.turns[0].sourceText).toBe('Hey how are you')
  })

  it('does not let a late report from the losing route open a second turn', () => {
    const talk = englishSpanish()

    speak(talk, {
      text: 'Hey, how are you?',
      language: 'en',
      heardBy: [ROUTE_TO_ES],
      interpretedBy: ROUTE_TO_ES,
      translation: 'Hola, ¿cómo estás?',
    })
    // The English route is still mid-utterance when playback finishes.
    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you?', languageCode: 'en' }, false)
    finishPlayback(talk.coordinator)
    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.turnEnd(ROUTE_TO_EN)

    expect(talk.coordinator.turns).toHaveLength(1)
  })
})

describe('Test E — asynchronous event orders', () => {
  const expected = [
    {
      source: 'Hey, how are you?',
      sourceLanguage: 'en',
      translated: 'Hola, ¿cómo estás?',
      targetLanguage: 'es',
      status: 'complete',
    },
  ]

  it('route B reports before route A', () => {
    const talk = englishSpanish()
    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.translation(ROUTE_TO_ES, {
      text: 'Hola, ¿cómo estás?',
    })
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.routes.generationComplete(ROUTE_TO_ES)
    talk.routes.turnEnd(ROUTE_TO_EN)
    talk.routes.turnEnd(ROUTE_TO_ES)
    finishPlayback(talk.coordinator)

    expect(summarize(talk.coordinator.turns)).toEqual(expected)
  })

  it('audio arrives before any translated text', () => {
    const talk = englishSpanish()
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.routes.translation(ROUTE_TO_ES, {
      text: 'Hola, ¿cómo estás?',
    })
    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.generationComplete(ROUTE_TO_ES)
    talk.routes.turnEnd(ROUTE_TO_ES)
    talk.routes.turnEnd(ROUTE_TO_EN)
    finishPlayback(talk.coordinator)

    expect(summarize(talk.coordinator.turns)).toEqual(expected)
    expect(talk.spoken.played).toEqual([1])
  })

  it('generationComplete and turnComplete both arrive late', () => {
    const talk = englishSpanish()
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.translation(ROUTE_TO_ES, {
      text: 'Hola, ¿cómo estás?',
    })
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.coordinator.playbackStarted()
    talk.routes.turnEnd(ROUTE_TO_EN)
    talk.routes.generationComplete(ROUTE_TO_ES)
    talk.coordinator.playbackEnded()
    talk.routes.turnEnd(ROUTE_TO_ES)

    expect(summarize(talk.coordinator.turns)).toEqual(expected)
    expect(talk.spoken.ended).toBe(1)
  })

  it('a trailing source fragment arrives after the translation', () => {
    const talk = englishSpanish()
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are', languageCode: 'en' }, false)
    talk.routes.translation(ROUTE_TO_ES, {
      text: 'Hola, ¿cómo estás?',
    })
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.routes.generationComplete(ROUTE_TO_ES)
    talk.routes.turnEnd(ROUTE_TO_ES)
    finishPlayback(talk.coordinator)

    expect(summarize(talk.coordinator.turns)).toEqual(expected)
  })
})

describe('Test G — playback ends without a watchdog', () => {
  it('returns to listening the moment the last audio source finishes', () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.coordinator.playbackStarted()
    expect(talk.coordinator.phase).toBe('playing')

    talk.routes.generationComplete(ROUTE_TO_ES)
    expect(talk.spoken.ended).toBe(1)
    expect(talk.coordinator.phase).toBe('playing')

    talk.coordinator.playbackEnded()
    expect(talk.coordinator.phase).toBe('listening')

    // And the next speaker is heard straight away.
    speak(talk, {
      text: 'Bien, ¿y tú?',
      language: 'es',
      heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_EN,
      translation: 'Good, and you?',
    })
    finishPlayback(talk.coordinator)

    expect(talk.coordinator.turns).toHaveLength(2)
    expect(talk.coordinator.turns[1].translatedText).toBe('Good, and you?')
  })

  it('keeps a source-only turn joinable, then closes it while listening', async () => {
    vi.useFakeTimers()
    try {
    const talk = conversation({
      targetLanguage: 'en',
      counterpart: null,
      autoDetect: true,
    })
    talk.coordinator.addRoute(ROUTE_TO_EN, 'en')

    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    expect(talk.coordinator.phase).toBe('translating')
    talk.routes.turnEnd(ROUTE_TO_EN)

    expect(talk.coordinator.phase).toBe('listening')
    expect(talk.coordinator.turns[0].status).toBe('translating')
    await vi.advanceTimersByTimeAsync(UTTERANCE_JOIN_MS)
    expect(talk.coordinator.turns[0].status).toBe('complete')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Test I — Auto detect into English', () => {
  it('becomes a stable Spanish <-> English pair after Spanish appears', () => {
    const talk = conversation({
      targetLanguage: 'en',
      counterpart: null,
      autoDetect: true,
    })
    talk.coordinator.addRoute(ROUTE_TO_EN, 'en')

    // The first speaker uses English. Transcribe it; do not translate or read
    // it back, and do not invent a second language.
    speak(talk, {
      text: 'Hey, how are you?',
      language: 'en',
      heardBy: [ROUTE_TO_EN],
    })
    expect(talk.counterparts).toEqual([])
    expect(talk.spoken.played).toEqual([])
    expect(summarize(talk.coordinator.turns)).toEqual([
      {
        source: 'Hey, how are you?',
        sourceLanguage: 'en',
        translated: '',
        targetLanguage: null,
        status: 'translating',
      },
    ])

    // Spanish appears: interpret it into English and adopt the pair.
    speak(talk, {
      text: 'Bien, ¿y tú?',
      language: 'es',
      heardBy: [ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_EN,
      translation: 'Good, and you?',
    })
    finishPlayback(talk.coordinator)
    expect(talk.counterparts).toEqual(['es'])
    expect(talk.coordinator.counterpartLanguage).toBe('es')
    expect(talk.coordinator.turns[1]).toMatchObject({
      sourceLanguage: 'es',
      translatedText: 'Good, and you?',
      targetLanguage: 'en',
    })

    // The session now behaves exactly like an explicit pair: English goes to
    // the Spanish route the session opened when the counterpart was adopted.
    talk.coordinator.addRoute(ROUTE_TO_ES, 'es')
    talk.spoken.played.length = 0
    speak(talk, {
      text: 'I am good, thanks.',
      language: 'en',
      heardBy: [ROUTE_TO_EN, ROUTE_TO_ES],
      interpretedBy: ROUTE_TO_ES,
      translation: 'Estoy bien, gracias.',
    })
    finishPlayback(talk.coordinator)

    expect(talk.coordinator.turns).toHaveLength(3)
    expect(talk.coordinator.turns[2]).toMatchObject({
      sourceLanguage: 'en',
      translatedText: 'Estoy bien, gracias.',
      targetLanguage: 'es',
    })
    expect(talk.spoken.played).toEqual([1, 2])
    expect(talk.counterparts).toEqual(['es'])
  })

  it('keeps the pair it settled on when a stray language is reported', () => {
    const talk = conversation({
      targetLanguage: 'en',
      counterpart: null,
      autoDetect: true,
    })
    talk.coordinator.addRoute(ROUTE_TO_EN, 'en')

    speak(talk, {
      text: 'Bien, ¿y tú?',
      language: 'es',
      heardBy: [ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_EN,
      translation: 'Good, and you?',
    })
    finishPlayback(talk.coordinator)
    talk.coordinator.addRoute(ROUTE_TO_ES, 'es')

    speak(talk, {
      text: 'Que tal',
      language: 'pt-BR',
      heardBy: [ROUTE_TO_EN, ROUTE_TO_ES],
      interpretedBy: ROUTE_TO_EN,
      translation: 'How are things',
    })
    finishPlayback(talk.coordinator)

    expect(talk.counterparts).toEqual(['es'])
    expect(talk.coordinator.counterpartLanguage).toBe('es')
  })
})

describe('Test J — transcript fragments', () => {
  it('grows one turn through partial transcriptions', async () => {
    vi.useFakeTimers()
    try {
    const talk = englishSpanish()
    const fragments = ['Hey', 'Hey, how', 'Hey, how are', 'Hey, how are you?']

    for (const [index, text] of fragments.entries()) {
      talk.routes.source(
        ROUTE_TO_ES,
        { text, languageCode: 'en' },
        index === fragments.length - 1,
      )
      expect(talk.coordinator.turns).toHaveLength(1)
      expect(talk.coordinator.turns[0].sourceText).toBe(text)
    }

    // Both routes hear the same microphone, so the turn is over when both are
    // done with it.
    talk.routes.source(
      ROUTE_TO_EN,
      { text: 'Hey, how are you?', languageCode: 'en' },
      true,
    )
    talk.routes.turnEnd(ROUTE_TO_ES)
    talk.routes.turnEnd(ROUTE_TO_EN)
    expect(talk.coordinator.turns).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(UTTERANCE_JOIN_MS)
    expect(talk.coordinator.turns[0].status).toBe('complete')
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes a turn a route never reported on, within a bounded window', async () => {
    vi.useFakeTimers()
    try {
      const talk = englishSpanish()
      talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
      talk.routes.turnEnd(ROUTE_TO_ES)
      expect(talk.coordinator.turns[0].status).toBe('translating')

      await vi.advanceTimersByTimeAsync(UTTERANCE_JOIN_MS + 10)
      expect(talk.coordinator.turns[0].status).toBe('complete')
      expect(talk.coordinator.phase).toBe('listening')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows an interim caption and drops it once the turn has the words', () => {
    const talk = englishSpanish()

    talk.routes.interim(ROUTE_TO_ES, {
      text: 'Hey how',
      languageCode: 'en',
    })
    talk.routes.interim(ROUTE_TO_EN, {
      text: 'Hey',
      languageCode: 'en',
    })
    // Both routes caption the same speech; the fuller reading is shown.
    expect(talk.coordinator.interimTranscript?.text).toBe('Hey how')

    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    expect(talk.coordinator.interimTranscript).toBeNull()
    expect(talk.coordinator.turns[0].sourceText).toBe('Hey, how are you?')
  })
})

describe('audio ownership when the reported language is wrong', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays the only interpretation there is when the pair disagrees with it', async () => {
    const talk = englishSpanish()

    // Spanish speech reported as English. The Spanish route stays silent
    // because Spanish *is* its target, so the English route is the only one
    // that can interpret this utterance even though the metadata says
    // otherwise.
    talk.routes.source(ROUTE_TO_ES, { text: 'Bien, y tu', languageCode: 'en' }, true)
    talk.routes.source(ROUTE_TO_EN, { text: 'Bien, y tu', languageCode: 'en' }, true)
    talk.routes.translation(ROUTE_TO_EN, {
      text: 'Good, and you?',
    })
    talk.routes.audio(ROUTE_TO_EN, pcm(7))
    expect(talk.spoken.played).toEqual([])

    await vi.advanceTimersByTimeAsync(CONTESTED_AUDIO_HOLD_MS + 10)
    expect(talk.spoken.played).toEqual([])

    // The pair-favoured route explicitly finishes without audio. That is
    // evidence the metadata was wrong; elapsed time alone is not.
    talk.routes.generationComplete(ROUTE_TO_ES)
    expect(talk.spoken.played).toEqual([7])
    expect(talk.coordinator.turns[0].translatedText).toBe('Good, and you?')
  })

  it('drops held audio as soon as the favoured route speaks', async () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.audio(ROUTE_TO_EN, pcm(9))
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    await vi.advanceTimersByTimeAsync(CONTESTED_AUDIO_HOLD_MS + 10)

    expect(talk.spoken.played).toEqual([1])
  })

  it('never releases held audio that is the speaker read back', async () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.translation(ROUTE_TO_EN, {
      text: 'Hey, how are you?',
    })
    talk.routes.audio(ROUTE_TO_EN, pcm(9))
    await vi.advanceTimersByTimeAsync(CONTESTED_AUDIO_HOLD_MS + 10)

    expect(talk.spoken.played).toEqual([])
  })

  it('ends the stream immediately for a route that claims after generating', () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Bien, y tu', languageCode: 'en' }, true)
    talk.routes.translation(ROUTE_TO_EN, {
      text: 'Good, and you?',
    })
    talk.routes.audio(ROUTE_TO_EN, pcm(7))
    // Its whole response is generated while the audio is still held.
    talk.routes.generationComplete(ROUTE_TO_EN)
    expect(talk.spoken.ended).toBe(0)

    talk.routes.generationComplete(ROUTE_TO_ES)
    expect(talk.spoken.played).toEqual([7])
    // The turn must not wait out the scheduler's idle fallback to end.
    expect(talk.spoken.ended).toBe(1)
  })

  it('releases held audio early when the favoured route finishes silently', () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Bien, y tu', languageCode: 'en' }, true)
    talk.routes.translation(ROUTE_TO_EN, {
      text: 'Good, and you?',
    })
    talk.routes.audio(ROUTE_TO_EN, pcm(7))
    expect(talk.spoken.played).toEqual([])

    talk.routes.generationComplete(ROUTE_TO_ES)
    expect(talk.spoken.played).toEqual([7])
  })
})

describe('interruption', () => {
  it('drops the queue and closes the turn when the owner is cut off', () => {
    const talk = englishSpanish()

    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' }, true)
    talk.routes.translation(ROUTE_TO_ES, { text: 'Hola' })
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.coordinator.playbackStarted()
    talk.coordinator.interrupted(ROUTE_TO_ES, talk.routes.g(ROUTE_TO_ES))

    expect(talk.spoken.flushed).toBe(1)
    expect(talk.coordinator.phase).toBe('listening')
    expect(talk.coordinator.turns).toHaveLength(1)
    expect(talk.coordinator.turns[0].status).toBe('complete')
  })
})

describe('turn boundaries between two people (post-rewrite QA)', () => {
  it('makes completed source text immutable while late translation still lands', () => {
    const talk = englishSpanish()

    talk.routes.nextUtterance(ROUTE_TO_ES)
    const utterance = talk.routes.u(ROUTE_TO_ES)
    talk.coordinator.sourceTranscription(
      ROUTE_TO_ES,
      utterance,
      { text: 'Hello, how are you?', languageCode: 'en' },
      true,
    )
    // Same-route residue and the evidence route are both forbidden to alter the
    // sealed human source.
    talk.coordinator.sourceTranscription(
      ROUTE_TO_ES,
      utterance,
      { text: 'Hello, how are you? ¿Cómo estás?', languageCode: 'es' },
      false,
    )
    talk.routes.source(
      ROUTE_TO_EN,
      { text: 'Different route wording', languageCode: 'vi' },
      true,
    )

    talk.routes.nextGeneration(ROUTE_TO_ES)
    talk.routes.translation(ROUTE_TO_ES, { text: 'Hola, ¿cómo estás?' })
    talk.routes.audio(ROUTE_TO_ES, pcm(1))

    expect(talk.coordinator.turns[0]).toMatchObject({
      sourceText: 'Hello, how are you?',
      sourceLanguage: 'en',
      translatedText: 'Hola, ¿cómo estás?',
    })
  })

  /**
   * The reported screenshot: an English sentence and the Spanish reply run into
   * one source block, with a translation that belonged to neither.
   */
  it('never runs two things a person said into one turn', () => {
    const talk = englishSpanish()

    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.nextUtterance(ROUTE_TO_EN)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' })
    talk.routes.source(ROUTE_TO_EN, { text: 'Hey, how are you?', languageCode: 'en' })
    talk.routes.nextGeneration(ROUTE_TO_ES)
    talk.routes.translation(ROUTE_TO_ES, { text: 'Hola, ¿cómo estás?' })
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.routes.generationComplete(ROUTE_TO_ES)
    talk.coordinator.playbackStarted()
    talk.coordinator.playbackEnded()

    // The reply arrives while the sockets are still tidying up the first turn:
    // no turnComplete has been sent for it yet.
    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.nextUtterance(ROUTE_TO_EN)
    talk.routes.source(ROUTE_TO_EN, { text: 'Hola, ¿cómo estás?', languageCode: 'es' })
    talk.routes.source(ROUTE_TO_ES, { text: 'Hola, ¿cómo estás?', languageCode: 'es' })
    talk.routes.nextGeneration(ROUTE_TO_EN)
    talk.routes.translation(ROUTE_TO_EN, { text: 'Hi, how are you?' })
    talk.routes.audio(ROUTE_TO_EN, pcm(2))
    talk.routes.generationComplete(ROUTE_TO_EN)
    talk.coordinator.playbackStarted()
    talk.coordinator.playbackEnded()

    expect(summarize(talk.coordinator.turns)).toEqual([
      {
        source: 'Hey, how are you?',
        sourceLanguage: 'en',
        translated: 'Hola, ¿cómo estás?',
        targetLanguage: 'es',
        status: 'complete',
      },
      {
        source: 'Hola, ¿cómo estás?',
        sourceLanguage: 'es',
        translated: 'Hi, how are you?',
        targetLanguage: 'en',
        status: 'complete',
      },
    ])
    expect(talk.spoken.played).toEqual([1, 2])
  })

  it('joins finalized API segments while the product turn is still open', () => {
    const talk = englishSpanish()

    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' })
    // No product boundary occurred. A second finalized transport id is another
    // ASR segment of the same human thought.
    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hola, ¿cómo estás?', languageCode: 'es' })

    expect(talk.coordinator.turns.map((turn) => turn.sourceText)).toEqual([
      'Hey, how are you? Hola, ¿cómo estás?',
    ])
  })

  it('leaves a committed turn untouched by everything the old run still sends', () => {
    const talk = englishSpanish()

    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.nextGeneration(ROUTE_TO_ES)
    const staleUtterance = talk.routes.u(ROUTE_TO_ES)
    const staleGeneration = talk.routes.g(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' })
    talk.routes.translation(ROUTE_TO_ES, { text: 'Hola, ¿cómo estás?' })
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.routes.generationComplete(ROUTE_TO_ES)
    talk.coordinator.playbackStarted()
    talk.coordinator.playbackEnded()
    expect(talk.coordinator.turns).toHaveLength(1)

    // Turn 2 begins.
    talk.routes.nextUtterance(ROUTE_TO_EN)
    talk.routes.source(ROUTE_TO_EN, { text: 'Hola, ¿cómo estás?', languageCode: 'es' })
    const before = summarize(talk.coordinator.turns)

    // Everything the first run still had to say arrives now.
    talk.coordinator.sourceTranscription(
      ROUTE_TO_ES,
      staleUtterance,
      { text: 'Hey, how are you? And more', languageCode: 'en' },
      true,
    )
    talk.coordinator.translationTranscription(ROUTE_TO_ES, staleGeneration, {
      text: '你好，你好吗？',
    })
    talk.coordinator.audio(ROUTE_TO_ES, staleGeneration, pcm(9))
    talk.coordinator.generationComplete(ROUTE_TO_ES, staleGeneration)
    talk.coordinator.routeTurnEnd(
      ROUTE_TO_ES,
      staleUtterance,
      staleGeneration,
    )

    expect(summarize(talk.coordinator.turns)).toEqual(before)
    expect(talk.spoken.played).toEqual([1])
  })

  it('does not let a rejected old turn end deactivate the current route', async () => {
    vi.useFakeTimers()
    try {
      const talk = englishSpanish()

      speak(talk, {
        text: 'First turn',
        language: 'en',
        heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
      })
      const staleUtterance = talk.routes.u(ROUTE_TO_EN)
      const staleGeneration = talk.routes.g(ROUTE_TO_EN)

      talk.routes.nextUtterance(ROUTE_TO_ES)
      talk.routes.nextUtterance(ROUTE_TO_EN)
      talk.routes.source(ROUTE_TO_ES, {
        text: 'Second turn',
        languageCode: 'en',
      })
      talk.routes.source(ROUTE_TO_EN, {
        text: 'Second turn',
        languageCode: 'en',
      })

      talk.coordinator.routeTurnEnd(
        ROUTE_TO_EN,
        staleUtterance,
        staleGeneration,
      )
      talk.routes.turnEnd(ROUTE_TO_ES)
      await vi.advanceTimersByTimeAsync(400)

      // The current run on the English route is still active, so an old end
      // cannot make the coordinator commit its turn early.
      expect(talk.coordinator.turns).toHaveLength(1)
      expect(talk.coordinator.turns[0].status).toBe('translating')

      talk.routes.turnEnd(ROUTE_TO_EN)
      await vi.advanceTimersByTimeAsync(UTTERANCE_JOIN_MS)
      expect(talk.coordinator.turns[0].status).toBe('complete')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hears the next speaker immediately after playback ends', () => {
    const talk = englishSpanish()

    speak(talk, {
      text: 'Hey, how are you?',
      language: 'en',
      heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_ES,
      translation: 'Hola, ¿cómo estás?',
    })
    talk.coordinator.playbackStarted()
    talk.coordinator.playbackEnded()
    expect(talk.coordinator.phase).toBe('listening')

    speak(talk, {
      text: 'Bien, ¿y tú?',
      language: 'es',
      heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_EN,
      translation: 'Good, and you?',
    })
    finishPlayback(talk.coordinator)

    expect(talk.coordinator.turns).toHaveLength(2)
    expect(talk.coordinator.turns[1].sourceText).toBe('Bien, ¿y tú?')
  })

  it('says it is playing only while there is sound', () => {
    const talk = englishSpanish()

    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' })
    expect(talk.coordinator.phase).toBe('translating')

    talk.routes.nextGeneration(ROUTE_TO_ES)
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.coordinator.playbackStarted()
    expect(talk.coordinator.phase).toBe('playing')

    talk.routes.generationComplete(ROUTE_TO_ES)
    // Still audible: the model has finished generating, the speakers have not.
    expect(talk.coordinator.phase).toBe('playing')

    talk.coordinator.playbackEnded()
    expect(talk.coordinator.phase).toBe('listening')
  })

  it('keeps later finalized segments on the same playing product turn', () => {
    const talk = englishSpanish()

    // Turn 1 is being spoken.
    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' })
    talk.routes.nextGeneration(ROUTE_TO_ES)
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.coordinator.playbackStarted()
    expect(talk.coordinator.phase).toBe('playing')

    // Another finalized ASR segment arrives before the translated stream ends.
    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'I also need help.', languageCode: 'en' })
    talk.routes.nextGeneration(ROUTE_TO_ES)
    talk.routes.audio(ROUTE_TO_ES, pcm(2))
    expect(talk.spoken.flushed).toBe(0)

    talk.routes.generationComplete(ROUTE_TO_ES)
    talk.coordinator.playbackEnded()

    expect(talk.coordinator.phase).toBe('listening')
    expect(talk.coordinator.turns).toHaveLength(1)
    expect(summarize(talk.coordinator.turns)[0]).toMatchObject({
      source: 'Hey, how are you? I also need help.',
      status: 'complete',
    })
  })
})

describe('interruption by a person', () => {
  it('cancels the rest of the translation and keeps the turn it belonged to', () => {
    const talk = englishSpanish()

    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' })
    talk.routes.nextGeneration(ROUTE_TO_ES)
    talk.routes.translation(ROUTE_TO_ES, { text: 'Hola, ¿cómo estás?' })
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.coordinator.playbackStarted()
    expect(talk.coordinator.phase).toBe('playing')

    talk.coordinator.bargeIn()

    expect(talk.spoken.flushed).toBe(1)
    expect(talk.coordinator.phase).toBe('listening')
    // The row is exactly what the two of them had already seen.
    expect(summarize(talk.coordinator.turns)).toEqual([
      {
        source: 'Hey, how are you?',
        sourceLanguage: 'en',
        translated: 'Hola, ¿cómo estás?',
        targetLanguage: 'es',
        status: 'complete',
      },
    ])
  })

  it('does not swallow the turn of the person doing the interrupting', () => {
    const talk = englishSpanish()

    // The previous translation has already finished and been committed; the
    // short guard after it is still running when the next person starts.
    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'Hey, how are you?', languageCode: 'en' })
    talk.routes.nextGeneration(ROUTE_TO_ES)
    talk.routes.audio(ROUTE_TO_ES, pcm(1))
    talk.coordinator.playbackStarted()
    talk.coordinator.playbackEnded()
    expect(talk.coordinator.turns).toHaveLength(1)

    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_ES, { text: 'Bien, ¿y tú?', languageCode: 'es' })

    talk.coordinator.bargeIn()

    // Their own words are still the open turn, not a row cut short by the
    // interruption they caused.
    expect(talk.coordinator.turns).toHaveLength(2)
    expect(talk.coordinator.turns[1]).toMatchObject({
      sourceText: 'Bien, ¿y tú?',
      status: 'translating',
    })
  })

  it('leaves committed history alone when nothing is open', () => {
    const talk = englishSpanish()

    speak(talk, {
      text: 'Hey, how are you?',
      language: 'en',
      heardBy: [ROUTE_TO_ES, ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_ES,
      translation: 'Hola, ¿cómo estás?',
    })
    finishPlayback(talk.coordinator)
    const settled = summarize(talk.coordinator.turns)

    talk.coordinator.bargeIn()

    expect(summarize(talk.coordinator.turns)).toEqual(settled)
    expect(talk.coordinator.phase).toBe('listening')
  })
})

describe('auto mode language trust', () => {
  const auto = () => {
    const talk = conversation({
      targetLanguage: 'en',
      counterpart: null,
      autoDetect: true,
    })
    talk.coordinator.addRoute(ROUTE_TO_EN, 'en')
    return talk
  }

  it('does not adopt a language the model never acted on', () => {
    const talk = auto()

    // Live Translate labelled a plainly English sentence Vietnamese in real
    // use. The route stayed silent, which is what it does when the speech is
    // already the language it renders into.
    speak(talk, {
      text: 'Hey, how are you? I am doing fine. And you?',
      language: 'vi',
      heardBy: [ROUTE_TO_EN],
    })

    expect(talk.counterparts).toEqual([])
    expect(talk.coordinator.counterpartLanguage).toBeNull()
    expect(talk.coordinator.turns[0].sourceLanguage).toBe('en')
    expect(talk.spoken.played).toEqual([])
  })

  it('takes the writing system over a code it contradicts', () => {
    const talk = auto()

    speak(talk, {
      text: '你好，你好吗？',
      language: 'vi',
      heardBy: [ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_EN,
      translation: 'Hello, how are you?',
    })
    finishPlayback(talk.coordinator)

    // Han script is not Vietnamese. The conversation is with the language the
    // script actually belongs to, never the one the code claimed.
    expect(talk.counterparts).toEqual(['zh-Hans'])
    expect(talk.coordinator.turns[0]).toMatchObject({
      sourceLanguage: 'zh-Hans',
      translatedText: 'Hello, how are you?',
    })
  })

  it('takes the writing system over a code for a right-to-left script too', () => {
    const talk = auto()

    speak(talk, {
      text: 'مرحبا كيف حالك',
      language: 'vi',
      heardBy: [ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_EN,
      translation: 'Hello, how are you?',
    })
    finishPlayback(talk.coordinator)

    expect(talk.counterparts).toEqual(['ar'])
  })

  it('does not let a secondary route overwrite the source authority', () => {
    const talk = auto()
    talk.coordinator.addRoute(ROUTE_TO_ES, 'es')

    // Per-route metadata is not voted across incomparable route runs. The first
    // route owns source evidence; the second can only contribute translation.
    talk.routes.nextUtterance(ROUTE_TO_EN)
    talk.routes.nextUtterance(ROUTE_TO_ES)
    talk.routes.source(ROUTE_TO_EN, { text: 'Bem, e tu?', languageCode: 'pt-BR' })
    talk.routes.source(ROUTE_TO_ES, { text: 'Bem, e tu?', languageCode: 'vi' })
    talk.routes.nextGeneration(ROUTE_TO_EN)
    talk.routes.translation(ROUTE_TO_EN, { text: 'Well, and you?' })

    expect(talk.counterparts).toEqual(['pt-BR'])
  })

  it('adopts a language the model actually interpreted out of', () => {
    const talk = auto()

    speak(talk, {
      text: 'Bem, e tu?',
      language: 'pt-BR',
      heardBy: [ROUTE_TO_EN],
      interpretedBy: ROUTE_TO_EN,
      translation: 'Well, and you?',
    })
    finishPlayback(talk.coordinator)

    expect(talk.counterparts).toEqual(['pt-BR'])
    expect(talk.coordinator.turns[0]).toMatchObject({
      sourceLanguage: 'pt-BR',
      translatedText: 'Well, and you?',
      targetLanguage: 'en',
    })
  })
})

describe('session boundaries', () => {
  it('discards the whole conversation when the pair changes', () => {
    const talk = englishSpanish()
    speak(talk, {
      text: 'Hey, how are you?',
      language: 'en',
      heardBy: [ROUTE_TO_ES],
      interpretedBy: ROUTE_TO_ES,
      translation: 'Hola',
    })
    finishPlayback(talk.coordinator)
    expect(talk.coordinator.turns).toHaveLength(1)

    talk.coordinator.configure({
      targetLanguage: 'en',
      counterpart: null,
      autoDetect: true,
    })

    // Choosing different languages is starting a different conversation.
    // Leaving the previous pair's rows on screen is the visible half of
    // leaving its state in place, and the two go together.
    expect(talk.coordinator.turns).toEqual([])
    expect(talk.coordinator.counterpartLanguage).toBeNull()
    expect(talk.coordinator.phase).toBe('listening')
  })

  it('keeps history when the same pair is reconfigured', () => {
    const talk = englishSpanish()
    speak(talk, {
      text: 'Hey, how are you?',
      language: 'en',
      heardBy: [ROUTE_TO_ES],
      interpretedBy: ROUTE_TO_ES,
      translation: 'Hola',
    })
    finishPlayback(talk.coordinator)

    // Stop and Start on the same languages is a retry, not a new conversation.
    talk.coordinator.configure({
      targetLanguage: 'es',
      counterpart: 'en',
      autoDetect: false,
    })

    expect(talk.coordinator.turns).toHaveLength(1)
  })

  it('abandons a turn in progress on reset and clears history on demand', () => {
    const talk = englishSpanish()
    talk.routes.source(ROUTE_TO_ES, { text: 'Half a sentence', languageCode: 'en' }, false)
    expect(talk.coordinator.turns).toHaveLength(1)

    talk.coordinator.reset()
    expect(talk.coordinator.turns).toEqual([])
    expect(talk.coordinator.interimTranscript).toBeNull()

    talk.coordinator.clearHistory()
    expect(talk.coordinator.turns).toEqual([])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTESTED_AUDIO_HOLD_MS,
  ConversationCoordinator,
} from './conversation'
import { UTTERANCE_JOIN_MS } from './config'
import type { SupportedLanguageCode } from './types'

const pcm = (marker: number) => new Uint8Array([marker, 0, marker, 0])

function harness({
  target,
  counterpart,
  autoDetect = false,
}: {
  target: SupportedLanguageCode
  counterpart: SupportedLanguageCode | null
  autoDetect?: boolean
}) {
  const played: number[] = []
  const counterpartChanges: SupportedLanguageCode[] = []
  const coordinator = new ConversationCoordinator(
    {
      playAudio: (chunk) => {
        played.push(chunk[0])
        return true
      },
      endAudio: () => undefined,
      flushAudio: () => undefined,
      changed: () => undefined,
      counterpartDetected: (language) => counterpartChanges.push(language),
    },
    { targetLanguage: target, counterpart, autoDetect },
  )
  return { coordinator, played, counterpartChanges }
}

function source(
  coordinator: ConversationCoordinator,
  route: number,
  utterance: number,
  text: string,
  languageCode: string,
) {
  coordinator.speechStarted(route, utterance)
  coordinator.sourceTranscription(
    route,
    utterance,
    { text, languageCode },
    true,
  )
  coordinator.speechEnded(route, utterance)
}

function translated(
  coordinator: ConversationCoordinator,
  route: number,
  generation: number,
  text: string,
  marker: number,
) {
  coordinator.translationTranscription(route, generation, { text })
  coordinator.audio(route, generation, pcm(marker))
}

function finishPlayback(coordinator: ConversationCoordinator) {
  coordinator.playbackStarted()
  coordinator.playbackEnded()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('browser trace 3 — English <-> Bengali', () => {
  it('does not let English readback win and joins finalized sentence segments', async () => {
    vi.useFakeTimers()
    const talk = harness({ target: 'en', counterpart: 'bn' })
    const intoEnglish = 1
    const intoBengali = 2
    talk.coordinator.addRoute(intoEnglish, 'en')
    talk.coordinator.addRoute(intoBengali, 'bn')

    source(talk.coordinator, intoEnglish, 1, 'I just want to confirm', 'en')

    // Trace 3 at 32.095 s: the English-target route generated first. The
    // second route did not report the same English source until 170 ms after
    // that wrong audio was already waiting.
    talk.coordinator.translationTranscription(intoEnglish, 1, {
      text: 'I just want to confirm',
    })
    talk.coordinator.audio(intoEnglish, 1, pcm(1))
    await vi.advanceTimersByTimeAsync(170)
    source(talk.coordinator, intoBengali, 1, 'I just want to confirm', 'en')

    // At 32.613 s the former 250 ms fallback claimed the wrong route even
    // though the newly arrived evidence favoured Bengali output.
    await vi.advanceTimersByTimeAsync(CONTESTED_AUDIO_HOLD_MS - 170 + 4)
    expect(talk.played).toEqual([])

    // Correct Bengali transcription/audio followed at 32.769/32.793 s.
    await vi.advanceTimersByTimeAsync(152)
    talk.coordinator.translationTranscription(intoBengali, 1, {
      text: 'আমি শুধু নিশ্চিত করতে চাই',
    })
    await vi.advanceTimersByTimeAsync(24)
    talk.coordinator.audio(intoBengali, 1, pcm(2))
    expect(talk.played).toEqual([2])
    talk.coordinator.playbackStarted()

    // The real trace delivered these as separate finished input runs while the
    // same person was still completing one thought.
    const continuations = [
      ['you have an appointment', 'আপনার একটি অ্যাপয়েন্টমেন্ট আছে'],
      ['before tomorrow morning', 'আগামীকাল সকালের আগে'],
    ] as const
    for (const [index, [heard, interpretation]] of continuations.entries()) {
      const utterance = index + 2
      const generation = index + 2
      source(talk.coordinator, intoEnglish, utterance, heard, 'en')
      source(talk.coordinator, intoBengali, utterance, heard, 'en')
      translated(
        talk.coordinator,
        intoBengali,
        generation,
        interpretation,
        2,
      )
      expect(talk.coordinator.turns).toHaveLength(1)
    }

    talk.coordinator.playbackEnded()
    expect(talk.coordinator.turns).toHaveLength(1)
    expect(talk.coordinator.turns[0]).toMatchObject({
      sourceLanguage: 'en',
      sourceText:
        'I just want to confirm you have an appointment before tomorrow morning',
      targetLanguage: 'bn',
      translatedText:
        'আমি শুধু নিশ্চিত করতে চাই আপনার একটি অ্যাপয়েন্টমেন্ট আছে আগামীকাল সকালের আগে',
      status: 'complete',
    })

    // The Bengali reply uses the opposite route and its own script remains the
    // displayed human source.
    source(talk.coordinator, intoEnglish, 4, 'হ্যাঁ, আমার সময় আছে।', 'bn')
    source(talk.coordinator, intoBengali, 4, 'hya, amar shomoy ache', 'bn')
    translated(talk.coordinator, intoEnglish, 2, 'Yes, I have time.', 1)
    finishPlayback(talk.coordinator)

    expect(talk.coordinator.turns[1]).toMatchObject({
      sourceLanguage: 'bn',
      sourceText: 'হ্যাঁ, আমার সময় আছে।',
      targetLanguage: 'en',
      translatedText: 'Yes, I have time.',
    })
  })
})

describe('browser trace 5 — Spanish <-> English', () => {
  it('makes the favoured route authoritative even when its audio arrives later', async () => {
    vi.useFakeTimers()
    const talk = harness({ target: 'en', counterpart: 'es' })
    const intoEnglish = 1
    const intoSpanish = 2
    talk.coordinator.addRoute(intoEnglish, 'en')
    talk.coordinator.addRoute(intoSpanish, 'es')

    source(talk.coordinator, intoEnglish, 1, 'I need to confirm my appointment', 'en')

    // Trace 5: wrong English-target audio arrived at 7.608 s, 116 ms before
    // the Spanish-target route even reported the same English source.
    talk.coordinator.audio(intoEnglish, 1, pcm(1))
    await vi.advanceTimersByTimeAsync(116)
    source(talk.coordinator, intoSpanish, 1, 'I need to confirm my appointment', 'en')

    // The old fallback fired at 7.859 s. Time alone no longer grants ownership.
    await vi.advanceTimersByTimeAsync(CONTESTED_AUDIO_HOLD_MS - 116 + 1)
    expect(talk.played).toEqual([])

    // The correct Spanish transcript arrived 26 ms later, then audio 14 ms
    // after that. It still wins the turn.
    await vi.advanceTimersByTimeAsync(26)
    talk.coordinator.translationTranscription(intoSpanish, 1, {
      text: 'Necesito confirmar mi cita',
    })
    await vi.advanceTimersByTimeAsync(14)
    talk.coordinator.audio(intoSpanish, 1, pcm(2))
    expect(talk.played).toEqual([2])
    finishPlayback(talk.coordinator)

    expect(talk.coordinator.turns[0]).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      translatedText: 'Necesito confirmar mi cita',
    })

    // Spanish ASR in the trace finalized every few words. It remains one row
    // while translated output for that thought is still playing.
    const fragments = [
      ['Quería decirte', 'I wanted to tell you'],
      ['que mañana', 'that tomorrow'],
      ['llegaré un poco tarde.', 'I will arrive a little late.'],
    ] as const
    for (const [index, [heard, interpretation]] of fragments.entries()) {
      const utterance = index + 2
      const generation = index + 2
      source(talk.coordinator, intoEnglish, utterance, heard, 'es')
      source(talk.coordinator, intoSpanish, utterance, heard, 'es')
      translated(
        talk.coordinator,
        intoEnglish,
        generation,
        interpretation,
        1,
      )
      if (index === 0) talk.coordinator.playbackStarted()
      expect(talk.coordinator.turns).toHaveLength(2)
    }
    talk.coordinator.playbackEnded()

    expect(talk.coordinator.turns[1]).toMatchObject({
      sourceLanguage: 'es',
      sourceText: 'Quería decirte que mañana llegaré un poco tarde.',
      targetLanguage: 'en',
      translatedText:
        'I wanted to tell you that tomorrow I will arrive a little late.',
      status: 'complete',
    })
  })
})

describe('browser trace 4 — Auto -> English', () => {
  it('recovers from Vietnamese and uses Spanish for the English reply', async () => {
    vi.useFakeTimers()
    const talk = harness({
      target: 'en',
      counterpart: null,
      autoDetect: true,
    })
    const intoEnglish = 1
    talk.coordinator.addRoute(intoEnglish, 'en')

    // Three finalized English ASR runs were one opening thought. No English
    // readback and no invented counterpart.
    for (const [index, text] of [
      'Hello,',
      'I wanted to ask',
      'how old you are.',
    ].entries()) {
      const utterance = index + 1
      const generation = index + 1
      source(talk.coordinator, intoEnglish, utterance, text, 'en')
      // Trace 4 carried target-route audio here despite target-language speech.
      // Directional silence must discard it rather than read English back.
      talk.coordinator.audio(intoEnglish, generation, pcm(1))
      talk.coordinator.routeTurnEnd(intoEnglish, utterance, generation)
      await vi.advanceTimersByTimeAsync(500)
    }
    await vi.advanceTimersByTimeAsync(UTTERANCE_JOIN_MS)
    expect(talk.coordinator.turns).toHaveLength(1)
    expect(talk.coordinator.turns[0]).toMatchObject({
      sourceLanguage: 'en',
      sourceText: 'Hello, I wanted to ask how old you are.',
      targetLanguage: null,
      translatedText: '',
      status: 'complete',
    })
    expect(talk.counterpartChanges).toEqual([])

    // Trace 4 first supplied weak Vietnamese evidence, then a longer second
    // segment. It may provisionally adopt Vietnamese, but that decision is not
    // permanent.
    source(talk.coordinator, intoEnglish, 4, 'x', 'vi')
    translated(talk.coordinator, intoEnglish, 4, 'What?', 1)
    talk.coordinator.playbackStarted()
    source(talk.coordinator, intoEnglish, 5, 'xin chao ban', 'vi')
    translated(talk.coordinator, intoEnglish, 5, 'Hello there', 1)
    talk.coordinator.playbackEnded()
    expect(talk.coordinator.counterpartLanguage).toBe('vi')
    talk.coordinator.addRoute(2, 'vi')

    // Repeated clear Spanish evidence replaces the stale counterpart.
    source(talk.coordinator, intoEnglish, 6, 'cuántos', 'es')
    translated(talk.coordinator, intoEnglish, 6, 'how many', 1)
    talk.coordinator.playbackStarted()
    // The stale Vietnamese route reported Spanish only after the English
    // translation route had already acted, matching trace 4's ordering.
    source(talk.coordinator, 2, 1, 'cuántos años', 'es')
    source(talk.coordinator, intoEnglish, 7, 'años tienes', 'es')
    translated(talk.coordinator, intoEnglish, 7, 'years old are you', 1)
    expect(talk.coordinator.counterpartLanguage).toBe('es')
    expect(talk.counterpartChanges).toEqual(['vi', 'es'])
    talk.coordinator.playbackEnded()

    talk.coordinator.removeRoute(2)
    const intoSpanish = 3
    talk.coordinator.addRoute(intoSpanish, 'es')

    source(talk.coordinator, intoEnglish, 8, 'I am thirty years old.', 'en')
    source(talk.coordinator, intoSpanish, 1, 'I am thirty years old.', 'en')
    translated(talk.coordinator, intoSpanish, 1, 'Tengo treinta años.', 3)
    finishPlayback(talk.coordinator)

    expect(talk.coordinator.turns.at(-1)).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      translatedText: 'Tengo treinta años.',
    })
    expect(talk.played.at(-1)).toBe(3)

    // Continue to 20 product turns to prove the recovered pair does not drift.
    let enUtterance = 8
    let esUtterance = 1
    let enGeneration = 7
    let esGeneration = 1
    for (let index = 0; index < 16; index += 1) {
      const spanishSpeaking = index % 2 === 0
      enUtterance += 1
      esUtterance += 1
      const heard = spanishSpeaking
        ? `respuesta española ${index + 1}`
        : `English reply ${index + 1}`
      const language = spanishSpeaking ? 'es' : 'en'
      source(talk.coordinator, intoEnglish, enUtterance, heard, language)
      source(talk.coordinator, intoSpanish, esUtterance, heard, language)
      if (spanishSpeaking) {
        enGeneration += 1
        translated(
          talk.coordinator,
          intoEnglish,
          enGeneration,
          `English interpretation ${index + 1}`,
          1,
        )
      } else {
        esGeneration += 1
        translated(
          talk.coordinator,
          intoSpanish,
          esGeneration,
          `interpretación española ${index + 1}`,
          3,
        )
      }
      finishPlayback(talk.coordinator)
    }

    expect(talk.coordinator.turns).toHaveLength(20)
    expect(talk.coordinator.counterpartLanguage).toBe('es')
    for (const turn of talk.coordinator.turns.slice(2)) {
      expect(new Set([turn.sourceLanguage, turn.targetLanguage])).toEqual(
        new Set(['en', 'es']),
      )
    }
  })
})

function runExplicitConversation({
  counterpart,
  counterpartStarts,
}: {
  counterpart: 'es' | 'bn'
  counterpartStarts: boolean
}) {
  const talk = harness({ target: 'en', counterpart })
  const intoEnglish = 1
  const intoCounterpart = 2
  talk.coordinator.addRoute(intoEnglish, 'en')
  talk.coordinator.addRoute(intoCounterpart, counterpart)
  let enUtterance = 0
  let otherUtterance = 0
  let enGeneration = 0
  let otherGeneration = 0

  for (let index = 0; index < 20; index += 1) {
    const otherSpeaking = (index % 2 === 0) === counterpartStarts
    enUtterance += 1
    otherUtterance += 1
    const language = otherSpeaking ? counterpart : 'en'
    const heard =
      language === 'bn'
        ? `বাংলা উত্তর ${index + 1}`
        : language === 'es'
          ? `respuesta española ${index + 1}`
          : `English turn ${index + 1}`
    source(talk.coordinator, intoEnglish, enUtterance, heard, language)
    source(
      talk.coordinator,
      intoCounterpart,
      otherUtterance,
      heard,
      language,
    )

    if (otherSpeaking) {
      enGeneration += 1
      translated(
        talk.coordinator,
        intoEnglish,
        enGeneration,
        `English interpretation ${index + 1}`,
        1,
      )
    } else {
      otherGeneration += 1
      translated(
        talk.coordinator,
        intoCounterpart,
        otherGeneration,
        counterpart === 'bn'
          ? `বাংলা অনুবাদ ${index + 1}`
          : `traducción española ${index + 1}`,
        2,
      )
    }
    finishPlayback(talk.coordinator)
  }

  expect(talk.coordinator.turns).toHaveLength(20)
  for (const [index, turn] of talk.coordinator.turns.entries()) {
    const otherSpeaking = (index % 2 === 0) === counterpartStarts
    expect(turn.sourceLanguage).toBe(otherSpeaking ? counterpart : 'en')
    expect(turn.targetLanguage).toBe(otherSpeaking ? 'en' : counterpart)
    expect(turn.sourceLanguage).not.toBe(turn.targetLanguage)
    expect(turn.status).toBe('complete')
  }
}

describe('long-session direction invariants', () => {
  it('keeps English <-> Bengali correct for 20 alternating turns', () => {
    runExplicitConversation({ counterpart: 'bn', counterpartStarts: false })
  })

  it('keeps English <-> Spanish correct for 20 turns when English starts', () => {
    runExplicitConversation({ counterpart: 'es', counterpartStarts: false })
  })

  it('keeps English <-> Spanish correct for 20 turns when Spanish starts', () => {
    runExplicitConversation({ counterpart: 'es', counterpartStarts: true })
  })
})

describe('progressive transcription remains one product utterance', () => {
  it.each([
    {
      language: 'en' as const,
      counterpart: 'es' as const,
      fragments: ['I wanted', 'to confirm', 'the appointment tomorrow.'],
    },
    {
      language: 'es' as const,
      counterpart: 'es' as const,
      fragments: ['Quería', 'confirmar la cita', 'para mañana.'],
    },
    {
      language: 'bn' as const,
      counterpart: 'bn' as const,
      fragments: ['আমি', 'আগামীকালের সময়', 'নিশ্চিত করতে চাই।'],
    },
  ])('$language finalized fragments update one row', ({
    language,
    counterpart,
    fragments,
  }) => {
    const talk = harness({ target: 'en', counterpart })
    const intoEnglish = 1
    const intoCounterpart = 2
    talk.coordinator.addRoute(intoEnglish, 'en')
    talk.coordinator.addRoute(intoCounterpart, counterpart)
    const interpreter = language === 'en' ? intoCounterpart : intoEnglish

    for (const [index, fragment] of fragments.entries()) {
      const utterance = index + 1
      source(talk.coordinator, intoEnglish, utterance, fragment, language)
      source(talk.coordinator, intoCounterpart, utterance, fragment, language)
      translated(
        talk.coordinator,
        interpreter,
        index + 1,
        `translation ${index + 1}`,
        interpreter,
      )
      if (index === 0) talk.coordinator.playbackStarted()
      expect(talk.coordinator.turns).toHaveLength(1)
      expect(talk.coordinator.turns[0].sourceText).toContain(fragment)
    }
    talk.coordinator.playbackEnded()

    expect(talk.coordinator.turns).toHaveLength(1)
    expect(talk.coordinator.turns[0].sourceText).toBe(fragments.join(' '))
    expect(talk.coordinator.turns[0].status).toBe('complete')
  })
})

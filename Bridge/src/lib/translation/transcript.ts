import type { TranscriptTurn } from './types'

/**
 * Transcript assembly, kept pure so it can be exercised without a Live session.
 *
 * `TranslationSession` commits a turn once the Live API has finished reporting
 * that piece of speech, so a turn is normally final as soon as it exists.
 * `isFinal` stays part of the turn contract for a segment the API marks
 * unfinished; closing those on stop keeps a line from being left mid-turn.
 */
export function finalizeOpenTurns(
  turns: readonly TranscriptTurn[],
): TranscriptTurn[] {
  if (turns.every((turn) => turn.isFinal)) {
    return turns as TranscriptTurn[]
  }
  return turns.map((turn) => (turn.isFinal ? turn : { ...turn, isFinal: true }))
}

/** Letters and digits only, for comparisons that should ignore how it was written. */
export function comparableTranscriptText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Shortest text that still counts as the same utterance, as a fraction. */
const NEAR_DUPLICATE_COVERAGE = 0.8

/**
 * Whether two transcriptions are the same piece of speech written down twice.
 *
 * Every open route hears the same microphone, so one sentence can be reported
 * by more than one of them with small differences in punctuation, casing, or a
 * missing final word. Requiring the shorter text to be a prefix covering most
 * of the longer one accepts those while still treating a genuine continuation
 * of the conversation as new.
 *
 * The same question identifies the route of a pair that is parroting rather
 * than interpreting: its "translation" is the speech it was given. The coverage
 * rule is what keeps a short reply whose translation merely starts the same way
 * from looking like a repeat, and what keeps a translation that is still
 * streaming from being judged before enough of it has arrived.
 */
export function isNearDuplicateTranscript(left: string, right: string): boolean {
  const a = comparableTranscriptText(left)
  const b = comparableTranscriptText(right)
  if (!a || !b) return false
  if (a === b) return true

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (!longer.startsWith(shorter)) return false
  return shorter.length / longer.length >= NEAR_DUPLICATE_COVERAGE
}

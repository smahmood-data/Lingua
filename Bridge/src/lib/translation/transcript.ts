/** Letters and digits only, for comparisons that ignore how it was written. */
export function comparableTranscriptText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Shortest text that still counts as the same utterance, as a fraction. */
const NEAR_DUPLICATE_COVERAGE = 0.8

/**
 * Whether two transcriptions are the same piece of speech written down twice.
 *
 * This identifies the route of a pair that is parroting rather than
 * interpreting: its "translation" is the speech it was given. The coverage rule
 * is what keeps a short reply whose translation merely starts the same way from
 * looking like a repeat, and what keeps a translation that is still streaming
 * from being judged before enough of it has arrived.
 *
 * It is deliberately not how duplicate speech is kept off the screen. One
 * utterance is one turn because only one turn is ever open, not because two
 * strings were compared.
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

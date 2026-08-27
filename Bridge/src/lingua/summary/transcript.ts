import type { Speaker, TranscriptTurn } from './types.ts'

/**
 * The transcript lives in React state for the length of one session and is
 * deliberately never written to localStorage, sessionStorage, or a database.
 * A refresh must lose the conversation: these are medical, legal, and
 * financial conversations, and the prototype has no consent flow for keeping
 * them. The helpers below are pure so this rule stays easy to test.
 */

const SPEAKERS: readonly Speaker[] = ['user', 'other']

let turnCounter = 0

export function createTurn(input: {
  speaker: Speaker
  original: string
  translated?: string
}): TranscriptTurn {
  turnCounter += 1
  return {
    id: `turn-${turnCounter}`,
    speaker: input.speaker,
    original: input.original,
    translated: input.translated ?? '',
  }
}

/**
 * Appends a finalised turn. Turns with no speech are dropped at the edge so
 * every later stage can assume the transcript holds real content.
 */
export function appendTurn(
  turns: readonly TranscriptTurn[],
  turn: TranscriptTurn,
): TranscriptTurn[] {
  if (turn.original.trim().length === 0) return [...turns]
  return [...turns, turn]
}

/** Mirrors the server's rule so the UI can disable the button before asking. */
export function hasSpokenContent(turns: readonly TranscriptTurn[]): boolean {
  return turns.some((turn) => turn.original.trim().length > 0)
}

/** Strips the client-only id down to the fields the server accepts. */
export function toRequestTurns(turns: readonly TranscriptTurn[]) {
  return turns
    .filter((turn) => turn.original.trim().length > 0)
    .map((turn) => ({
      speaker: turn.speaker,
      original: turn.original,
      translated: turn.translated,
    }))
}

export function isSpeaker(value: unknown): value is Speaker {
  return typeof value === 'string' && SPEAKERS.includes(value as Speaker)
}

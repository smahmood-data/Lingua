import type { TranscriptKind, TranscriptTurn } from './types'

/**
 * Transcript assembly, kept pure so it can be exercised without a Live session.
 *
 * The Live API separates two things, and they must not be mixed:
 *
 * - `interimInputTranscription` is a speculative partial hypothesis, replaced
 *   as the speaker keeps talking. It is a preview, not history.
 * - `inputTranscription` / `outputTranscription` are, per the Live transcription
 *   documentation, "the finalized transcript emitted when the speaker pauses,
 *   the turn completes, or speech is finalized", and each one "represents the
 *   model's authoritative transcription of that speech segment".
 *
 * So each finalised message is committed as its own turn. An earlier version
 * concatenated them until `turnComplete`, which merged separate utterances into
 * one turn whenever more than one was finalised inside a model turn.
 */
export interface TranscriptFragment {
  kind: TranscriptKind
  text: string
  languageCode: string
  isFinal: boolean
}

/** Shape of `Transcription` from the SDK, narrowed to the fields used here. */
export interface TranscriptionLike {
  text?: string
  finished?: boolean
  languageCode?: string
}

/**
 * Convert an API transcription into a fragment, or `null` when it carries no
 * text worth recording. Whitespace-only payloads are dropped so an empty
 * segment cannot appear as a blank subtitle line.
 */
export function normalizeTranscription(
  kind: TranscriptKind,
  transcription: TranscriptionLike,
  fallbackLanguageCode: string,
): TranscriptFragment | null {
  const text = transcription.text ?? ''
  if (text.trim().length === 0) {
    return null
  }

  return {
    kind,
    text,
    languageCode: transcription.languageCode ?? fallbackLanguageCode,
    // These messages are the finalised segment. `finished` is only consulted so
    // that an explicit `false` from the API is still honoured.
    isFinal: transcription.finished !== false,
  }
}

/**
 * Commit a finalised segment.
 *
 * A segment that the API marked as not finished stays open, so a follow-up
 * segment of the same kind extends it instead of starting a new line.
 */
export function commitFragment(
  turns: readonly TranscriptTurn[],
  fragment: TranscriptFragment,
  id: string,
  createdAt: number,
): TranscriptTurn[] {
  const openIndex = turns.findLastIndex(
    (turn) => turn.kind === fragment.kind && !turn.isFinal,
  )

  if (openIndex === -1) {
    return [
      ...turns,
      {
        id,
        kind: fragment.kind,
        text: fragment.text,
        languageCode: fragment.languageCode,
        isFinal: fragment.isFinal,
        createdAt,
      },
    ]
  }

  const next = [...turns]
  const open = next[openIndex]
  next[openIndex] = {
    ...open,
    text: open.text + fragment.text,
    languageCode: fragment.languageCode,
    isFinal: fragment.isFinal,
  }
  return next
}

/** Close every open turn, e.g. on `turnComplete` or when the session stops. */
export function finalizeOpenTurns(
  turns: readonly TranscriptTurn[],
): TranscriptTurn[] {
  if (turns.every((turn) => turn.isFinal)) {
    return turns as TranscriptTurn[]
  }
  return turns.map((turn) => (turn.isFinal ? turn : { ...turn, isFinal: true }))
}

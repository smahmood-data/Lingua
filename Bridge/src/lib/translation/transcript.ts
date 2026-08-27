import type { TranscriptKind, TranscriptTurn } from './types'

/**
 * Transcript assembly, kept pure so it can be exercised without a Live session.
 *
 * Gemini streams transcription in fragments. Fragments of the same kind are
 * appended to the open turn until the API reports the turn finished; nothing is
 * invented when the API sends no transcription at all.
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
 * text worth recording.
 */
export function normalizeTranscription(
  kind: TranscriptKind,
  transcription: TranscriptionLike,
  fallbackLanguageCode: string,
): TranscriptFragment | null {
  const text = transcription.text ?? ''
  if (text.length === 0) {
    return null
  }

  return {
    kind,
    text,
    languageCode: transcription.languageCode ?? fallbackLanguageCode,
    isFinal: transcription.finished === true,
  }
}

/**
 * Append a fragment to the transcript.
 *
 * Fragment text is concatenated exactly as the API sends it — no spacing or
 * punctuation is added — so the transcript always reflects the model output.
 */
export function appendFragment(
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

/**
 * The client's view of the POST /api/summarize contract.
 *
 * These are types only, so nothing is shared at runtime with the server. The
 * client therefore re-checks the response shape rather than assuming the
 * server validated it — a proxy, a tunnel, or a stale deploy can all put
 * something else on the wire.
 */

export type Speaker = 'user' | 'other'

export type TranscriptTurn = {
  id: string
  speaker: Speaker
  /** What the speaker said, in the language they said it in. */
  original: string
  /** The interpreted text the other participant heard. */
  translated: string
}

export type ConversationSummary = {
  summary: string
  appointments: string[]
  deadlines: string[]
  instructions: string[]
  locations: string[]
  requiredDocuments: string[]
  decisions: string[]
  clarifications: string[]
}

export const SUMMARY_CATEGORIES = [
  'appointments',
  'deadlines',
  'instructions',
  'locations',
  'requiredDocuments',
  'decisions',
  'clarifications',
] as const satisfies ReadonlyArray<Exclude<keyof ConversationSummary, 'summary'>>

export type SummaryCategory = (typeof SUMMARY_CATEGORIES)[number]

export type SummaryErrorCode =
  /** Nobody actually spoke, so there is nothing to summarise. */
  | 'empty_transcript'
  /** The server rejected the transcript payload. */
  | 'invalid_request'
  /** Gemini answered with something the server refused to trust. */
  | 'invalid_model_output'
  /** Gemini could not be reached. */
  | 'upstream_unavailable'
  /** The transcript was larger than the server accepts. */
  | 'payload_too_large'
  /** The server failed for an unexpected reason. */
  | 'internal_error'
  /** The request never completed: offline, DNS, CORS. */
  | 'network_error'
  /** The summary took longer than the client is willing to wait. */
  | 'timeout'
  /** Something answered, but not with the summary contract. */
  | 'malformed_response'

export type SummaryResult =
  | { ok: true; summary: ConversationSummary }
  | { ok: false; code: SummaryErrorCode }

export function emptySummary(): ConversationSummary {
  return {
    summary: '',
    appointments: [],
    deadlines: [],
    instructions: [],
    locations: [],
    requiredDocuments: [],
    decisions: [],
    clarifications: [],
  }
}

/**
 * True when the model found nothing actionable. Only the categories count: a
 * real model almost always writes a sentence for `summary` even when it
 * extracted nothing ("A brief exchange about the weather."), so including it
 * here made this permanently false and left the UI rendering the screen of
 * empty category headings this exists to prevent. The prose is still worth
 * showing, so callers keep the summary and change how they render it.
 */
export function isSummaryEmpty(summary: ConversationSummary): boolean {
  return SUMMARY_CATEGORIES.every((category) => summary[category].length === 0)
}

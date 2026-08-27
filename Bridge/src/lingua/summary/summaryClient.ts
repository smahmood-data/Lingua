import { SUMMARY_CATEGORIES, type ConversationSummary, type SummaryErrorCode, type SummaryResult } from './types.ts'
import { toRequestTurns } from './transcript.ts'
import type { TranscriptTurn } from './types.ts'

const SUMMARIZE_ENDPOINT = '/api/summarize'

/**
 * The server gives up on Gemini at 45s; this leaves room for that answer to
 * come back before the client stops waiting. Without a deadline a stalled or
 * rate-limited upstream leaves the summary screen loading forever, because
 * `loading` has no other way out.
 */
const REQUEST_TIMEOUT_MS = 60_000

/** Codes the server is allowed to send. Anything else is not our contract. */
const KNOWN_ERROR_CODES: readonly SummaryErrorCode[] = [
  'empty_transcript',
  'invalid_request',
  'invalid_model_output',
  'upstream_unavailable',
  'payload_too_large',
  'internal_error',
]

/**
 * Re-validates the response before it reaches the UI. The server already
 * validates Gemini, but this is the last gate before a screen is rendered
 * from it, and an unexpected shape must become a safe error state rather
 * than a crash halfway through a render.
 */
export function parseSummaryPayload(payload: unknown): ConversationSummary | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null

  const raw = payload as Record<string, unknown>
  if (typeof raw['summary'] !== 'string') return null

  const summary = { summary: raw['summary'] } as ConversationSummary

  for (const category of SUMMARY_CATEGORIES) {
    const value = raw[category]
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null
    summary[category] = value as string[]
  }

  return summary
}

function isDomException(error: unknown, name: string): boolean {
  return error instanceof DOMException && error.name === name
}

function toErrorCode(payload: unknown): SummaryErrorCode {
  const code = (payload as { error?: { code?: unknown } } | null)?.error?.code
  return KNOWN_ERROR_CODES.find((known) => known === code) ?? 'malformed_response'
}

export async function requestSummary(
  input: { readingLanguage: string; turns: readonly TranscriptTurn[] },
  options: {
    signal?: AbortSignal
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {},
): Promise<SummaryResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch

  // The caller's signal cancels (unmount, reset, resubmit); the timeout gives
  // up. They are combined so either can end the request, and told apart below
  // because a cancellation must stay silent while a timeout must be shown.
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  let response: Response
  try {
    response = await doFetch(SUMMARIZE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readingLanguage: input.readingLanguage,
        turns: toRequestTurns(input.turns),
      }),
      signal,
    })
  } catch (error) {
    if (isDomException(error, 'TimeoutError')) return { ok: false, code: 'timeout' }
    // Rethrow cancellation so the caller can tell it apart from a failure.
    if (isDomException(error, 'AbortError')) throw error
    return { ok: false, code: 'network_error' }
  }

  // A gateway or tunnel can answer with HTML, so parsing is allowed to fail.
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) return { ok: false, code: toErrorCode(payload) }

  const summary = parseSummaryPayload(payload)
  return summary ? { ok: true, summary } : { ok: false, code: 'malformed_response' }
}

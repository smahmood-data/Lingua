import { GoogleGenAI } from '@google/genai'
import {
  conversationSummarySchema,
  geminiResponseSchema,
  normalizeSummary,
  type ConversationSummary,
  type SummarizeRequest,
} from './contract.ts'
import { SUMMARY_SYSTEM_INSTRUCTION, buildSummaryPrompt } from './prompt.ts'

/**
 * Why a bespoke error type: the route has to tell "Gemini was unreachable"
 * apart from "Gemini answered with something we refuse to trust", because the
 * client shows a different safe state for each.
 */
export class SummaryError extends Error {
  readonly code: 'upstream_unavailable' | 'invalid_model_output'

  /**
   * Operator-facing context for the server log, never sent to the client.
   * It is reduced to a string on the way in rather than kept as the original
   * error, so nothing holds a reference to an SDK object that may still carry
   * the request body — these transcripts are not ours to retain.
   */
  readonly detail: string

  constructor(code: SummaryError['code'], message: string, detail = '') {
    super(message)
    this.name = 'SummaryError'
    this.code = code
    this.detail = detail
  }
}

/** Reduces whatever the SDK rejected with to one loggable line. */
function describe(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  return typeof cause === 'string' ? cause : ''
}

export type Summarizer = (request: SummarizeRequest) => Promise<ConversationSummary>

/**
 * A summary is worth waiting for, but not indefinitely. Without a deadline the
 * SDK retries a rate-limited or stalled call with backoff for minutes while the
 * browser holds an open request and the UI sits on a spinner it can never
 * leave. One retry covers a transient blip; anything slower has already lost
 * the demo, so it is better to fail fast and let the user try again.
 */
const REQUEST_TIMEOUT_MS = 45_000
const MAX_RETRIES = 1

/** Statuses other than these mean the model never finished its answer. */
const COMPLETED_STATUSES = new Set(['completed'])

export function createGeminiSummarizer(options: {
  apiKey: string
  model: string
  timeoutMs?: number
}): Summarizer {
  const client = new GoogleGenAI({ apiKey: options.apiKey })
  const responseSchema = geminiResponseSchema()
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS

  return async function summarize(request) {
    let rawText: string | undefined

    try {
      const interaction = await client.interactions.create(
        {
          model: options.model,
          input: buildSummaryPrompt(request),
          system_instruction: SUMMARY_SYSTEM_INSTRUCTION,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: responseSchema,
          },
        },
        { timeout, maxRetries: MAX_RETRIES },
      )

      // A safety block, a budget cut-off, or a truncated answer still resolves
      // rather than throwing, and whatever text came with it is incomplete.
      if (!COMPLETED_STATUSES.has(interaction.status)) {
        throw new SummaryError(
          'invalid_model_output',
          `Gemini stopped before finishing the summary (status: ${interaction.status}).`,
        )
      }

      rawText = interaction.output_text
    } catch (cause) {
      if (cause instanceof SummaryError) throw cause
      throw new SummaryError(
        'upstream_unavailable',
        'Gemini did not return a summary.',
        describe(cause),
      )
    }

    return parseSummaryResponse(rawText)
  }
}

/**
 * Structured output makes well-formed JSON very likely, not certain: a
 * truncated or safety-blocked interaction still resolves. Everything the
 * model returns is validated here before it can reach the client.
 */
export function parseSummaryResponse(rawText: string | undefined): ConversationSummary {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new SummaryError('invalid_model_output', 'Gemini returned an empty response.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (cause) {
    throw new SummaryError(
      'invalid_model_output',
      'Gemini returned text that is not JSON.',
      describe(cause),
    )
  }

  const result = conversationSummarySchema.safeParse(parsed)
  if (!result.success) {
    throw new SummaryError(
      'invalid_model_output',
      `Gemini returned JSON that does not match the summary contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    )
  }

  return normalizeSummary(result.data)
}

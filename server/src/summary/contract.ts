import { z } from 'zod'

/**
 * The shared request/response contract for POST /api/summarize.
 *
 * Two rules drive the shapes below:
 *
 * 1. A category the conversation never mentioned must come back as an empty
 *    array, never as a placeholder sentence. Absent and null both mean "the
 *    model found nothing", so both normalise to [].
 * 2. Anything that is not a string in a category array is malformed output,
 *    not an empty result, and is rejected rather than coerced.
 */

const MAX_TURNS = 400
const MAX_TEXT = 4_000
const MAX_ITEMS_PER_CATEGORY = 20

export const SPEAKERS = ['user', 'other'] as const

export const transcriptTurnSchema = z.object({
  speaker: z.enum(SPEAKERS),
  /** What the speaker actually said, in the language they said it in. */
  original: z.string().max(MAX_TEXT),
  /** The interpreted text the other participant heard. */
  translated: z.string().max(MAX_TEXT).default(''),
})

export const summarizeRequestSchema = z.object({
  /**
   * The language the summary must be written in: the reading language the
   * user picked during setup, not whichever language dominated the call.
   */
  readingLanguage: z.string().min(2).max(64),
  turns: z.array(transcriptTurnSchema).max(MAX_TURNS),
})

const category = z.array(z.string()).max(MAX_ITEMS_PER_CATEGORY)

/**
 * The exact shape Gemini is asked to produce. This is the single source of
 * truth for the contract: the JSON schema sent to the model and the validator
 * applied to its answer are both derived from it, so they cannot drift.
 */
const strictSummarySchema = z.object({
  summary: z.string(),
  appointments: category,
  deadlines: category,
  instructions: category,
  locations: category,
  requiredDocuments: category,
  decisions: category,
  clarifications: category,
})

export type ConversationSummary = z.infer<typeof strictSummarySchema>

export const SUMMARY_CATEGORIES = [
  'appointments',
  'deadlines',
  'instructions',
  'locations',
  'requiredDocuments',
  'decisions',
  'clarifications',
] as const satisfies ReadonlyArray<keyof ConversationSummary>

/**
 * A model that found nothing for a category tends to omit the key or send
 * null rather than []. Both mean "nothing found", so both are filled in
 * before validation. Anything else is left untouched and fails validation.
 */
function fillMissingCategories(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value

  const raw = value as Record<string, unknown>
  const filled: Record<string, unknown> = { ...raw, summary: raw['summary'] ?? '' }

  for (const key of SUMMARY_CATEGORIES) {
    filled[key] = raw[key] ?? []
  }

  return filled
}

export const conversationSummarySchema = z.preprocess(fillMissingCategories, strictSummarySchema)

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>
export type SummarizeRequest = z.infer<typeof summarizeRequestSchema>

/** An all-empty summary, used as the safe fallback shape on the client. */
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
 * A turn only counts if somebody actually said something. Whitespace-only
 * turns are what an interrupted or silent microphone produces, and a
 * transcript made entirely of those is an empty conversation.
 */
export function hasSpokenContent(turns: readonly TranscriptTurn[]): boolean {
  return turns.some((turn) => turn.original.trim().length > 0)
}

/**
 * Drops blank and duplicate entries the model may emit around real findings.
 * Runs after validation, so it only ever sees strings.
 */
export function normalizeSummary(summary: ConversationSummary): ConversationSummary {
  const normalized = { ...summary, summary: summary.summary.trim() }

  for (const key of SUMMARY_CATEGORIES) {
    const seen = new Set<string>()
    normalized[key] = summary[key]
      .map((item) => item.trim())
      .filter((item) => {
        if (item.length === 0 || seen.has(item.toLowerCase())) return false
        seen.add(item.toLowerCase())
        return true
      })
  }

  return normalized
}

/**
 * The JSON schema handed to Gemini as the response format. Derived from the
 * zod schema so the model and the validator cannot drift apart, then stripped
 * of the JSON Schema keywords the Gemini structured-output subset rejects.
 */
export function geminiResponseSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(strictSummarySchema, {
    io: 'output',
    target: 'draft-7',
  })
  return stripUnsupportedKeywords(jsonSchema) as Record<string, unknown>
}

const UNSUPPORTED_KEYWORDS = new Set(['$schema', 'additionalProperties', 'default'])

function stripUnsupportedKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupportedKeywords)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
      .map(([key, nested]) => [key, stripUnsupportedKeywords(nested)]),
  )
}

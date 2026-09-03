type ApiRequest = { method?: string; body?: unknown }
type ApiResponse = { setHeader: (name: string, value: string) => void; status: (code: number) => ApiResponse; json: (body: unknown) => void }

const API_BASE_URL = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
const SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || 'gemini-3.7-flash'

const summarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'A short plain-language overview of the conversation.' },
    appointments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: ['string', 'null'], description: 'Appointment date, if mentioned.' },
          time: { type: ['string', 'null'], description: 'Appointment time, if mentioned.' },
          location: { type: ['string', 'null'], description: 'Appointment location, if mentioned.' },
          notes: { type: 'string', description: 'Relevant appointment context.' },
        },
        required: ['date', 'time', 'location', 'notes'],
      },
    },
    deadlines: { type: 'array', items: { type: 'string' } },
    instructions: { type: 'array', items: { type: 'string' } },
    locations: { type: 'array', items: { type: 'string' } },
    documents: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    clarifications: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'appointments', 'deadlines', 'instructions', 'locations', 'documents', 'decisions', 'clarifications', 'nextSteps'],
}

type SummaryArrayKey = 'appointments' | 'deadlines' | 'instructions' | 'locations' | 'documents' | 'decisions' | 'clarifications' | 'nextSteps'
const SUMMARY_ARRAY_KEYS: SummaryArrayKey[] = [
  'appointments',
  'deadlines',
  'instructions',
  'locations',
  'documents',
  'decisions',
  'clarifications',
  'nextSteps',
]

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function validateTranscript(transcript: unknown): string | null {
  if (!Array.isArray(transcript)) return 'transcript must be an array of transcript turns.'
  if (transcript.length === 0) return 'transcript must contain at least one turn.'
  for (const [index, turn] of transcript.entries()) {
    if (!turn || typeof turn !== 'object') return `transcript[${index}] must be an object.`
    const candidate = turn as Record<string, unknown>
    if (!normalizeText(candidate.originalText) && !normalizeText(candidate.translatedText)) {
      return `transcript[${index}] must include originalText or translatedText.`
    }
  }
  return null
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function validateSummary(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return 'Summary response must be an object.'
  const candidate = summary as Record<string, unknown>
  if (typeof candidate.summary !== 'string') return 'Summary response is missing summary text.'
  for (const key of SUMMARY_ARRAY_KEYS) {
    if (!Array.isArray(candidate[key])) return `Summary response field ${key} must be an array.`
    if (key !== 'appointments' && (candidate[key] as unknown[]).some((item) => typeof item !== 'string')) {
      return `Summary response field ${key} must contain only strings.`
    }
  }
  const appointments = candidate.appointments as unknown
  if (!Array.isArray(appointments)) return 'Summary response field appointments must be an array.'
  for (const [index, appointment] of (appointments as unknown[]).entries()) {
    if (!appointment || typeof appointment !== 'object' || Array.isArray(appointment)) {
      return `Summary appointment ${index} must be an object.`
    }
    const appt = appointment as Record<string, unknown>
    for (const key of ['date', 'time', 'location', 'notes']) {
      if (!(key in appt)) return `Summary appointment ${index} is missing ${key}.`
    }
    if (!isNullableString(appt.date) || !isNullableString(appt.time) || !isNullableString(appt.location) || typeof appt.notes !== 'string') {
      return `Summary appointment ${index} contains invalid field types.`
    }
  }
  return null
}

function buildSummaryPrompt(transcript: unknown[], preferredLanguage: string): string {
  const turns = transcript
    .map((turn, index) => {
      const item = turn as Record<string, unknown>
      const original = normalizeText(item.originalText)
      const translated = normalizeText(item.translatedText)
      const translatedText = translated ? `\nTranslated: ${translated}` : ''
      return `Turn ${index + 1} (${String(item.speaker || 'unknown')}, ${String(item.timestamp || 'no timestamp')}):\nOriginal: ${original}${translatedText}`
    })
    .join('\n\n')
  return [
    `Return a concise structured two-person professional meeting summary in ${preferredLanguage}.`,
    'Use the supplied speaker labels exactly. Attribute specific recommendations to the speaker label that appears on the turn, and never alternate or invent speaker identity.',
    'For each next step, include an owner or deadline only when the transcript explicitly supports it. Never invent an owner or deadline, and do not use "Immediate" unless the transcript says the timing is immediate.',
    'Only use facts stated in the transcript. Use empty arrays when a category is not mentioned.',
    'Put unresolved questions or uncertainty in clarifications.',
    '',
    'Transcript:',
    turns,
  ].join('\n')
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method Not Allowed', message: 'Use POST /api/summarize.' })
  }
  const body = request.body as { transcript?: unknown; preferredLanguage?: unknown } | null
  const validationError = validateTranscript(body?.transcript)
  if (validationError) {
    return response.status(400).json({ error: 'Validation Error', message: validationError })
  }
  const transcript = body!.transcript as unknown[]
  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ error: 'Configuration Error', message: 'GEMINI_API_KEY is not configured on the server.' })
  }
  const preferredLanguage =
    typeof body?.preferredLanguage === 'string' && body.preferredLanguage.trim() ? body.preferredLanguage : 'English'
  const input = buildSummaryPrompt(transcript, preferredLanguage)
  try {
    const upstream = await fetch(`${API_BASE_URL}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ model: SUMMARY_MODEL, input, response_format: { type: 'text', mime_type: 'application/json', schema: summarySchema } }),
      signal: AbortSignal.timeout(30_000),
    })
    const textBody = await upstream.text()
    let data: { output_text?: string; steps?: Array<{ content?: Array<{ text?: string }> }> } = {}
    if (textBody) {
      try {
        data = JSON.parse(textBody) as typeof data
      } catch {
        data = {}
      }
    }
    if (!upstream.ok) {
      const message = upstream.status === 429 || upstream.status === 503 ? 'Live-token creation is temporarily unavailable.' : 'Unable to summarize transcript.'
      return response.status(upstream.status).json({ error: 'Gemini API Error', message })
    }
    const text = data.output_text || data.steps?.flatMap((step) => step.content || []).map((content) => content.text).filter(Boolean).join('')
    if (!text) return response.status(502).json({ error: 'Gemini Validation Error', message: 'Gemini returned an empty summary response.' })
    let summary: unknown
    try {
      summary = JSON.parse(text)
    } catch {
      return response.status(502).json({ error: 'Gemini Validation Error', message: 'Gemini returned summary text that was not valid JSON.' })
    }
    const summaryError = validateSummary(summary)
    if (summaryError) {
      return response.status(502).json({ error: 'Gemini Validation Error', message: summaryError })
    }
    return response.status(200).json({ summary })
  } catch {
    return response.status(502).json({ error: 'Gemini API Error', message: 'Unable to summarize transcript.' })
  }
}

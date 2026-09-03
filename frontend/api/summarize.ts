type ApiRequest = { method?: string; body?: unknown }
type ApiResponse = { setHeader: (name: string, value: string) => void; status: (code: number) => ApiResponse; json: (body: unknown) => void }

const API_BASE_URL = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
const SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || 'gemini-3.7-flash'

const summarySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    appointments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { date: { type: ['string', 'null'] }, time: { type: ['string', 'null'] }, location: { type: ['string', 'null'] }, notes: { type: 'string' } }, required: ['date', 'time', 'location', 'notes'] } },
    deadlines: { type: 'array', items: { type: 'string' } }, instructions: { type: 'array', items: { type: 'string' } }, locations: { type: 'array', items: { type: 'string' } }, documents: { type: 'array', items: { type: 'string' } }, decisions: { type: 'array', items: { type: 'string' } }, clarifications: { type: 'array', items: { type: 'string' } }, nextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'appointments', 'deadlines', 'instructions', 'locations', 'documents', 'decisions', 'clarifications', 'nextSteps'],
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method Not Allowed', message: 'Use POST /api/summarize.' })
  }
  const body = request.body as { transcript?: unknown; preferredLanguage?: unknown } | null
  const transcript = body?.transcript
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return response.status(400).json({ error: 'Validation Error', message: 'transcript must contain at least one turn.' })
  }
  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ error: 'Configuration Error', message: 'GEMINI_API_KEY is not configured on the server.' })
  }
  const preferredLanguage = typeof body?.preferredLanguage === 'string' && body.preferredLanguage.trim() ? body.preferredLanguage : 'English'
  const turns = transcript.map((turn, index) => {
    const item = turn as Record<string, unknown>
    return `Turn ${index + 1} (${String(item.speaker || 'unknown')}, ${String(item.timestamp || 'no timestamp')}):\nOriginal: ${String(item.originalText || '')}${item.translatedText ? `\nTranslated: ${String(item.translatedText)}` : ''}`
  }).join('\n\n')
  const input = [`Return a concise structured two-person professional meeting summary in ${preferredLanguage}.`, 'Use the supplied speaker labels exactly. Do not infer, alternate, or invent speaker identity.', 'Only use facts stated in the transcript. For next steps, include an owner or deadline only when explicitly supported by the transcript; otherwise leave them out. Use empty arrays when a category is not mentioned.', '', 'Transcript:', turns].join('\n')
  try {
    const upstream = await fetch(`${API_BASE_URL}/interactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify({ model: SUMMARY_MODEL, input, response_format: { type: 'text', mime_type: 'application/json', schema: summarySchema } }), signal: AbortSignal.timeout(30_000) })
    const data = await upstream.json() as { output_text?: string; steps?: Array<{ content?: Array<{ text?: string }> }> }
    if (!upstream.ok) return response.status(upstream.status).json({ error: 'Gemini API Error', message: 'Unable to summarize transcript.' })
    const text = data.output_text || data.steps?.flatMap((step) => step.content || []).map((content) => content.text).filter(Boolean).join('')
    if (!text) return response.status(502).json({ error: 'Gemini Validation Error', message: 'Gemini returned an empty summary response.' })
    return response.json({ summary: JSON.parse(text) })
  } catch {
    return response.status(502).json({ error: 'Gemini API Error', message: 'Unable to summarize transcript.' })
  }
}

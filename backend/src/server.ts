import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_BASE_URL =
  (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    '',
  );
const GEMINI_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL || 'models/gemini-3.1-flash-live-preview';
const GEMINI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || 'gemini-3.7-flash';
const LIVE_TOKEN_TTL_MINUTES = toPositiveInteger(process.env.LIVE_TOKEN_TTL_MINUTES, 30);
const LIVE_NEW_SESSION_TTL_SECONDS = toPositiveInteger(
  process.env.LIVE_NEW_SESSION_TTL_SECONDS,
  60,
);

type TranslationDirection = 'ur-to-en' | 'en-to-ur';
type SummaryArrayKey = Exclude<keyof ConversationSummary, 'summary'>;

const SUMMARY_ARRAY_KEYS: SummaryArrayKey[] = [
  'appointments',
  'deadlines',
  'instructions',
  'locations',
  'documents',
  'decisions',
  'clarifications',
  'nextSteps',
];

type TranscriptTurn = {
  id?: string;
  speaker?: 'user' | 'model' | string;
  originalText?: string;
  translatedText?: string;
  timestamp?: string;
};

type SummaryAppointment = {
  date: string | null;
  time: string | null;
  location: string | null;
  notes: string;
};

type ConversationSummary = {
  summary: string;
  appointments: SummaryAppointment[];
  deadlines: string[];
  instructions: string[];
  locations: string[];
  documents: string[];
  decisions: string[];
  clarifications: string[];
  nextSteps: string[];
};

type GeminiAuthTokenResponse = {
  name?: string;
  expireTime?: string;
  newSessionExpireTime?: string;
  authToken?: {
    name?: string;
    expireTime?: string;
    newSessionExpireTime?: string;
  };
};

type GeminiInteractionResponse = {
  output_text?: string;
  steps?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const summarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description: 'A short plain-language overview of the conversation.',
    },
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
    deadlines: {
      type: 'array',
      items: { type: 'string' },
      description: 'Deadlines or due dates mentioned in the conversation.',
    },
    instructions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Instructions the speakers should follow.',
    },
    locations: {
      type: 'array',
      items: { type: 'string' },
      description: 'Important locations mentioned.',
    },
    documents: {
      type: 'array',
      items: { type: 'string' },
      description: 'Documents, IDs, or cards the speakers need.',
    },
    decisions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Confirmed decisions or agreements.',
    },
    clarifications: {
      type: 'array',
      items: { type: 'string' },
      description: 'Open questions, uncertainties, or requested clarifications.',
    },
    nextSteps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete next actions.',
    },
  },
  required: [
    'summary',
    'appointments',
    'deadlines',
    'instructions',
    'locations',
    'documents',
    'decisions',
    'clarifications',
    'nextSteps',
  ],
};

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  }),
);
app.use(express.json({ limit: '1mb' }));

app.use((error: unknown, _req: Request, res: Response, next: () => void) => {
  if (error instanceof SyntaxError) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Request body must contain valid JSON.',
    });
  }

  next();
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'lingua-backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/live-token', async (req: Request, res: Response) => {
  const direction = normalizeDirection(req.query.direction);
  if (!direction) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'direction must be one of: ur-to-en, en-to-ur.',
    });
  }

  if (!GEMINI_API_KEY) {
    return sendConfigurationError(res);
  }

  const expireTime = new Date(Date.now() + LIVE_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(
    Date.now() + LIVE_NEW_SESSION_TTL_SECONDS * 1000,
  ).toISOString();

  try {
    const token = await createGeminiLiveToken({
      direction,
      expireTime,
      newSessionExpireTime,
    });

    const authToken = token.authToken || token;

    if (!authToken.name) {
      throw new GeminiApiError(502, 'Gemini did not return an ephemeral token name.');
    }

    res.json({
      token: authToken.name,
      expiresAt: authToken.expireTime || expireTime,
      newSessionExpiresAt: authToken.newSessionExpireTime || newSessionExpireTime,
      model: GEMINI_LIVE_MODEL,
      direction,
    });
  } catch (error) {
    sendGeminiError(res, error, 'Unable to create Gemini Live token.');
  }
});

app.get('/api/gemini/token', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Endpoint Removed',
    message: 'Use GET /api/live-token. This endpoint no longer returns the server API key.',
  });
});

app.post('/api/summarize', async (req: Request, res: Response) => {
  const transcript = req.body?.transcript;
  const preferredLanguage = req.body?.preferredLanguage || 'English';
  const validationError = validateTranscript(transcript);

  if (validationError) {
    return res.status(400).json({
      error: 'Validation Error',
      message: validationError,
    });
  }

  if (!GEMINI_API_KEY) {
    return sendConfigurationError(res);
  }

  try {
    const summary = await summarizeConversation({
      transcript,
      preferredLanguage,
    });
    const summaryError = validateSummary(summary);

    if (summaryError) {
      return res.status(502).json({
        error: 'Gemini Validation Error',
        message: summaryError,
      });
    }

    res.json({ summary });
  } catch (error) {
    sendGeminiError(res, error, 'Unable to summarize transcript.');
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested backend route does not exist.',
  });
});

async function createGeminiLiveToken({
  direction,
  expireTime,
  newSessionExpireTime,
}: {
  direction: TranslationDirection;
  expireTime: string;
  newSessionExpireTime: string;
}): Promise<GeminiAuthTokenResponse> {
  const response = await fetch(`${GEMINI_API_BASE_URL}/auth_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': getGeminiApiKey(),
    },
    body: JSON.stringify({
      uses: 1,
      expireTime,
      newSessionExpireTime,
      bidiGenerateContentSetup: {
        model: GEMINI_LIVE_MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
        },
        sessionResumption: {},
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [{ text: buildLiveSystemInstruction(direction) }],
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  return parseGeminiResponse(response);
}

async function summarizeConversation({
  transcript,
  preferredLanguage,
}: {
  transcript: TranscriptTurn[];
  preferredLanguage: string;
}): Promise<ConversationSummary> {
  const response = await fetch(`${GEMINI_API_BASE_URL}/interactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': getGeminiApiKey(),
    },
    body: JSON.stringify({
      model: GEMINI_SUMMARY_MODEL,
      input: buildSummaryPrompt(transcript, preferredLanguage),
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: summarySchema,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const data = await parseGeminiResponse<GeminiInteractionResponse>(response);
  const text =
    data.output_text ||
    data.steps
      ?.flatMap((step) => step.content || [])
      .map((content) => content.text)
      .filter(Boolean)
      .join('');

  if (!text) {
    throw new GeminiApiError(502, 'Gemini returned an empty summary response.');
  }

  try {
    return JSON.parse(text) as ConversationSummary;
  } catch {
    throw new GeminiApiError(502, 'Gemini returned summary text that was not valid JSON.');
  }
}

async function parseGeminiResponse<T>(response: globalThis.Response): Promise<T> {
  const bodyText = await response.text();
  const data = bodyText ? safeJsonParse(bodyText) : {};

  if (!response.ok) {
    const message = getGeminiErrorMessage(data, response.status);
    throw new GeminiApiError(response.status, message);
  }

  return data as T;
}

function buildLiveSystemInstruction(direction: TranslationDirection): string {
  if (direction === 'ur-to-en') {
    return [
      'You are Lingua, a real-time medical and service interpreter.',
      'Translate spoken Urdu into clear spoken English.',
      'Preserve names, dates, times, locations, documents, and instructions exactly.',
      'Do not add advice, diagnosis, or extra details.',
    ].join(' ');
  }

  return [
    'You are Lingua, a real-time medical and service interpreter.',
    'Translate spoken English into clear spoken Urdu.',
    'Preserve names, dates, times, locations, documents, and instructions exactly.',
    'Do not add advice, diagnosis, or extra details.',
  ].join(' ');
}

function buildSummaryPrompt(transcript: TranscriptTurn[], preferredLanguage: string): string {
  const turns = transcript
    .map((turn, index) => {
      const original = normalizeText(turn.originalText);
      const translated = normalizeText(turn.translatedText);
      const translatedText = translated ? `\nTranslated: ${translated}` : '';
      return `Turn ${index + 1} (${turn.speaker || 'unknown'}, ${turn.timestamp || 'no timestamp'}):\nOriginal: ${original}${translatedText}`;
    })
    .join('\n\n');

  return [
    `Return a concise structured conversation summary in ${preferredLanguage}.`,
    'Only use facts stated in the transcript. Use empty arrays when a category is not mentioned.',
    'Put unresolved questions or uncertainty in clarifications.',
    '',
    'Transcript:',
    turns,
  ].join('\n');
}

function validateTranscript(transcript: unknown): string | null {
  if (!Array.isArray(transcript)) {
    return 'transcript must be an array of transcript turns.';
  }

  if (transcript.length === 0) {
    return 'transcript must contain at least one turn.';
  }

  for (const [index, turn] of transcript.entries()) {
    if (!turn || typeof turn !== 'object') {
      return `transcript[${index}] must be an object.`;
    }

    if (!normalizeText(turn.originalText) && !normalizeText(turn.translatedText)) {
      return `transcript[${index}] must include originalText or translatedText.`;
    }
  }

  return null;
}

function validateSummary(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return 'Summary response must be an object.';
  }

  const candidate = summary as Partial<ConversationSummary>;

  if (typeof candidate.summary !== 'string') {
    return 'Summary response is missing summary text.';
  }

  for (const key of SUMMARY_ARRAY_KEYS) {
    if (!Array.isArray(candidate[key])) {
      return `Summary response field ${key} must be an array.`;
    }

    if (key !== 'appointments' && candidate[key].some((item) => typeof item !== 'string')) {
      return `Summary response field ${key} must contain only strings.`;
    }
  }

  const appointments = candidate.appointments;
  if (!Array.isArray(appointments)) {
    return 'Summary response field appointments must be an array.';
  }

  for (const [index, appointment] of appointments.entries()) {
    if (!appointment || typeof appointment !== 'object' || Array.isArray(appointment)) {
      return `Summary appointment ${index} must be an object.`;
    }

    for (const key of ['date', 'time', 'location', 'notes']) {
      if (!(key in appointment)) {
        return `Summary appointment ${index} is missing ${key}.`;
      }
    }

    if (
      !isNullableString(appointment.date) ||
      !isNullableString(appointment.time) ||
      !isNullableString(appointment.location) ||
      typeof appointment.notes !== 'string'
    ) {
      return `Summary appointment ${index} contains invalid field types.`;
    }
  }

  return null;
}

function normalizeDirection(direction: unknown): TranslationDirection | null {
  const value = typeof direction === 'string' ? direction : 'ur-to-en';

  if (value === 'ur-en') {
    return 'ur-to-en';
  }

  if (value === 'en-ur') {
    return 'en-to-ur';
  }

  return isTranslationDirection(value) ? value : null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toPositiveInteger(value: string | undefined, fallback: number): number {
  const number = Number.parseInt(value ?? '', 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function isTranslationDirection(value: string): value is TranslationDirection {
  return value === 'ur-to-en' || value === 'en-to-ur';
}

function getGeminiApiKey(): string {
  if (!GEMINI_API_KEY) {
    throw new GeminiApiError(500, 'GEMINI_API_KEY is not configured on the server.');
  }

  return GEMINI_API_KEY;
}

function getGeminiErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const maybeError = 'error' in data ? data.error : undefined;
    if (maybeError && typeof maybeError === 'object' && 'message' in maybeError) {
      const message = maybeError.message;
      if (typeof message === 'string') {
        return message;
      }
    }

    if ('message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }

  return `Gemini request failed with ${status}.`;
}

function sendConfigurationError(res: Response) {
  return res.status(500).json({
    error: 'Configuration Error',
    message: 'GEMINI_API_KEY is not configured on the server.',
  });
}

function sendGeminiError(res: Response, error: unknown, fallbackMessage: string) {
  const status = error instanceof GeminiApiError ? error.status : 502;
  const message = error instanceof GeminiApiError ? error.message : fallbackMessage;

  res.status(status >= 400 && status < 600 ? status : 502).json({
    error: 'Gemini API Error',
    message,
  });
}

class GeminiApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function startServer() {
  return app.listen(PORT, () => {
    console.log(`Lingua secure backend running on port ${PORT}`);
  });
}

export { app };

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  startServer();
}

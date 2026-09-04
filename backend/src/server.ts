import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(backendRoot, '..');

dotenv.config({ path: resolve(backendRoot, '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: resolve(repoRoot, '.env') });
}

const app = express();

const PORT = toPositiveInteger(process.env.PORT, 3001);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_BASE_URL =
  (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    '',
  );
const GEMINI_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-live-translate-preview';
const GEMINI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || 'gemini-3.7-flash';
const LIVE_TOKEN_TTL_MINUTES = toPositiveInteger(process.env.LIVE_TOKEN_TTL_MINUTES, 30);
const LIVE_NEW_SESSION_TTL_SECONDS = toPositiveInteger(
  process.env.LIVE_NEW_SESSION_TTL_SECONDS,
  60,
);
const LIVE_TOKEN_RATE_LIMIT_MAX = toPositiveInteger(
  process.env.LIVE_TOKEN_RATE_LIMIT_MAX,
  60,
);
const LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS = toPositiveInteger(
  process.env.LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
  10 * 60,
);
const TRUST_PROXY_HOPS = toPositiveInteger(process.env.TRUST_PROXY_HOPS, 0);

const SUPPORTED_TARGET_LANGUAGES = [
  'af',
  'ak',
  'sq',
  'am',
  'ar',
  'hy',
  'az',
  'eu',
  'be',
  'bn',
  'bg',
  'my',
  'ca',
  'zh-Hans',
  'zh-Hant',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fil',
  'fi',
  'fr',
  'gl',
  'ka',
  'de',
  'el',
  'gu',
  'ha',
  'he',
  'hi',
  'hu',
  'is',
  'id',
  'it',
  'ja',
  'jv',
  'kn',
  'kk',
  'km',
  'rw',
  'ko',
  'lo',
  'lv',
  'lt',
  'mk',
  'ms',
  'ml',
  'mr',
  'mn',
  'ne',
  'no',
  'nb',
  'fa',
  'pl',
  'pt-BR',
  'pt-PT',
  'pa',
  'ro',
  'ru',
  'sr',
  'sd',
  'si',
  'sk',
  'sl',
  'es',
  'su',
  'sw',
  'sv',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'ur',
  'uz',
  'vi',
  'zu',
] as const;
type SupportedLanguageCode = (typeof SUPPORTED_TARGET_LANGUAGES)[number];
type SourceLanguageCode = 'auto' | SupportedLanguageCode;
const SUPPORTED_TARGET_LANGUAGE_SET = new Set<string>(SUPPORTED_TARGET_LANGUAGES);
/**
 * Automatic activity detection for the sessions this token constrains.
 *
 * The low end sensitivity prevents ordinary mid-sentence pauses from becoming
 * separate model turns. The explicit silence duration still provides a bounded
 * end-of-speech fallback. Mirrors `END_OF_SPEECH_*` in the frontend's
 * translation config; the token constrains the session setup, so the two must
 * agree.
 */
const END_OF_SPEECH_SILENCE_MS = 700;
const END_OF_SPEECH_SENSITIVITY = 'END_SENSITIVITY_LOW';
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

if (TRUST_PROXY_HOPS > 0) {
  // Only enable forwarded client IPs when the operator knows exactly how many
  // trusted reverse-proxy hops overwrite X-Forwarded-For before this process.
  app.set('trust proxy', TRUST_PROXY_HOPS);
}

const liveTokenRateLimiter = rateLimit({
  windowMs: LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS * 1000,
  limit: LIVE_TOKEN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  identifier: 'live-token',
  // Validation and upstream failures do not create usable tokens and therefore
  // should not spend the successful-token allowance.
  skipFailedRequests: true,
  handler: (_request, response) => {
    const retryAfterHeader = response.getHeader('Retry-After');
    const retryAfterSeconds = toPositiveInteger(
      typeof retryAfterHeader === 'string' ? retryAfterHeader : undefined,
      LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
    );
    response.status(429).json({
      error: 'Live Session Limit Reached',
      code: 'live_token_rate_limited',
      message: `This network has started too many live sessions. Try again in ${retryDelay(
        retryAfterSeconds,
      )}.`,
      retryable: true,
      retryAfterSeconds,
    });
  },
});

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

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof SyntaxError) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Request body must contain valid JSON.',
    });
  }

  next(error);
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'lingua-backend',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/live-token', setNoStoreResponse);

app.get('/api/live-token', liveTokenRateLimiter, async (req: Request, res: Response) => {
  const route = normalizeTranslationRoute(
    req.query.target,
    req.query.source,
    req.query.direction,
  );
  if (!route) {
    return res.status(400).json({
      error: 'Validation Error',
      message:
        'source must be auto or a supported language, target must be supported, and the languages must differ.',
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
      sourceLanguage: route.sourceLanguage,
      targetLanguage: route.targetLanguage,
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
      sourceLanguage: route.sourceLanguage,
      targetLanguage: route.targetLanguage,
      direction: route.direction,
      systemInstruction: route.systemInstruction,
    });
  } catch (error) {
    sendLiveTokenGeminiError(res, error);
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

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = getErrorStatus(error);
  res.status(status).json({
    error: status === 413 ? 'Payload Too Large' : 'Request Error',
    message: status === 413 ? 'Request body exceeds the 1MB limit.' : 'Unable to process the request.',
  });
});

async function createGeminiLiveToken({
  sourceLanguage,
  targetLanguage,
  expireTime,
  newSessionExpireTime,
}: {
  sourceLanguage: SourceLanguageCode;
  targetLanguage: SupportedLanguageCode;
  expireTime: string;
  newSessionExpireTime: string;
}): Promise<GeminiAuthTokenResponse> {
  const systemInstruction = buildInterpreterInstruction(
    sourceLanguage,
    targetLanguage,
  );
  // `liveConnectConstraints` does not exist on this API version — it is
  // rejected with "Unknown name" — so `bidiGenerateContentSetup` is the only
  // way to bind a token to a model, an instruction, and a target language.
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
        model: `models/${GEMINI_LIVE_MODEL.replace(/^models\//, '')}`,
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        generationConfig: {
          responseModalities: ['AUDIO'],
          translationConfig: {
            targetLanguageCode: targetLanguage,
            // A route stays silent when the language being spoken is already
            // its target, so the other route of the pair is the only one heard.
            echoTargetLanguage: false,
          },
        },
        sessionResumption: {},
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: {
            endOfSpeechSensitivity: END_OF_SPEECH_SENSITIVITY,
            silenceDurationMs: END_OF_SPEECH_SILENCE_MS,
          },
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
    const retryAfterSeconds =
      response.status === 429 || response.status === 503
        ? readRetryAfterSeconds(response.headers.get('Retry-After'))
        : undefined;
    throw new GeminiApiError(response.status, message, retryAfterSeconds);
  }

  return data as T;
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
    `Return a concise structured two-person professional meeting summary in ${preferredLanguage}.`,
    'Use the supplied speaker labels exactly. Attribute specific recommendations to the speaker label that appears on the turn, and never alternate or invent speaker identity.',
    'For each next step, include an owner or deadline only when the transcript explicitly supports it. Never invent an owner or deadline, and do not use "Immediate" unless the transcript says the timing is immediate.',
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

function normalizeTranslationRoute(
  target: unknown,
  source: unknown,
  direction: unknown,
): {
  sourceLanguage: SourceLanguageCode;
  targetLanguage: SupportedLanguageCode;
  direction: string;
  systemInstruction: string;
} | null {
  if (typeof target === 'string') {
    const targetLanguage = normalizeTargetLanguage(target);
    const sourceLanguage = normalizeSourceLanguage(source ?? 'auto');
    if (
      !targetLanguage ||
      !sourceLanguage ||
      sourceLanguage === targetLanguage
    ) {
      return null;
    }
    return {
      sourceLanguage,
      targetLanguage,
      direction: `${sourceLanguage}-to-${targetLanguage}`,
      systemInstruction: buildInterpreterInstruction(
        sourceLanguage,
        targetLanguage,
      ),
    };
  }

  const value = typeof direction === 'string' ? direction : 'auto-to-en';
  const aliases: Record<string, string> = {
    'ur-en': 'ur-to-en',
    'en-ur': 'en-to-ur',
    'es-en': 'es-to-en',
    'en-es': 'en-to-es',
    'bn-en': 'bn-to-en',
    'en-bn': 'en-to-bn',
  };
  const normalizedDirection = aliases[value] ?? value;
  const separator = normalizedDirection.lastIndexOf('-to-');
  if (separator < 1) return null;

  const targetLanguage = normalizeTargetLanguage(
    normalizedDirection.slice(separator + 4),
  );
  const sourceLanguage = normalizeSourceLanguage(
    normalizedDirection.slice(0, separator),
  );
  if (
    !targetLanguage ||
    !sourceLanguage ||
    sourceLanguage === targetLanguage
  ) {
    return null;
  }
  return {
    sourceLanguage,
    targetLanguage,
    direction: normalizedDirection,
    systemInstruction: buildInterpreterInstruction(
      sourceLanguage,
      targetLanguage,
    ),
  };
}

function normalizeSourceLanguage(value: unknown): SourceLanguageCode | null {
  if (typeof value !== 'string') return null;
  if (value.trim().toLowerCase() === 'auto') return 'auto';
  return normalizeTargetLanguage(value);
}

function normalizeTargetLanguage(value: string): SupportedLanguageCode | null {
  const match = SUPPORTED_TARGET_LANGUAGES.find(
    (language) => language.toLowerCase() === value.trim().toLowerCase(),
  );
  return match && SUPPORTED_TARGET_LANGUAGE_SET.has(match) ? match : null;
}

/**
 * System instruction for one route of an interpreter session.
 *
 * A route renders everything it hears into `targetLanguage`; `translationConfig`
 * has no source-language field, so `sourceLanguage` is only the other language
 * of the conversation. It is named as context for recognition, deliberately
 * without telling the model to *expect* it: a route told to expect one language
 * identifies speech as that language even when it is not, which defeats
 * `echoTargetLanguage: false` and makes the route read the speaker's own words
 * back to them.
 *
 * Mirrors `interpreterInstruction` in the frontend's `src/types.ts`.
 */
function buildInterpreterInstruction(
  sourceLanguage: SourceLanguageCode,
  targetLanguage: SupportedLanguageCode,
): string {
  const pair =
    sourceLanguage === 'auto'
      ? 'You are the interpreter for a live conversation.'
      : `You are the interpreter for a two-way conversation between language code ${sourceLanguage} and language code ${targetLanguage} speakers.`;

  return `${pair} Translate every utterance into language code ${targetLanguage}. Identify the spoken language from the audio itself for each utterance, and never carry a previous language guess into a new turn. When the speaker is already speaking language code ${targetLanguage}, stay silent and produce no audio.`;
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

function retryDelay(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function readRetryAfterSeconds(value: string | null): number | undefined {
  const seconds = Number.parseInt(value ?? '', 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function getErrorStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = error.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return status;
    }
  }

  return 500;
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

function setNoStoreResponse(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function sendGeminiError(res: Response, error: unknown, fallbackMessage: string) {
  const status = error instanceof GeminiApiError ? error.status : 502;
  const message = error instanceof GeminiApiError ? error.message : fallbackMessage;

  res.status(status >= 400 && status < 600 ? status : 502).json({
    error: 'Gemini API Error',
    message,
  });
}

function sendLiveTokenGeminiError(res: Response, error: unknown) {
  const status = error instanceof GeminiApiError ? error.status : 502;

  if (status === 429 || status === 503) {
    const retryAfterSeconds =
      error instanceof GeminiApiError ? error.retryAfterSeconds : undefined;
    if (retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
    }

    const isRateLimited = status === 429;
    const message = isRateLimited
      ? 'Live-token creation is temporarily rate-limited.'
      : 'Live-token creation is temporarily unavailable.';
    const retryMessage = retryAfterSeconds
      ? ` Try again in ${retryDelay(retryAfterSeconds)}.`
      : ' Try again later.';

    return res.status(status).json({
      error: 'Gemini API Error',
      code: isRateLimited
        ? 'live_token_upstream_rate_limited'
        : 'live_token_upstream_unavailable',
      message: `${message}${retryMessage}`,
      retryable: true,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }

  return sendGeminiError(res, error, 'Unable to create Gemini Live token.');
}

class GeminiApiError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
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

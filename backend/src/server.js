import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL || 'models/gemini-3.1-flash-live-preview';
const GEMINI_SUMMARY_MODEL = process.env.GEMINI_SUMMARY_MODEL || 'gemini-3.7-flash';
const LIVE_TOKEN_TTL_MINUTES = toPositiveInteger(process.env.LIVE_TOKEN_TTL_MINUTES, 30);
const LIVE_NEW_SESSION_TTL_SECONDS = toPositiveInteger(
  process.env.LIVE_NEW_SESSION_TTL_SECONDS,
  60,
);

const VALID_DIRECTIONS = new Set(['ur-en', 'en-ur']);

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
    origin: process.env.CORS_ORIGIN || true,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lingua-backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/live-token', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return sendConfigurationError(res);
  }

  const direction = normalizeDirection(req.query.direction);
  if (!direction) {
    return res.status(400).json({
      error: 'Validation Error',
      message: 'direction must be one of: ur-en, en-ur.',
    });
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

    res.json({
      token: token.name,
      expiresAt: token.expireTime || expireTime,
      newSessionExpiresAt: token.newSessionExpireTime || newSessionExpireTime,
      model: GEMINI_LIVE_MODEL,
      direction,
    });
  } catch (error) {
    sendGeminiError(res, error, 'Unable to create Gemini Live token.');
  }
});

app.get('/api/gemini/token', (req, res) => {
  res.status(410).json({
    error: 'Endpoint Removed',
    message: 'Use GET /api/live-token. This endpoint no longer returns the server API key.',
  });
});

app.post('/api/summarize', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return sendConfigurationError(res);
  }

  const transcript = req.body?.transcript;
  const preferredLanguage = req.body?.preferredLanguage || 'English';
  const validationError = validateTranscript(transcript);

  if (validationError) {
    return res.status(400).json({
      error: 'Validation Error',
      message: validationError,
    });
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

async function createGeminiLiveToken({ direction, expireTime, newSessionExpireTime }) {
  const response = await fetch(`${GEMINI_API_BASE_URL}/auth_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify({
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: GEMINI_LIVE_MODEL,
        config: {
          sessionResumption: {},
          responseModalities: ['AUDIO'],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: buildLiveSystemInstruction(direction) }],
          },
        },
      },
    }),
  });

  return parseGeminiResponse(response);
}

async function summarizeConversation({ transcript, preferredLanguage }) {
  const response = await fetch(
    `${GEMINI_API_BASE_URL}/models/${GEMINI_SUMMARY_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: buildSummaryPrompt(transcript, preferredLanguage),
              },
            ],
          },
        ],
        generationConfig: {
          responseFormat: {
            text: {
              mimeType: 'application/json',
              schema: summarySchema,
            },
          },
        },
      }),
    },
  );

  const data = await parseGeminiResponse(response);
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join('');

  if (!text) {
    throw new GeminiApiError(502, 'Gemini returned an empty summary response.');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiApiError(502, 'Gemini returned summary text that was not valid JSON.');
  }
}

async function parseGeminiResponse(response) {
  const bodyText = await response.text();
  const data = bodyText ? safeJsonParse(bodyText) : {};

  if (!response.ok) {
    const message =
      data?.error?.message || data?.message || `Gemini request failed with ${response.status}.`;
    throw new GeminiApiError(response.status, message);
  }

  return data;
}

function buildLiveSystemInstruction(direction) {
  if (direction === 'ur-en') {
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

function buildSummaryPrompt(transcript, preferredLanguage) {
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

function validateTranscript(transcript) {
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

function validateSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return 'Summary response must be an object.';
  }

  if (typeof summary.summary !== 'string') {
    return 'Summary response is missing summary text.';
  }

  for (const key of [
    'appointments',
    'deadlines',
    'instructions',
    'locations',
    'documents',
    'decisions',
    'clarifications',
    'nextSteps',
  ]) {
    if (!Array.isArray(summary[key])) {
      return `Summary response field ${key} must be an array.`;
    }
  }

  for (const [index, appointment] of summary.appointments.entries()) {
    if (!appointment || typeof appointment !== 'object' || Array.isArray(appointment)) {
      return `Summary appointment ${index} must be an object.`;
    }

    for (const key of ['date', 'time', 'location', 'notes']) {
      if (!(key in appointment)) {
        return `Summary appointment ${index} is missing ${key}.`;
      }
    }
  }

  return null;
}

function normalizeDirection(direction) {
  const value = typeof direction === 'string' ? direction : 'ur-en';
  return VALID_DIRECTIONS.has(value) ? value : null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toPositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function sendConfigurationError(res) {
  return res.status(500).json({
    error: 'Configuration Error',
    message: 'GEMINI_API_KEY is not configured on the server.',
  });
}

function sendGeminiError(res, error, fallbackMessage) {
  const status = error instanceof GeminiApiError ? error.status : 502;
  const message = error instanceof GeminiApiError ? error.message : fallbackMessage;

  res.status(status >= 400 && status < 600 ? status : 502).json({
    error: 'Gemini API Error',
    message,
  });
}

class GeminiApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

app.listen(PORT, () => {
  console.log(`Lingua secure backend running on port ${PORT}`);
});

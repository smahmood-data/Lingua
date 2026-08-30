import { checkRateLimit } from '@vercel/firewall'
import {
  interpreterInstruction,
  isSourceLanguageCode,
  isSupportedLanguageCode,
  type SourceLanguageCode,
  type SupportedLanguageCode,
} from '../src/types.js'
import {
  END_OF_SPEECH_SENSITIVITY,
  END_OF_SPEECH_SILENCE_MS,
} from '../src/lib/translation/config.js'

type ApiRequest = {
  method?: string
  query: Record<string, string | string[] | undefined>
  headers?: Record<string, string | string[] | undefined>
}

type ApiResponse = {
  setHeader: (name: string, value: string) => void
  status: (statusCode: number) => ApiResponse
  json: (body: unknown) => void
}

type GeminiAuthTokenResponse = {
  name?: string
  expireTime?: string
  newSessionExpireTime?: string
  authToken?: {
    name?: string
    expireTime?: string
    newSessionExpireTime?: string
  }
}

const API_BASE_URL = (
  process.env.GEMINI_API_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta'
).replace(/\/$/, '')
const LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-live-translate-preview'
const LIVE_TOKEN_RATE_LIMIT_ID =
  process.env.LIVE_TOKEN_RATE_LIMIT_ID || 'lingua-live-token'
const LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS = positiveInteger(
  process.env.LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
  10 * 60,
)
const LIVE_TOKEN_PROTECTION_RETRY_SECONDS = 30

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function definedHeaders(
  headers: ApiRequest['headers'],
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(
      (entry): entry is [string, string | string[]] =>
        entry[1] !== undefined,
    ),
  )
}

function retryDelay(seconds: number) {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`
  }
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

function sendRateLimitError(response: ApiResponse) {
  response.setHeader(
    'Retry-After',
    String(LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS),
  )
  return response.status(429).json({
    error: 'Live Session Limit Reached',
    code: 'live_token_rate_limited',
    message: `This network has started too many live sessions. Try again in ${retryDelay(
      LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
    )}.`,
    retryable: true,
    retryAfterSeconds: LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
  })
}

function sendProtectionConfigurationError(response: ApiResponse) {
  return response.status(503).json({
    error: 'Live Session Protection Error',
    code: 'live_token_protection_not_configured',
    message:
      'Live sessions are unavailable because abuse protection is not configured. Contact the site owner.',
    retryable: false,
  })
}

function sendProtectionUnavailableError(response: ApiResponse) {
  response.setHeader('Retry-After', String(LIVE_TOKEN_PROTECTION_RETRY_SECONDS))
  return response.status(503).json({
    error: 'Live Session Protection Unavailable',
    code: 'live_token_protection_unavailable',
    message: `Live-session protection could not be checked. Try again in ${retryDelay(
      LIVE_TOKEN_PROTECTION_RETRY_SECONDS,
    )}.`,
    retryable: true,
    retryAfterSeconds: LIVE_TOKEN_PROTECTION_RETRY_SECONDS,
  })
}

async function allowLiveTokenRequest(
  request: ApiRequest,
  response: ApiResponse,
) {
  try {
    const result = await checkRateLimit(LIVE_TOKEN_RATE_LIMIT_ID, {
      headers: definedHeaders(request.headers),
    })
    // The SDK deliberately fails open when the matching dashboard rule is
    // missing. Token creation must instead stop until deployment protection is
    // restored, or a configuration mistake would silently reopen this route.
    if (result.error) {
      if (result.error === 'not-found') {
        sendProtectionConfigurationError(response)
      } else {
        sendProtectionUnavailableError(response)
      }
      return false
    }
    if (result.rateLimited) {
      sendRateLimitError(response)
      return false
    }
    return true
  } catch {
    sendProtectionUnavailableError(response)
    return false
  }
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({
      error: 'Method Not Allowed',
      message: 'Use GET /api/live-token.',
    })
  }

  const requestedTarget = queryValue(request.query.target) ?? 'en'
  if (!isSupportedLanguageCode(requestedTarget)) {
    return response.status(400).json({
      error: 'Validation Error',
      message: 'target must be a supported Gemini Live Translation language.',
    })
  }

  const requestedSource = queryValue(request.query.source) ?? 'auto'
  if (!isSourceLanguageCode(requestedSource)) {
    return response.status(400).json({
      error: 'Validation Error',
      message: 'source must be auto or a supported Gemini Live Translation language.',
    })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return response.status(500).json({
      error: 'Configuration Error',
      message: 'GEMINI_API_KEY is not configured on the server.',
    })
  }

  const targetLanguage: SupportedLanguageCode = requestedTarget
  const sourceLanguage: SourceLanguageCode = requestedSource
  if (
    sourceLanguage !== 'auto' &&
    sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()
  ) {
    return response.status(400).json({
      error: 'Validation Error',
      message: 'source and target must be different languages.',
    })
  }

  if (!(await allowLiveTokenRequest(request, response))) {
    return
  }

  const systemInstruction = interpreterInstruction(
    sourceLanguage,
    targetLanguage,
  )
  const tokenTtlMinutes = positiveInteger(
    process.env.LIVE_TOKEN_TTL_MINUTES,
    30,
  )
  const newSessionTtlSeconds = positiveInteger(
    process.env.LIVE_NEW_SESSION_TTL_SECONDS,
    60,
  )
  const expireTime = new Date(
    Date.now() + tokenTtlMinutes * 60 * 1000,
  ).toISOString()
  const newSessionExpireTime = new Date(
    Date.now() + newSessionTtlSeconds * 1000,
  ).toISOString()

  try {
    // `liveConnectConstraints` does not exist on this API version — it is
    // rejected with "Unknown name" — so `bidiGenerateContentSetup` is the only
    // way to bind a token to a model, an instruction, and a target language.
    const geminiResponse = await fetch(`${API_BASE_URL}/auth_tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime,
        bidiGenerateContentSetup: {
          model: `models/${LIVE_MODEL.replace(/^models\//, '')}`,
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          generationConfig: {
            responseModalities: ['AUDIO'],
            translationConfig: {
              targetLanguageCode: targetLanguage,
              // A route stays silent when the language being spoken is already
              // its target, so only the other route of the pair is heard.
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
    })

    const tokenBody = (await geminiResponse.json()) as GeminiAuthTokenResponse
    if (!geminiResponse.ok) {
      return response.status(geminiResponse.status).json({
        error: 'Gemini API Error',
        message: 'Unable to create a Gemini Live token.',
      })
    }

    const token = tokenBody.authToken ?? tokenBody
    if (!token.name?.startsWith('auth_tokens/')) {
      return response.status(502).json({
        error: 'Gemini API Error',
        message: 'Gemini did not return a valid ephemeral token.',
      })
    }

    return response.status(200).json({
      token: token.name,
      expiresAt: token.expireTime ?? expireTime,
      newSessionExpiresAt:
        token.newSessionExpireTime ?? newSessionExpireTime,
      model: LIVE_MODEL,
      sourceLanguage,
      targetLanguage,
      systemInstruction,
    })
  } catch {
    return response.status(502).json({
      error: 'Gemini API Error',
      message: 'Unable to create a Gemini Live token.',
    })
  }
}

import {
  isSupportedLanguageCode,
  type SupportedLanguageCode,
} from '../src/types.js'

type ApiRequest = {
  method?: string
  query: Record<string, string | string[] | undefined>
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

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return response.status(500).json({
      error: 'Configuration Error',
      message: 'GEMINI_API_KEY is not configured on the server.',
    })
  }

  const targetLanguage: SupportedLanguageCode = requestedTarget
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
    const requestToken = (constraints: 'legacy' | 'documented') =>
      fetch(`${API_BASE_URL}/auth_tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
          ...(constraints === 'legacy'
            ? {
                bidiGenerateContentSetup: {
                  model: `models/${LIVE_MODEL.replace(/^models\//, '')}`,
                  generationConfig: {
                    responseModalities: ['AUDIO'],
                    translationConfig: {
                      targetLanguageCode: targetLanguage,
                      echoTargetLanguage: false,
                    },
                  },
                  sessionResumption: {},
                  inputAudioTranscription: {},
                  outputAudioTranscription: {},
                },
              }
            : {
                liveConnectConstraints: {
                  model: `models/${LIVE_MODEL.replace(/^models\//, '')}`,
                  config: {
                    responseModalities: ['AUDIO'],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    translationConfig: {
                      targetLanguageCode: targetLanguage,
                      echoTargetLanguage: false,
                    },
                  },
                },
              }),
        }),
        signal: AbortSignal.timeout(30_000),
      })

    let geminiResponse = await requestToken('legacy')
    if (
      geminiResponse.status === 400 &&
      (await geminiResponse.clone().text()).includes(
        'bidiGenerateContentSetup',
      )
    ) {
      geminiResponse = await requestToken('documented')
    }

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
      targetLanguage,
    })
  } catch {
    return response.status(502).json({
      error: 'Gemini API Error',
      message: 'Unable to create a Gemini Live token.',
    })
  }
}

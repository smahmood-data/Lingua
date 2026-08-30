import { EPHEMERAL_TOKEN_PREFIX, LIVE_TOKEN_ENDPOINT } from './config'
import { sessionError } from './errors'
import type { SourceLanguageCode, SupportedLanguageCode } from './types'

/**
 * Adapter for the ephemeral-token endpoint owned by Issue #1.
 *
 * This is the only file that knows the wire shape of `/api/live-token`. It is
 * written against the contract now provided by the merged issue #1 backend:
 *
 *   GET /api/live-token?target=en
 *   -> { token, expiresAt, newSessionExpiresAt, model, targetLanguage }
 *
 * The browser only ever holds the short-lived token this returns. The long-lived
 * `GEMINI_API_KEY` stays on the server and is never read here.
 */
export interface LiveToken {
  /** Short-lived ephemeral token, used as the Live API key. */
  token: string
  /** Model the token is constrained to, when the server reports one. */
  model?: string
  /** ISO timestamp, when the server reports one. Informational only. */
  expiresAt?: string
  /** Exact instruction included in the server-side token constraints. */
  systemInstruction: string
}

export interface LiveTokenRequest {
  signal: AbortSignal
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
}

export type LiveTokenProvider = (request: LiveTokenRequest) => Promise<LiveToken>

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readRetryAfterSeconds(
  response: Response,
  body: Record<string, unknown>,
): number | undefined {
  const bodyValue = body.retryAfterSeconds
  const headerValue = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
  const value =
    typeof bodyValue === 'number' && Number.isInteger(bodyValue)
      ? bodyValue
      : headerValue
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function retryDelay(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`
  }
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

async function liveTokenResponseError(response: Response) {
  let body: Record<string, unknown> = {}
  try {
    const candidate: unknown = await response.json()
    if (typeof candidate === 'object' && candidate !== null) {
      body = candidate as Record<string, unknown>
    }
  } catch {
    // Only the small, recognised protection schema below is allowed into UI
    // errors. Malformed and unrelated responses keep the safe fallback.
  }

  const retryAfterSeconds = readRetryAfterSeconds(response, body)
  switch (body.code) {
    case 'live_token_rate_limited': {
      const delay = retryAfterSeconds
        ? ` Try again in ${retryDelay(retryAfterSeconds)}.`
        : ' Wait before trying again.'
      return sessionError(
        'token-rate-limited',
        `This network has started too many live sessions.${delay}`,
        { retryAfterSeconds },
      )
    }
    case 'live_token_protection_not_configured':
      return sessionError(
        'token-protection-not-configured',
        undefined,
        { recoverable: false },
      )
    case 'live_token_protection_unavailable': {
      const delay = retryAfterSeconds
        ? ` Try again in ${retryDelay(retryAfterSeconds)}.`
        : ' Wait briefly and try again.'
      return sessionError(
        'token-protection-unavailable',
        `Live-session protection could not be checked.${delay}`,
        { retryAfterSeconds },
      )
    }
    default:
      return sessionError('token-request-failed')
  }
}

/**
 * Read the token out of the server response.
 *
 * The value must look like a Gemini ephemeral token. `@google/genai` decides
 * how to authenticate purely from the `auth_tokens/` prefix, and sends anything
 * else as a plain API key in the WebSocket URL — so accepting an arbitrary
 * string here is what would turn a server misconfiguration into a long-lived
 * credential travelling through browser code.
 */
export function parseLiveTokenResponse(body: unknown): LiveToken {
  if (typeof body !== 'object' || body === null) {
    throw sessionError('token-request-failed')
  }

  const root = body as Record<string, unknown>
  const token = readString(root, 'token')
  const systemInstruction = readString(root, 'systemInstruction')

  if (
    !token ||
    !token.startsWith(EPHEMERAL_TOKEN_PREFIX) ||
    !systemInstruction
  ) {
    throw sessionError('token-request-failed')
  }

  return {
    token,
    model: readString(root, 'model'),
    expiresAt: readString(root, 'expiresAt'),
    systemInstruction,
  }
}

/**
 * Default provider: asks the Lingua server for a token.
 *
 * The endpoint is relative so a single-origin deployment works unchanged; the
 * Vite dev server proxies `/api` to the local Express port. A deployment that
 * puts the server on another origin should pass an absolute URL here rather
 * than introduce a build-time variable.
 *
 * Only the endpoint's recognised abuse-protection codes receive specific UI
 * guidance. Other failures still collapse into `token-request-failed`, so raw
 * response bodies, status text, and URLs never reach the UI or console.
 */
export function createLiveTokenProvider(
  endpoint: string = LIVE_TOKEN_ENDPOINT,
): LiveTokenProvider {
  return async ({ signal, sourceLanguage, targetLanguage }) => {
    const parameters = new URLSearchParams({
      source: sourceLanguage,
      target: targetLanguage,
    })
    const url = `${endpoint}?${parameters.toString()}`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      })
    } catch (cause) {
      if (signal.aborted) {
        throw cause
      }
      throw sessionError('token-request-failed')
    }

    if (!response.ok) {
      throw await liveTokenResponseError(response)
    }

    try {
      return parseLiveTokenResponse(await response.json())
    } catch (cause) {
      if (signal.aborted) {
        throw cause
      }
      throw sessionError('token-request-failed')
    }
  }
}

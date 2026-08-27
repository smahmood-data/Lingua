import { LIVE_TOKEN_ENDPOINT } from './config'
import { sessionError } from './errors'

/**
 * Adapter for the ephemeral-token endpoint owned by Issue #1.
 *
 * This is the only place that knows the wire shape of `/api/live-token`. The
 * route itself is documented in the README and `docs/ARCHITECTURE.md`, but the
 * response body has not been fixed yet, so the reader below accepts the handful
 * of obvious shapes and should be narrowed to the real one once #1 merges.
 *
 * The browser only ever holds the short-lived token this returns. The long-lived
 * `GEMINI_API_KEY` stays on the server and is never read here.
 */
export interface LiveToken {
  /** Short-lived token value used as the Live API key. */
  token: string
  /** Model the token is constrained to, when the server reports one. */
  model?: string
  /** ISO timestamp, when the server reports one. Informational only. */
  expiresAt?: string
}

export type LiveTokenProvider = (signal: AbortSignal) => Promise<LiveToken>

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Pull the token value out of the server response.
 *
 * Gemini's own examples use `token.name` for the ephemeral token resource, so
 * both `token` and `name` are accepted, at the top level or nested under `token`.
 */
export function parseLiveTokenResponse(body: unknown): LiveToken {
  if (typeof body !== 'object' || body === null) {
    throw sessionError('token-request-failed')
  }

  const root = body as Record<string, unknown>
  const nested =
    typeof root.token === 'object' && root.token !== null
      ? (root.token as Record<string, unknown>)
      : undefined

  const token =
    readString(root, 'token') ??
    readString(root, 'name') ??
    (nested ? (readString(nested, 'name') ?? readString(nested, 'token')) : undefined)

  if (!token) {
    throw sessionError('token-request-failed')
  }

  return {
    token,
    model: readString(root, 'model') ?? (nested ? readString(nested, 'model') : undefined),
    expiresAt:
      readString(root, 'expiresAt') ??
      readString(root, 'expireTime') ??
      (nested ? readString(nested, 'expireTime') : undefined),
  }
}

/**
 * Default provider: asks the Lingua server for a token.
 *
 * Failures are collapsed into a single `token-request-failed` session error so
 * that server internals never reach the UI or the console.
 */
export function createLiveTokenProvider(
  endpoint: string = LIVE_TOKEN_ENDPOINT,
): LiveTokenProvider {
  return async (signal) => {
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause
      }
      throw sessionError('token-request-failed')
    }

    if (!response.ok) {
      throw sessionError('token-request-failed')
    }

    try {
      return parseLiveTokenResponse(await response.json())
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause
      }
      throw sessionError('token-request-failed')
    }
  }
}

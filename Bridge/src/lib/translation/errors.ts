import type { SessionError, SessionErrorCode } from './types'

const MESSAGES: Record<SessionErrorCode, string> = {
  'microphone-permission-denied':
    'Microphone access was blocked. Allow the microphone for this site and start again.',
  'microphone-unavailable':
    'No usable microphone was found. Check the input device and start again.',
  'unsupported-browser':
    'This browser is missing the audio APIs Lingua needs. Try a current version of Chrome, Edge, Firefox, or Safari.',
  'token-request-failed':
    'Could not get a usable session token from the Lingua server. Check that the server is running and try again.',
  'live-connection-failed':
    'Could not connect to the translation service. Check the connection and try again.',
  'live-disconnected':
    'The translation session ended unexpectedly. Start a new session to continue.',
  unknown: 'The translation session could not continue. Try again.',
}

/** Every code the session layer can report. Exported so the UI can exhaust it. */
export const SESSION_ERROR_CODES = Object.keys(MESSAGES) as SessionErrorCode[]

const CODE_SET = new Set<string>(SESSION_ERROR_CODES)

export function sessionError(
  code: SessionErrorCode,
  message?: string,
): SessionError {
  return {
    code,
    message: message ?? MESSAGES[code],
    // Every failure here is retryable without a page reload; the controller
    // always returns to a resting state before surfacing the error.
    recoverable: true,
  }
}

/**
 * Identify one of our own errors.
 *
 * This checks the `code` against the known set rather than testing for the
 * presence of a `code` property. A `DOMException` also carries `code` and
 * `message`, but its `code` is a legacy *number*, so a structural check would
 * let a raw DOMException through and break the advertised `SessionError`
 * contract for anything reading `error.code`.
 */
export function isSessionError(value: unknown): value is SessionError {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const code = (value as { code?: unknown }).code
  return typeof code === 'string' && CODE_SET.has(code)
}

/** Normalise anything thrown into a `SessionError`. */
export function toSessionError(
  cause: unknown,
  fallback: SessionErrorCode = 'unknown',
): SessionError {
  return isSessionError(cause) ? cause : sessionError(fallback)
}

/**
 * Map a `getUserMedia` rejection onto a session error.
 *
 * Names come from the Media Capture spec rather than from message text, which
 * differs between browsers.
 */
export function microphoneError(cause: unknown): SessionError {
  const name = cause instanceof Error ? cause.name : ''

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return sessionError('microphone-permission-denied')
  }
  return sessionError('microphone-unavailable')
}

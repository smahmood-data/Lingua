import type { SessionError, SessionErrorCode } from './types'

const MESSAGES: Record<SessionErrorCode, string> = {
  'microphone-permission-denied':
    'Microphone access was blocked. Allow the microphone for this site and start again.',
  'microphone-unavailable':
    'No usable microphone was found. Check the input device and start again.',
  'unsupported-browser':
    'This browser is missing the audio APIs Lingua needs. Try a current version of Chrome, Edge, Firefox, or Safari.',
  'token-request-failed':
    'Could not reach the Lingua server for a session token. Check that the server is running and try again.',
  'live-connection-failed':
    'Could not connect to the translation service. Check the connection and try again.',
  'live-disconnected':
    'The translation session ended unexpectedly. Start a new session to continue.',
  unknown: 'The translation session could not continue. Try again.',
}

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
  if (
    name === 'NotFoundError' ||
    name === 'OverconstrainedError' ||
    name === 'NotReadableError'
  ) {
    return sessionError('microphone-unavailable')
  }
  return sessionError('microphone-unavailable')
}

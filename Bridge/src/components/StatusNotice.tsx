import type { SessionError, SessionErrorCode } from '../lib/translation'
import './StatusNotice.css'

const NOTICE_TITLES: Record<SessionErrorCode, string> = {
  'microphone-permission-denied': 'Microphone access was denied',
  'microphone-unavailable': 'No microphone was found',
  'unsupported-browser': 'This browser can’t run live translation',
  'token-request-failed': 'Could not reach the Lingua server',
  'live-connection-failed': 'Could not connect to the interpreter',
  'live-disconnected': 'Connection lost',
  unknown: 'Something went wrong with translation',
}

const CALM_CODES = new Set<SessionErrorCode>([
  'microphone-permission-denied',
  'microphone-unavailable',
  'unsupported-browser',
])

/**
 * One calm inline notice for when a session fails. The message comes from the
 * session layer, which keeps it free of tokens and server internals; the UI
 * only adds a title and a tone.
 */
export function StatusNotice({ error }: { error: SessionError }) {
  const tone = CALM_CODES.has(error.code) ? 'warning' : 'danger'

  return (
    <div className={`status-notice notice-${tone}`} role="alert">
      <p className="notice-title">{NOTICE_TITLES[error.code]}</p>
      <p className="notice-detail">{error.message}</p>
    </div>
  )
}

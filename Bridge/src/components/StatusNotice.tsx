import { useEffect, useState } from 'react'
import type { SessionError, SessionErrorCode } from '../lib/translation'
import './StatusNotice.css'

const NOTICE_TITLES: Record<SessionErrorCode, string> = {
  'microphone-permission-denied': 'Microphone access was denied',
  'microphone-unavailable': 'No microphone was found',
  'unsupported-browser': 'This browser can’t run live translation',
  'token-rate-limited': 'Live-session limit reached',
  'token-protection-not-configured': 'Live sessions need protection setup',
  'token-protection-unavailable': 'Live-session protection is unavailable',
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

const NOTICE_EXIT_MS = 240
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

type NoticeTone = 'warning' | 'danger'

interface DismissibleNoticeProps {
  title: string
  detail: string
  tone: NoticeTone
}

/**
 * One calm inline notice for when a session fails. The message comes from the
 * session layer, which keeps it free of tokens and server internals; the UI
 * only adds a title and a tone.
 */
function DismissibleNotice({
  title,
  detail,
  tone,
}: DismissibleNoticeProps) {
  const [isVisible, setIsVisible] = useState(true)
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (!isExiting) return
    const exitTimer = window.setTimeout(
      () => setIsVisible(false),
      NOTICE_EXIT_MS,
    )
    return () => window.clearTimeout(exitTimer)
  }, [isExiting])

  if (!isVisible) return null

  const dismiss = () => {
    if (isExiting) return
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) {
      setIsVisible(false)
      return
    }
    setIsExiting(true)
  }

  return (
    <div
      className={`status-notice notice-${tone}${isExiting ? ' is-exiting' : ''}`}
      role="alert"
    >
      <div className="notice-copy">
        <p className="notice-title">{title}</p>
        <p className="notice-detail">{detail}</p>
      </div>
      <button
        className="notice-dismiss"
        type="button"
        aria-label="Dismiss message"
        onClick={dismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

export function StatusNotice({ error }: { error: SessionError }) {
  return (
    <DismissibleNotice
      title={NOTICE_TITLES[error.code]}
      detail={error.message}
      tone={CALM_CODES.has(error.code) ? 'warning' : 'danger'}
    />
  )
}

function idleTimeRemaining(endsAt: number) {
  const seconds = Math.max(1, Math.ceil((endsAt - Date.now()) / 1000))
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`
  }
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

export function IdleSessionNotice({ endsAt }: { endsAt: number }) {
  return (
    <DismissibleNotice
      title="Session ending soon"
      detail={`No speech detected. Speak within ${idleTimeRemaining(
        endsAt,
      )} to keep this session open.`}
      tone="warning"
    />
  )
}

export function IdleSessionEndedNotice() {
  return (
    <DismissibleNotice
      title="Session ended due to inactivity"
      detail="Start a new session when you’re ready."
      tone="danger"
    />
  )
}

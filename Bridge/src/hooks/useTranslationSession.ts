import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { TranslationSession, isSessionActive } from '../lib/translation'
import type {
  InterimTranscript,
  PartnerLanguage,
  SessionError,
  SessionState,
  TranscriptTurn,
  TranslationDirection,
  TranslationSessionOptions,
} from '../lib/translation'

export interface UseTranslationSessionResult {
  /** `connecting`, `listening`, `translating`, `stopped`, or `error`. */
  state: SessionState
  /** Selected direction for the next or current session. */
  direction: TranslationDirection
  /** Last failure, cleared when a new session starts. `null` while healthy. */
  error: SessionError | null
  /** Finalised turns for this browser session only. Never persisted. */
  transcript: TranscriptTurn[]
  /** Live partial caption while someone is speaking, or `null`. */
  interimTranscript: InterimTranscript | null
  /** True while microphone and Live resources are held. */
  isActive: boolean
  /** Start a session. Repeated calls while active are ignored. */
  start: (direction?: TranslationDirection) => Promise<void>
  /** Two-way English ↔ partner conversation; auto-detects who is speaking. */
  startConversation: (partner: PartnerLanguage) => Promise<void>
  /** Select a direction, stopping an active session before it changes. */
  setDirection: (direction: TranslationDirection) => Promise<void>
  /** Stop and release everything. Safe to call more than once. */
  stop: () => Promise<void>
  /** Drop the transcript without touching the session. */
  clearTranscript: () => void
}

/**
 * React binding for the live translation pipeline.
 *
 * Options are read once, when the session is created; later changes are ignored.
 * Pass `direction` to `start()` instead of re-rendering with new options.
 */
export function useTranslationSession(
  options: TranslationSessionOptions = {},
): UseTranslationSessionResult {
  // Lazy initialiser: the session is constructed once and the options object is
  // captured from the first render only.
  const [session] = useState(() => new TranslationSession(options))

  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => session.subscribe(listener), [session]),
    useCallback(() => session.getSnapshot(), [session]),
  )

  // Stop rather than dispose: the session instance outlives StrictMode's
  // mount/unmount/mount cycle and must stay startable afterwards.
  useEffect(() => {
    return () => {
      void session.stop()
    }
  }, [session])

  const start = useCallback(
    (direction?: TranslationDirection) => session.start(direction),
    [session],
  )
  const startConversation = useCallback(
    (partner: PartnerLanguage) => session.startConversation(partner),
    [session],
  )
  const setDirection = useCallback(
    (direction: TranslationDirection) => session.setDirection(direction),
    [session],
  )
  const stop = useCallback(() => session.stop(), [session])
  const clearTranscript = useCallback(() => session.clearTranscript(), [session])

  return {
    state: snapshot.state,
    direction: snapshot.direction,
    error: snapshot.error,
    transcript: snapshot.transcript,
    interimTranscript: snapshot.interimTranscript,
    isActive: isSessionActive(snapshot.state),
    start,
    startConversation,
    setDirection,
    stop,
    clearTranscript,
  }
}

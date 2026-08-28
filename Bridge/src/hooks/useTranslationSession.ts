import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { TranslationSession, isSessionActive } from '../lib/translation'
import type {
  InterimTranscript,
  SessionError,
  SessionState,
  SupportedLanguageCode,
  TranscriptTurn,
  TranslationSessionOptions,
} from '../lib/translation'

export interface UseTranslationSessionResult {
  /** `connecting`, `listening`, `translating`, `stopped`, or `error`. */
  state: SessionState
  /** Selected output language for the next or current session. */
  targetLanguage: SupportedLanguageCode
  /** Last failure, cleared when a new session starts. `null` while healthy. */
  error: SessionError | null
  /** Finalised turns for this browser session only. Never persisted. */
  transcript: TranscriptTurn[]
  /** Live partial caption while someone is speaking, or `null`. */
  interimTranscript: InterimTranscript | null
  /** True while microphone and Live resources are held. */
  isActive: boolean
  /** Start a session. Repeated calls while active are ignored. */
  start: (targetLanguage?: SupportedLanguageCode) => Promise<void>
  /** Select an output language, stopping an active session before it changes. */
  setTargetLanguage: (targetLanguage: SupportedLanguageCode) => Promise<void>
  /** Stop and release everything. Safe to call more than once. */
  stop: () => Promise<void>
  /** Drop the transcript without touching the session. */
  clearTranscript: () => void
}

/**
 * React binding for the live translation pipeline.
 *
 * Options are read once, when the session is created; later changes are ignored.
 * Pass `targetLanguage` to `start()` instead of re-rendering with new options.
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
    (targetLanguage?: SupportedLanguageCode) => session.start(targetLanguage),
    [session],
  )
  const setTargetLanguage = useCallback(
    (targetLanguage: SupportedLanguageCode) =>
      session.setTargetLanguage(targetLanguage),
    [session],
  )
  const stop = useCallback(() => session.stop(), [session])
  const clearTranscript = useCallback(() => session.clearTranscript(), [session])

  return {
    state: snapshot.state,
    targetLanguage: snapshot.targetLanguage,
    error: snapshot.error,
    transcript: snapshot.transcript,
    interimTranscript: snapshot.interimTranscript,
    isActive: isSessionActive(snapshot.state),
    start,
    setTargetLanguage,
    stop,
    clearTranscript,
  }
}

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { TranslationSession, isSessionActive } from '../lib/translation'
import type {
  ConversationTurn,
  InterimTranscript,
  SessionError,
  SessionState,
  SourceLanguageCode,
  SupportedLanguageCode,
  TranslationSessionOptions,
} from '../lib/translation'

export interface UseTranslationSessionResult {
  /** `connecting`, `listening`, `translating`, `playing`, `stopped`, or `error`. */
  state: SessionState
  /** Selected output language for the next or current session. */
  targetLanguage: SupportedLanguageCode
  /** Selected input language, or per-utterance automatic detection. */
  sourceLanguage: SourceLanguageCode
  /** The other language of the pair: the explicit source, or Auto's current detection. */
  counterpartLanguage: SupportedLanguageCode | null
  /** Last failure, cleared when a new session starts. `null` while healthy. */
  error: SessionError | null
  /** Conversation history, including the turn in progress. Never persisted. */
  turns: ConversationTurn[]
  /** Live partial caption while someone is speaking, or `null`. */
  interimTranscript: InterimTranscript | null
  /** Idle deadline once the session-ending warning is active. */
  idleWarningEndsAt: number | null
  /** When inactivity most recently ended the session; cleared on the next start. */
  idleTimeoutEndedAt: number | null
  /** True while microphone and Live resources are held. */
  isActive: boolean
  /** Start a session. Repeated calls while active are ignored. */
  start: (
    sourceLanguage?: SourceLanguageCode,
    targetLanguage?: SupportedLanguageCode,
  ) => Promise<void>
  /** Select the input language, stopping an active session before it changes. */
  setSourceLanguage: (sourceLanguage: SourceLanguageCode) => Promise<void>
  /** Select an output language, stopping an active session before it changes. */
  setTargetLanguage: (targetLanguage: SupportedLanguageCode) => Promise<void>
  /** Change both sides as one operation. */
  setLanguages: (
    sourceLanguage: SourceLanguageCode,
    targetLanguage: SupportedLanguageCode,
  ) => Promise<void>
  /** Stop and release everything. Safe to call more than once. */
  stop: () => Promise<void>
  /** Drop the conversation history without touching the session. */
  clearTranscript: () => void
}

/**
 * React binding for the live translation pipeline.
 *
 * Options are read once, when the session is created; later changes are ignored.
 * Pass the language pair to `start()` instead of re-rendering with new options.
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
    (
      sourceLanguage?: SourceLanguageCode,
      targetLanguage?: SupportedLanguageCode,
    ) => session.start(sourceLanguage, targetLanguage),
    [session],
  )
  const setSourceLanguage = useCallback(
    (sourceLanguage: SourceLanguageCode) =>
      session.setSourceLanguage(sourceLanguage),
    [session],
  )
  const setTargetLanguage = useCallback(
    (targetLanguage: SupportedLanguageCode) =>
      session.setTargetLanguage(targetLanguage),
    [session],
  )
  const setLanguages = useCallback(
    (
      sourceLanguage: SourceLanguageCode,
      targetLanguage: SupportedLanguageCode,
    ) => session.setLanguages(sourceLanguage, targetLanguage),
    [session],
  )
  const stop = useCallback(() => session.stop(), [session])
  const clearTranscript = useCallback(() => session.clearTranscript(), [session])

  return {
    state: snapshot.state,
    sourceLanguage: snapshot.sourceLanguage,
    targetLanguage: snapshot.targetLanguage,
    counterpartLanguage: snapshot.counterpartLanguage,
    error: snapshot.error,
    turns: snapshot.turns,
    interimTranscript: snapshot.interimTranscript,
    idleWarningEndsAt: snapshot.idleWarningEndsAt,
    idleTimeoutEndedAt: snapshot.idleTimeoutEndedAt,
    isActive: isSessionActive(snapshot.state),
    start,
    setSourceLanguage,
    setTargetLanguage,
    setLanguages,
    stop,
    clearTranscript,
  }
}

/**
 * Public contracts for the live translation pipeline.
 *
 * Issue #1 owns the shared cross-layer types for the project. The live pipeline
 * keeps its finer-grained session and conversation types here; its language type
 * is re-exported from the shared contract below. The UI (#4) and summary flow
 * (#5) should import from `src/lib/translation` rather than individual modules.
 */

/** Shared target-language contract used by the frontend and token endpoint. */
import type { SourceLanguageCode, SupportedLanguageCode } from '../../types'
export type { SourceLanguageCode, SupportedLanguageCode }

/**
 * What the session is doing, as a person watching it would describe it.
 *
 * `stopped` is both the initial and the terminal resting state, so a session
 * that has been stopped or recovered from an error can be started again.
 * `translating` and `playing` are deliberately separate: only the second one
 * means translated speech is coming out of the speakers.
 */
export type SessionState =
  | 'connecting'
  | 'listening'
  | 'translating'
  | 'playing'
  | 'stopped'
  | 'error'

/** Resource lifecycle, independent of what the conversation is doing. */
export type SessionLifecycle = 'stopped' | 'connecting' | 'active' | 'error'

/** What the conversation is doing while the session holds its resources. */
export type ConversationPhase = 'listening' | 'translating' | 'playing'

/** Machine-readable reason a session failed, for UI copy and retry guidance. */
export type SessionErrorCode =
  | 'microphone-permission-denied'
  | 'microphone-unavailable'
  | 'unsupported-browser'
  | 'token-request-failed'
  | 'live-connection-failed'
  | 'live-disconnected'
  | 'unknown'

export interface SessionError {
  code: SessionErrorCode
  /** Short, user-safe message. Never contains tokens or server internals. */
  message: string
  /** Whether starting a new session is expected to work without a page reload. */
  recoverable: boolean
}

/**
 * How far one human utterance has got.
 *
 * `speaking` while the words are still arriving, `translating` once the
 * utterance is closed and the interpretation is being produced, `playing` while
 * that interpretation is audible, `complete` once it has finished.
 */
export type TurnStatus = 'speaking' | 'translating' | 'playing' | 'complete'

/**
 * One thing one person said, and what the other person hears back.
 *
 * This is the unit the product is about. Both Live routes hear the same
 * microphone and both report the same speech, but a turn is created from the
 * utterance rather than from a route's report of it, so one person speaking
 * once is always exactly one turn.
 */
export interface ConversationTurn {
  id: string
  /** BCP-47 code of the speech, or `null` while it is still unidentified. */
  sourceLanguage: string | null
  /** What the speaker said, in their own language. */
  sourceText: string
  /** The language this turn is interpreted into, once a direction exists. */
  targetLanguage: string | null
  /** What the other person hears. Empty when nothing had to be interpreted. */
  translatedText: string
  status: TurnStatus
  createdAt: number
}

/**
 * Speculative partial transcription of the current speaker.
 *
 * Updated while someone is still talking and replaced wholesale, so it belongs
 * in a live caption line rather than in the conversation history. It is cleared
 * as soon as the turn it was previewing closes.
 */
export interface InterimTranscript {
  text: string
  languageCode: string
}

/** Snapshot handed to subscribers on every change. */
export interface TranslationSessionSnapshot {
  state: SessionState
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
  /** Current Auto-detected counterpart, or the explicitly selected source. */
  counterpartLanguage: SupportedLanguageCode | null
  error: SessionError | null
  /** Conversation history, oldest first, including the turn in progress. */
  turns: ConversationTurn[]
  /** Live partial caption, or `null` when there is nothing in progress. */
  interimTranscript: InterimTranscript | null
}

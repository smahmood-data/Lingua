/**
 * Public contracts for the live translation pipeline.
 *
 * Issue #1 owns the shared cross-layer types for the project. Until that lands,
 * these local definitions keep the boundary small and easy to re-point: the UI
 * (#4) and the summary flow (#5) should import from `src/lib/translation`
 * rather than from the individual modules underneath it.
 */

/** Translation direction. Issue #2 ships `ur-to-en`; #3 owns the direction toggle. */
export type TranslationDirection = 'ur-to-en' | 'en-to-ur'

/**
 * Session lifecycle states.
 *
 * `stopped` is both the initial and the terminal resting state, so a session
 * that has been stopped or recovered from an error can be started again.
 */
export type SessionState =
  | 'connecting'
  | 'listening'
  | 'translating'
  | 'stopped'
  | 'error'

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
 * One line of transcript.
 *
 * `source` is what Gemini heard, `translation` is what it spoke back. Turns are
 * only created from transcription events the API actually sends; nothing is
 * inferred or filled in locally.
 */
export type TranscriptKind = 'source' | 'translation'

export interface TranscriptTurn {
  id: string
  kind: TranscriptKind
  text: string
  /** BCP-47 code reported by the API, or the configured language for this side. */
  languageCode: string
  /**
   * Normally true: these turns are built from the API's finalised transcription
   * segments. It is only false if the API explicitly marks a segment unfinished,
   * in which case the next segment of the same kind extends this turn.
   */
  isFinal: boolean
  createdAt: number
}

/**
 * Speculative partial transcription of the current speaker.
 *
 * Updated while someone is still talking and replaced wholesale, so it belongs
 * in a live caption line rather than in the transcript history. It is cleared
 * as soon as the finalised segment for that speech arrives.
 */
export interface InterimTranscript {
  text: string
  languageCode: string
}

/** Snapshot handed to subscribers on every change. */
export interface TranslationSessionSnapshot {
  state: SessionState
  direction: TranslationDirection
  error: SessionError | null
  /** Finalised turns, oldest first. */
  transcript: TranscriptTurn[]
  /** Live partial caption, or `null` when there is nothing in progress. */
  interimTranscript: InterimTranscript | null
}

/**
 * Live translation pipeline.
 *
 * This is the boundary the rest of the app should import from. UI work (#4) and
 * the summary flow (#5) can rely on `useTranslationSession` and the types here
 * without touching microphone, PCM, or Gemini Live details.
 */
export { TranslationSession } from './translationSession'
export type {
  SessionListener,
  TranslationSessionOptions,
} from './translationSession'

export type {
  ConversationPhase,
  ConversationTurn,
  InterimTranscript,
  SessionError,
  SessionErrorCode,
  SessionLifecycle,
  SessionState,
  SourceLanguageCode,
  SupportedLanguageCode,
  TranslationSessionSnapshot,
  TurnStatus,
} from './types'

export { canStart, deriveSessionState, isSessionActive } from './sessionMachine'
export { SESSION_ERROR_CODES } from './errors'
export { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE } from './config'

export {
  createLiveTokenProvider,
  parseLiveTokenResponse,
} from './tokenProvider'
export type {
  LiveToken,
  LiveTokenProvider,
  LiveTokenRequest,
} from './tokenProvider'

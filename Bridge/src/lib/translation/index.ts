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
  InterimTranscript,
  SessionError,
  SessionErrorCode,
  SessionState,
  TranscriptKind,
  TranscriptTurn,
  PartnerLanguage,
  TranslationDirection,
  TranslationSessionSnapshot,
} from './types'

export { canStart, isSessionActive } from './sessionMachine'
export { SESSION_ERROR_CODES } from './errors'
export { conversationDirections, languagesForDirection } from './config'

export {
  createLiveTokenProvider,
  parseLiveTokenResponse,
} from './tokenProvider'
export type {
  LiveToken,
  LiveTokenProvider,
  LiveTokenRequest,
} from './tokenProvider'

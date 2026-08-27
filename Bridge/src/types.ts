export type Direction = 'en-ur' | 'ur-en'
export type Language = 'English' | 'Urdu'
export type TranslationDirection = 'ur-to-en' | 'en-to-ur'

export type AppStatus =
  | 'ready'
  | 'listening'
  | 'loading'
  | 'disconnected'
  | 'denied'
  | 'error'

export type SessionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface TranscriptTurn {
  id: string;
  speaker: 'user' | 'model';
  originalText: string;
  translatedText?: string;
  timestamp: string;
}

export type TranscriptLine = {
  id: number
  speaker: string
  originalLanguage: Language
  translatedLanguage: Language
  original: string
  translated: string
}

export interface ApiError {
  error: string;
  message: string;
  status?: number;
}

export interface TokenResponse {
  token: string;
  expiresAt: string;
  newSessionExpiresAt: string;
  model: string;
  direction: TranslationDirection;
}

export const directions: Direction[] = ['en-ur', 'ur-en']

export type ControlId = Direction | 'start' | 'stop' | 'demo'

export const controlLayout: ControlId[][] = [
  ['en-ur', 'ur-en'],
  ['start', 'stop'],
]

export const controlIds: ControlId[] = [
  'en-ur',
  'ur-en',
  'start',
  'stop',
  'demo',
]

export function isControlDisabled(controlId: ControlId, isListening: boolean) {
  if (controlId === 'start') return isListening
  if (controlId === 'stop') return !isListening
  return false
}

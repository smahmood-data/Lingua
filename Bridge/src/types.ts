export type TranslationDirection = 'ur-to-en' | 'en-to-ur';

export type SessionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface TranscriptTurn {
  id: string;
  speaker: 'user' | 'model';
  originalText: string;
  translatedText?: string;
  timestamp: string;
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

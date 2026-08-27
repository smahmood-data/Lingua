export type PartnerLanguage = 'ur' | 'es' | 'bn'
export type Language = 'English' | 'Urdu' | 'Spanish' | 'Bengali'
export type TranslationDirection =
  | `${PartnerLanguage}-to-en`
  | `en-to-${PartnerLanguage}`

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

export const partnerLanguages: PartnerLanguage[] = ['ur', 'es', 'bn']

export const partnerLanguageMeta: Record<
  PartnerLanguage,
  { label: Language; nativeName: string; htmlLang: string; short: string }
> = {
  ur: { label: 'Urdu', nativeName: 'اردو', htmlLang: 'ur', short: 'UR' },
  es: { label: 'Spanish', nativeName: 'Español', htmlLang: 'es', short: 'ES' },
  bn: { label: 'Bengali', nativeName: 'বাংলা', htmlLang: 'bn', short: 'BN' },
}

export type ControlId = PartnerLanguage | 'start' | 'stop' | 'demo'

export const controlLayout: ControlId[][] = [
  ['ur', 'es', 'bn'],
  ['start', 'stop'],
]

export const controlIds: ControlId[] = ['ur', 'es', 'bn', 'start', 'stop', 'demo']

export function isControlDisabled(controlId: ControlId, isListening: boolean) {
  if (controlId === 'start') return isListening
  if (controlId === 'stop') return !isListening
  return false
}

export function languageFromCode(code: string): Language {
  const normalized = code.toLowerCase()
  if (normalized.startsWith('ur')) return 'Urdu'
  if (normalized.startsWith('es') || normalized.startsWith('spa')) return 'Spanish'
  if (normalized.startsWith('bn') || normalized.startsWith('ben')) return 'Bengali'
  return 'English'
}

export function htmlLangFromLanguage(language: Language): string {
  if (language === 'Urdu') return 'ur'
  if (language === 'Spanish') return 'es'
  if (language === 'Bengali') return 'bn'
  return 'en'
}

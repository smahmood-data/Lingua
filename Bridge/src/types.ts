export type AppStatus =
  | 'ready'
  | 'listening'
  | 'loading'
  | 'disconnected'
  | 'denied'
  | 'error'

export interface TranscriptTurn {
  id: string
  speaker: 'user' | 'model'
  originalText: string
  translatedText?: string
  timestamp: string
}

export type TranscriptLine = {
  id: number
  speaker: string
  originalLanguage: string
  originalLanguageCode: string
  translatedLanguage: string
  translatedLanguageCode: string
  original: string
  translated: string
}

export interface ApiError {
  error: string
  message: string
  status?: number
}

/** Languages currently supported by Gemini 3.5 Live Translate. */
export const supportedLanguages = [
  { code: 'af', label: 'Afrikaans' },
  { code: 'ak', label: 'Akan' },
  { code: 'sq', label: 'Albanian' },
  { code: 'am', label: 'Amharic' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hy', label: 'Armenian' },
  { code: 'az', label: 'Azerbaijani' },
  { code: 'eu', label: 'Basque' },
  { code: 'be', label: 'Belarusian' },
  { code: 'bn', label: 'Bengali' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'my', label: 'Burmese (Myanmar)' },
  { code: 'ca', label: 'Catalan' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' },
  { code: 'et', label: 'Estonian' },
  { code: 'fil', label: 'Filipino' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'gl', label: 'Galician' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ha', label: 'Hausa' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'is', label: 'Icelandic' },
  { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'jv', label: 'Javanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'km', label: 'Khmer' },
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'ko', label: 'Korean' },
  { code: 'lo', label: 'Lao' },
  { code: 'lv', label: 'Latvian' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mr', label: 'Marathi' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'ne', label: 'Nepali' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },
  { code: 'sr', label: 'Serbian' },
  { code: 'sd', label: 'Sindhi' },
  { code: 'si', label: 'Sinhala' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'es', label: 'Spanish' },
  { code: 'su', label: 'Sundanese' },
  { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'th', label: 'Thai' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'zu', label: 'Zulu' },
] as const

export type SupportedLanguageCode = (typeof supportedLanguages)[number]['code']

export interface LanguageMeta {
  code: string
  label: string
  htmlLang: string
  isRtl: boolean
}

export interface TokenResponse {
  token: string
  expiresAt: string
  newSessionExpiresAt: string
  model: string
  targetLanguage: SupportedLanguageCode
}

const languageByCode = new Map<string, (typeof supportedLanguages)[number]>(
  supportedLanguages.map((language) => [language.code.toLowerCase(), language]),
)

const languageAliases: Record<string, SupportedLanguageCode> = {
  ben: 'bn',
  cmn: 'zh-Hans',
  eng: 'en',
  heb: 'he',
  nor: 'no',
  spa: 'es',
  urd: 'ur',
  zho: 'zh-Hans',
  zh: 'zh-Hans',
}

const rtlLanguageCodes = new Set(['ar', 'fa', 'he', 'sd', 'ur'])

function canonicalLanguageCode(code: string): string {
  const normalized = code.trim().replaceAll('_', '-').toLowerCase()
  const alias = languageAliases[normalized]
  if (alias) return alias

  if (languageByCode.has(normalized)) return normalized

  const base = normalized.split('-')[0]
  const baseAlias = languageAliases[base]
  if (baseAlias) return baseAlias
  if (languageByCode.has(base)) return base

  return normalized || 'und'
}

export function languageMetaFromCode(code: string): LanguageMeta {
  const canonical = canonicalLanguageCode(code)
  const known = languageByCode.get(canonical.toLowerCase())
  const base = canonical.split('-')[0]

  return {
    code: known?.code ?? canonical,
    label:
      known?.label ??
      (canonical === 'und' ? 'Detected language' : canonical.toUpperCase()),
    htmlLang: canonical === 'und' ? '' : canonical,
    isRtl: rtlLanguageCodes.has(base),
  }
}

export function languageCodesMatch(left: string, right: string): boolean {
  const a = canonicalLanguageCode(left)
  const b = canonicalLanguageCode(right)
  return a === b || a.split('-')[0] === b.split('-')[0]
}

export function isSupportedLanguageCode(
  code: string,
): code is SupportedLanguageCode {
  return supportedLanguages.some((language) => language.code === code)
}

export type ControlId = 'target-language' | 'start' | 'stop' | 'demo'

export const controlLayout: ControlId[][] = [
  ['target-language'],
  ['start', 'stop'],
]

export const controlIds: ControlId[] = [
  'target-language',
  'start',
  'stop',
  'demo',
]

export function isControlDisabled(controlId: ControlId, isListening: boolean) {
  if (controlId === 'start') return isListening
  if (controlId === 'stop') return !isListening
  return false
}

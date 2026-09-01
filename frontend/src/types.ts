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
  { code: 'nb', label: 'Norwegian Bokmål' },
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
export const AUTO_SOURCE_LANGUAGE = 'auto' as const
export type SourceLanguageCode =
  | typeof AUTO_SOURCE_LANGUAGE
  | SupportedLanguageCode

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
  sourceLanguage: SourceLanguageCode
  targetLanguage: SupportedLanguageCode
  systemInstruction: string
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

const scriptLanguagePatterns: ReadonlyArray<{
  pattern: RegExp
  language: SupportedLanguageCode
  compatible?: readonly SupportedLanguageCode[]
}> = [
  {
    pattern: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u,
    language: 'ar',
    compatible: ['ar', 'fa', 'sd', 'ur'],
  },
  { pattern: /[\u3040-\u30ff]/u, language: 'ja' },
  { pattern: /[\uac00-\ud7af]/u, language: 'ko' },
  {
    pattern: /[\u4e00-\u9fff\u3400-\u4dbf]/u,
    language: 'zh-Hans',
    compatible: ['ja', 'zh-Hans', 'zh-Hant'],
  },
  { pattern: /[\u0590-\u05ff]/u, language: 'he' },
  { pattern: /[\u0e00-\u0e7f]/u, language: 'th' },
  { pattern: /[\u0980-\u09ff]/u, language: 'bn' },
  { pattern: /[\u0b80-\u0bff]/u, language: 'ta' },
  { pattern: /[\u0c00-\u0c7f]/u, language: 'te' },
  { pattern: /[\u0c80-\u0cff]/u, language: 'kn' },
  { pattern: /[\u0d00-\u0d7f]/u, language: 'ml' },
  { pattern: /[\u0a80-\u0aff]/u, language: 'gu' },
  { pattern: /[\u0e80-\u0eff]/u, language: 'lo' },
  { pattern: /[\u1780-\u17ff]/u, language: 'km' },
  { pattern: /[\u1000-\u109f]/u, language: 'my' },
  { pattern: /[\u0d80-\u0dff]/u, language: 'si' },
  { pattern: /[\u0370-\u03ff]/u, language: 'el' },
]

/**
 * Fold a reported code onto the supported list.
 *
 * Returns the supported code *as it is spelled there*, not the lowercased form
 * it was looked up by: the region and script subtags of `zh-Hans`, `zh-Hant`,
 * `pt-BR` and `pt-PT` are capitalised, and callers test the result against that
 * list. Returning `zh-hans` here made every one of those languages fail the
 * `isSupportedLanguageCode` check, so a code the API reported for them counted
 * as no language at all.
 */
function canonicalLanguageCode(code: string): string {
  const normalized = code.trim().replaceAll('_', '-').toLowerCase()
  const alias = languageAliases[normalized]
  if (alias) return alias

  const exact = languageByCode.get(normalized)
  if (exact) return exact.code

  const base = normalized.split('-')[0]
  const baseAlias = languageAliases[base]
  if (baseAlias) return baseAlias
  const baseMatch = languageByCode.get(base)
  if (baseMatch) return baseMatch.code

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
  if (a === b) return true

  // A generic code such as `pt` may stand for a regional variant, but two
  // explicit variants such as `pt-BR` and `pt-PT` must remain distinct.
  const leftIsGeneric = isGenericLanguageCode(left)
  const rightIsGeneric = isGenericLanguageCode(right)
  return (
    (leftIsGeneric || rightIsGeneric) &&
    a.split('-')[0] === b.split('-')[0]
  )
}

function isGenericLanguageCode(code: string): boolean {
  const normalized = code.trim().replaceAll('_', '-')
  return normalized.length > 0 && !normalized.includes('-')
}

export function isSupportedLanguageCode(
  code: string,
): code is SupportedLanguageCode {
  return supportedLanguages.some((language) => language.code === code)
}

export function isSourceLanguageCode(code: string): code is SourceLanguageCode {
  return code === AUTO_SOURCE_LANGUAGE || isSupportedLanguageCode(code)
}

/**
 * The writing system `text` is in, when it is one that narrows the language
 * down at all. Latin script is shared by too many languages to be a signal.
 */
function scriptOf(text: string) {
  return scriptLanguagePatterns.find((candidate) => candidate.pattern.test(text))
}

/** Whether `text` is written in a script that says anything about its language. */
export function textHasScriptEvidence(text: string): boolean {
  return scriptOf(text) !== undefined
}

/**
 * Whether the writing system of `text` can belong to `language`.
 *
 * Only ever used to *reject* a claim, never to make one: Latin text supports
 * every Latin-script language equally, so the answer there is always yes.
 * Incompatible non-Latin script is the evidence this check can reject.
 */
export function scriptSupportsLanguage(language: string, text: string): boolean {
  const script = scriptOf(text)
  if (!script) return true
  if (languageCodesMatch(script.language, language)) return true
  return Boolean(
    script.compatible?.some((candidate) => languageCodesMatch(candidate, language)),
  )
}

/**
 * Prefer an unambiguous writing-system signal over stale model metadata.
 * Live Translate can occasionally carry a Latin-language guess into the next
 * turn even when the finalized transcript is plainly Arabic, Han, Hangul, etc.
 * Script families shared by several supported languages are intentionally not
 * guessed here; the model's reported code remains authoritative for those.
 */
export function resolveTranscriptLanguage(
  reportedCode: string | undefined,
  text: string,
): SupportedLanguageCode | null {
  const canonical = canonicalLanguageCode(reportedCode ?? '')
  const reported = isSupportedLanguageCode(canonical) ? canonical : null
  for (const candidate of scriptLanguagePatterns) {
    if (!candidate.pattern.test(text)) continue
    if (reported && candidate.compatible?.includes(reported)) return reported
    return candidate.language
  }

  return reported
}

/**
 * System instruction for one route of an interpreter session.
 *
 * A route renders everything it hears into `targetLanguage`; the API has no
 * source-language field, so `sourceLanguage` is only the other language of the
 * conversation. It is named as context for recognition, deliberately without
 * telling the model to *expect* it: a route told to expect one language will
 * identify speech as that language even when it is not, which defeats
 * `echoTargetLanguage: false` and makes the route read the speaker's own words
 * back to them.
 *
 * Staying silent on target-language speech is restated here because it is how a
 * pair of routes divides one conversation between them.
 */
export function interpreterInstruction(
  sourceLanguage: SourceLanguageCode,
  targetLanguage: SupportedLanguageCode,
): string {
  const target = languageMetaFromCode(targetLanguage).label
  const pair =
    sourceLanguage === AUTO_SOURCE_LANGUAGE
      ? 'You are the interpreter for a live conversation.'
      : `You are the interpreter for a two-way conversation between ${languageMetaFromCode(sourceLanguage).label} and ${target} speakers.`

  return `${pair} Translate every utterance into ${target}. Identify the spoken language from the audio itself for each utterance, and never carry a previous language guess into a new turn. When the speaker is already speaking ${target}, stay silent and produce no audio.`
}

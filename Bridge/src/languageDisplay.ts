import { languageMetaFromCode } from './types'

/**
 * Presentation layer for languages: the accent color a language carries through
 * the interface (speaker identity, column accents, playback state) and the
 * name a language calls itself.
 */

/**
 * Curated accents for the languages Lingua is used with most. Every color must
 * stay legible as small text on the paper surface — accents are for identity,
 * not decoration.
 */
const LANGUAGE_ACCENTS: Record<string, string> = {
  bn: '#0e7a66', // Bengali — teal green
  en: '#38618f', // English — steel blue
  ur: '#0c6b4e', // Urdu — deep green
  ar: '#8a5a17', // Arabic — amber
  hi: '#b0522f', // Hindi — terracotta
  es: '#a5641f', // Spanish — ochre
  fr: '#4f5aa8', // French — indigo
  de: '#5f6a3a', // German — olive
  fa: '#7c4a6e', // Persian — plum
  ta: '#94314f', // Tamil — burgundy
}

/** Stable fallback for every other supported language. */
const ACCENT_PALETTE = [
  '#0e7a66',
  '#38618f',
  '#a5641f',
  '#7c4a6e',
  '#b0522f',
  '#4f5aa8',
  '#0f7b7c',
  '#94314f',
  '#5f6a3a',
  '#6d5a8f',
  '#2f6f8f',
  '#8a4b2f',
]

function hashCode(code: string): number {
  let hash = 0
  for (const character of code) hash += character.codePointAt(0) ?? 0
  return hash
}

/** The accent color identifying a language across the interface. */
export function languageColor(code: string): string {
  const base = languageMetaFromCode(code).code.toLowerCase().split('-')[0]
  return (
    LANGUAGE_ACCENTS[base] ??
    ACCENT_PALETTE[hashCode(base) % ACCENT_PALETTE.length]
  )
}

const nativeNameCache = new Map<string, string | null>()

/**
 * What a language calls itself, e.g. বাংলা for Bengali.
 *
 * Resolved through `Intl.DisplayNames` in the language's own locale rather
 * than a hand-maintained table. `null` when the native name adds nothing
 * (it matches the English label) or cannot be resolved.
 */
export function nativeLanguageName(code: string): string | null {
  const meta = languageMetaFromCode(code)
  if (!meta.htmlLang) return null

  const cached = nativeNameCache.get(meta.code)
  if (cached !== undefined) return cached

  let native: string | null = null
  try {
    const names = new Intl.DisplayNames([meta.htmlLang], { type: 'language' })
    const resolved = names.of(meta.htmlLang)
    if (resolved && resolved !== meta.label && resolved !== meta.htmlLang) {
      native = resolved
    }
  } catch {
    native = null
  }
  nativeNameCache.set(meta.code, native)
  return native
}

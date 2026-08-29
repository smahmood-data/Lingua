/**
 * Language visual identity.
 *
 * Every supported language maps deterministically to one accent from a small,
 * muted palette that sits comfortably on the warm paper surface. The mapping
 * never changes between sessions, so a language always looks like itself.
 * Only two accents are ever on screen together (a conversation pair), so the
 * pair helper nudges the second language when both would share one accent.
 *
 * Color is never the only signal: everywhere an accent appears, the language
 * is also named in text.
 */

export interface LanguageAccent {
  /** Palette slot, useful for tests and debugging. */
  id: string
  /** Text-safe on `--paper` (used for labels, dots, rings, bars). */
  strong: string
}

const PALETTE: readonly LanguageAccent[] = [
  { id: 'pine', strong: '#0c6b4e' },
  { id: 'indigo', strong: '#3d55a0' },
  { id: 'terracotta', strong: '#a8481f' },
  { id: 'plum', strong: '#7a4a6f' },
  { id: 'ochre', strong: '#7d610c' },
  { id: 'teal', strong: '#0d6e6a' },
  { id: 'slate', strong: '#4a6280' },
  { id: 'olive', strong: '#5a6a12' },
  { id: 'rust', strong: '#96382c' },
  { id: 'mauve', strong: '#7f527a' },
  { id: 'forest', strong: '#3a6631' },
  { id: 'clay', strong: '#8a5a34' },
  { id: 'cerulean', strong: '#2b6987' },
  { id: 'mulberry', strong: '#863254' },
]

/** Hand-placed accents for the languages most likely to share a screen. */
const CURATED: Record<string, string> = {
  en: 'slate',
  es: 'terracotta',
  bn: 'ochre',
  ur: 'pine',
  ar: 'teal',
  hi: 'rust',
  pa: 'clay',
  fr: 'indigo',
  de: 'forest',
  'pt-BR': 'olive',
  'pt-PT': 'mauve',
  ru: 'mulberry',
  ja: 'plum',
  ko: 'mauve',
  'zh-Hans': 'clay',
  'zh-Hant': 'terracotta',
  it: 'olive',
  tr: 'cerulean',
  fa: 'cerulean',
  vi: 'forest',
  th: 'plum',
  sw: 'ochre',
  nl: 'indigo',
  pl: 'rust',
  uk: 'slate',
  id: 'teal',
}

/** Auto mode before detection: a quiet neutral, not an error color. */
export const AUTO_ACCENT: LanguageAccent = { id: 'auto', strong: '#6a756e' }

const BY_ID = new Map(PALETTE.map((accent) => [accent.id, accent]))

function hashCode(code: string): number {
  let hash = 0
  for (const character of code) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 9973
  }
  return hash
}

/** The accent one language always gets, curated or derived from its code. */
export function languageAccent(code: string): LanguageAccent {
  const curated = CURATED[code] ?? CURATED[code.split('-')[0]]
  if (curated) return BY_ID.get(curated) ?? PALETTE[0]
  return PALETTE[hashCode(code.toLowerCase()) % PALETTE.length]
}

/**
 * The two accents of a conversation pair. When both languages would share one
 * accent, the second moves to the next palette slot so the two sides of a
 * conversation are always distinguishable.
 */
export function languagePairAccents(
  first: string,
  second: string,
): [LanguageAccent, LanguageAccent] {
  const a = languageAccent(first)
  const b = languageAccent(second)
  if (a.id !== b.id) return [a, b]
  const index = PALETTE.findIndex((accent) => accent.id === b.id)
  return [a, PALETTE[(index + 1) % PALETTE.length]]
}

/**
 * Blend two hex colors. Used for the waveform gradient that travels from the
 * spoken language toward the language being rendered.
 */
export function mixAccents(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
  const [r1, g1, b1] = parse(from)
  const [r2, g2, b2] = parse(to)
  const channel = (a: number, b: number) =>
    Math.round(a + (b - a) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`
}

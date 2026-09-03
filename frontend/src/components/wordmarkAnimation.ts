export const WORDMARK_STAGES = [
  { text: 'Lingua', lang: 'en' },
  { text: 'Lengua', lang: 'es' },
  { text: '语言', lang: 'zh-Hans' },
  { text: 'भाषा', lang: 'hi' },
  { text: 'لغة', lang: 'ar' },
] as const

export const WORDMARK_TIMING = {
  typeMs: 64,
  deleteMs: 44,
  holdMs: 240,
  transitionMs: 90,
} as const

/** Split text into user-perceived characters so Indic marks stay attached. */
export function splitGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), ({ segment }) => segment)
  }

  const graphemes: string[] = []
  for (const character of Array.from(text)) {
    if (graphemes.length > 0 && /^\p{Mark}$/u.test(character)) {
      graphemes[graphemes.length - 1] += character
    } else {
      graphemes.push(character)
    }
  }
  return graphemes
}

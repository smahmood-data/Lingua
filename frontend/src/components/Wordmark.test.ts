import { describe, expect, it } from 'vitest'
import {
  splitGraphemes,
  WORDMARK_STAGES,
  WORDMARK_TIMING,
} from './wordmarkAnimation'

describe('idle wordmark animation', () => {
  it('uses authentic language wording and scripts', () => {
    expect(WORDMARK_STAGES).toEqual([
      { text: 'Lingua', lang: 'en' },
      { text: 'Lengua', lang: 'es' },
      { text: '语言', lang: 'zh-Hans' },
      { text: 'भाषा', lang: 'hi' },
      { text: 'لغة', lang: 'ar' },
    ])
  })

  it('deletes graphemes rather than splitting Hindi marks', () => {
    expect(splitGraphemes('भाषा')).toEqual(['भा', 'षा'])
    expect(splitGraphemes('语言')).toEqual(['语', '言'])
    expect(splitGraphemes('لغة')).toEqual(['ل', 'غ', 'ة'])
  })

  it('keeps the sequence brief', () => {
    const characterTime = WORDMARK_STAGES.reduce((total, stage) => {
      const characterCount = splitGraphemes(stage.text).length
      return (
        total +
        characterCount *
          (WORDMARK_TIMING.typeMs + WORDMARK_TIMING.deleteMs)
      )
    }, 0)
    const holds = WORDMARK_STAGES.length * WORDMARK_TIMING.holdMs
    const transitions =
      (WORDMARK_STAGES.length - 1) * WORDMARK_TIMING.transitionMs

    expect(characterTime + holds + transitions).toBeLessThan(4_000)
  })
})

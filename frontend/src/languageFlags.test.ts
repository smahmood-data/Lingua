import { describe, expect, it } from 'vitest'
import { flagForLanguage } from './languageFlags'
import { supportedLanguages } from './types'

describe('language flags', () => {
  it('maps every supported language to an inline flag', () => {
    const unmapped = supportedLanguages
      .filter(({ code }) => flagForLanguage(code) === null)
      .map(({ label }) => label)

    expect(unmapped).toEqual([])
  })

  it('keeps non-language options on the neutral fallback', () => {
    expect(flagForLanguage('auto')).toBeNull()
  })
})

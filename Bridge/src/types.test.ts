import { describe, expect, it } from 'vitest'
import {
  languageCodesMatch,
  supportedLanguages,
} from './types'

describe('language code helpers', () => {
  it('keeps explicit regional and script variants distinct', () => {
    expect(languageCodesMatch('pt-BR', 'pt-PT')).toBe(false)
    expect(languageCodesMatch('zh-Hans', 'zh-Hant')).toBe(false)
  })

  it('allows a generic code to match a specific variant', () => {
    expect(languageCodesMatch('pt', 'pt-BR')).toBe(true)
    expect(languageCodesMatch('zh', 'zh-Hant')).toBe(true)
  })

  it('includes Norwegian Bokmål', () => {
    expect(
      supportedLanguages.some(
        (language) => language.code === 'nb' && language.label === 'Norwegian Bokmål',
      ),
    ).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  AUTO_ACCENT,
  languageAccent,
  languagePairAccents,
  mixAccents,
} from './languageAccents'
import { supportedLanguages } from './types'

describe('languageAccent', () => {
  it('is deterministic: a language always gets the same accent', () => {
    expect(languageAccent('bn')).toEqual(languageAccent('bn'))
    expect(languageAccent('zh-Hans')).toEqual(languageAccent('zh-Hans'))
  })

  it('covers every supported language with a real accent', () => {
    for (const language of supportedLanguages) {
      const accent = languageAccent(language.code)
      expect(accent.strong).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('keeps the flagship pairs visually distinct', () => {
    const pairs: [string, string][] = [
      ['en', 'bn'],
      ['en', 'es'],
      ['en', 'ur'],
      ['bn', 'ur'],
      ['es', 'en'],
    ]
    for (const [a, b] of pairs) {
      const [accentA, accentB] = languagePairAccents(a, b)
      expect(accentA.id).not.toBe(accentB.id)
    }
  })

  it('nudges the second accent when a pair would collide', () => {
    const colliding = languageAccent('it')
    const [a, b] = languagePairAccents('it', 'it')
    expect(a.id).toBe(colliding.id)
    expect(b.id).not.toBe(a.id)
  })

  it('keeps Auto visually neutral', () => {
    expect(AUTO_ACCENT.id).toBe('auto')
  })
})

describe('mixAccents', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(mixAccents('#0c6b4e', '#a8481f', 0)).toBe('#0c6b4e')
    expect(mixAccents('#0c6b4e', '#a8481f', 1)).toBe('#a8481f')
  })

  it('blends halfway', () => {
    expect(mixAccents('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

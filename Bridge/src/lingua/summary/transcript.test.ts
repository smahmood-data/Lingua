import { describe, expect, it } from 'vitest'
import { appendTurn, createTurn, hasSpokenContent, toRequestTurns } from './transcript.ts'

describe('appendTurn', () => {
  it('appends a spoken turn without mutating the previous array', () => {
    const before = [createTurn({ speaker: 'user', original: 'Hello' })]
    const after = appendTurn(before, createTurn({ speaker: 'other', original: 'Hi' }))

    expect(before).toHaveLength(1)
    expect(after).toHaveLength(2)
  })

  it.each(['', '   ', '\n\t'])('drops a turn whose speech is %j', (original) => {
    const turns = appendTurn([], createTurn({ speaker: 'user', original }))
    expect(turns).toEqual([])
  })

  it('gives every turn a distinct id', () => {
    const ids = [
      createTurn({ speaker: 'user', original: 'a' }).id,
      createTurn({ speaker: 'user', original: 'b' }).id,
    ]
    expect(new Set(ids).size).toBe(2)
  })
})

describe('hasSpokenContent', () => {
  it('is false for an empty or silent transcript', () => {
    expect(hasSpokenContent([])).toBe(false)
    expect(hasSpokenContent([createTurn({ speaker: 'user', original: '  ' })])).toBe(false)
  })

  it('is true once somebody spoke', () => {
    expect(hasSpokenContent([createTurn({ speaker: 'user', original: 'Hello' })])).toBe(true)
  })
})

describe('toRequestTurns', () => {
  it('strips the client-only id and defaults a missing translation', () => {
    expect(toRequestTurns([createTurn({ speaker: 'user', original: 'Hello' })])).toEqual([
      { speaker: 'user', original: 'Hello', translated: '' },
    ])
  })
})

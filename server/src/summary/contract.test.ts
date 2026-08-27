import { describe, expect, it } from 'vitest'
import {
  conversationSummarySchema,
  geminiResponseSchema,
  hasSpokenContent,
  normalizeSummary,
  summarizeRequestSchema,
} from './contract.ts'

describe('summarizeRequestSchema', () => {
  it('accepts a transcript and defaults a missing translation to empty', () => {
    const result = summarizeRequestSchema.safeParse({
      readingLanguage: 'ur',
      turns: [{ speaker: 'user', original: 'کیا مجھے کچھ لانا ہوگا؟' }],
    })

    expect(result.success).toBe(true)
    expect(result.data?.turns[0]?.translated).toBe('')
  })

  it('rejects an unknown speaker', () => {
    const result = summarizeRequestSchema.safeParse({
      readingLanguage: 'ur',
      turns: [{ speaker: 'receptionist', original: 'Hello' }],
    })

    expect(result.success).toBe(false)
  })
})

describe('hasSpokenContent', () => {
  it('is false for no turns and for whitespace-only turns', () => {
    expect(hasSpokenContent([])).toBe(false)
    expect(hasSpokenContent([{ speaker: 'user', original: '   ', translated: '' }])).toBe(false)
  })

  it('is true once somebody actually spoke', () => {
    expect(hasSpokenContent([{ speaker: 'user', original: 'Hello', translated: '' }])).toBe(true)
  })
})

describe('conversationSummarySchema', () => {
  it('turns absent and null categories into empty arrays', () => {
    const result = conversationSummarySchema.safeParse({
      summary: 'Appointment confirmed.',
      appointments: ['September 12 at 3:30 PM'],
      deadlines: null,
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      summary: 'Appointment confirmed.',
      appointments: ['September 12 at 3:30 PM'],
      deadlines: [],
      instructions: [],
      locations: [],
      requiredDocuments: [],
      decisions: [],
      clarifications: [],
    })
  })

  it('rejects a category that is not an array of strings', () => {
    const result = conversationSummarySchema.safeParse({
      summary: 'Appointment confirmed.',
      appointments: [{ date: 'September 12' }],
    })

    expect(result.success).toBe(false)
  })

  it('rejects a non-object response', () => {
    expect(conversationSummarySchema.safeParse('Appointment confirmed.').success).toBe(false)
  })
})

describe('normalizeSummary', () => {
  it('trims entries and drops blanks and case-insensitive duplicates', () => {
    const normalized = normalizeSummary({
      summary: '  Bring your documents.  ',
      appointments: [],
      deadlines: [],
      instructions: [],
      locations: [],
      requiredDocuments: ['  insurance card ', 'Insurance Card', '', 'photo ID'],
      decisions: [],
      clarifications: [],
    })

    expect(normalized.summary).toBe('Bring your documents.')
    expect(normalized.requiredDocuments).toEqual(['insurance card', 'photo ID'])
  })
})

describe('geminiResponseSchema', () => {
  it('describes every category and omits keywords Gemini rejects', () => {
    const schema = geminiResponseSchema()
    const serialized = JSON.stringify(schema)

    expect(schema['type']).toBe('object')
    expect(Object.keys(schema['properties'] as object)).toEqual([
      'summary',
      'appointments',
      'deadlines',
      'instructions',
      'locations',
      'requiredDocuments',
      'decisions',
      'clarifications',
    ])
    expect(serialized).not.toContain('$schema')
    expect(serialized).not.toContain('additionalProperties')
  })
})

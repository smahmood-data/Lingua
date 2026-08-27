import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SummaryError, createGeminiSummarizer, parseSummaryResponse } from './summarize.ts'
import type { SummarizeRequest } from './contract.ts'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = { create }
  },
}))

const VALID = JSON.stringify({
  summary: 'Appointment confirmed for September 12.',
  appointments: ['September 12 at 3:30 PM'],
  requiredDocuments: ['insurance card', 'photo ID'],
})

describe('parseSummaryResponse', () => {
  it('validates and fills in the categories the model omitted', () => {
    const summary = parseSummaryResponse(VALID)

    expect(summary.appointments).toEqual(['September 12 at 3:30 PM'])
    expect(summary.requiredDocuments).toEqual(['insurance card', 'photo ID'])
    expect(summary.decisions).toEqual([])
    expect(summary.clarifications).toEqual([])
  })

  it.each([
    ['undefined output', undefined],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['prose instead of JSON', 'I could not summarise that conversation.'],
    ['truncated JSON', '{"summary": "Appointment con'],
    ['a JSON array', '[]'],
    ['a category of objects', '{"summary":"ok","appointments":[{"date":"Sept 12"}]}'],
  ])('rejects %s as invalid model output', (_label, raw) => {
    expect(() => parseSummaryResponse(raw)).toThrowError(
      expect.objectContaining({ code: 'invalid_model_output' }),
    )
  })

  it('reports the offending field so the failure is debuggable', () => {
    try {
      parseSummaryResponse('{"summary":"ok","appointments":[1]}')
      expect.unreachable('expected a SummaryError')
    } catch (error) {
      expect(error).toBeInstanceOf(SummaryError)
      expect((error as SummaryError).message).toContain('appointments')
    }
  })
})

const REQUEST: SummarizeRequest = {
  readingLanguage: 'ur',
  turns: [{ speaker: 'other', original: 'Arrive at 3:15 PM.', translated: '' }],
}

describe('createGeminiSummarizer', () => {
  beforeEach(() => create.mockReset())

  const summarizer = () => createGeminiSummarizer({ apiKey: 'test-key', model: 'test-model' })

  it('returns the normalised summary of a completed interaction', async () => {
    create.mockResolvedValue({ status: 'completed', output_text: VALID })

    await expect(summarizer()(REQUEST)).resolves.toMatchObject({
      appointments: ['September 12 at 3:30 PM'],
      decisions: [],
    })
  })

  /**
   * Without a deadline the SDK retries a rate-limited call with backoff for
   * minutes while the browser holds the request open and the summary screen
   * sits on a spinner that has no other way out.
   */
  it('bounds the call with a timeout and a retry cap', async () => {
    create.mockResolvedValue({ status: 'completed', output_text: VALID })

    await summarizer()(REQUEST)

    expect(create.mock.calls[0]?.[1]).toEqual({
      timeout: expect.any(Number),
      maxRetries: expect.any(Number),
    })
    expect(create.mock.calls[0]?.[1].timeout).toBeGreaterThan(0)
  })

  it('honours an explicit timeout', async () => {
    create.mockResolvedValue({ status: 'completed', output_text: VALID })

    await createGeminiSummarizer({ apiKey: 'k', model: 'm', timeoutMs: 1234 })(REQUEST)

    expect(create.mock.calls[0]?.[1].timeout).toBe(1234)
  })

  it.each(['incomplete', 'failed', 'cancelled', 'budget_exceeded'])(
    'refuses the partial text of a %s interaction',
    async (status) => {
      create.mockResolvedValue({ status, output_text: VALID })

      await expect(summarizer()(REQUEST)).rejects.toThrowError(
        expect.objectContaining({ code: 'invalid_model_output' }),
      )
    },
  )
})

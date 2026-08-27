import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { emptySummary } from './contract.ts'
import { createSummaryRouter } from './route.ts'
import { SummaryError, type Summarizer } from './summarize.ts'

function appWith(summarize: Summarizer) {
  const app = express()
  app.use(express.json())
  app.use('/api', createSummaryRouter(summarize))
  return app
}

const SPOKEN = {
  readingLanguage: 'ur',
  turns: [
    { speaker: 'other', original: 'Your appointment is September 12 at 3:30 PM.', translated: '...' },
  ],
}

describe('POST /api/summarize', () => {
  it('returns the validated summary for a real transcript', async () => {
    const summarize = vi.fn(async () => ({
      ...emptySummary(),
      appointments: ['September 12 at 3:30 PM'],
    }))

    const response = await request(appWith(summarize)).post('/api/summarize').send(SPOKEN)

    expect(response.status).toBe(200)
    expect(response.body.appointments).toEqual(['September 12 at 3:30 PM'])
    expect(response.body.decisions).toEqual([])
    expect(summarize).toHaveBeenCalledOnce()
  })

  it('rejects a malformed payload without calling Gemini', async () => {
    const summarize = vi.fn<Summarizer>()

    const response = await request(appWith(summarize))
      .post('/api/summarize')
      .send({ readingLanguage: 'ur' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invalid_request')
    expect(summarize).not.toHaveBeenCalled()
  })

  it.each([
    ['no turns', []],
    ['whitespace-only turns', [{ speaker: 'user', original: '  ', translated: '' }]],
  ])('answers empty_transcript for %s without calling Gemini', async (_label, turns) => {
    const summarize = vi.fn<Summarizer>()

    const response = await request(appWith(summarize))
      .post('/api/summarize')
      .send({ readingLanguage: 'ur', turns })

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('empty_transcript')
    expect(summarize).not.toHaveBeenCalled()
  })

  it.each(['upstream_unavailable', 'invalid_model_output'] as const)(
    'surfaces a %s failure as a 502 with that code',
    async (code) => {
      const summarize = vi.fn<Summarizer>().mockRejectedValue(new SummaryError(code, 'nope'))

      const response = await request(appWith(summarize)).post('/api/summarize').send(SPOKEN)

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe(code)
    },
  )

  /**
   * A 502 tells the client only that Gemini let us down. Without a log there
   * is nothing anywhere that says why, which is the worst possible position
   * to be in when the demo fails.
   */
  it('logs why the summary failed while telling the client only the code', async () => {
    const summarize = vi
      .fn<Summarizer>()
      .mockRejectedValue(
        new SummaryError('upstream_unavailable', 'Gemini did not return a summary.', '429 quota exceeded'),
      )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(appWith(summarize)).post('/api/summarize').send(SPOKEN)

    expect(response.status).toBe(502)
    const logged = consoleError.mock.calls.flat().join(' ')
    expect(logged).toContain('upstream_unavailable')
    expect(logged).toContain('429 quota exceeded')
    // The operator gets the reason; the wire does not.
    expect(JSON.stringify(response.body)).not.toContain('429')
    consoleError.mockRestore()
  })

  it('never puts the transcript in a log line', async () => {
    const summarize = vi
      .fn<Summarizer>()
      .mockRejectedValue(new SummaryError('upstream_unavailable', 'Gemini did not return a summary.', 'ETIMEDOUT'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await request(appWith(summarize)).post('/api/summarize').send(SPOKEN)

    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('September 12')
    consoleError.mockRestore()
  })

  it('does not leak an unexpected error to the client', async () => {
    const summarize = vi
      .fn<Summarizer>()
      .mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:443 apiKey=secret'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await request(appWith(summarize)).post('/api/summarize').send(SPOKEN)

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('internal_error')
    expect(JSON.stringify(response.body)).not.toContain('secret')
    consoleError.mockRestore()
  })
})

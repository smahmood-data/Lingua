import { describe, expect, it, vi } from 'vitest'
import { parseSummaryPayload, requestSummary } from './summaryClient.ts'
import { createTurn } from './transcript.ts'
import { emptySummary } from './types.ts'

const TURNS = [createTurn({ speaker: 'other', original: 'Arrive at 3:15 PM.' })]

function respondWith(body: unknown, init: { status?: number; json?: boolean } = {}) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    ({
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      json: async () => {
        if (init.json === false) throw new SyntaxError('Unexpected token < in JSON')
        return body
      },
    }) as unknown as Response,
  )
}

describe('parseSummaryPayload', () => {
  it('accepts the full contract', () => {
    expect(parseSummaryPayload({ ...emptySummary(), summary: 'ok' })).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'ok'],
    ['a missing summary', { ...emptySummary(), summary: undefined }],
    ['a missing category', { summary: 'ok' }],
    ['a category that is not an array', { ...emptySummary(), appointments: 'September 12' }],
    ['a category holding non-strings', { ...emptySummary(), appointments: [12] }],
  ])('rejects %s', (_label, payload) => {
    expect(parseSummaryPayload(payload)).toBeNull()
  })
})

describe('requestSummary', () => {
  it('posts the transcript and returns the summary', async () => {
    const fetchImpl = respondWith({ ...emptySummary(), appointments: ['September 12'] })

    const result = await requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl })

    expect(result).toEqual({
      ok: true,
      summary: { ...emptySummary(), appointments: ['September 12'] },
    })

    const [, init] = fetchImpl.mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toEqual({
      readingLanguage: 'ur',
      turns: [{ speaker: 'other', original: 'Arrive at 3:15 PM.', translated: '' }],
    })
  })

  it.each([
    ['empty_transcript', 422],
    ['invalid_model_output', 502],
    ['upstream_unavailable', 502],
    ['internal_error', 500],
  ] as const)('passes through the %s error code', async (code, status) => {
    const fetchImpl = respondWith({ error: { code, message: 'nope' } }, { status })

    expect(await requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl })).toEqual({
      ok: false,
      code,
    })
  })

  it('reports an unrecognised error code as malformed_response', async () => {
    const fetchImpl = respondWith({ error: { code: 'teapot' } }, { status: 418 })

    expect(await requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl })).toEqual({
      ok: false,
      code: 'malformed_response',
    })
  })

  it('reports a non-JSON error page as malformed_response', async () => {
    const fetchImpl = respondWith(null, { status: 502, json: false })

    expect(await requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl })).toEqual({
      ok: false,
      code: 'malformed_response',
    })
  })

  it('reports a 200 that does not match the contract as malformed_response', async () => {
    const fetchImpl = respondWith({ summary: 'ok' })

    expect(await requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl })).toEqual({
      ok: false,
      code: 'malformed_response',
    })
  })

  it('reports a failed request as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    expect(await requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl })).toEqual({
      ok: false,
      code: 'network_error',
    })
  })

  it('passes through the payload_too_large error code', async () => {
    const fetchImpl = respondWith({ error: { code: 'payload_too_large' } }, { status: 413 })

    expect(await requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl })).toEqual({
      ok: false,
      code: 'payload_too_large',
    })
  })

  /**
   * Without this the summary screen has no way out of `loading`: a stalled or
   * rate-limited upstream simply never answers.
   */
  it('gives up on a request that never answers', async () => {
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )

    expect(
      await requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl, timeoutMs: 20 }),
    ).toEqual({ ok: false, code: 'timeout' })
  })

  it('still rethrows a caller cancellation rather than reporting a timeout', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )

    const pending = requestSummary(
      { readingLanguage: 'ur', turns: TURNS },
      { fetchImpl, signal: controller.signal, timeoutMs: 10_000 },
    )
    controller.abort()

    await expect(pending).rejects.toThrowError(DOMException)
  })

  it('rethrows a cancellation so it is not shown as a failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    await expect(
      requestSummary({ readingLanguage: 'ur', turns: TURNS }, { fetchImpl }),
    ).rejects.toThrowError(DOMException)
  })
})

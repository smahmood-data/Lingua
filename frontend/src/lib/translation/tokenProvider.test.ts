import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLiveTokenProvider } from './tokenProvider'

const request = {
  signal: new AbortController().signal,
  sourceLanguage: 'en' as const,
  targetLanguage: 'fr' as const,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('live token protection errors', () => {
  it('surfaces a rate limit with the server retry delay', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'live_token_rate_limited',
          retryAfterSeconds: 275,
        }),
        { status: 429, headers: { 'Retry-After': '275' } },
      ),
    )

    await expect(createLiveTokenProvider()(request)).rejects.toEqual({
      code: 'token-rate-limited',
      message:
        'This network has started too many live sessions. Try again in 5 minutes.',
      recoverable: true,
      retryAfterSeconds: 275,
    })
  })

  it('distinguishes missing and temporarily unavailable protection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'live_token_protection_not_configured' }),
        { status: 503 },
      ),
    )

    await expect(createLiveTokenProvider()(request)).rejects.toEqual({
      code: 'token-protection-not-configured',
      message:
        'Live sessions are unavailable because abuse protection is not configured. Contact the site owner.',
      recoverable: false,
    })

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'live_token_protection_unavailable' }),
        { status: 503, headers: { 'Retry-After': '30' } },
      ),
    )

    await expect(createLiveTokenProvider()(request)).rejects.toEqual({
      code: 'token-protection-unavailable',
      message:
        'Live-session protection could not be checked. Try again in 30 seconds.',
      recoverable: true,
      retryAfterSeconds: 30,
    })
  })

  it('keeps upstream throttling safe while preserving retry guidance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'live_token_upstream_rate_limited',
          message: 'private provider details',
        }),
        { status: 429, headers: { 'Retry-After': '17' } },
      ),
    )

    await expect(createLiveTokenProvider()(request)).rejects.toEqual({
      code: 'token-request-failed',
      message:
        'Live-token creation is temporarily rate-limited. Try again in 17 seconds.',
      recoverable: true,
      retryAfterSeconds: 17,
    })

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'live_token_upstream_unavailable' }),
        { status: 503 },
      ),
    )

    await expect(createLiveTokenProvider()(request)).rejects.toEqual({
      code: 'token-request-failed',
      message:
        'Live-token creation is temporarily unavailable. Try again later.',
      recoverable: true,
    })
  })

  it('does not expose unrecognised server errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'private upstream details',
          retryAfterSeconds: 600,
        }),
        { status: 503 },
      ),
    )

    await expect(createLiveTokenProvider()(request)).rejects.toMatchObject({
      code: 'token-request-failed',
      message: expect.not.stringContaining('private upstream details'),
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  END_OF_SPEECH_SENSITIVITY,
  END_OF_SPEECH_SILENCE_MS,
} from '../src/lib/translation/config.js'

const { checkRateLimitMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
}))

vi.mock('@vercel/firewall', () => ({
  checkRateLimit: checkRateLimitMock,
}))

class TestResponse {
  statusCode = 200
  body: unknown
  headers = new Map<string, string>()

  setHeader(name: string, value: string) {
    this.headers.set(name, value)
  }

  status(statusCode: number) {
    this.statusCode = statusCode
    return this
  }

  json(body: unknown) {
    this.body = body
  }
}

describe('Vercel live-token function', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-server-key')
    vi.stubEnv('LIVE_TOKEN_RATE_LIMIT_ID', 'lingua-live-token')
    vi.stubEnv('LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS', '600')
    checkRateLimitMock.mockReset()
    checkRateLimitMock.mockResolvedValue({ rateLimited: false })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('validates target languages without calling Gemini', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { default: handler } = await import('./live-token.js')
    const response = new TestResponse()

    await handler(
      { method: 'GET', query: { target: 'not-supported' } },
      response,
    )

    expect(response.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the long-lived key required on the server', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { default: handler } = await import('./live-token.js')
    const response = new TestResponse()

    await handler(
      { method: 'GET', query: { source: 'en', target: 'fr' } },
      response,
    )

    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual({
      error: 'Configuration Error',
      message: 'GEMINI_API_KEY is not configured on the server.',
    })
    expect(checkRateLimitMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid and identical source languages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { default: handler } = await import('./live-token.js')

    for (const query of [
      { source: 'not-supported', target: 'en' },
      { source: 'en', target: 'en' },
    ]) {
      const response = new TestResponse()
      await handler({ method: 'GET', query }, response)
      expect(response.statusCode).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mints a constrained token for the selected target', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'auth_tokens/test-token',
          expireTime: '2026-08-28T02:00:00.000Z',
          newSessionExpireTime: '2026-08-28T01:31:00.000Z',
        }),
        { status: 200 },
      ),
    )
    const { default: handler } = await import('./live-token.js')
    const response = new TestResponse()

    await handler(
      {
        method: 'GET',
        query: { source: 'en', target: 'fr' },
        headers: {
          host: 'lingua.example',
          'x-real-ip': '203.0.113.10',
        },
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      token: 'auth_tokens/test-token',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      systemInstruction: expect.stringContaining('English'),
    })
    expect(checkRateLimitMock).toHaveBeenCalledWith('lingua-live-token', {
      headers: {
        host: 'lingua.example',
        'x-real-ip': '203.0.113.10',
      },
    })
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body))
    expect(body).toMatchObject({
      uses: 1,
      bidiGenerateContentSetup: {
        model: 'models/gemini-3.5-live-translate-preview',
        generationConfig: {
          responseModalities: ['AUDIO'],
        },
      },
    })
    expect(body.bidiGenerateContentSetup.generationConfig).toMatchObject({
      translationConfig: {
        targetLanguageCode: 'fr',
        echoTargetLanguage: false,
      },
    })
    expect(body.bidiGenerateContentSetup).toMatchObject({
      systemInstruction: {
        parts: [{ text: expect.stringContaining('French') }],
      },
      realtimeInputConfig: {
        automaticActivityDetection: {
          // A token constrains the session setup, so the endpointing the
          // browser asks for only takes effect if the token agrees.
          endOfSpeechSensitivity: END_OF_SPEECH_SENSITIVITY,
          silenceDurationMs: END_OF_SPEECH_SILENCE_MS,
        },
      },
    })
  })

  it('bounds repeated creation with a safe retryable response', async () => {
    checkRateLimitMock
      .mockResolvedValueOnce({ rateLimited: false })
      .mockResolvedValueOnce({ rateLimited: false })
      .mockResolvedValueOnce({ rateLimited: true })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ name: 'auth_tokens/test-token' }), {
          status: 200,
        }),
    )
    const { default: handler } = await import('./live-token.js')
    const responses = [new TestResponse(), new TestResponse(), new TestResponse()]

    for (const response of responses) {
      await handler(
        { method: 'GET', query: { source: 'en', target: 'fr' } },
        response,
      )
    }

    expect(responses.map((response) => response.statusCode)).toEqual([
      200,
      200,
      429,
    ])
    expect(responses[2]?.headers.get('Retry-After')).toBe('600')
    expect(responses[2]?.body).toEqual({
      error: 'Live Session Limit Reached',
      code: 'live_token_rate_limited',
      message:
        'This network has started too many live sessions. Try again in 10 minutes.',
      retryable: true,
      retryAfterSeconds: 600,
    })
    expect(JSON.stringify(responses[2]?.body)).not.toContain('test-server-key')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('explains when the protection rule is not configured', async () => {
    checkRateLimitMock.mockResolvedValue({
      rateLimited: false,
      error: 'not-found',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { default: handler } = await import('./live-token.js')
    const response = new TestResponse()

    await handler(
      { method: 'GET', query: { source: 'en', target: 'fr' } },
      response,
    )

    expect(response.statusCode).toBe(503)
    expect(response.headers.get('Retry-After')).toBeUndefined()
    expect(response.body).toEqual({
      error: 'Live Session Protection Error',
      code: 'live_token_protection_not_configured',
      message:
        'Live sessions are unavailable because abuse protection is not configured. Contact the site owner.',
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed with retry guidance when protection cannot be checked', async () => {
    checkRateLimitMock.mockResolvedValueOnce({
      rateLimited: true,
      error: 'blocked',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { default: handler } = await import('./live-token.js')
    const responses = [new TestResponse(), new TestResponse()]

    await handler(
      { method: 'GET', query: { source: 'en', target: 'fr' } },
      responses[0]!,
    )
    checkRateLimitMock.mockRejectedValue(new Error('firewall unavailable'))
    await handler(
      { method: 'GET', query: { source: 'en', target: 'fr' } },
      responses[1]!,
    )

    for (const response of responses) {
      expect(response.statusCode).toBe(503)
      expect(response.headers.get('Retry-After')).toBe('30')
      expect(response.body).toEqual({
        error: 'Live Session Protection Unavailable',
        code: 'live_token_protection_unavailable',
        message:
          'Live-session protection could not be checked. Try again in 30 seconds.',
        retryable: true,
        retryAfterSeconds: 30,
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts Norwegian Bokmål as a target language', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ name: 'auth_tokens/test-token' }),
        { status: 200 },
      ),
    )
    const { default: handler } = await import('./live-token.js')
    const response = new TestResponse()

    await handler(
      { method: 'GET', query: { source: 'en', target: 'nb' } },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'nb',
    })
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body))
    expect(
      body.bidiGenerateContentSetup.generationConfig.translationConfig
        .targetLanguageCode,
    ).toBe('nb')
  })
})

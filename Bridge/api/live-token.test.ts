import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

    await handler({ method: 'GET', query: { target: 'fr' } }, response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      token: 'auth_tokens/test-token',
      targetLanguage: 'fr',
    })
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body))
    expect(body.bidiGenerateContentSetup.generationConfig).toMatchObject({
      translationConfig: {
        targetLanguageCode: 'fr',
        echoTargetLanguage: false,
      },
    })
  })
})

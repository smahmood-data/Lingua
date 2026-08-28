import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  END_OF_SPEECH_SENSITIVITY,
  END_OF_SPEECH_SILENCE_MS,
} from '../src/lib/translation/config.js'

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
      { method: 'GET', query: { source: 'en', target: 'fr' } },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      token: 'auth_tokens/test-token',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      systemInstruction: expect.stringContaining('English'),
    })
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body))
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
})

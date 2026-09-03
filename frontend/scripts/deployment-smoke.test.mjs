import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  runDeploymentSmoke,
  validateLiveTokenResponse,
} from './deployment-smoke.mjs'

const now = Date.parse('2026-08-30T20:00:00.000Z')

function tokenBody(overrides = {}) {
  return {
    token: 'auth_tokens/test-ephemeral-token',
    expiresAt: '2026-08-30T20:30:00.000Z',
    newSessionExpiresAt: '2026-08-30T20:01:00.000Z',
    model: 'gemini-3.5-live-translate-preview',
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    systemInstruction: 'Translate into English.',
    ...overrides,
  }
}

describe('deployment smoke', () => {
  it('validates the homepage and token without returning the token value', async () => {
    const fetchImpl = async (url) => {
      if (new URL(url).pathname === '/') {
        return new Response('<div id="root"></div>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      return new Response(JSON.stringify(tokenBody()), {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
        },
      })
    }

    const result = await runDeploymentSmoke('https://lingua.example', {
      fetchImpl,
      now,
    })

    expect(result).toMatchObject({
      origin: 'https://lingua.example',
      homepageStatus: 200,
      tokenStatus: 200,
      sourceLanguage: 'auto',
      targetLanguage: 'en',
    })
    expect(JSON.stringify(result)).not.toContain('test-ephemeral-token')
  })

  it('rejects unexpected response fields and expired tokens', () => {
    expect(() =>
      validateLiveTokenResponse(tokenBody({ privateKey: 'must-not-pass' }), now),
    ).toThrow('unexpected field set')
    expect(() =>
      validateLiveTokenResponse(
        tokenBody({ expiresAt: '2026-08-30T19:59:00.000Z' }),
        now,
      ),
    ).toThrow('invalid expiry bounds')
  })

  it('reports only recognised safe fields from endpoint failures', async () => {
    const fetchImpl = async (url) => {
      if (new URL(url).pathname === '/') {
        return new Response('<div id="root"></div>', {
          headers: { 'Content-Type': 'text/html' },
        })
      }
      return new Response(
        JSON.stringify({
          error: 'Configuration Error',
          message: 'GEMINI_API_KEY is not configured on the server.',
          privateDetail: 'do-not-print-this-value',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const smoke = runDeploymentSmoke('https://lingua.example', {
      fetchImpl,
      now,
    })
    await expect(smoke).rejects.toThrow(
      'GEMINI_API_KEY is not configured on the server.',
    )
    await expect(smoke).rejects.not.toThrow('do-not-print-this-value')
  })

  it('pins the repository-owned Vercel build contract', async () => {
    const config = JSON.parse(
      await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    )
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    )

    expect(config).toEqual({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: 'vite',
      installCommand: 'npm ci',
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
    })
    expect(packageJson.engines).toEqual({ node: '24.x' })
  })
})

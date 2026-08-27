import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { emptySummary } from './summary/contract.ts'
import type { Summarizer } from './summary/summarize.ts'

const app = () =>
  createApp({
    clientOrigin: 'http://localhost:5173',
    summarize: vi.fn<Summarizer>(async () => emptySummary()),
  })

describe('createApp', () => {
  it('answers the health check', async () => {
    const response = await request(app()).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
  })

  /**
   * Body-parser rejections happen before any route, so without the error
   * handler they came back as an HTML page carrying a stack trace and server
   * filesystem paths, and the client could only read them as "malformed".
   */
  it('answers malformed JSON with the JSON error contract', async () => {
    const response = await request(app())
      .post('/api/summarize')
      .set('Content-Type', 'application/json')
      .send('{"turns": ')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invalid_request')
    expect(response.headers['content-type']).toMatch(/application\/json/)
  })

  it('answers an oversized transcript with the JSON error contract', async () => {
    const response = await request(app())
      .post('/api/summarize')
      .send({ readingLanguage: 'ur', turns: [{ speaker: 'user', original: 'a'.repeat(2_000_000) }] })

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('payload_too_large')
  })

  it.each([
    ['malformed JSON', '{"turns": '],
    ['an oversized body', JSON.stringify({ padding: 'a'.repeat(2_000_000) })],
  ])('never leaks a stack trace or a server path for %s', async (_label, body) => {
    const response = await request(app())
      .post('/api/summarize')
      .set('Content-Type', 'application/json')
      .send(body)

    const serialized = JSON.stringify(response.body) + response.text
    expect(serialized).not.toContain('node_modules')
    expect(serialized).not.toContain('at ')
    expect(serialized).not.toMatch(/SyntaxError|<html/i)
  })
})

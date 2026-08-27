import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { app } from './server.js';

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server?.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('health endpoint reports a live backend', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'lingua-backend');
});

test('live token validates direction before calling Gemini', async () => {
  const response = await fetch(`${baseUrl}/api/live-token?direction=fr-de`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Validation Error',
    message: 'direction must be a supported English language pair.',
  });
});

test('live token accepts both canonical and legacy direction spellings', async () => {
  if (!process.env.GEMINI_API_KEY) {
    for (const direction of [
      'ur-to-en',
      'en-to-ur',
      'ur-en',
      'en-ur',
      'es-to-en',
      'en-to-es',
      'bn-to-en',
      'en-to-bn',
    ]) {
      const response = await fetch(`${baseUrl}/api/live-token?direction=${direction}`);
      assert.equal(response.status, 500);
      assert.equal((await response.json()).error, 'Configuration Error');
    }
    return;
  }

  const response = await fetch(`${baseUrl}/api/live-token?direction=en-to-ur`);
  assert.notEqual(response.status, 400);
});

test('summary validates transcript before requiring Gemini configuration', async () => {
  const response = await fetch(`${baseUrl}/api/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: [] }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /at least one turn/);
});

test('malformed JSON returns an API error instead of HTML', async () => {
  const response = await fetch(`${baseUrl}/api/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Validation Error',
    message: 'Request body must contain valid JSON.',
  });
});

test('unknown routes return JSON', async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'Not Found');
});

test('Gemini endpoints work with the configured API key', { skip: !process.env.GEMINI_API_KEY }, async () => {
  const tokenResponse = await fetch(`${baseUrl}/api/live-token?direction=ur-en`);
  const tokenText = await tokenResponse.text();
  assert.equal(tokenResponse.status, 200, tokenText);
  const tokenBody = JSON.parse(tokenText);
  assert.equal(typeof tokenBody.token, 'string');
  assert.equal(tokenBody.direction, 'ur-to-en');

  const summaryResponse = await fetch(`${baseUrl}/api/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preferredLanguage: 'English',
      transcript: [
        {
          speaker: 'user',
          originalText: 'My appointment is tomorrow at 10 AM at City Hospital.',
          translatedText: 'My appointment is tomorrow at 10 AM at City Hospital.',
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  const summaryText = await summaryResponse.text();
  assert.equal(summaryResponse.status, 200, summaryText);
  const summaryBody = JSON.parse(summaryText);
  assert.equal(typeof summaryBody.summary.summary, 'string');
});

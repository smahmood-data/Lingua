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

test('live token validates the target language before calling Gemini', async () => {
  const response = await fetch(`${baseUrl}/api/live-token?target=xx-invalid`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Validation Error',
    message:
      'source must be auto or a supported language, target must be supported, and the languages must differ.',
  });
});

test('live token validates source languages and rejects identical pairs', async () => {
  for (const query of ['source=xx-invalid&target=en', 'source=en&target=en']) {
    const response = await fetch(`${baseUrl}/api/live-token?${query}`);
    assert.equal(response.status, 400);
  }
});

test('live token accepts expanded targets and legacy direction spellings', async () => {
  if (!process.env.GEMINI_API_KEY) {
    for (const query of [
      'target=en',
      'target=fr',
      'target=zh-Hans',
      'source=en&target=fr',
      'direction=ur-en',
      'direction=en-to-es',
    ]) {
      const response = await fetch(`${baseUrl}/api/live-token?${query}`);
      assert.equal(response.status, 500);
      assert.equal((await response.json()).error, 'Configuration Error');
    }
    return;
  }

  const response = await fetch(`${baseUrl}/api/live-token?target=fr`);
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

test('Gemini Live tokens work with the configured API key', { skip: !process.env.GEMINI_API_KEY }, async () => {
  // Both directions of an interpreted conversation are minted the same way, so
  // the reverse route of an explicit pair is checked against Gemini too.
  for (const [query, sourceLanguage, targetLanguage] of [
    ['target=en', 'auto', 'en'],
    ['source=en&target=es', 'en', 'es'],
  ] as const) {
    const tokenResponse = await fetch(`${baseUrl}/api/live-token?${query}`);
    const tokenText = await tokenResponse.text();
    assert.equal(tokenResponse.status, 200, tokenText);
    const tokenBody = JSON.parse(tokenText);
    assert.equal(typeof tokenBody.token, 'string');
    assert.equal(tokenBody.sourceLanguage, sourceLanguage);
    assert.equal(tokenBody.targetLanguage, targetLanguage);
    // The browser replays this verbatim into the Live setup, so a token without
    // it cannot be used at all.
    assert.ok(tokenBody.systemInstruction.length > 0, tokenText);
  }
});

test('Gemini summary works when the external integration check is enabled', {
  skip: !process.env.GEMINI_API_KEY || process.env.RUN_GEMINI_SUMMARY_TESTS !== 'true',
}, async () => {
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

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(backendRoot, '..');
const originalEnvironment = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_LIVE_MODEL: process.env.GEMINI_LIVE_MODEL,
  LIVE_TOKEN_RATE_LIMIT_MAX: process.env.LIVE_TOKEN_RATE_LIMIT_MAX,
  LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS: process.env.LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
};

dotenv.config({ path: resolve(backendRoot, '.env') });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: resolve(repoRoot, '.env') });
}

const integrationApiKey = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = integrationApiKey || 'test-server-key';
process.env.GEMINI_LIVE_MODEL = 'gemini-3.5-live-translate-preview';
process.env.LIVE_TOKEN_RATE_LIMIT_MAX = '3';
process.env.LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS = '600';
process.env.TRUST_PROXY_HOPS = '1';

const { app } = await import('./server.js');
const originalFetch = globalThis.fetch;
const geminiTokenRequests: RequestInit[] = [];
let useRealGemini = false;
let nextGeminiTokenResponse: Response | undefined;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!useRealGemini && url.endsWith('/auth_tokens')) {
    geminiTokenRequests.push(init ?? {});
    if (nextGeminiTokenResponse) {
      const response = nextGeminiTokenResponse;
      nextGeminiTokenResponse = undefined;
      return response;
    }
    return new Response(
      JSON.stringify({ name: `auth_tokens/test-${geminiTokenRequests.length}` }),
      { status: 200 },
    );
  }
  return originalFetch(input, init);
};

let server: Server;
let baseUrl: string;

function restoreEnvironment(name: keyof typeof originalEnvironment) {
  const value = originalEnvironment[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function liveToken(query: string, clientIp: string) {
  return fetch(`${baseUrl}/api/live-token?${query}`, {
    headers: { 'X-Forwarded-For': clientIp },
  });
}

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolveListening, reject) => {
    server.once('listening', () => resolveListening());
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  for (const name of Object.keys(originalEnvironment) as Array<
    keyof typeof originalEnvironment
  >) {
    restoreEnvironment(name);
  }
  if (!server?.listening) {
    return;
  }
  await new Promise<void>((resolveClosed, reject) =>
    server.close((error) => (error ? reject(error) : resolveClosed())),
  );
});

test('health endpoint reports a live backend', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'lingua-backend');
});

test('live token validates the target language before calling Gemini', async () => {
  const requestsBefore = geminiTokenRequests.length;
  const response = await liveToken('target=xx-invalid', '203.0.113.10');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Validation Error',
    message:
      'source must be auto or a supported language, target must be supported, and the languages must differ.',
  });
  assert.equal(geminiTokenRequests.length, requestsBefore);
});

test('live token validates source languages and rejects identical pairs', async () => {
  for (const query of ['source=xx-invalid&target=en', 'source=en&target=en']) {
    const response = await liveToken(query, '203.0.113.11');
    assert.equal(response.status, 400);
  }
});

test('live token accepts expanded targets and legacy direction spellings', async () => {
  const queries = [
    'target=en',
    'target=fr',
    'target=zh-Hans',
    'target=nb',
    'source=en&target=fr',
    'direction=ur-en',
    'direction=en-to-es',
  ];
  for (const [index, query] of queries.entries()) {
    const response = await liveToken(query, `203.0.113.${20 + index}`);
    assert.equal(response.status, 200, await response.text());
  }
});

test('live token stays one-use and locked to audio translation', async () => {
  geminiTokenRequests.length = 0;
  const response = await liveToken('source=en&target=fr', '203.0.113.30');
  assert.equal(response.status, 200, await response.text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(geminiTokenRequests.length, 1);

  const body = JSON.parse(String(geminiTokenRequests[0]?.body));
  assert.equal(body.uses, 1);
  assert.equal(
    body.bidiGenerateContentSetup.model,
    'models/gemini-3.5-live-translate-preview',
  );
  assert.deepEqual(
    body.bidiGenerateContentSetup.generationConfig.responseModalities,
    ['AUDIO'],
  );
  assert.deepEqual(
    body.bidiGenerateContentSetup.generationConfig.translationConfig,
    {
      targetLanguageCode: 'fr',
      echoTargetLanguage: false,
    },
  );
  assert.deepEqual(body.bidiGenerateContentSetup.sessionResumption, {});
  assert.equal('tools' in body.bidiGenerateContentSetup, false);
});

test('live token limits repeated creation per client with retry guidance', async () => {
  geminiTokenRequests.length = 0;
  const responses: globalThis.Response[] = [];
  for (let request = 0; request < 4; request += 1) {
    responses.push(
      await liveToken('source=en&target=fr', '203.0.113.40'),
    );
  }

  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200, 200, 429],
  );
  assert.equal(geminiTokenRequests.length, 3);
  assert.equal(responses[3]?.headers.get('cache-control'), 'no-store');
  assert.match(responses[3]?.headers.get('retry-after') ?? '', /^\d+$/);
  const limitedBody = await responses[3]?.json();
  assert.equal(limitedBody.error, 'Live Session Limit Reached');
  assert.equal(limitedBody.code, 'live_token_rate_limited');
  assert.equal(limitedBody.retryable, true);
  assert.equal(typeof limitedBody.retryAfterSeconds, 'number');
  assert.match(
    limitedBody.message,
    /^This network has started too many live sessions\. Try again in \d+ minutes?\.$/,
  );

  const otherClient = await liveToken(
    'source=en&target=fr',
    '203.0.113.41',
  );
  assert.equal(otherClient.status, 200);
});

test('live token safely reports retryable Gemini throttling', async () => {
  nextGeminiTokenResponse = new Response(
    JSON.stringify({ error: { message: 'private provider details' } }),
    { status: 429, headers: { 'Retry-After': '17' } },
  );
  const rateLimited = await liveToken(
    'source=en&target=fr',
    '203.0.113.60',
  );
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get('retry-after'), '17');
  const rateLimitedBody = await rateLimited.json();
  assert.deepEqual(rateLimitedBody, {
    error: 'Gemini API Error',
    code: 'live_token_upstream_rate_limited',
    message:
      'Live-token creation is temporarily rate-limited. Try again in 17 seconds.',
    retryable: true,
    retryAfterSeconds: 17,
  });
  assert.doesNotMatch(JSON.stringify(rateLimitedBody), /private provider details/);

  nextGeminiTokenResponse = new Response('not-json', { status: 503 });
  const unavailable = await liveToken(
    'source=en&target=fr',
    '203.0.113.61',
  );
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('retry-after'), null);
  assert.deepEqual(await unavailable.json(), {
    error: 'Gemini API Error',
    code: 'live_token_upstream_unavailable',
    message:
      'Live-token creation is temporarily unavailable. Try again later.',
    retryable: true,
  });
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

test('Gemini Live tokens work with the configured API key', { skip: !integrationApiKey }, async () => {
  useRealGemini = true;
  try {
    // Both directions of an interpreted conversation are minted the same way,
    // so the reverse route of an explicit pair is checked against Gemini too.
    for (const [index, [query, sourceLanguage, targetLanguage]] of [
      ['target=en', 'auto', 'en'],
      ['source=en&target=es', 'en', 'es'],
      ['source=en&target=nb', 'en', 'nb'],
    ].entries()) {
      const tokenResponse = await liveToken(query, `203.0.113.${50 + index}`);
      const tokenText = await tokenResponse.text();
      assert.equal(tokenResponse.status, 200, tokenText);
      const tokenBody = JSON.parse(tokenText);
      assert.equal(typeof tokenBody.token, 'string');
      assert.equal(tokenBody.sourceLanguage, sourceLanguage);
      assert.equal(tokenBody.targetLanguage, targetLanguage);
      // The browser replays this verbatim into the Live setup, so a token
      // without it cannot be used at all.
      assert.ok(tokenBody.systemInstruction.length > 0, tokenText);
    }
  } finally {
    useRealGemini = false;
  }
});

test('Gemini summary works when the external integration check is enabled', {
  skip: !integrationApiKey || process.env.RUN_GEMINI_SUMMARY_TESTS !== 'true',
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

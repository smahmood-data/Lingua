# Lingua frontend

This directory is the canonical React + TypeScript + Vite package and the
Vercel project root. Project-wide product scope, architecture, and team workflow
are documented in the [root README](../README.md). The complete package and
runtime ownership map is in
[`docs/REPOSITORY_STRUCTURE.md`](../docs/REPOSITORY_STRUCTURE.md).

The code has two runtime boundaries inside this package:

- `src/` is browser code and must never read server secrets.
- `api/` contains Vercel-only serverless functions. It is not used by the Vite
  development server, which proxies `/api` to `../backend` instead.

## Requirements

- Node.js 20.19 or newer
- npm
- Git

## Setup

From the repository root:

```bash
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite. The live harness uses the Node/Express backend in `../backend`, which must be running separately for token requests.

## Checks

```bash
npm run lint
npm test
npm run build
```

Do not put Gemini credentials in frontend code or in a `VITE_*` variable. The backend dependencies are installed with `npm ci` from `../backend`, and its key remains server-side.

## Live translation

The auto-detected speech translation pipeline lives in [`src/lib/translation/`](./src/lib/translation)
and is consumed through the `useTranslationSession` hook:

```tsx
import { useTranslationSession } from './hooks/useTranslationSession'

const {
  state, error, transcript, interimTranscript,
  isActive, targetLanguage, start, setTargetLanguage, stop, clearTranscript,
} = useTranslationSession()
```

- `state` is `connecting`, `listening`, `translating`, `stopped`, or `error`.
- `error` is `null` or `{ code, message, recoverable, retryAfterSeconds? }`. `code` is always one of
  the values in `SESSION_ERROR_CODES` — never a raw browser error code — so it is
  safe to switch on for UI copy and retry guidance.
- `transcript` holds finalised turns: `{ id, kind, text, languageCode, isFinal }`.
  `kind` is `source` for what was heard and `translation` for what was spoken
  back. Each finalised transcription the API sends becomes its own turn; nothing
  is invented locally.
- `interimTranscript` is `{ text, languageCode }` or `null` — the speculative
  partial caption while someone is still speaking. It is replaced as they talk
  and cleared once the finalised turn for that speech arrives. Render it as a
  live caption line, not as transcript history.
- `targetLanguage` defaults to English. Gemini detects the input language.
- `setTargetLanguage()` stops an active session before changing the output.
- `start()` and `stop()` are idempotent. Repeated calls cannot open a second
  microphone or a second Live session, and a session can always be restarted
  after stopping or failing without reloading the page.

Nothing is persisted: the transcript exists only for the current page load.

An active session also stops after five minutes without Gemini-detected user
speech, with a warning 15 seconds before expiry. Speech start or end resets the
deadline; translated audio does not. Override the build-time, non-secret
`VITE_LIVE_IDLE_TIMEOUT_SECONDS` and `VITE_LIVE_IDLE_WARNING_SECONDS` values
when a deployment needs a different policy. Keep the warning shorter than the
timeout.

### Dependency on the server

The browser connects to Gemini Live with a short-lived ephemeral token from
`GET /api/live-token`. The long-lived `GEMINI_API_KEY` stays on the server and
is never read by frontend code. `vite.config.ts` proxies `/api` to
`http://localhost:3001` in development. On Vercel, `api/live-token.ts` provides
the same route as a serverless function when the Vercel project root is this
`frontend` directory. Set `GEMINI_API_KEY` in Vercel's server-side environment settings;
no frontend environment variable is needed. The deployed function also requires
the `lingua-live-token` Vercel Firewall rule documented in the root
[live-token abuse-protection section](../README.md#live-token-abuse-protection);
without that rule, token creation fails closed with HTTP 503.

`src/lib/translation/tokenProvider.ts` is the only frontend file that knows the
wire shape. It consumes the merged issue #1 contract:

```
GET /api/live-token?target=en
-> { token, expiresAt, newSessionExpiresAt, model, targetLanguage }
```

The Express backend still accepts legacy direction parameters for compatibility.
The `token` value must
start with `auth_tokens/`: `@google/genai` decides how to authenticate from that
prefix alone and sends anything else as a plain API key in the WebSocket URL, so
the provider rejects non-ephemeral values instead of forwarding them.

The merged contract and configuration now line up:

1. **API version.** `LIVE_API_VERSION` in `config.ts` is `v1beta`, matching the
   Live Translate and ephemeral-token contract. `@google/genai` 2.19.0 may log
   an experimental-support warning for `v1beta`, but it still selects the
   constrained WebSocket method from the `auth_tokens/` prefix.
2. **Locked translation config.** The server constrains `targetLanguageCode`,
   transcription, audio, and `echoTargetLanguage` in the ephemeral token. The
   July 2026 guide names this field `liveConnectConstraints`, while some current
   `v1beta` accounts still accept only `bidiGenerateContentSetup`; the token
   routes prefer the working legacy field and retry the documented successor
   when Google retires it.
3. **Model.** The backend template, backend fallback, and frontend fallback use
   `gemini-3.5-live-translate-preview`, the dedicated Live Translate model. The
   server's returned `model` is used when present.

### Manual test

A developer harness is available at `http://localhost:5173/?live=1`. It is
compiled out of production builds and should be removed once the interpreter UI
in issue #4 can drive a session. Headphones are recommended so the translated
audio is not picked up by the microphone again.

1. Start `../backend` with a valid `GEMINI_API_KEY`, then run `npm run dev` here.
2. Open `/?live=1` and select **Start session**.
3. Leave the target on **English**, grant microphone access, and speak a short
   Urdu, French, Chinese, or Spanish phrase. Confirm English audio plays and the
   detected source language is labelled in the transcript.
4. Change the target to **Urdu** while active and confirm the session stops and
   the browser microphone indicator clears.
5. Start again, speak a short English phrase, and confirm Urdu audio and
   English/Urdu transcript lines appear.
6. Stop and start again to confirm retry works without reloading.
7. Block microphone access and confirm a recoverable error is shown.

### Live diagnostic trace

The interpreter can record what it actually did, for the failures that only
appear in a real browser with a real microphone in a real room. It is off by
default and records nothing until it is asked for.

Enable it with either:

- `http://localhost:5173/?debugLive=1`, or
- `localStorage.linguaDebugLive = '1'` before loading the page.

Have the conversation, then read the trace from the browser console:

```js
copy(window.__linguaTrace)          // to the clipboard
console.table(window.__linguaTrace) // or just look at it
```

Each entry is `{ t, event, detail }`, where `t` is milliseconds since the trace
was enabled. It records route ids and targets, utterance and generation ids,
turn open/close, which route claimed the speakers, playback start and end,
barge-in, and every session state change. It deliberately records transcript
*lengths* rather than transcript text, and never records tokens or audio, so a
trace can be pasted into an issue as it is.

#### Replaying a captured trace

A saved trace can be put back through the real coordinator, which is how the
`es → es` and ghost-turn regressions were found and fixed:

```bash
LINGUA_TRACE=~/lingua-live-trace.json npm test -- traceReplay
```

It asserts the product invariants against the recorded ordering — no row
translating a language into itself, no row without a human source, nothing
outside the configured pair. Set `LINGUA_TRACE_TARGET` and
`LINGUA_TRACE_COUNTERPART` to match the session's selectors (they default to
`en` and auto-detect). Without `LINGUA_TRACE` the test skips, so it never runs
in CI.

The trace also records, per event: route id and target, utterance and generation
ids, turn owner, the route that actually interpreted, the resolved product-side
language, the reported language code, the configured pair and current
counterpart, whether a turn had source text, and every event dropped as stale
(`stale`, with the id that was already committed) or as a readback
(`hold-drop`). Still no transcript text, no audio, no tokens.

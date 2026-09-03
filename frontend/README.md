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

- Node.js 24.x (the version pinned for Vercel and frontend CI)
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

## Deployment

`vercel.json` is the repository-owned Vercel contract: Vite, `npm ci`,
`npm run build`, and the `dist` output directory. The existing Vercel project's
Root Directory must be `frontend`; a config file cannot repair a dashboard root
that still points to the removed `Bridge` directory.

Follow [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for the owner-only project,
secret, firewall, domain, and GitHub homepage steps. After a new deployment is
ready, run the token-redacting check from this directory:

```bash
npm run smoke:deployment -- https://bridgev1.vercel.app
```

The check creates one real ephemeral token, validates it only in memory, and
never prints the token value.

## Live translation

The auto-detected speech translation pipeline lives in [`src/lib/translation/`](./src/lib/translation)
and is consumed through the `useTranslationSession` hook:

```tsx
import { useTranslationSession } from './hooks/useTranslationSession'

const {
  state, error, turns, interimTranscript, isActive,
  sourceLanguage, targetLanguage, counterpartLanguage,
  idleWarningEndsAt, idleTimeoutEndedAt,
  start, setSourceLanguage, setTargetLanguage, setLanguages,
  stop, clearTranscript,
} = useTranslationSession()
```

- `state` is `connecting`, `listening`, `translating`, `playing`, `stopped`, or
  `error`. `translating` and `playing` are deliberately separate: only `playing`
  means translated speech is physically coming out of the speakers.
- `error` is `null` or `{ code, message, recoverable, retryAfterSeconds? }`. `code` is always one of
  the values in `SESSION_ERROR_CODES` — never a raw browser error code — so it is
  safe to switch on for UI copy and retry guidance.
- `turns` holds the conversation as bilingual turns:
  `{ id, sourceLanguage, sourceText, targetLanguage, translatedText, status, createdAt }`.
  One turn carries both sides of the same utterance — what the speaker said and
  what the other person hears — rather than one row per direction. The language
  fields are `null` until the route that owns the turn has identified them, and
  `translatedText` stays empty when nothing had to be interpreted (someone
  already speaking the target language). Nothing is invented locally.
- `counterpartLanguage` is the other language of the pair once Auto Detect has
  learned it, and `null` before that.
- `interimTranscript` is `{ text, languageCode }` or `null` — the speculative
  partial caption while someone is still speaking. It is replaced as they talk
  and cleared once the finalised turn for that speech arrives. Render it as a
  live caption line, not as transcript history.
- `targetLanguage` defaults to English. Gemini detects the input language.
- `setTargetLanguage()` stops an active session before changing the output.
- `start()` and `stop()` are idempotent. Repeated calls cannot open a second
  microphone or a second Live session, and a session can always be restarted
  after stopping or failing without reloading the page.

Completed transcripts and generated summaries are stored only in this browser's localStorage. They are not synced to an account or server; anyone with access to this browser profile may be able to view them. Use the Clear history control to remove saved sessions from localStorage.

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
the `lingua-live-token` Vercel Firewall rule documented in
[`docs/SECURITY.md`](../docs/SECURITY.md); without that rule, token creation
fails closed with HTTP 503.

`src/lib/translation/tokenProvider.ts` is the only frontend file that knows the
wire shape. It consumes the merged issue #1 contract:

```
GET /api/live-token?source=auto&target=en
-> {
     token,                 // must start with "auth_tokens/"
     expiresAt,             // ISO 8601; when the token itself dies
     newSessionExpiresAt,   // ISO 8601; deadline to *open* the session
     model,
     sourceLanguage,        // echoed back, "auto" or a BCP-47 code
     targetLanguage,
     systemInstruction,     // the interpreter prompt the token is bound to
   }
```

All seven fields are required: the provider rejects a response missing any of
them rather than starting a session on a partial contract. Responses are sent
with `Cache-Control: no-store`.

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

Drive the real interpreter screen at `http://localhost:5173`. A lower-level
harness also exists at `/?live=1`; it is compiled out of production builds and
is only useful for isolating the audio pipeline from the UI.

Headphones are strongly recommended. Barge-in is disabled, so translated audio
played through speakers is suppressed rather than misread as speech — but
headphones keep the test honest.

**A normal two-way conversation (English ↔ Bengali).** This is the path that
matters; test it before anything else.

1. Start `../backend` with a valid `GEMINI_API_KEY`, then run `npm run dev` here.
2. Leave the source on **Auto-detect** and the target on **English**. Grant
   microphone access and start the conversation.
3. Speak a short **Bengali** phrase. Confirm English audio plays, the turn is
   labelled Bengali, and the masthead pair fills in once Auto Detect has learned
   the counterpart.
4. **Watch the state complete.** While the English translation is audible the
   microphone shows `playing`; when the audio physically finishes it must return
   to `listening` on its own. A session that stays in `playing` after the
   speakers have gone quiet is the regression `traceRegression.test.ts` exists
   for.
5. Reply in **English** without touching any control. Confirm Bengali audio
   plays and a second turn appears with the languages the other way round. Two
   consecutive turns in both directions is the real acceptance test.
6. Confirm neither speaker had to pick a language or switch a direction.

**Edge cases.**

7. Speak English while the target is English and confirm the interpreter stays
   silent rather than reading it back.
8. Change the target language mid-session and confirm the session stops cleanly
   and the browser microphone indicator clears.
9. Stop and start again to confirm retry works without reloading.
10. Block microphone access and confirm a recoverable error is shown.
11. Leave the session idle and confirm the warning appears before it ends
    itself.

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

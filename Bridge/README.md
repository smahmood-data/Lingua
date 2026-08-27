# Lingua frontend

This directory contains the React + TypeScript + Vite client. Project-wide product scope, architecture, and team workflow are documented in the [root README](../README.md).

## Requirements

- Node.js 20.19 or newer
- npm
- Git

## Setup

From the repository root:

```bash
cd Bridge
npm ci
npm run dev
```

Open the local URL printed by Vite. The current branch contains the frontend starter; Gemini and the Node/Express server are added through the implementation issues.

## Checks

```bash
npm run lint
npm run build
```

Do not put Gemini credentials in frontend code or in a `VITE_*` variable. When the server is added, its dependencies will be installed with `npm ci` from the server directory and its key will remain server-side.

## Live translation (issue #2)

The Urdu → English audio pipeline lives in [`src/lib/translation/`](./src/lib/translation)
and is consumed through the `useTranslationSession` hook:

```tsx
import { useTranslationSession } from './hooks/useTranslationSession'

const {
  state, error, transcript, interimTranscript,
  isActive, start, stop, clearTranscript,
} = useTranslationSession()
```

- `state` is `connecting`, `listening`, `translating`, `stopped`, or `error`.
- `error` is `null` or `{ code, message, recoverable }`. `code` is always one of
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
- `start()` and `stop()` are idempotent. Repeated calls cannot open a second
  microphone or a second Live session, and a session can always be restarted
  after stopping or failing without reloading the page.

Nothing is persisted: the transcript exists only for the current page load.

### Dependency on the server

The browser connects to Gemini Live with a short-lived ephemeral token from
`GET /api/live-token`, which issue #1 owns. The long-lived `GEMINI_API_KEY` stays
on the server and is never read by frontend code. `vite.config.ts` proxies `/api`
to `http://localhost:3001` in development, so no frontend environment variable is
needed. A deployment that serves the API from another origin should pass an
absolute URL to `createLiveTokenProvider()` rather than add a build-time variable.

`src/lib/translation/tokenProvider.ts` is the only file that knows the wire
shape. It is written against the contract on the unmerged
`feat/1-secure-gemini-backend` branch:

```
GET /api/live-token?direction=ur-to-en
-> { token, expiresAt, newSessionExpiresAt, model, direction }
```

`direction` is required — that route answers 400 without it. The `token` value
must start with `auth_tokens/`: `@google/genai` decides how to authenticate from
that prefix alone and sends anything else as a plain API key in the WebSocket
URL, so the provider rejects non-ephemeral values instead of forwarding them.

Three things must be confirmed on the first real run, and none can be verified
without a live token:

1. **API version.** `LIVE_API_VERSION` in `config.ts` is `v1beta`, matching the
   Live Translate documentation and the version the issue #1 server mints tokens
   on. `@google/genai` 2.19.0 still logs "The SDK's ephemeral token support is in
   v1alpha only" — that warning is cosmetic here, since the SDK selects the
   constrained ephemeral method from the token prefix regardless of version. If
   the handshake fails, flip the constant to `v1alpha` and retry.
2. **Locked translation config.** The Live Translate docs say `translationConfig`
   should be set in the server's token constraints and is locked against the
   client by default, unless the server sends `lock_additional_fields: []`. The
   issue #1 branch currently sends neither, so the client's `translationConfig`
   may be rejected. The session will surface this as a recoverable
   `live-connection-failed` rather than hanging.
3. **Model.** The issue #1 branch defaults to `models/gemini-3.1-flash-live-preview`
   with a translation system instruction, while the root `.env.example` and this
   client's fallback use `gemini-3.5-live-translate-preview` with
   `translationConfig`. The server's model wins when it sends one. The team needs
   to settle on one approach.

### Manual test

A developer harness is available at `http://localhost:5173/?live=1`. It is
compiled out of production builds and should be removed once the interpreter UI
in issue #4 can drive a session. Headphones are recommended so the translated
audio is not picked up by the microphone again.

1. Start the server with a valid `GEMINI_API_KEY`, then `npm run dev` here.
2. Open `/?live=1` and select **Start session**.
3. Grant microphone access and speak a short Urdu phrase.
4. Confirm English audio plays and transcript lines appear.
5. Select **Stop session** and confirm the browser microphone indicator clears.
6. Start again and confirm it works without reloading.
7. Block microphone access and confirm a recoverable error is shown.

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

const { state, error, transcript, isActive, start, stop, clearTranscript } =
  useTranslationSession()
```

- `state` is `connecting`, `listening`, `translating`, `stopped`, or `error`.
- `error` is `null` or `{ code, message, recoverable }`; `code` is a stable value
  such as `microphone-permission-denied` for UI copy and retry guidance.
- `transcript` is an in-memory array of `{ id, kind, text, languageCode, isFinal }`.
  `kind` is `source` for what was heard and `translation` for what was spoken back.
  Turns only appear when Gemini sends transcription events; nothing is invented.
- `start()` and `stop()` are idempotent. Repeated calls cannot open a second
  microphone or a second Live session, and a session can always be restarted
  after stopping or failing without reloading the page.

Nothing is persisted: the transcript exists only for the current page load.

### Dependency on the server

The browser connects to Gemini Live with a short-lived ephemeral token fetched
from `GET /api/live-token`, which issue #1 owns. The long-lived `GEMINI_API_KEY`
stays on the server and is never read by frontend code. `vite.config.ts` proxies
`/api` to `http://localhost:3001` in development, so no frontend environment
variable is needed.

Until that route exists, starting a session fails with a `token-request-failed`
error. `src/lib/translation/tokenProvider.ts` is the only file that knows the
response shape and is the single place to adjust once #1 lands.

### Manual test

A developer harness is available at `http://localhost:5173/?live=1`. It is
temporary and should be removed once the interpreter UI in issue #4 can drive a
session. Headphones are recommended so the translated audio is not picked up by
the microphone again.

1. Start the server with a valid `GEMINI_API_KEY`, then `npm run dev` here.
2. Open `/?live=1` and select **Start session**.
3. Grant microphone access and speak a short Urdu phrase.
4. Confirm English audio plays and transcript lines appear.
5. Select **Stop session** and confirm the browser microphone indicator clears.
6. Start again and confirm it works without reloading.
7. Block microphone access and confirm a recoverable error is shown.

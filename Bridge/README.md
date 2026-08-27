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

Open the local URL printed by Vite. The live harness uses the Node/Express backend in `../backend`, which must be running separately for token requests.

## Checks

```bash
npm run lint
npm run build
```

Do not put Gemini credentials in frontend code or in a `VITE_*` variable. The backend dependencies are installed with `npm ci` from `../backend`, and its key remains server-side.

## Live translation (issues #2 and #3)

The shared Urdu ↔ English audio pipeline lives in [`src/lib/translation/`](./src/lib/translation)
and is consumed through the `useTranslationSession` hook:

```tsx
import { useTranslationSession } from './hooks/useTranslationSession'

const {
  state, error, transcript, interimTranscript,
  isActive, start, setDirection, stop, clearTranscript,
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
- `setDirection()` stops an active session before selecting the reverse direction.
- `start()` and `stop()` are idempotent. Repeated calls cannot open a second
  microphone or a second Live session, and a session can always be restarted
  after stopping or failing without reloading the page.

Nothing is persisted: the transcript exists only for the current page load.

### Dependency on the server

The browser connects to Gemini Live with a short-lived ephemeral token from the
merged issue #1 backend's `GET /api/live-token`. The long-lived `GEMINI_API_KEY`
stays on the server and is never read by frontend code. `vite.config.ts` proxies
`/api` to `http://localhost:3001` in development, so no frontend environment
variable is needed. A deployment that serves the API from another origin should
pass an absolute URL to `createLiveTokenProvider()` rather than add a build-time
variable.

`src/lib/translation/tokenProvider.ts` is the only frontend file that knows the
wire shape. It consumes the merged issue #1 contract:

```
GET /api/live-token?direction=ur-to-en | en-to-ur
-> { token, expiresAt, newSessionExpiresAt, model, direction }
```

The frontend always sends a canonical `direction` value. The backend also accepts
the legacy `ur-en`/`en-ur` spellings for compatibility. The `token` value must
start with `auth_tokens/`: `@google/genai` decides how to authenticate from that
prefix alone and sends anything else as a plain API key in the WebSocket URL, so
the provider rejects non-ephemeral values instead of forwarding them.

The merged contract and configuration now line up:

1. **API version.** `LIVE_API_VERSION` in `config.ts` is `v1beta`, matching the
   Live Translate and ephemeral-token contract. `@google/genai` 2.19.0 may log
   an experimental-support warning for `v1beta`, but it still selects the
   constrained WebSocket method from the `auth_tokens/` prefix.
2. **Locked translation config.** The backend constrains `targetLanguageCode`,
   transcription, audio, and `echoTargetLanguage` in the token's
   `bidiGenerateContentSetup`. The client sends the same translation settings;
   the server constraint remains authoritative.
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
3. Grant microphone access and speak a short Urdu phrase; confirm English audio
   plays and Urdu/English transcript lines appear.
4. Select **English → Urdu** while active and confirm the session stops and the
   browser microphone indicator clears.
5. Start again, speak a short English phrase, and confirm Urdu audio and
   English/Urdu transcript lines appear.
6. Stop and start again to confirm retry works without reloading.
7. Block microphone access and confirm a recoverable error is shown.

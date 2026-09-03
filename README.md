# Lingua

> Translation tells you what someone said. Lingua helps you understand what happens next.

Lingua is a real-time conversation assistant for people who are not fluent in English. It is designed for high-stakes conversations with schools, doctors, landlords, banks, government offices, and other service providers.

During a conversation, Lingua automatically detects the spoken language, translates it into a selected language, reads the translation aloud, and displays live subtitles. At the end, it can turn the transcript into a concise, preferred-language summary of appointments, deadlines, instructions, locations, required documents, decisions, and anything that may need clarification.

## Hackathon MVP

The first demo focuses on one complete path:

1. Leave speech detection on Auto and choose the language to translate into (English by default).
2. Start a live translated conversation.
3. Hear translated speech and read live subtitles.
4. End the conversation.
5. Receive a structured action summary in the user's preferred language.

### Success criteria

- Spoken language is detected automatically.
- Urdu, French, Chinese, Spanish, and the rest of Gemini Live Translate's supported languages can be translated to English audio.
- The target can be changed from English to any supported language.
- Each detected speaker language produces a clearly labelled transcript turn.
- The final screen extracts at least an appointment, arrival time, location, and required documents from the demo script.
- No Gemini API key is exposed in browser code or committed to Git.

Misunderstanding detection is a stretch goal. Authentication, a database, call integrations, saved history, and additional service-specific portals are intentionally outside the hackathon MVP.

## Current status

The repository contains a React + TypeScript + Vite package in
[`frontend/`](./frontend) and a TypeScript Express service in
[`backend/`](./backend). The frontend exposes Gemini Live Translate's complete
supported target-language list, with automatic source-language detection and
English as the default output. Microphone capture, PCM conversion, streamed
playback, and transcript events live behind the `useTranslationSession` hook.
The developer harness is documented in the
[frontend README](./frontend/README.md), and the canonical package/deployment
boundaries are recorded in
[`docs/REPOSITORY_STRUCTURE.md`](./docs/REPOSITORY_STRUCTURE.md).

The canonical production alias is
[`https://bridgev1.vercel.app`](https://bridgev1.vercel.app). Repository-owned
deployment settings live in `frontend/vercel.json`; the required Vercel and
GitHub owner steps and the redacting smoke check are in
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Architecture & Security

```text
Browser (React + Vite)
  ├─ local /api/* → Vite proxy → backend/ (Express)
  │    ├─ GET /api/live-token
  │    └─ POST /api/summarize
  └─ Vercel GET /api/live-token → frontend/api/live-token.ts
```

The long-lived Gemini key remains server-side: in the Express process during
local development and in the Vercel Function at deployment. The browser
receives only a short-lived Live API token, and transcript summaries returned by
Express are schema-validated.

For Vercel, [`frontend/api/live-token.ts`](./frontend/api/live-token.ts) is the
intentional deployment adapter inside the frontend project. Set
`GEMINI_API_KEY` as a server-side Vercel environment variable; never expose it
as a `VITE_*` variable. The Vercel project root must be `frontend`.

### Live-token abuse protection

The default anonymous policy allows 60 successful token creations per client IP in a fixed 10-minute window. A normal explicit-language conversation creates two tokens, so the default leaves room for about 30 starts, or 15 people each making one full restart/retry, behind the same public IP during that window. Keeping a conversation open for 5–10 minutes does not itself create more tokens. A limited request returns HTTP 429 with a short explanation, a stable error code, `retryAfterSeconds`, and `Retry-After`; invalid requests and upstream failures do not consume the local Express server's successful-token allowance. `LIVE_TOKEN_RATE_LIMIT_MAX` and `LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS` adjust the local policy.

The Vercel function uses Vercel Firewall for a distributed counter. Before deploying it, create and publish an `@vercel/firewall` rate-limit rule with ID `lingua-live-token`, a fixed window of 60 requests per 600 seconds, the client IP as its key, and 429 as its exceeded action. The rule threshold remains configurable in Vercel. Its ID can be changed with the server-only `LIVE_TOKEN_RATE_LIMIT_ID`; if the window changes, set `LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS` to the same number so retry guidance remains accurate. The function returns an actionable HTTP 503 and does not contact Gemini when the rule is missing, blocked, or unavailable, so a deployment cannot silently fail open.

The Express counter is intentionally in memory because that server is the single-process local-development path. Keep `TRUST_PROXY_HOPS=0` when it is reached directly. If it is placed behind a reverse proxy, set the value only to the exact number of trusted hops after confirming the last proxy overwrites `X-Forwarded-For`; a multi-process or public Express deployment needs a shared rate-limit store.

This is a per-IP control, not identity or a global spending cap. Vercel Firewall counters are also regional, so a distributed client or multi-region traffic can exceed the nominal project-wide total. Authentication, a human challenge, a global quota, and usage-based session accounting are separate hardening layers if the demo becomes a broader public service.

After issuance, `uses: 1` still permits only one new Live session. That session must start within 60 seconds by default, and the token expires after 30 minutes by default; both values remain server-adjustable. The browser does not automatically reconnect or resume a closed connection. It also ends an open session after five minutes without Gemini-detected user speech, warning 15 seconds beforehand; both idle intervals are configurable through the non-secret Vite settings documented in the frontend README. The token locks the dedicated Live Translate model, audio output, transcription, and target-language translation configuration, and does not enable tools.

## Local setup

Prerequisites: Node.js 24.x for the frontend deployment package, Node.js 20.19
or newer for the local backend, npm, and a Gemini API key for authenticated
backend integration tests and live requests.

```bash
cd backend
npm ci
cp .env.example .env
# Edit .env and set GEMINI_API_KEY from Google AI Studio.
# Never commit .env or place the key in a VITE_* variable.
npm run dev
```

Backend commands: `npm run check`, `npm run build`, `npm test`, and `npm start`.

`npm test` verifies the local HTTP architecture. With `GEMINI_API_KEY`, it also creates a real Live token. Set `RUN_GEMINI_SUMMARY_TESTS=true` only when you intentionally want the quota-dependent structured-summary integration check.

In a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Validate the frontend with `npm run lint`, `npm test`, and `npm run build` from
`frontend/`.

## Structured summary contract

The transcript-analysis endpoint returns a validated object containing `summary`, `appointments`, `deadlines`, `instructions`, `locations`, `documents`, `decisions`, `clarifications`, and `nextSteps`. Missing information produces an empty array, not a fabricated value.

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) - system architecture, user journey, runtime sequences, summary flow, and issue dependencies
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) - canonical Vercel configuration, owner-only setup, smoke checks, and failure diagnosis
- [`docs/REPOSITORY_STRUCTURE.md`](./docs/REPOSITORY_STRUCTURE.md) - package ownership, local/Vercel request paths, environment boundaries, and the repository-layout audit
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) - ordered prototype backlog, dependencies, demo script, and submission checklist
- [`docs/REPOSITORY_SETTINGS.md`](./docs/REPOSITORY_SETTINGS.md) - owner-only GitHub protection and merge settings
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - branches, commits, pull requests, and team workflow
- [`AI_USAGE.md`](./AI_USAGE.md) - transparent record of AI-assisted work

## Product principles

- Understanding is the goal; translation is the mechanism.
- Do not invent facts that were not present in the conversation.
- Make uncertainty visible and suggest a clarification instead of guessing.
- Stream audio for the demo and avoid retaining raw audio.
- Keep the interface calm, legible, and usable under stress.

## Official Gemini references

- [Live translation](https://ai.google.dev/gemini-api/docs/live-api/live-translate)
- [Live API overview](https://ai.google.dev/gemini-api/docs/live-api)
- [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)

## License

See [`LICENSE`](./LICENSE).

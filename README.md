# Lingua

> Translation tells you what someone said. Lingua helps you understand what happens next.

Lingua is a real-time conversation assistant for people who are not fluent in English. It is designed for high-stakes conversations with schools, doctors, landlords, banks, government offices, and other service providers.

During a conversation, Lingua translates speech in both directions and displays live subtitles. At the end, it turns the transcript into a concise, preferred-language summary of appointments, deadlines, instructions, locations, required documents, decisions, and anything that may need clarification.

## Hackathon MVP

The first demo focuses on one complete path:

1. Choose the user's language and the other speaker's language.
2. Start a live, two-way translated conversation.
3. Hear translated speech and read live subtitles.
4. End the conversation.
5. Receive a structured action summary in the user's preferred language.

### Success criteria

- Urdu speech is translated to English audio.
- English speech is translated to Urdu audio.
- Both sides of the conversation produce a usable transcript.
- The final screen extracts at least an appointment, arrival time, location, and required documents from the demo script.
- No Gemini API key is exposed in browser code or committed to Git.

Misunderstanding detection is a stretch goal. Authentication, a database, call integrations, saved history, and additional service-specific portals are intentionally outside the hackathon MVP.

## Current status

The repository contains a React + TypeScript + Vite frontend in [`Bridge/`](./Bridge) and a TypeScript Express backend in [`backend/`](./backend). Issue #1 provides secure ephemeral Gemini Live tokens and a validated structured-summary endpoint. Issue #2 adds the Urdu → English live audio pipeline—microphone capture, PCM conversion, Gemini Live transport, streamed playback, and transcript events—behind the `useTranslationSession` hook. The developer harness is documented in the [frontend README](./Bridge/README.md); real end-to-end translation still needs a valid Gemini credential and browser microphone access.

## Architecture & Security

```text
Browser (React + Vite)
  ├─ microphone capture, translated audio playback, and transcript state
  └─ GET /api/live-token → short-lived constrained Gemini Live token
     POST /api/summarize → validated Gemini structured output
```

The Gemini API key remains on the backend. The browser receives only a short-lived Live API token, and transcript summaries are validated before being returned to the frontend.

## Local setup

Prerequisites: Node.js 20.19 or newer, npm, and a Gemini API key for authenticated backend integration tests and live requests.

```bash
cd backend
npm ci
cp .env.example .env
# Edit .env and set GEMINI_API_KEY from Google AI Studio.
# Never commit .env or place the key in a VITE_* variable.
npm run dev
```

Backend commands: `npm run check`, `npm run build`, `npm test`, and `npm start`.

`npm test` verifies the local HTTP architecture without credentials. With `GEMINI_API_KEY`, it also attempts Live token and structured-summary requests; the summary check depends on available API quota.

In a second terminal:

```bash
cd Bridge
npm ci
npm run dev
```

Validate the frontend with `npm run lint` and `npm run build` from `Bridge/`.

## Structured summary contract

The transcript-analysis endpoint returns a validated object containing `summary`, `appointments`, `deadlines`, `instructions`, `locations`, `documents`, `decisions`, `clarifications`, and `nextSteps`. Missing information produces an empty array, not a fabricated value.

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) - system architecture, user journey, runtime sequences, summary flow, and issue dependencies
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

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

The repository currently contains a React + TypeScript + Vite starter in [`Bridge/`](./Bridge). The live audio flow, Gemini integration, server, and Lingua UI are not implemented yet. The directory keeps its earlier project name for now so the team can avoid a disruptive rename during the hackathon.

## Planned architecture

```text
Browser (React + Vite)
  ├─ microphone capture
  ├─ translated audio playback
  ├─ live subtitles and transcript state
  └─ setup, conversation, and summary screens
          │
          ├── GET /api/live-token
          │      └─ creates a short-lived Gemini Live token
          │
          └── POST /api/summarize
                 └─ validates transcript → Gemini structured output

Gemini Live Translate
  └─ low-latency speech-to-speech translation

Gemini Flash
  └─ end-of-conversation extraction and preferred-language summary
```

The intended stack is React, TypeScript, Vite, Node.js, Express, the official `@google/genai` SDK, and schema validation. There is no MongoDB in the MVP because the demo does not require durable accounts or conversation storage.

As of August 27, 2026, Google's documentation identifies `gemini-3.5-live-translate-preview` for dedicated real-time speech translation and documents ephemeral tokens for direct browser Live API connections. Model IDs marked as preview can change, so verify the exact ID in Google AI Studio before the demo.

## Local setup

Prerequisites:

- Node.js 20.19 or newer (Vite 8 also supports Node.js 22.12+)
- npm
- A Gemini API key for the teammate implementing the server integration

Run the existing frontend:

```bash
cd Bridge
npm ci
npm run dev
```

Validate the current frontend:

```bash
cd Bridge
npm run lint
npm run build
```

When the Node/Express server is added, it will have its own `package.json` and lockfile. Teammates will then run `npm ci` from that server directory as well; Express and the Gemini SDK will be installed from the lockfile automatically.

When the server is added, copy `.env.example` to `.env` and add your own key. Never put a real key in a `VITE_*` variable because Vite exposes those values to the browser bundle.

## Structured summary contract

The transcript-analysis endpoint should return a validated object shaped like this:

```json
{
  "summary": "A short summary in the user's preferred language.",
  "appointments": [],
  "deadlines": [],
  "instructions": [],
  "locations": [],
  "requiredDocuments": [],
  "decisions": [],
  "clarifications": []
}
```

Missing information should produce an empty array, not a fabricated value. The server must validate model output before returning it to the UI.

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system architecture, user journey, runtime sequences, summary flow, and issue dependencies
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — ordered four-hour prototype backlog, dependencies, demo script, and submission checklist
- [`docs/REPOSITORY_SETTINGS.md`](./docs/REPOSITORY_SETTINGS.md) — owner-only GitHub protection and merge settings
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branches, commits, pull requests, and team workflow
- [`AI_USAGE.md`](./AI_USAGE.md) — transparent record of AI-assisted work

## Product principles

- Understanding is the goal; translation is the mechanism.
- Do not invent facts that were not present in the conversation.
- Make uncertainty visible and suggest a clarification instead of guessing.
- Stream audio for the demo and avoid retaining raw audio.
- Keep the interface calm, legible, and usable under stress.

## Official Gemini references

- [Live translation](https://ai.google.dev/gemini-api/docs/live-api/live-translate)
- [Live API overview](https://ai.google.dev/gemini-api/docs/live-api)
- [Live transcription and ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)

## License

See [`LICENSE`](./LICENSE).

# Lingua Architecture and Flows

These diagrams describe the hackathon MVP: one laptop translates spoken Urdu and English in both directions, displays bilingual subtitles, and optionally produces a structured summary when the conversation ends.

## System architecture and secure token flow

The browser never receives the long-lived `GEMINI_API_KEY`. It asks a
server-side adapter for a constrained, short-lived token and uses that token for
the direct Live API connection. Local development and Vercel expose the same
browser path through different adapters; their ownership is documented in
[`REPOSITORY_STRUCTURE.md`](./REPOSITORY_STRUCTURE.md).

```mermaid
flowchart LR
    User["Conversation participants"] --> Browser["frontend/src<br/>React + Vite browser app"]
    Browser -->|"local /api proxy"| Express["backend/<br/>Node + Express"]
    Browser -->|"deployed GET /api/live-token"| Function["frontend/api/live-token.ts<br/>Vercel Function"]
    Secret["Server-only GEMINI_API_KEY"] --> Express
    Secret --> Function
    Express -->|"Create constrained ephemeral token"| GeminiAPI["Gemini API"]
    Function -->|"Create constrained ephemeral token"| GeminiAPI
    Express -->|"Return short-lived token locally"| Browser
    Function -->|"Return short-lived token on Vercel"| Browser
    Browser <-->|"Live audio and transcript events"| Live["Gemini Live Translate"]
    Browser -->|"local POST /api/summarize with transcript"| Express
    Express -->|"Structured extraction request"| Flash["Gemini Flash"]
    Flash -->|"Structured result"| Express
    Express -->|"Validated summary"| Browser
```

## Three-screen user journey

```mermaid
flowchart LR
    Setup["1. Setup<br/>Choose Urdu and English<br/>Start conversation"]
    Conversation["2. Conversation<br/>Hear translated audio<br/>Read bilingual subtitles"]
    Summary["3. Summary<br/>Review appointments, documents,<br/>next steps, and clarifications"]

    Setup -->|"Start"| Conversation
    Conversation -->|"End conversation"| Summary
    Summary -->|"Start another"| Setup
```

## Live translation sequence

The same sequence is reused with the languages reversed for English to Urdu.

```mermaid
sequenceDiagram
    actor Speaker as Urdu speaker
    participant Browser as Lingua browser
    participant Server as Server-side token adapter
    participant Gemini as Gemini Live Translate

    Speaker->>Browser: Start Urdu to English session
    Browser->>Server: Request ephemeral Live token
    Server-->>Browser: Return constrained short-lived token
    Browser->>Browser: Request microphone permission
    Browser->>Gemini: Connect using ephemeral token
    loop While the session is active
        Speaker->>Browser: Speak Urdu
        Browser->>Gemini: Stream microphone audio
        Gemini-->>Browser: Stream English audio and transcript events
        Browser-->>Speaker: Play English audio and show subtitles
    end
    Speaker->>Browser: Stop session
    Browser->>Gemini: Close Live connection
    Browser->>Browser: Release microphone and playback resources
```

## End-of-conversation summary flow

```mermaid
flowchart TD
    End["Conversation ends"] --> Transcript["Collect final transcript turns"]
    Transcript --> ValidateInput{"Transcript valid and non-empty?"}
    ValidateInput -->|"No"| Empty["Show a recoverable no-summary state"]
    ValidateInput -->|"Yes"| Request["POST /api/summarize"]
    Request --> Extract["Gemini extracts structured facts"]
    Extract --> ValidateOutput{"Output matches the summary schema?"}
    ValidateOutput -->|"No"| Error["Return a safe validation error"]
    ValidateOutput -->|"Yes"| Cards["Render summary cards in the preferred language"]
    Cards --> Fields["Appointments, deadlines, instructions,<br/>locations, documents, decisions, clarifications"]
```

> **Build status.** The `POST /api/summarize` endpoint, its schema validation,
> and the scored benchmark in [`eval/`](../eval) are implemented and tested.
> Nothing in the UI calls the endpoint yet, so the "Render summary cards" step
> above describes the intended flow rather than shipped behaviour. Tracked in
> [#5](https://github.com/smahmood-data/Lingua/issues/5).

### Summary response contract

`POST /api/summarize` returns a validated object with these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `summary` | `string` | Short prose recap in the preferred language |
| `appointments` | `{ date, time, location, notes }[]` | The first three are `string \| null` when not mentioned |
| `deadlines` | `string[]` | Dates by which something must be done |
| `instructions` | `string[]` | What the person was told to do |
| `locations` | `string[]` | Places named in the conversation |
| `documents` | `string[]` | Paperwork the person must bring or provide |
| `decisions` | `string[]` | Decisions or agreements reached |
| `clarifications` | `string[]` | Points that were unclear and should be confirmed |
| `nextSteps` | `string[]` | Actions to take after the conversation |

Missing information yields an empty array, never a fabricated value. Output that
does not match the schema is rejected server-side rather than passed to the
client.

## Issue dependency map

Issues #2 and #4 can begin against mocks while #1 is in progress, but their final integration depends on the secure backend and shared contracts from #1.

```mermaid
flowchart LR
    I1["#1 Secure backend and shared types"]
    I2["#2 Urdu to English audio"]
    I3["#3 English to Urdu audio"]
    I4["#4 Interpreter UI and subtitles"]
    I5["#5 Conversation summary"]
    I6["#6 Tests and CI"]
    I7["#7 Demo and submission"]

    I1 --> I2
    I1 --> I3
    I2 --> I3
    I2 --> I4
    I3 --> I4
    I1 --> I5
    I2 --> I5
    I3 --> I5
    I1 --> I6
    I2 --> I7
    I3 --> I7
    I4 --> I7
    I6 --> I7
    I5 -.->|"Include only if stable"| I7
```

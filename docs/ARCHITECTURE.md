# Lingua Architecture and Flows

These diagrams describe the hackathon MVP: one laptop translates spoken Urdu and English in both directions, displays bilingual subtitles, and optionally produces a structured summary when the conversation ends.

## System architecture and secure token flow

The browser never receives the long-lived `GEMINI_API_KEY`. It asks the server for a constrained, short-lived token and uses that token for the direct Live API connection.

```mermaid
flowchart LR
    User["Urdu and English speakers"] --> Browser["React + Vite browser app"]
    Browser -->|"GET /api/live-token"| Server["Node + Express API"]
    Secret["Server-only GEMINI_API_KEY"] --> Server
    Server -->|"Create constrained ephemeral token"| GeminiAPI["Gemini API"]
    Server -->|"Return short-lived token"| Browser
    Browser <-->|"Live audio and transcript events"| Live["Gemini Live Translate"]
    Browser -->|"POST /api/summarize with transcript"| Server
    Server -->|"Structured extraction request"| Flash["Gemini Flash"]
    Flash -->|"Structured result"| Server
    Server -->|"Validated summary"| Browser
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
    participant Server as Express token API
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

# Lingua Secure Gemini Backend & Bridge Frontend

This repository provides the minimal secure TypeScript Node/Express backend foundation and React/Vite frontend (`Bridge`) for the Lingua Gemini Live API integration.

## Architecture & Security
- **No Client Exposure**: `GEMINI_API_KEY` is kept exclusively on the Node/Express backend (`backend/`).
- **Live Token Endpoint**: The frontend requests constrained short-lived Live API tokens from `/api/live-token`.
- **Summary Endpoint**: The frontend can send final transcript turns to `/api/summarize` for server-side structured extraction through the Gemini Interactions API.
- **Shared Contracts**: Common types (`TranslationDirection`, `TranscriptTurn`, `SessionState`, `ApiError`) are defined under `Bridge/src/types.ts`.

## Getting Started

### 1. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
# Edit .env and set GEMINI_API_KEY from Google AI Studio.
# Never commit .env or place the key in a VITE_* variable.
npm run dev
```

Backend commands:
```bash
npm run check
npm run build
npm test
npm start
```

`npm test` verifies the local HTTP architecture without requiring Gemini credentials. If `.env` contains `GEMINI_API_KEY`, it also makes a live-token request and a structured-summary request against Gemini; otherwise that integration test is skipped.

### 2. Frontend (`Bridge`) Setup
```bash
cd Bridge
npm install
npm run dev
```

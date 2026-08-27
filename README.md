# OfferGuard Secure Gemini Backend & Bridge Frontend

This repository provides the minimal secure Node/Express backend foundation and React/Vite frontend (`Bridge`) for the Gemini Live API integration.

## Architecture & Security
- **No Client Exposure**: `GEMINI_API_KEY` is kept exclusively on the Node/Express backend (`backend/`).
- **Token Endpoint**: The frontend requests session configuration/tokens from `/api/gemini/token`.
- **Shared Contracts**: Common types (`TranslationDirection`, `TranscriptTurn`, `SessionState`, `ApiError`) are defined under `Bridge/src/types.ts`.

## Getting Started

### 1. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
# Edit .env and set your GEMINI_API_KEY
npm run dev
```

### 2. Frontend (`Bridge`) Setup
```bash
cd Bridge
npm install
npm run dev
```

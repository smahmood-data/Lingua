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

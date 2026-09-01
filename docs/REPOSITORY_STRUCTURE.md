# Repository Structure and Runtime Boundaries

Issue #39 audited the repository before changing its layout. The result is a
small normalization: the former `Bridge/` directory is now `frontend/`. No
application behavior, API contract, or deployment repair is part of this
change.

## Canonical structure

| Path | Owner and responsibility |
| --- | --- |
| `frontend/src/` | Browser-only React, audio, translation-session, and UI code. It may use only public `VITE_*` build settings. |
| `frontend/api/` | Server-only Vercel Functions deployed with the frontend project. It may read server environment variables and must never expose the long-lived Gemini key. |
| `frontend/package.json` | The `lingua-frontend` Vite package, including the dependencies needed by both the browser build and its Vercel Function. |
| `backend/` | The self-contained local Node/Express service. It owns health, live-token, and structured-summary routes for local development and evaluation. |
| `eval/` | Repository-level summary fixtures and runners. They call an already-running `backend/` service and do not import frontend code. |
| `.github/workflows/ci.yml` | Independent frontend and backend install/check/test/build jobs. |

There is intentionally no root JavaScript workspace. Each package has its own
lockfile and can be installed, tested, and built independently.

## Audit baseline and impact map

This inventory was agreed before the directory move.

| Audited area | Pre-change relationship | Normalization |
| --- | --- | --- |
| `Bridge/src/`, Vite config, tests, and static assets | One React/Vite package; all source imports are package-relative. | Move together to `frontend/`; no import rewrite or runtime change. |
| `Bridge/api/live-token.ts` | Vercel-only function located under the configured `Bridge` project root; imports only files within that root. | Move with the package to `frontend/api/`; keep the `/api/live-token` route unchanged. |
| `Bridge/package*.json` | Package and lockfile were named `bridge`. | Rename the package metadata to `lingua-frontend`; dependency versions stay unchanged. |
| Vite development proxy | `/api/*` is forwarded to `http://localhost:3001`. | Keep unchanged; local development continues to use `backend/`. |
| `backend/` | Separate Express package with live-token, summary, and health routes. | Keep unchanged. |
| CI | Frontend job and npm cache referenced `Bridge`. | Point both paths to `frontend`; job commands stay unchanged. |
| Environment templates | Root and `backend/` templates describe server settings; the frontend template contains only non-secret `VITE_*` settings. | Preserve the split and clarify that Vercel secrets live in Project Settings. |
| Contributor and architecture docs | Commands and links referenced `Bridge`; the main diagram showed only Express. | Update paths and show the distinct local and Vercel adapters. |
| Vercel project | Project Root Directory was expected to be `Bridge`; Vite outputs `dist`, and root-level `api/` files become Functions. | The required root becomes `frontend`. Project settings, aliases, secrets, and live smoke validation are coordinated in Issue #31. |

## Request paths by runtime

| Runtime | Browser request | Owner | Notes |
| --- | --- | --- | --- |
| Local Vite development | `GET /api/live-token` | `backend/src/server.ts`, reached through the Vite proxy | Uses the in-memory Express rate limiter. |
| Local Vite development | `POST /api/summarize` | `backend/src/server.ts`, reached through the Vite proxy | Used by summary work and the evaluation runner. |
| Vercel | `GET /api/live-token` | `frontend/api/live-token.ts` | Vercel-only adapter using the server-side key and Vercel Firewall. |
| Vercel | `POST /api/summarize` | Not provided by the current frontend project | `backend/` owns this route; deploying it is outside Issue #39. |

The browser-facing live-token path and response contract stay identical in both
environments. The frontend therefore needs no server origin setting.

## `frontend/api/live-token.ts` decision

The function is intentional Vercel-only server code, not browser code and not a
replacement for the full Express service. It remains inside `frontend/` because
Vercel's Vite integration discovers Functions in an `api/` directory at the
project root. Keeping all of its imports inside that root also avoids relying on
the optional "include source files outside the Root Directory" project setting.

The Vercel and Express live-token adapters currently implement the same external
contract in different runtimes. A new shared workspace package was rejected for
this issue because it would expand a path normalization into a build-system and
deployment-boundary rewrite. Contract changes must update both route test suites
and `frontend/src/lib/translation/tokenProvider.test.ts`. The Vercel function
already reuses the frontend package's language types, interpreter instruction,
and Live configuration where those are safe on the server.

Relevant platform behavior is documented in Vercel's
[Vite guide](https://vercel.com/docs/frameworks/frontend/vite) and
[monorepo Root Directory guidance](https://vercel.com/docs/monorepos).

## Environment ownership

| Location | Intended use |
| --- | --- |
| `frontend/.env.example` | Non-secret, build-time browser resource settings only. |
| `backend/.env.example` | Local Express process settings. Copy to `backend/.env`; do not commit the result. |
| Root `.env.example` | Combined server-operator reference and supported fallback for a root `.env` read by `backend/`. |
| Vercel Project Settings | Server-only deployment values such as `GEMINI_API_KEY`, model/token settings, and `LIVE_TOKEN_RATE_LIMIT_ID`. |

Never create a `VITE_GEMINI_API_KEY`; Vite would place it in the client bundle.

## Commands and deployment handoff

Run frontend commands from `frontend/` and backend commands from `backend/`:

```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
```

```bash
cd backend
npm ci
npm run check
npm test
npm run build
```

When this structure becomes the deployment source, the Vercel project Root
Directory must be `frontend`. Issue #31 owns the repository-side deployment
configuration, canonical URL, server-side secret checklist, and deployed smoke
test; this issue does not change an account setting or create another project.

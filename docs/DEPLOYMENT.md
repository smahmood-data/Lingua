# Vercel Deployment Runbook

The one canonical production URL is
[`https://try-lingua.vercel.app`](https://try-lingua.vercel.app). Repair and retain
the existing Vercel project; do not create a second deployment to
work around configuration drift.

## Current verified state

Checked on 2026-09-02 with `npm run smoke:deployment`:

| Check | Observed state |
| --- | --- |
| Canonical `try-lingua` homepage | HTTP 200, current Lingua Vite shell |
| Canonical `GET /api/live-token?target=en` | HTTP 200, constrained `auth_tokens/` token, `Cache-Control: no-store` |
| Firewall rule | Active — the Function does not fail closed with HTTP 503 |
| Production deployment source | Current `main`; the served bundle hash matches a local `main` build |
| GitHub repository website | Still the dead `https://bridge-umber-chi.vercel.app` (HTTP 404) |

The deployed application is healthy. The one remaining defect is the GitHub
repository website field, which is an owner-only setting.

### Original diagnosis (2026-08-30)

Kept because it explains why `vercel.json` and this runbook exist:

| Check | Observed state |
| --- | --- |
| Canonical `GET /api/live-token?target=en` | HTTP 500: `GEMINI_API_KEY is not configured on the server.` |
| Production deployment source | Commit `5d94c13` on `main` |
| Issue #30 preview before the rename | Successful with `Bridge` as the package path |
| Issue #39 preview after the rename | Failed before an application smoke check |
| Local Vercel linkage/config | No committed `.vercel` project link and no prior `vercel.json` |

The #30/#39 contrast indicated that the Vercel project's Root Directory still
pointed at the removed `Bridge` directory. That inference was correct: the
project now builds `frontend/` and serves current `main`.

## Repository-owned deployment contract

The deployed project root is `frontend/`. Its committed `vercel.json` pins:

- Framework: Vite
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `dist`

`frontend/package.json` pins Node.js 24.x, matching frontend CI and Vercel's
supported LTS runtime. `frontend/api/live-token.ts` remains under the project
root so Vercel discovers it as `/api/live-token`. It imports no files outside
`frontend/`, so the "include source files outside the Root Directory" setting
is not required.

Never commit `.vercel/`, `.env.local`, a Vercel token, an organization/project
ID, or a Gemini key. `.vercel/` is intentionally ignored.

## Owner-only project repair

Steps 1–7 below have been applied and are confirmed by the smoke check above.
They are retained as the reproducible configuration for this project, and as
the recovery procedure if the deployment drifts again.

**Step 8 is still outstanding** and is the only known remaining defect.

1. In **Settings → Git**, confirm the connected repository is
   `smahmood-data/Lingua` and the Production Branch is `main`. Do not make a
   feature branch the production source.
2. In **Settings → Build and Deployment**, change **Root Directory** from
   `Bridge` to `frontend`. Save it before redeploying.
3. Leave framework/build/install/output values controlled by the committed
   `frontend/vercel.json`. Confirm the dashboard does not retain a conflicting
   override.
4. In **Settings → Environment Variables**, add `GEMINI_API_KEY` as a sensitive,
   server-side value for **Production**. Add it to **Preview** only if preview
   branches are intended to create real tokens. Never use a `VITE_*` name.
5. Create and publish the Vercel Firewall rate-limit rule described below.
6. Trigger a new deployment of the latest `main`. Environment-variable changes
   affect only new deployments, so an existing deployment must be redeployed.
7. In **Settings → Domains**, confirm `try-lingua.vercel.app` targets the latest
   successful production deployment.
8. **Outstanding.** Change the GitHub repository website field from the dead
   `bridge-umber-chi` URL to `https://try-lingua.vercel.app`, and add a
   repository description and topics. These are GitHub settings, not Vercel
   ones, and require repository Admin access.

## Server environment variables

| Variable | Vercel use |
| --- | --- |
| `GEMINI_API_KEY` | Required secret for the Function. Production is mandatory; Preview is optional and should be enabled deliberately. |
| `GEMINI_API_BASE_URL` | Optional server-only override; omit to use the tested Google `v1beta` endpoint. |
| `GEMINI_LIVE_MODEL` | Optional server-only override; omit to use the repository fallback. |
| `LIVE_TOKEN_TTL_MINUTES` | Optional positive-integer token lifetime override. |
| `LIVE_NEW_SESSION_TTL_SECONDS` | Optional positive-integer new-session window override. |
| `LIVE_TOKEN_RATE_LIMIT_ID` | Optional rule ID override; defaults to `lingua-live-token`. |
| `LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS` | Optional retry-guidance window; keep it equal to the published firewall window. |
| `VITE_LIVE_IDLE_TIMEOUT_SECONDS` | Optional public build-time idle timeout; not a secret. |
| `VITE_LIVE_IDLE_WARNING_SECONDS` | Optional public build-time warning lead; not a secret. |

`LIVE_TOKEN_RATE_LIMIT_MAX` and `TRUST_PROXY_HOPS` belong to the local Express
service, not the Vercel Function. On `main` `GEMINI_SUMMARY_MODEL` is unnecessary
for Vercel because it does not deploy `/api/summarize`; after `PR #47` Vercel
uses it for the new `frontend/api/summarize.ts` adapter, so set it alongside
`GEMINI_API_KEY` when that change is live.

## Required Vercel Firewall rule

Create and publish an `@vercel/firewall` rate-limit rule with:

- ID: `lingua-live-token`
- Key: client IP
- Algorithm: fixed window
- Limit: 60 requests
- Window: 600 seconds
- Exceeded action: HTTP 429

The Function intentionally fails closed with HTTP 503 if this rule is missing,
blocked, or unavailable. If the dashboard threshold changes, keep
`LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS` aligned so `Retry-After` guidance remains
accurate. See [`SECURITY.md`](./SECURITY.md) for the policy and its limitations.

## Verification

Before deployment, run the same local checks as CI:

```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
```

After a new production deployment, run:

```bash
cd frontend
npm run smoke:deployment -- https://try-lingua.vercel.app
```

The smoke command verifies the HTML shell, calls
`GET /api/live-token?target=en`, requires the exact safe response fields,
checks the constrained `auth_tokens/` shape and expiry bounds, and requires
`Cache-Control: no-store`. It creates one real token but validates it only in
memory and never prints it.

Then perform the browser-only check that cannot be completed from the
repository:

1. Open the canonical URL and confirm the current UI loads.
2. Grant microphone permission and start a session.
3. Confirm startup reaches a live connection, speak a short phrase, and confirm
   translated audio/transcript activity.
4. Stop the session and confirm the microphone is released.
5. Inspect Vercel Function logs for configuration, firewall, or Gemini errors.

## Failure map

| Symptom | Check |
| --- | --- |
| Build fails immediately after the rename | Root Directory must be `frontend`, not `Bridge`. |
| Homepage returns `DEPLOYMENT_NOT_FOUND` | The URL/domain is stale or not assigned to this project. |
| `/api/live-token` returns HTTP 500 Configuration Error | Add `GEMINI_API_KEY` to the correct environment and create a new deployment. |
| `/api/live-token` returns HTTP 503 protection-not-configured | Publish the `lingua-live-token` firewall rule in this project/environment. |
| `/api/live-token` returns HTTP 503 protection-unavailable | Inspect Vercel Firewall and Function logs; do not bypass the fail-closed check. |
| `/api/live-token` returns HTTP 429 | The limit is operating; honor `Retry-After` rather than increasing it for a smoke test. |

Repair the existing project and repeat the checks. Do not route around a failed
configuration with an unrelated deployment.

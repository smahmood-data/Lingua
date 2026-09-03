# Security and abuse protection

This document covers where the Gemini credential lives, what the browser is
allowed to do with the token it receives, and the limits of the abuse
protection in front of token creation.

## The key boundary

The long-lived `GEMINI_API_KEY` is only ever held server-side:

- in the Express process during local development, and
- in the Vercel Function at deployment.

The browser never receives it. It receives a short-lived Live API token
instead. A key placed in a `VITE_*` variable would be compiled into the client
bundle, so that name is never used for a credential.

The deployed bundle can be checked directly:

```bash
curl -s https://try-lingua.vercel.app | grep -o '/assets/[^"]*\.js' | head -1
# then fetch that file and search it for a key prefix
```

## What the token can do

The token the browser receives is deliberately narrow:

- It is prefixed `auth_tokens/`. `@google/genai` keys its ephemeral handling off
  that prefix; a value without it would be sent as a long-lived API key. The
  client rejects anything else, so a misconfigured server cannot turn into a
  credential leak.
- `uses: 1` — it starts exactly one Live session.
- That session must start within 60 seconds by default, and the token expires
  after 30 minutes. Both are server-adjustable.
- It locks the Live Translate model, audio output, transcription, and the
  target-language translation configuration, and enables no tools.
- The browser does not automatically reconnect or resume a closed session.

An open session also ends after five minutes without Gemini-detected speech,
warning 15 seconds beforehand. Both intervals are configurable through the
non-secret Vite settings documented in the [frontend README](../frontend/README.md).

## Rate limiting

### Local Express

The default anonymous policy allows 60 successful token creations per client IP
in a fixed 10-minute window. A normal explicit-language conversation creates two
tokens, so the default leaves room for roughly 30 starts — or 15 people each
making one full restart — behind the same public IP in that window. Keeping a
conversation open does not itself create more tokens.

A limited request returns HTTP 429 with a short explanation, a stable error
code, `retryAfterSeconds`, and `Retry-After`. Invalid requests and upstream
failures do not consume the successful-token allowance.

`LIVE_TOKEN_RATE_LIMIT_MAX` and `LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS` adjust
the policy.

The counter is intentionally in memory because Express is the single-process
local-development path. Keep `TRUST_PROXY_HOPS=0` when it is reached directly.
Behind a reverse proxy, set it only to the exact number of trusted hops, and
only after confirming the last proxy overwrites `X-Forwarded-For`. A
multi-process or public Express deployment would need a shared store.

### Vercel

The Function uses Vercel Firewall for a distributed counter. Before deploying,
create and publish an `@vercel/firewall` rate-limit rule with ID
`lingua-live-token`, a fixed window of 60 requests per 600 seconds, the client
IP as its key, and 429 as its exceeded action.

The rule ID can be changed with the server-only `LIVE_TOKEN_RATE_LIMIT_ID`. If
the window changes, set `LIVE_TOKEN_RATE_LIMIT_WINDOW_SECONDS` to match so
retry guidance stays accurate.

The Function returns an actionable HTTP 503 and does not contact Gemini when the
rule is missing, blocked, or unavailable. A deployment cannot silently fail
open.

## What this does not protect against

Stated plainly, because the gap matters more than the control:

- This is a **per-IP** control. It is not identity, and it is not a spending
  cap.
- Vercel Firewall counters are **regional**, so a distributed client or
  multi-region traffic can exceed the nominal project-wide total.
- Authentication, a human challenge, a global quota, and usage-based session
  accounting are separate layers that a broader public service would need.

## Reporting

This is a student hackathon project, not a production service. If you find a
security problem, please open an issue — or, for anything involving a live
credential, contact the repository owner directly rather than filing publicly.

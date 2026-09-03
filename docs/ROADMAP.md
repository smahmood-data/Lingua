# Lingua Roadmap

Lingua is a live voice interpreter for conversations where misunderstanding is
expensive. One phone or laptop sits between two people. It detects the spoken
language (or uses an explicit pair), translates into any of 79 target languages,
speaks the translation aloud, and shows both sides as bilingual subtitles.

The original hackathon slice was a one-laptop Urdu ↔ English prototype. That
work is done. The product is now the broader interpreter described here.

Accounts, server-side storage, call integrations, and true sharing stay out of
scope until privacy, consent, and access-control decisions exist.

## Built

- Secure ephemeral Live-token exchange. The long-lived Gemini key never reaches
  the browser. Local Express and the Vercel Function implement the same
  `/api/live-token` contract.
- Per-IP abuse protection and idle-session cleanup.
- Automatic spoken-language detection, plus explicit source/target pairs.
- Live translation into 79 target languages, spoken aloud.
- Two concurrent Gemini Live routes coordinated as one conversation — turn
  ownership, utterance joining, and language arbitration.
- Live bilingual subtitles with per-turn language labels.
- A single interpreter canvas: idle, live session, and ended-conversation
  compositions. Light and dark themes follow the system setting.
- CI, trace-replay regression tests, and a scored summary-extraction benchmark.
- A deployed demo at [bridgev1.vercel.app](https://bridgev1.vercel.app).

Completed hackathon issues (#1–#4, plus the live-audio follow-ups through
[#22](https://github.com/smahmood-data/Lingua/issues/22) and the interpreter
overhaul in [#27](https://github.com/smahmood-data/Lingua/issues/27)) are
history, not remaining work.

## Partial

- **Structured summary.** `POST /api/summarize` and the evaluation harness in
  [`eval/`](../eval) exist and are tested. On `main` nothing in the UI calls
  them and Vercel does not serve the route; `PR #47` adds the UI, `localStorage`
  history, and a Vercel `POST /api/summarize` adapter aligned with the backend
  contract. Finishing the product path is
  [#5](https://github.com/smahmood-data/Lingua/issues/5). Provenance grounding
  is [#25](https://github.com/smahmood-data/Lingua/issues/25). Persistent
  history is not a prerequisite for the summary.
- **Barge-in.** Implemented and unit-tested, shipped disabled
  (`BARGE_IN_ENABLED = false`). The echo gate false-triggered on continued
  speech and speaker residue in recorded sessions. Re-enable or redesign after
  [#29](https://github.com/smahmood-data/Lingua/issues/29). Tracked as
  [#28](https://github.com/smahmood-data/Lingua/issues/28).

## Next

The immediate priority is making Auto Detect, turn boundaries, and two-route
language arbitration reliable. History and export wait until that contract is
stable.

| Order | Work | Issue |
| --- | --- | --- |
| 1 | Stabilize Auto Detect, turn boundaries, and language arbitration | [#29](https://github.com/smahmood-data/Lingua/issues/29) |
| 2 | Define conversation-side semantics for the transcript | [#33](https://github.com/smahmood-data/Lingua/issues/33) |
| 3 | Wire the existing summary API into a summary UI | [#5](https://github.com/smahmood-data/Lingua/issues/5) |
| 4 | Keep the translated voice consistent across turns | [#34](https://github.com/smahmood-data/Lingua/issues/34) |
| 5 | Microphone-level telemetry and an amplitude-driven waveform | [#35](https://github.com/smahmood-data/Lingua/issues/35) |
| 6 | Reliable barge-in during translated playback | [#28](https://github.com/smahmood-data/Lingua/issues/28) |
| 7 | Persistent conversation history and search | [#36](https://github.com/smahmood-data/Lingua/issues/36) |
| 8 | Local transcript export | [#37](https://github.com/smahmood-data/Lingua/issues/37) |

[#35](https://github.com/smahmood-data/Lingua/issues/35) can proceed in
parallel with [#29](https://github.com/smahmood-data/Lingua/issues/29).
[#28](https://github.com/smahmood-data/Lingua/issues/28) depends on #29.
[#5](https://github.com/smahmood-data/Lingua/issues/5) does not depend on
[#36](https://github.com/smahmood-data/Lingua/issues/36).

> **PR #47 note:** `PR #47` (`feat/end-of-conversation`) implements [#5],
> [#36], and [#37] on this branch with `localStorage` persistence and Vercel
> summary parity, pending final review. The language-based attribution limitation
> (no diarization) remains and is documented in `ARCHITECTURE.md`.

## Deferred

- **Saved history, search, and transcript export** are not built. Local export
  ([#37](https://github.com/smahmood-data/Lingua/issues/37)) is a user-controlled
  download of the current conversation. It is not sharing.
- **True sharing or cloud sync** needs backend storage, access control,
  retention, consent, and privacy decisions. Do not treat it as a follow-on of
  local export.
- **Accounts and identity.**
- **Third-party call integrations.**
- **Spending caps and identity-based rate limits.** The current limit is per-IP
  and protects a demo; see [`SECURITY.md`](./SECURITY.md).

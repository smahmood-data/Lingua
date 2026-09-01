# AI Usage

The supplied CTP Hacks planning notes say AI coding tools are permitted and that their use must be documented. Confirm that requirement against the official event rules, then keep this file as a living record and update it in the same pull request as AI-assisted work.

## Tools used so far

| Tool | How it was used | Human review or changes |
| --- | --- | --- |
| ChatGPT | Explored the Lingua concept, MVP scope, stack, architecture, and five-hour build order. | The team selected the Lingua direction and rejected unnecessary MongoDB, authentication, and integrations for the MVP. |
| Claude | Produced general hackathon strategy covering repository hygiene, collaboration, judging, demo preparation, and submission artifacts. It also proposed a separate phishing product that is **not** Lingua. | Only the applicable process advice was retained. The phishing architecture, evaluation plan, and pitch were not adopted. |
| OpenAI Codex | Inspected the repository and drafted the initial README, hackathon plan, contribution workflow, environment template, and this disclosure. | The team must review these documents for accuracy and update ownership, implementation details, and decisions as work progresses. |

## Per-change log

Add a row whenever an AI tool materially helps create or revise code, tests, prompts, designs, or documentation.

| Date | Contributor | Tool | Files or feature | What AI proposed | What the contributor verified or changed |
| --- | --- | --- | --- | --- | --- |
| 2026-08-27 | emmakatz06 | Codex | Interpreter UI, bilingual subtitles, status states, and keyboard navigation in `frontend/src/App.tsx` and `frontend/src/App.css` | Replaced the Vite starter with a mock bilingual interpreter screen, direction-aware transcript data, demo states, and keyboard control navigation | Reviewed the UI behavior in the local Vite demo, adjusted wording and colors, verified Urdu RTL/wrapping behavior, and confirmed build and lint pass. |
| 2026-08-27 | team review pending | Cursor Cloud Agent | Visual overhaul of the interpreter UI on top of PR #14: `frontend/src/App.tsx`, `App.css`, `index.css`, `index.html`, and new `components/`, `hooks/`, `data/`, and `types.ts` | Restructured the screen into a top bar (brand, language pair, live status), a transcript-first reading surface, and a bottom control dock; self-hosted Inter and Noto Nastaliq Urdu type; moved mock data and keyboard navigation into their own modules without changing behavior | Verified lint and build pass, all six UI states, both directions, Urdu RTL and long-text wrapping, and keyboard navigation in headless Chrome at 1440/1024/390 px; team review still required. |
| 2026-08-27 | Adil / team review pending | Codex | Initial project documentation | Repo assessment, MVP documentation, workflow, and environment scaffolding | Confirmed repository state and official Gemini documentation; team review still required. |
| 2026-08-27 | Adil / team review pending | Codex | Prototype roadmap, GitHub issues #1–#7, CI, and PR workflow | Drafted ordered scope, linked dependencies, acceptance criteria, story-point estimates, labels, CI, and repository-setting guidance | Removed third-party call integration, simplified labels, kept story points in issue bodies, and left ownership unassigned for the team to decide. |
| 2026-08-27 | Jawmis / team review pending | Codex | Secure Gemini backend for issue #1 | Implemented the TypeScript Express server, constrained ephemeral Live token route, structured summary route, validation, tests, and setup documentation | Independently reviewed official Gemini API formats, aligned direction names with the audio branch, tested local routes, and verified builds, lint, audit, and secret scans. Live token creation was verified; summary testing reached Gemini but was limited by free-tier quota. |
| 2026-08-27 | Adil | Claude | Issue #2 Urdu → English live audio pipeline (`frontend/src/lib/translation/`, `useTranslationSession`) | Scaffolded the capture/PCM/transport/playback/session split, the Gemini Live integration, and the error and cleanup handling; investigated three external code reviews and proposed the resulting fixes | Adil reviewed and integrated the changes and ran lint, build, and the local logic and lifecycle checks. Real Urdu → English translation remains unverified and now depends on the merged backend, valid credentials, and browser microphone access. |
| 2026-08-27 | Adil | OpenAI Codex | Issue #2 post-merge integration and hygiene (`main`/#1 into `feat/2-urdu-english-audio`) | Audited repository artifacts and reconciled the backend token, model, configuration, shared direction type, and documentation contracts | Reviewed the merged diff, aligned the Live Translate model and target-language echo behavior, confirmed clean hygiene, and ran frontend lint/build, backend check/build/tests, and a mocked token-contract smoke test. Credentialed browser end-to-end testing remains pending. |
| 2026-08-27 | Adil | OpenAI Codex | Issue #3 English → Urdu audio flow | Assisted with implementation and debugging of the reverse translation control and shared-session lifecycle | Adil reviewed, tested, and integrated the changes. |
| 2026-08-29 | Adil | Claude | Issue #27 interpreter UI overhaul and polish | Assisted with the unified conversation canvas, responsive layout, theme treatment, language selector, header alignment, session-state presentation, and visual QA/refinement. | Adil directed the visual design, provided reference images, manually tested the live app in light/dark modes and real multilingual conversations, identified follow-up defects, and reviewed the resulting UI before integration. |
| 2026-08-29 | Adil | OpenAI Codex | Issue #27 final language-selector and idle-state polish | Completed the inline-SVG language flag mappings, added focused flag tests, and expanded the curated idle-message set. | Adil specified the flag-selection policy, reviewed the resulting selector, and verified the final UI before committing. |
| 2026-08-30 | Adil / team review pending | OpenAI Codex | Issue #30 live-token abuse and resource protection | Preserved and audited the completed local implementation, isolated it from PR #38 in a dedicated stacked worktree, reviewed the serverless and Express rate limits, safe client errors, idle-session cleanup, tests, and deployment documentation, and reran the full repository verification. | Adil had already tested and manually sanity-checked the implementation; final teammate review remains required before the stacked PR is opened. |
| 2026-08-30 | Adil / team review pending | OpenAI Codex | Issue #39 repository structure and deployment boundaries | Audited package, CI, local proxy, API, test, environment, documentation, and Vercel-root relationships; proposed the minimal `Bridge/` to `frontend/` normalization and documented the final runtime ownership and deployment handoff. | The branch preserves application logic, updates every operational path reference, and is subject to the full frontend/backend verification and teammate review before its stacked PR is opened. |

## Team responsibility

AI output is not accepted blindly. The contributor who commits a change is responsible for:

- reading and understanding it;
- testing the behavior they claim works;
- checking security and privacy implications;
- correcting inaccurate generated comments or documentation;
- explaining the implementation during judging; and
- never placing private conversation data, credentials, or personal information into an AI prompt.

## Before submission

- Ensure every AI-assisted feature has an entry above.
- Remove claims that are no longer accurate.
- Have each contributor explain the files they own to the rest of the team.
- Confirm that the demo, README, and Devpost description match the actual implementation.

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
| 2026-08-27 | Adil / team review pending | Codex | Initial project documentation | Repo assessment, MVP documentation, workflow, and environment scaffolding | Confirmed repository state and official Gemini documentation; team review still required. |
| 2026-08-27 | Adil / team review pending | Codex | Prototype roadmap, GitHub issues #1–#7, CI, and PR workflow | Drafted ordered scope, linked dependencies, acceptance criteria, story-point estimates, labels, CI, and repository-setting guidance | Removed third-party call integration, simplified labels, kept story points in issue bodies, and left ownership unassigned for the team to decide. |
| 2026-08-27 | Jawmis / team review pending | Codex | Secure Gemini backend for issue #1 | Implemented the TypeScript Express server, constrained ephemeral Live token route, structured summary route, validation, tests, and setup documentation | Independently reviewed official Gemini API formats, aligned direction names with the audio branch, tested local routes, and verified builds, lint, audit, and secret scans. Live token creation was verified; summary testing reached Gemini but was limited by free-tier quota. |

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

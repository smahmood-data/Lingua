# Contributing to Lingua

Lingua is a four-person hackathon project. The workflow below keeps parallel work understandable and gives every teammate meaningful ownership.

## Before coding

1. Pick or create a GitHub issue with a concrete acceptance criterion.
2. Assign the issue to its owner.
3. Create a focused branch from the latest `main`.

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description
```

Suggested workstreams:

- `feature/live-audio` — microphone, ephemeral token, Live API, playback
- `feature/conversation-ui` — language setup, conversation, subtitles
- `feature/summary-api` — transcript schema, Gemini extraction, validation, tests
- `feature/summary-ui` — summary cards, accessibility, README, demo, pitch

Avoid having multiple teammates make large simultaneous edits to `Bridge/src/App.tsx`. Agree on component boundaries early and commit new components in separate files.

## Commits

Use small, meaningful commits:

```text
feat: stream microphone audio to live session
fix: clear playback buffer after interruption
test: reject malformed summary response
docs: record Gemini prompt assistance
```

If two people genuinely pair on a change, add a co-author trailer with the other contributor's real Git email. Do not use co-authorship merely to balance statistics.

## Pull requests

- Link the issue (`Closes #12`).
- Describe what changed and how it was tested.
- Keep credentials, raw personal conversations, and generated audio out of Git.
- Request a teammate review.
- Reviewers should leave at least one substantive observation or question when warranted; do not manufacture comments when there is nothing useful to say.
- Merge only after the build and lint checks pass.

Suggested pull request body:

```markdown
## What changed

## How to test

## Risks or limitations

## AI assistance

Closes #
```

## Definition of done

A feature is done when:

- its acceptance criterion works on the demo laptop;
- failure and empty states are handled;
- relevant model output is validated;
- tests or a documented manual test cover the important behavior;
- the contributor can explain the implementation; and
- `AI_USAGE.md` is updated when applicable.

## Final repository check

Before submission:

```bash
git status --short
git shortlog -sne --all
secret_name='GEMINI_API_KEY'
secret_pattern="AIza[0-9A-Za-z_-]{20,}|${secret_name}="
if git grep -nE "$secret_pattern" -- ':!.env.example' ':!**/.env.example'; then
  echo "Potential credential found; inspect the matches before continuing." >&2
  exit 1
fi
cd Bridge && npm run lint && npm run build
```

Review any secret-scan match manually. Keep the GitHub repository public if that is required by the official hackathon rules, and confirm those rules directly rather than relying only on planning notes.

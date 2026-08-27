# Required GitHub Repository Settings

These settings require repository Admin access. The repository owner should apply them before feature work is merged.

## Protect `main`

In **Settings → Branches**, add a branch protection rule for `main`:

- Require a pull request before merging.
- Require 1 approving review.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merging.
- Require linear history.
- Do not allow bypassing the rule, including administrators.
- Do not allow force pushes.
- Do not allow branch deletion.

After the CI workflow has completed successfully at least once, require the `Frontend checks` status check. Do not select “Require branches to be up to date” during the hackathon unless merge conflicts become a recurring problem; it creates extra rebasing work for short-lived branches.

## Pull request behavior

In **Settings → General → Pull Requests**:

- Enable squash merging.
- Disable merge commits.
- Disable rebase merging to keep one consistent team workflow.
- Enable automatic deletion of head branches after merge.

Recommended squash commit format: pull request title and number.

## Collaborator access

Keep contributors at Write access so they can create branches and pull requests. Branch protection—not removal of Write access—prevents direct changes to `main`.

Do not grant Admin access merely so contributors can merge. The repository owner should retain Admin access for settings and emergency recovery.

## Security

- Enable Dependabot alerts and security updates if available.
- Never store `GEMINI_API_KEY` as a client-side or `VITE_*` variable.
- If deployment requires a key, store it in the hosting provider's server-side secret manager.
- Do not add a Gemini key to GitHub Actions unless a test truly calls Gemini; the current CI does not need one.
- Keep the repository public if required by the official hackathon rules.

## Working agreement

- One issue per branch.
- One pull request per issue.
- At least one teammate reviews every pull request.
- The author does not approve their own pull request.
- Use `Closes #<issue>` so merging closes the issue automatically.
- Do not merge with failing or pending required checks.
- Record material AI assistance in `AI_USAGE.md`.

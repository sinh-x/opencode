---
name: git-workflow
description: Repo-local branch strategy for the sinh-x/opencode fork. Use before creating branches, editing files, syncing upstream, or preparing PRs in this repository.
---

# OpenCode Fork Git Workflow

This repository is Sinh's fork of `anomalyco/opencode`. Keep upstream-compatible code and Sinh-specific customizations on separate branch paths.

## Branch Roles

- `dev` tracks `upstream/dev` only.
- `sinh-x-dev` is the long-lived integration branch for Sinh-specific and PA-managed OpenCode customizations.
- `feat/...` branches for personal work must branch from `sinh-x-dev` and target `sinh-x-dev`.
- `dev` must not receive Sinh-specific feature work.

## Base Branch Selection

Use `sinh-x-dev` as the base when the work is:

- Sinh-specific OpenCode customization.
- PA-managed workflow customization.
- Branch strategy or repo-local agent guidance.
- Side-panel, launch variable, metadata, or local workflow behavior.

Use `dev` only when the work is:

- Mirroring `upstream/dev` into the fork's upstream-tracking branch.
- Preparing an upstream-compatible change that should not include Sinh-specific customization.

If unsure, stop and ask. Do not default personal work to `dev`.

## Starting Personal Feature Work

```bash
git fetch origin upstream
git checkout sinh-x-dev
git pull --ff-only origin sinh-x-dev
git checkout -b feat/<short-topic>
```

Open PRs from `feat/<short-topic>` into `sinh-x-dev` only.

Examples:

- `feat/branch-strategy` from `sinh-x-dev` to `sinh-x-dev`
- `feat/side-panel-launch-vars` from `sinh-x-dev` to `sinh-x-dev`

## PR Title Format

Use conventional commit format for PR titles:

```text
<type>(<scope>): <summary>
```

Allowed types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Use the affected package or area as the scope when practical, such as `app`, `desktop`, `opencode`, or `branch-strategy`.

Do not prefix the PR title with the ticket ID. Keep ticket IDs in the PR body, branch name, commit body, or linked PA ticket instead.

Examples:

- `docs(opencode): set up fork branch strategy`
- `feat(opencode): add side panel launch variables`
- `chore(branch-strategy): sync upstream into sinh-x-dev`

## Upstream Sync Flow

Upstream updates flow one way:

```text
upstream/dev -> dev -> sinh-x-dev
```

Before any sync work, run the report-only status script from the repository root:

```bash
sh script/upstream-status.sh
```

Use the report to confirm:

- `origin` and `upstream` are present and readable.
- `dev`, `origin/dev`, `upstream/dev`, `sinh-x-dev`, and `origin/sinh-x-dev` exist.
- Local refs were fetched before comparing branch counts.
- The worktree is clean before checkout, merge, push, conflict resolution, or branch creation.
- `dev...upstream/dev` and `sinh-x-dev...dev` counts match the intended sync direction.

If the report warns about a dirty worktree, missing remotes, missing refs, or stale branch expectations, stop and resolve that condition before continuing. Do not start a mutating sync step from the wrong branch or with uncommitted work.

### Interactive OpenCode Sync Sequence

In PA/OpenCode-guided sessions, checkout, merge, push, conflict resolution, and branch creation are mutating operations. Agents must ask Sinh for explicit confirmation immediately before each mutating operation. Do not infer permission from the fact that the sync was requested.

Recommended interactive sequence:

```bash
sh script/upstream-status.sh
# Ask Sinh before checking out dev.
git checkout dev
# Ask Sinh before merging upstream/dev into dev.
git merge --ff-only upstream/dev
# Ask Sinh before publishing the updated upstream mirror.
git push origin dev
# Ask Sinh before checking out sinh-x-dev.
git checkout sinh-x-dev
# Ask Sinh before merging dev into sinh-x-dev.
git merge dev
# Ask Sinh before publishing the updated personal integration branch.
git push origin sinh-x-dev
```

Safety gates:

- Run `sh script/upstream-status.sh` first and share the result with Sinh.
- Confirm with Sinh before checking out `dev`.
- Update `dev` only from `upstream/dev`, preferably with `git merge --ff-only upstream/dev`.
- Push `origin/dev` only after Sinh confirms this is an upstream mirror update.
- Confirm with Sinh before checking out `sinh-x-dev` and merging `dev` into it.
- Push `origin/sinh-x-dev` only after Sinh confirms the merge result.
- Stop if the current branch does not match the branch required for the next step.

Do not add release publishing, npm publishing, tag creation, or upstream PR submission steps to this workflow. Sinh-specific customizations do not go upstream by default.

### Conflict Path

`dev` is upstream-tracking only. Do not resolve personal customization conflicts by editing `dev`.

If `dev -> sinh-x-dev` cannot merge directly, ask Sinh before choosing one of these paths:

- Resolve the conflict on `sinh-x-dev`, then continue through the normal `sinh-x-dev` review/push path.
- Create `sync/upstream-<date>` from `sinh-x-dev`, merge `dev` there, resolve conflicts there, and target the result back to `sinh-x-dev`.

Do not target `dev` from `sync/upstream-<date>`. Do not merge `sinh-x-dev` into `dev` to resolve conflicts.

## Prohibited Flows

- Do not merge `sinh-x-dev` into `dev`.
- Do not merge `feat/...` personal branches into `dev`.
- Do not submit Sinh-specific customizations to `upstream/dev` unless Sinh explicitly requests it as separate upstream work.
- Do not use `dev` as the base branch for PA-managed personal customization work.
- Do not use `sync/upstream-<date>` branches to target `dev`; they target `sinh-x-dev` only.

## Branch Protection Requirements

Protect `dev` with:

- Required pull request or controlled upstream-sync process.
- Required status checks before merge.
- Direct personal pushes disabled.
- No personal feature branches targeting `dev`.

Protect `sinh-x-dev` with:

- Pull requests required for normal changes.
- Required lightweight CI checks, with `typecheck` as the default required check.
- Full unit/e2e workflows are optional or manual for high-risk changes; they are not required for every `sinh-x-dev` PR.
- Sinh/admin override available for emergencies.

## Agent Checklist

Before editing this repo:

- Read `AGENTS.md`.
- Read `.opencode/branch-strategy.yaml`.
- Confirm whether the work is upstream-compatible or Sinh-specific.
- Confirm the current branch is the expected `feat/...` branch for Sinh-specific work.
- Stop instead of switching branches if a PA deployment explicitly says branch management is owned by the orchestrator.

Before guiding upstream sync work:

- Run `sh script/upstream-status.sh` and review the output with Sinh.
- Stop on dirty worktree state, wrong branch, missing remotes, missing refs, stale refs, or any proposed prohibited flow.
- Ask Sinh before checkout, merge, push, conflict resolution, or branch creation.
- Keep `dev` as the upstream-tracking mirror of `upstream/dev` only.
- Keep Sinh-specific and PA-managed customizations on `sinh-x-dev` or feature branches targeting `sinh-x-dev`.

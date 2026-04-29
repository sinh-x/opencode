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

Recommended sync sequence:

```bash
git fetch upstream origin
git checkout dev
git merge --ff-only upstream/dev
git push origin dev
git checkout sinh-x-dev
git merge dev
git push origin sinh-x-dev
```

Resolve conflicts on `sinh-x-dev` or on a temporary `sync/upstream-<date>` branch targeting `sinh-x-dev`. Do not resolve personal customization conflicts by editing `dev`.

## Prohibited Flows

- Do not merge `sinh-x-dev` into `dev`.
- Do not merge `feat/...` personal branches into `dev`.
- Do not submit Sinh-specific customizations to `upstream/dev` unless Sinh explicitly requests it as separate upstream work.
- Do not use `dev` as the base branch for PA-managed personal customization work.

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

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

## Agent Sync

The agent-executable script `script/sync-upstream.ts` automates the upstream → dev → sinh-x-dev sync flow described in **Upstream Sync Flow** above. PA agents (builder, maintenance) MUST use this script instead of running the interactive git sequence by hand. The manual sequence above remains for non-PA / human-driven syncs.

### Sync Branch Workflow

The script always uses a dated sync branch to isolate the merge:

```text
upstream/dev -> dev -> sync/upstream-YYYY-MM-DD -> PR -> sinh-x-dev
```

- `dev` is fast-forward merged from `upstream/dev` and pushed to `origin/dev` (upstream mirror update only).
- `sync/upstream-YYYY-MM-DD` is created from the base branch (`sinh-x-dev`, default) on the day the sync runs.
- `dev` is merged into the sync branch.
- If the merge is clean, the script runs `bun typecheck`, then pushes the sync branch and opens a PR targeting `sinh-x-dev` via `gh pr create`.
- The PR review is the human gate — no auto-merge.
- On conflict, the script halts and hands the merge back to the human (see **Failure Modes** below).

### Invocation

From the repository root:

```bash
bun run script/sync-upstream.ts            # full sync (health → fetch → merge → typecheck → push → PR)
bun run script/sync-upstream.ts --dry-run  # health checks only; no mutations (safe, no confirmation needed)
bun run script/sync-upstream.ts --base-branch <name>  # override the base branch (default: sinh-x-dev)
bun run script/sync-upstream.ts --help      # show help and exit (safe, no confirmation needed)
```

Pre-conditions the script enforces itself (do not pre-run them by hand unless debugging):

- Current branch is `sinh-x-dev` (or today's sync branch when resuming after a conflict resolution — see Resume).
- Worktree is clean (no staged or unstaged changes).
- `git`, `gh`, and `bun` are on `PATH`.
- `gh auth status` succeeds.
- `origin` and `upstream` remotes are configured.
- `upstream/dev`, `origin/dev`, and `origin/<base-branch>` refs all resolve.

### Confirmation Gates

| Step | Mutation? | Confirmation required? |
|---|---|---|
| `--dry-run` (health checks only) | No | **No** — safe to run automatically |
| `--help` | No | **No** — safe to run automatically |
| Fetch (`git fetch origin && git fetch upstream`) | Remote read + ref update | **No** — does not touch the worktree |
| FF-merge `upstream/dev` into `dev` + push `origin/dev` | Yes | **Yes** — ask Sinh before invoking the script without `--dry-run` |
| Create `sync/upstream-YYYY-MM-DD` from base branch | Yes | **Yes** |
| Merge `dev` into sync branch | Yes | **Yes** |
| `bun typecheck` | No (build/read-only) | No |
| Push sync branch to origin | Yes | **Yes** |
| `gh pr create` targeting `sinh-x-dev` | Yes (opens PR) | **Yes** — PR review is the human gate |

**Rule of thumb:** anything other than `--dry-run` or `--help` performs mutating git operations. Ask Sinh for explicit confirmation immediately before invoking the script without `--dry-run`. Do not infer permission from the fact that a sync was requested — get an explicit "go" first, each run.

### Output Sections

The script emits `::group::`/`::endgroup::` sections (GitHub Actions–friendly) so PA agents can parse the run. In order:

1. **`Pre-sync health checks`** — six named checks, each printed as `  ✓ <name>: <message>` or `  ✗ <name>: <message>`. Ends with `all health checks passed in <ms>ms`.
2. **`Fetch remotes`** — `fetching origin…` / `fetched origin` then the same for `upstream`.
3. **`FR3 — ff-merge upstream/dev into dev, push origin/dev`** — `checked out dev` → `ff-only merged upstream/dev into dev` → `pushed dev to origin/dev`. On resume: `dev already at upstream/dev and pushed — skipping (resume)`.
4. **`FR4 — create sync branch, merge dev`** — `created sync/upstream-YYYY-MM-DD from sinh-x-dev` → `merging dev into …` → `merged dev into sync/upstream-YYYY-MM-DD`. On resume: `sync/upstream-YYYY-MM-DD already exists with dev merged — skipping (resume)`.
5. **`FR8 — bun typecheck (post-merge gate)`** — `running \`bun typecheck\` from repo root…` → `typecheck passed`.
6. **`FR7 — push sync branch + create PR`** — `pushing <branch> to origin…` → `pushed <branch>` → `creating PR via \`gh pr create\`…` → `PR created: <url>`.
7. **Final line** — `✓ phase 4 complete: typecheck passed, sync branch pushed, PR created` followed by `next: phase 5 (agent playbook)`.

Each step reports via the `okLine`/`failLine` convention (`  ✓` / `  ✗`). Step results are also surfaced as a `<step>: <message>` summary line after each section.

### Exit Codes

| Code | Meaning | What to do |
|---|---|---|
| `0` | Success — all steps completed (or `--dry-run` health checks passed) | Report the PR URL to Sinh; await PR review |
| `1` | Error — a health check, fetch, merge (non-conflict), typecheck, push, or PR-creation step failed | See **Failure Modes** below |
| `2` | Conflicts detected — human resolution required (FR5/AC3) | See **Conflict (exit 2)** failure mode below |

### Failure Modes

Each failure mode lists: trigger, what the script did to the repo (NFR2 — never leaves a dirty worktree or detached HEAD), and what the agent must do next.

#### Dirty worktree (health check `worktree-clean`)
- **Trigger:** `git status --porcelain` reports any uncommitted changes.
- **Repo state:** untouched — no mutation ran.
- **Agent action:** report the dirty files to Sinh, ask Sinh to commit or stash, then re-run. Do not run any mutating step until the worktree is clean.

#### Wrong branch (health check `correct-branch`)
- **Trigger:** current branch is not `sinh-x-dev` (and not today's sync branch with the merge already committed — see Resume).
- **Repo state:** untouched.
- **Agent action:** report the found branch vs expected branch to Sinh. Do **not** switch branches yourself if you are in implement mode (branch management is the orchestrator's responsibility). Hand back to the orchestrator or ask Sinh to check out `sinh-x-dev`.

#### Missing tools / gh auth / remotes / refs (health checks `tools-available`, `gh-authenticated`, `remotes-configured`, `refs-exist`)
- **Trigger:** `git`/`gh`/`bun` missing from `PATH`, `gh auth status` fails, `origin`/`upstream` remotes absent, or required refs do not resolve.
- **Repo state:** untouched.
- **Agent action:** report the named failing check and its message to Sinh. For gh auth, suggest `gh auth login`. For missing remotes, suggest the `git remote add` command. For missing refs, suggest `git fetch origin upstream`. Do not proceed until the named check passes.

#### Merge conflict (exit code `2`, step `create-and-merge-sync-branch`)
- **Trigger:** `git merge dev` into the sync branch produces conflicts.
- **Repo state:** the in-progress merge is **left in place** on the sync branch (not aborted) so the human can resolve in-tree. The worktree will show unmerged entries — this is expected.
- **Script output:** prints `✗ MERGE CONFLICTS DETECTED — human resolution required`, the step name, message, file count, and each conflicting file path, followed by four-step resolution instructions.
- **Agent action:**
  1. Report the conflicting files list to Sinh.
  2. Ask Sinh to resolve each conflict: edit → `git add <file>` → `git commit --no-edit`.
  3. After Sinh confirms the merge is committed and the worktree is clean, **re-run the script**. It will detect the sync branch already has `dev` merged (`syncBranchStepAlreadyDone`) and skip to the typecheck step — no manual state cleanup. (FR6/AC5)
  4. If Sinh prefers to abort instead, run `git merge --abort` and re-run the script from scratch.
- **Do not** resolve the conflicts yourself unless Sinh explicitly delegates it — merge-conflict resolution is a human-judgment step (Non-Goal).

#### Typecheck failure (step `typecheck`, exit code `1`)
- **Trigger:** `bun typecheck` returns non-zero after the merge chain succeeds.
- **Repo state:** sync branch is left in place (merged dev intact) for inspection. The script restores the original branch so the repo is not unexpectedly left on the sync branch.
- **Agent action:** report the typecheck error message to Sinh. The fix must land on the sync branch (or upstream must be patched). After Sinh fixes the typecheck error, re-run the script — the merge-chain steps will skip via their resume predicates and the run jumps straight to typecheck. (FR6/AC5)

#### Push failure (step `push-and-create-pr`, exit code `1`)
- **Trigger:** `git push -u origin <sync-branch>` fails (auth, network, or remote rejection).
- **Repo state:** sync branch intact locally; nothing pushed. Original branch restored.
- **Agent action:** report the push error to Sinh. For auth issues, suggest `gh auth login` / SSH key check. For remote rejection, suggest `git fetch origin` and re-attempt. Re-run after the cause is resolved — typecheck will skip via resume, push retries.

#### PR creation failure (step `push-and-create-pr`, exit code `1`)
- **Trigger:** `gh pr create` fails (auth scope, duplicate PR, network).
- **Repo state:** sync branch already pushed to origin; PR not created. Original branch restored.
- **Agent action:** report the `gh` error to Sinh. For auth scope, suggest `gh auth refresh -h github.com -s repo`. For "already a PR exists", surface the existing PR URL via `gh pr list --head <branch>`. Re-run after the cause is resolved — push is idempotent (`git push -u` is a no-op if already pushed), and `gh pr create` will succeed once the blocker clears.

#### FF-merge / dev push failure (step `merge-dev-from-upstream`, exit code `1`)
- **Trigger:** `git merge --ff-only upstream/dev` rejects (non-fast-forward → upstream force-pushed) or `git push origin dev` fails.
- **Repo state:** any in-progress merge aborted and original branch restored (NFR2).
- **Agent action:** for non-fast-forward, report upstream force-push to Sinh and stop — do not attempt a non-ff merge. For push failure, report and retry after the cause clears.

### Resume

The script is idempotent and resumable. Re-running after a halt (conflict, interrupt, or failure) detects completed steps via git ref comparison — no state file, no manual cleanup:

- **FR3 step skips** when local `dev` == `upstream/dev` HEAD **and** `origin/dev` matches (i.e. the ff-only merge + push both finished).
- **FR4 step skips** when today's `sync/upstream-YYYY-MM-DD` branch exists **and** `dev` is an ancestor of its HEAD (i.e. the merge is already committed — covers both clean-merge and human-resolved-and-committed cases).
- **Typecheck step re-runs** every time (it is read-only and cheap; no resume predicate).
- **Push step re-runs** every time; `git push -u` is idempotent if the branch is already up to date.
- **`gh pr create`** is not idempotent — if a PR already exists for the head branch, `gh` errors. Use `gh pr list --head <branch>` to surface it instead of re-running `gh pr create` blindly.

The `correct-branch` health check tolerates being on today's sync branch when the merge is already committed — so the resume path does not require the human to switch back to `sinh-x-dev` first.

### Agent Checklist (sync script path)

Before invoking `bun run script/sync-upstream.ts` without `--dry-run`:

- Read this SKILL.md section in full.
- Run `bun run script/sync-upstream.ts --dry-run` first and share the output with Sinh.
- Confirm with Sinh that a full sync run is approved.
- Confirm the current branch is `sinh-x-dev` (the script enforces this; do not pre-switch).
- After the run, report the PR URL (exit 0), the conflict file list (exit 2), or the failing step + message (exit 1) to Sinh.
- On exit 2, hand the conflict list to Sinh; after Sinh commits the resolution and confirms a clean worktree, re-run the script (do not switch branches — the resume path handles it).
- On exit 1, report the failing step name from the script's output and stop — do not retry blindly. Identify the failure mode above and follow the corresponding agent action.

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

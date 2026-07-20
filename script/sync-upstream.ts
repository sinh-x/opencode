#!/usr/bin/env bun
/**
 * sync-upstream.ts — Agent-executable upstream sync script.
 *
 * Phase 1: pre-sync health checks + fetch skeleton (FR1, FR2, AC1).
 * Phase 2: merge chain — dev ← upstream/dev ff-only merge + push, sync branch
 *   creation from sinh-x-dev, dev → sync branch merge with conflict detection
 *   and pause-and-report (FR3, FR4, FR5, NFR2, AC2, AC3).
 * Phase 3 (this implementation): resume + conflict-handling enhancements.
 *   - State detection via git ref comparison (FR6, AC5): idempotent, no state
 *     file to manage, survives interruption. Detects which steps are already
 *     complete by comparing rev-parses and branch existence.
 *   - Resume logic: skip completed steps (dev already at upstream/dev, sync
 *     branch already exists, dev already merged in) and continue from the
 *     next unfinished step (FR6, AC5).
 *   - Conflict report enhanced: lists conflicting files, prints resolution
 *     instructions, notes that re-running resumes from the next step, and
 *     exits with code 2 (FR5, AC3).
 *   - Clean abort on conflict: `git merge --abort` restores the worktree when
 *     the conflict is detected before any partial commit (NFR2).
 *
 * Phase 4 (this implementation): typecheck gate + PR creation.
 *   - `bun typecheck` runs from repo root after the merge chain succeeds but
 *     before any push/PR creation (FR8, AC6). Failure halts the run with a
 *     clear report and leaves the sync branch in place for inspection.
 *   - On typecheck pass, the sync branch is pushed to origin and a PR is
 *     created via `gh pr create` targeting the base branch with a
 *     conventional-commit title and a summary of upstream changes (FR7, AC4).
 *   - PR title format: `chore(sync): merge upstream/dev into sinh-x-dev
 *     (YYYY-MM-DD)`.
 *   - Structured output via `::group::` / `::endgroup::` for PA-agent
 *     parsability (NFR6).
 *
 * Traceability: FR1-FR8, NFR1-NFR4, NFR6, AC1-AC6.
 */

import { $ } from "bun"
import { parseArgs } from "node:util"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncConfig {
  /** Branch the sync targets and that we must start on (FR1 "correct branch"). */
  baseBranch: string
  /** Run health checks only; skip the mutating fetch step. */
  dryRun: boolean
  /** Remote names — hardcoded per plan §12 (no branch-strategy.yaml in this repo). */
  remotes: { origin: string; upstream: string }
  /** Refs that must exist before any mutation (FR1 "refs valid"). */
  refs: { upstreamDev: string; originDev: string; originBase: string }
}

interface CheckResult {
  name: string
  ok: boolean
  message: string
  durationMs: number
}

/** Outcome of a merge-chain step; used to drive the resume/halt/abort decision. */
type StepStatus = "completed" | "conflict" | "failed"

interface StepResult {
  step: string
  status: StepStatus
  message: string
  /** Conflicting files when status === "conflict" (FR5). */
  conflictingFiles?: string[]
}

/**
 * YYYY-MM-DD in local time — used for the sync branch name (FR4).
 *
 * CQ-1: accepts an optional `now` Date for unit-test injection. When omitted,
 * uses `new Date()`. This keeps the production path byte-identical while making
 * the date formatting pure and testable with known inputs.
 */
export function todayStamp(now: Date = new Date()): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

/** Sync branch name per FR4: `sync/upstream-YYYY-MM-DD`. CQ-1: optional `now` for tests. */
export function syncBranchName(now: Date = new Date()): string {
  return `sync/upstream-${todayStamp(now)}`
}

// ---------------------------------------------------------------------------
// Output helpers (CI-friendly, modeled after script/beta.ts `group()`)
// ---------------------------------------------------------------------------

function group(title: string): Disposable {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::group::${title}`)
    return {
      [Symbol.dispose]() {
        console.log("::endgroup::")
      },
    }
  }
  console.log(title)
  return { [Symbol.dispose]() {} }
}

function okLine(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function failLine(msg: string): void {
  console.log(`  ✗ ${msg}`)
}

function abort(msg: string): never {
  console.error(`\n✗ ABORT: ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Git / gh primitives
// ---------------------------------------------------------------------------

async function currentBranch(): Promise<string> {
  const out = await $`git branch --show-current`.text()
  return out.trim()
}

async function worktreeIsClean(): Promise<boolean> {
  const out = await $`git status --porcelain`.text()
  return out.trim().length === 0
}

async function dirtyFiles(): Promise<string[]> {
  const out = await $`git status --porcelain`.text()
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

async function remoteExists(name: string): Promise<boolean> {
  try {
    await $`git remote get-url ${name}`.quiet()
    return true
  } catch {
    return false
  }
}

async function remoteUrl(name: string): Promise<string> {
  const out = await $`git remote get-url ${name}`.text()
  return out.trim()
}

async function refExists(ref: string): Promise<boolean> {
  try {
    await $`git rev-parse --verify --quiet ${ref}`.quiet()
    return true
  } catch {
    return false
  }
}

export function toolPath(name: string): string | null {
  // Bun.which is a pure-Bun lookup (no shell) — satisfies NFR4 (no new deps).
  return Bun.which(name)
}

/**
 * SQ-2: verify the `gh` token has the `repo` scope required for `gh pr create`.
 * `gh auth status` alone succeeds without the `repo` scope, leading to a
 * late failure at PR creation time. We parse `gh auth status --show-token` for
 * a `repo` scope entry, falling back to a canary `gh pr list --limit 1` which
 * fails on a token without repo access.
 *
 * Returns an object with `authed` (authentication works) and `hasRepoScope`
 * (the token can actually create PRs in this repo).
 *
 * CQ-1: accepts an optional `shell` function for unit-test injection. When
 * omitted, uses the real Bun `$` template tag. The shell function receives
 * the command array (e.g. `["gh","auth","status"]`) and returns a string of
 * stdout, or throws to simulate a non-zero exit. This keeps the production
 * path byte-identical while making the pure logic testable.
 */
export type GhShell = (cmd: string[]) => Promise<string>

const defaultGhShell: GhShell = async (cmd) => {
  // Rebuild a `$` call from the cmd array. We use Bun's template tag with
  // interpolated args so each element is passed safely (no shell injection).
  const [bin, ...args] = cmd
  return await $`${[bin, ...args] as string[]}`.quiet().text()
}

export async function ghRepoScopeStatus(shell: GhShell = defaultGhShell): Promise<{ authed: boolean; hasRepoScope: boolean; detail: string }> {
  // First: must be authenticated at all.
  try {
    await shell(["gh", "auth", "status"])
  } catch {
    return { authed: false, hasRepoScope: false, detail: "gh auth status failed — run `gh auth login`" }
  }
  // Second: parse the scope list from `gh auth status --show-token`. The token
  // scopes line looks like "Token scopes: gist, read:org, repo". Note: in
  // GitHub Actions the GITHUB_TOKEN does not have `gh auth status` info, so
  // fall back to the canary below.
  try {
    const out = await shell(["gh", "auth", "status", "--show-token"])
    const scopeMatch = out.match(/scopes?:\s*([^\n]*)/i)
    if (scopeMatch) {
      const scopes = scopeMatch[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "").toLowerCase())
      const hasRepo = scopes.includes("repo") || scopes.includes("admin:repo_all")
      if (hasRepo) return { authed: true, hasRepoScope: true, detail: "gh authenticated with repo scope" }
      return {
        authed: true,
        hasRepoScope: false,
        detail: `gh authenticated but missing repo scope (have: ${scopes.join(", ") || "none"})`,
      }
    }
  } catch {
    // Fall through to the canary check.
  }
  // Fallback canary: try a read-only `gh pr list --limit 1` which requires
  // repo access. If it fails, the token cannot reach this repo's PRs.
  try {
    await shell(["gh", "pr", "list", "--limit", "1"])
    return { authed: true, hasRepoScope: true, detail: "gh authenticated (repo access verified via gh pr list canary)" }
  } catch {
    return {
      authed: true,
      hasRepoScope: false,
      detail: "gh authenticated but `gh pr list` failed — token may lack repo scope for this repo",
    }
  }
}

// ---------------------------------------------------------------------------
// Health checks (FR1). Each returns a CheckResult; main() aborts on first failure.
// ---------------------------------------------------------------------------

export type WhichFn = (name: string) => string | null

/**
 * CQ-1: accepts an optional `which` function for unit-test injection. When
 * omitted, uses the real `toolPath` (which calls `Bun.which`). This keeps the
 * production path byte-identical while making the pure logic testable without
 * spawning subprocesses or relying on the host's PATH.
 */
export async function checkTools(which: WhichFn = toolPath): Promise<CheckResult> {
  const start = Date.now()
  const missing: string[] = []
  for (const tool of ["git", "gh", "bun"]) {
    if (!which(tool)) missing.push(tool)
  }
  return {
    name: "tools-available",
    ok: missing.length === 0,
    message:
      missing.length === 0
        ? "git, gh, bun all on PATH"
        : `missing from PATH: ${missing.join(", ")}`,
    durationMs: Date.now() - start,
  }
}

async function checkGhAuth(): Promise<CheckResult> {
  const start = Date.now()
  // SQ-2: verify both authentication AND repo scope so a missing `repo` scope
  // fails early instead of at PR creation time.
  const status = await ghRepoScopeStatus()
  const ok = status.authed && status.hasRepoScope
  return {
    name: "gh-authenticated",
    ok,
    message: status.detail,
    durationMs: Date.now() - start,
  }
}

async function checkRemotes(cfg: SyncConfig): Promise<CheckResult> {
  const start = Date.now()
  const hasOrigin = await remoteExists(cfg.remotes.origin)
  const hasUpstream = await remoteExists(cfg.remotes.upstream)
  const ok = hasOrigin && hasUpstream
  let message: string
  if (ok) {
    const o = await remoteUrl(cfg.remotes.origin)
    const u = await remoteUrl(cfg.remotes.upstream)
    message = `origin=${o} upstream=${u}`
  } else {
    const absent: string[] = []
    if (!hasOrigin) absent.push(cfg.remotes.origin)
    if (!hasUpstream) absent.push(cfg.remotes.upstream)
    message = `remote(s) not configured: ${absent.join(", ")}`
  }
  return { name: "remotes-configured", ok, message, durationMs: Date.now() - start }
}

async function checkRefs(cfg: SyncConfig): Promise<CheckResult> {
  const start = Date.now()
  const need: Array<[string, string]> = [
    ["upstream/dev", cfg.refs.upstreamDev],
    ["origin/dev", cfg.refs.originDev],
    [`origin/${cfg.baseBranch}`, cfg.refs.originBase],
  ]
  const missing: string[] = []
  for (const [label, ref] of need) {
    if (!(await refExists(ref))) missing.push(`${label} (${ref})`)
  }
  return {
    name: "refs-exist",
    ok: missing.length === 0,
    message:
      missing.length === 0
        ? "upstream/dev, origin/dev, origin/<base> all resolvable"
        : `missing refs: ${missing.join(", ")}`,
    durationMs: Date.now() - start,
  }
}

async function checkWorktreeClean(): Promise<CheckResult> {
  const start = Date.now()
  const clean = await worktreeIsClean()
  let message: string
  if (clean) {
    message = "worktree clean"
  } else {
    const files = await dirtyFiles()
    message = `worktree dirty (${files.length} file(s)): ${files.slice(0, 10).join(", ")}${files.length > 10 ? " …" : ""}`
  }
  return { name: "worktree-clean", ok: clean, message, durationMs: Date.now() - start }
}

async function checkBranch(cfg: SyncConfig): Promise<CheckResult> {
  const start = Date.now()
  const branch = await currentBranch()
  const ok = branch === cfg.baseBranch
  // Resume tolerance (FR6/AC5): if we are NOT on the base branch but ARE on
  // today's sync branch AND that sync branch already has dev merged (i.e. the
  // human just committed a conflict resolution), the run is resumable — we
  // should not fail the "correct-branch" precondition in that case. The merge
  // chain steps will skip themselves because the work is already done.
  let message: string
  if (ok) {
    message = `on ${cfg.baseBranch}`
  } else if (branch === syncBranchName() && (await syncBranchStepAlreadyDone(cfg))) {
    // Resume case: on today's sync branch with the merge already committed.
    // Treat as OK so the rest of the run can proceed (all merge-chain steps
    // will skip via their own resume predicates).
    return {
      name: "correct-branch",
      ok: true,
      message: `on ${branch} (resume: sync branch already has dev merged)`,
      durationMs: Date.now() - start,
    }
  } else {
    message = `expected ${cfg.baseBranch}, found ${branch}`
  }
  return {
    name: "correct-branch",
    ok,
    message,
    durationMs: Date.now() - start,
  }
}

// ---------------------------------------------------------------------------
// Fetch step (FR2)
// ---------------------------------------------------------------------------

async function fetchRemotes(cfg: SyncConfig): Promise<void> {
  using _ = group("Fetch remotes")
  console.log(`  fetching ${cfg.remotes.origin}…`)
  await $`git fetch ${cfg.remotes.origin}`
  okLine(`fetched ${cfg.remotes.origin}`)
  console.log(`  fetching ${cfg.remotes.upstream}…`)
  await $`git fetch ${cfg.remotes.upstream}`
  okLine(`fetched ${cfg.remotes.upstream}`)
}

// ---------------------------------------------------------------------------
// Merge-chain primitives (FR3-FR5)
// ---------------------------------------------------------------------------

/** List of conflicting files (FR5). Uses `git diff --name-only --diff-filter=U`. */
async function conflictingFiles(): Promise<string[]> {
  const out = await $`git diff --name-only --diff-filter=U`.text().catch(() => "")
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

/** True when `git status --porcelain` reports unmerged entries (UU / AA / DD …). */
async function hasMergeConflicts(): Promise<boolean> {
  const files = await conflictingFiles()
  return files.length > 0
}

/** Checkout an existing local branch, aborting the run on failure (NFR2). */
async function checkoutBranch(branch: string): Promise<void> {
  await $`git checkout ${branch}`
}

/** Create and switch to a new branch from `fromRef`. Aborts if it already exists. */
async function createSyncBranch(branch: string, fromRef: string): Promise<void> {
  await $`git checkout -b ${branch} ${fromRef}`
}

/** Fast-forward merge `ref` into the current branch. Rejects non-fast-forward per FR3. */
async function ffOnlyMerge(ref: string): Promise<void> {
  await $`git merge --ff-only ${ref}`
}

/** Abort an in-progress merge (NFR2 — leave repo clean on failure). */
async function abortMerge(): Promise<void> {
  try {
    await $`git merge --abort`
  } catch {
    /* no merge in progress — safe to ignore */
  }
}

// ---------------------------------------------------------------------------
// State detection (Phase 3 — FR6, AC5)
//
// Resume logic uses git ref comparison instead of a step-marker file. This is
// idempotent, survives repo relocation, and needs no .opencode/ state file (no
// .gitignore churn). Each "is step X done?" predicate is a single rev-parse or
// branch-list call.
// ---------------------------------------------------------------------------

/** Rev-parse a ref to a SHA. Returns null if the ref does not resolve. */
async function revParse(ref: string): Promise<string | null> {
  try {
    const out = await $`git rev-parse --verify --quiet ${ref}`.quiet().text()
    const sha = out.trim()
    return sha.length > 0 ? sha : null
  } catch {
    return null
  }
}

/** True if a local branch named `branch` exists. */
async function localBranchExists(branch: string): Promise<boolean> {
  try {
    await $`git rev-parse --verify --quiet refs/heads/${branch}`.quiet()
    return true
  } catch {
    return false
  }
}

/**
 * FR3 step is "done" when local `dev` already matches `upstream/dev` HEAD and
 * `origin/dev` reflects that same SHA. Re-running the script after FR3 completed
 * (or after a manual conflict resolution that finished the dev merge) skips
 * the ff-only merge + push.
 */
async function devStepAlreadyDone(cfg: SyncConfig): Promise<boolean> {
  const localDev = await revParse("refs/heads/dev")
  const upstreamDev = await revParse(cfg.refs.upstreamDev)
  const originDev = await revParse(cfg.refs.originDev)
  if (!localDev || !upstreamDev) return false
  if (localDev !== upstreamDev) return false
  // origin/dev may lag behind upstream/dev if a prior push was interrupted
  // before completion — treat that as "not done" so we re-attempt the push.
  return originDev === localDev
}

/**
 * FR4 sync-branch step is "done" for today's branch when the branch already
 * exists locally AND dev has already been merged into it (sync branch HEAD is
 * a descendant of dev HEAD, i.e. dev is an ancestor of the sync branch HEAD).
 *
 * This covers both the clean-merge case and the human-resolved-and-committed
 * case: once the merge commit exists on the sync branch, dev is reachable from
 * it and this predicate returns true.
 */
async function syncBranchStepAlreadyDone(cfg: SyncConfig): Promise<boolean> {
  const branch = syncBranchName()
  if (!(await localBranchExists(branch))) return false
  const syncHead = await revParse(`refs/heads/${branch}`)
  const devHead = await revParse("refs/heads/dev")
  if (!syncHead || !devHead) return false
  // sync branch is "done merging dev" if dev is reachable from it.
  try {
    await $`git merge-base --is-ancestor ${devHead} ${syncHead}`.quiet()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Merge-chain steps (Phase 2: FR3, FR4, FR5, NFR2, AC2, AC3)
// ---------------------------------------------------------------------------

/**
 * FR3: fast-forward merge upstream/dev into local dev, push origin/dev.
 *
 * Pre: repo is on `cfg.baseBranch`, worktree clean, remotes fetched.
 * Post: local `dev` == upstream/dev and origin/dev reflects that, OR script halts.
 *
 * Resume (FR6/AC5): if `devStepAlreadyDone` is true this step is skipped — no
 * duplicate merge, no redundant push. The function reports "skipped" via the
 * returned StepResult so the caller can log it distinctly.
 *
 * Safety (NFR2): on any failure we restore the original branch and abort any
 * in-progress merge before reporting.
 */
async function stepMergeDevFromUpstream(cfg: SyncConfig, originalBranch: string): Promise<StepResult> {
  using _ = group("FR3 — ff-merge upstream/dev into dev, push origin/dev")
  // FR6/AC5: skip if already complete.
  if (await devStepAlreadyDone(cfg)) {
    okLine("dev already at upstream/dev and pushed — skipping (resume)")
    return {
      step: "merge-dev-from-upstream",
      status: "completed",
      message: "skipped: dev already at upstream/dev and pushed",
    }
  }
  try {
    await checkoutBranch("dev")
    okLine("checked out dev")

    await ffOnlyMerge(cfg.refs.upstreamDev)
    okLine(`ff-only merged ${cfg.refs.upstreamDev} into dev`)

    await $`git push ${cfg.remotes.origin} dev`
    okLine(`pushed dev to ${cfg.remotes.origin}/dev`)

    return { step: "merge-dev-from-upstream", status: "completed", message: "dev synced with upstream/dev and pushed" }
  } catch (err) {
    // NFR2: leave repo clean — abort any merge, restore the branch we started on.
    await abortMerge()
    await checkoutBranch(originalBranch).catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    return {
      step: "merge-dev-from-upstream",
      status: "failed",
      message: `dev ff-only merge or push failed: ${msg}`,
    }
  }
}

/**
 * FR4: create sync/upstream-YYYY-MM-DD from cfg.baseBranch, merge dev into it.
 *
 * Pre: dev has been pushed (FR3 step completed).
 * Post: sync branch exists and contains the merged dev, OR script halts with the
 * conflict list (FR5/AC3) — leaving the merge in place for human resolution.
 *
 * Resume (FR6/AC5):
 *   - If the sync branch already exists and dev is an ancestor of it (i.e. the
 *     human already resolved any conflicts and committed the merge), the whole
 *     step is skipped — the script proceeds to the next phase.
 *   - If the sync branch already exists but dev is NOT yet an ancestor (the
 *     merge was never started, or was aborted), we check it out and merge dev
 *     into it. This covers the case where a prior run created the branch but
 *     was interrupted before `git merge dev` ran.
 *
 * Conflict handling (FR5/AC3): when `git merge` reports conflicts we DO NOT abort
 * the merge. The human resolves them in-tree, commits the merge, then re-runs the
 * script. The script exits with a dedicated conflict code (2) and prints the
 * conflicting file list plus resolution instructions. Re-running after the
 * human commits: the worktree is clean, `syncBranchStepAlreadyDone` returns
 * true, and the script skips FR4 and continues to the next phase (FR6/AC5).
 *
 * Note on the worktree-clean precondition (FR1): the human MUST commit their
 * conflict resolution before re-running. A staged-but-uncommitted resolution
 * leaves the worktree dirty, which the health check (correctly) rejects. This
 * preserves FR1's invariant and keeps the resume path simple.
 */
async function stepCreateAndMergeSyncBranch(cfg: SyncConfig): Promise<StepResult> {
  using _ = group("FR4 — create sync branch, merge dev")
  const branch = syncBranchName()

  // FR6/AC5 — already fully complete? (human committed a prior conflict resolution)
  if (await syncBranchStepAlreadyDone(cfg)) {
    okLine(`${branch} already exists with dev merged — skipping (resume)`)
    return {
      step: "create-and-merge-sync-branch",
      status: "completed",
      message: `skipped: sync branch ${branch} already has dev merged`,
    }
  }

  // Fresh-run or resume-after-abort case. The branch may or may not exist yet:
  //   - does not exist → create it from cfg.baseBranch
  //   - exists but dev not merged → check it out and merge dev (e.g. a prior
  //     run created the branch but was interrupted before `git merge dev`)
  try {
    if (await localBranchExists(branch)) {
      okLine(`sync branch ${branch} already exists — checking out and merging dev`)
      await checkoutBranch(branch)
    } else {
      await checkoutBranch(cfg.baseBranch)
      okLine(`checked out ${cfg.baseBranch}`)
      await createSyncBranch(branch, cfg.baseBranch)
      okLine(`created ${branch} from ${cfg.baseBranch}`)
    }

    okLine(`merging dev into ${branch}…`)
    try {
      await $`git merge dev`
    } catch (err) {
      // git merge exits non-zero on conflicts. Check whether real conflicts exist.
      if (await hasMergeConflicts()) {
        const files = await conflictingFiles()
        return {
          step: "create-and-merge-sync-branch",
          status: "conflict",
          message: `merge dev into ${branch} produced ${files.length} conflict(s)`,
          conflictingFiles: files,
        }
      }
      // Non-conflict failure (e.g. ff-only not requested, or other git error).
      const msg = err instanceof Error ? err.message : String(err)
      await abortMerge()
      return {
        step: "create-and-merge-sync-branch",
        status: "failed",
        message: `git merge dev failed (no conflict markers): ${msg}`,
      }
    }

    // Merge succeeded cleanly.
    okLine(`merged dev into ${branch}`)
    return { step: "create-and-merge-sync-branch", status: "completed", message: `sync branch ${branch} created and dev merged cleanly` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      step: "create-and-merge-sync-branch",
      status: "failed",
      message: `sync-branch creation or merge step failed: ${msg}`,
    }
  }
}

/**
 * Print a conflict report (FR5/AC3) and exit with code 2 so PA agents can detect
 * "halt for human resolution" distinctly from a generic failure.
 *
 * Phase 3 enhancement: the instructions now explicitly state that re-running the
 * script after the human commits the merge will skip the completed steps and
 * resume from the next phase (FR6/AC5) — no manual state cleanup required.
 */
function reportConflictsAndHalt(result: StepResult): never {
  console.error(`\n✗ MERGE CONFLICTS DETECTED — human resolution required`)
  console.error(`  step:        ${result.step}`)
  console.error(`  message:     ${result.message}`)
  const files = result.conflictingFiles ?? []
  console.error(`  files (${files.length}):`)
  for (const f of files) {
    console.error(`    • ${f}`)
  }
  console.error(`\nTo resolve and resume:`)
  console.error(`  1. Edit each conflicted file above, choose the correct hunks.`)
  console.error(`  2. \`git add <file>\` for each resolved file.`)
  console.error(`  3. \`git commit --no-edit\` to complete the merge.`)
  console.error(`  4. Re-run this script. It will detect that the sync branch now`)
  console.error(`     has dev merged, skip this step (resume), and continue to the`)
  console.error(`     next phase. No state cleanup needed. (FR6/AC5)`)
  console.error(`\n  To abort instead: \`git merge --abort\` then re-run from scratch.`)
  console.error(`\nExit code 2 = conflicts need resolution (FR5/AC3).`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Phase 4 — Typecheck gate (FR8, AC6) + push + PR creation (FR7, AC4)
// ---------------------------------------------------------------------------

/**
 * FR8/AC6: run `bun typecheck` from the repo root. Halts the run on failure
 * before any push/PR creation (so a broken merge never produces a PR). The
 * failing step name + message are surfaced to the caller via the StepResult.
 *
 * The script never modifies the repo on typecheck failure: the sync branch is
 * left in place with the merged dev for the human to inspect and fix. Re-run
 * after fixing the typecheck error — the merge-chain steps skip via their
 * resume predicates (FR6/AC5), so the next run jumps straight to typecheck.
 */
async function stepTypecheck(): Promise<StepResult> {
  using _ = group("FR8 — bun typecheck (post-merge gate)")
  try {
    okLine("running `bun typecheck` from repo root…")
    await $`bun typecheck`
    okLine("typecheck passed")
    return { step: "typecheck", status: "completed", message: "bun typecheck passed" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      step: "typecheck",
      status: "failed",
      message: `bun typecheck failed (sync branch left in place for inspection): ${msg}`,
    }
  }
}

/**
 * FR7/AC4: push the sync branch to origin and create a PR targeting the base
 * branch via `gh pr create`. Title follows the conventional-commit form:
 *   chore(sync): merge upstream/dev into sinh-x-dev (YYYY-MM-DD)
 * The PR body summarizes the upstream changes via `git log` between the base
 * branch and the sync branch HEAD.
 *
 * Pre: typecheck passed (caller enforces). Sync branch is checked out.
 * Post: branch pushed to origin, PR created, PR URL printed. On failure the
 * StepResult reports the error; main() aborts.
 */
async function stepPushAndCreatePR(cfg: SyncConfig, steps: VerificationItem[]): Promise<StepResult> {
  using _ = group("FR7 — push sync branch + create PR")
  const branch = syncBranchName()
  try {
    okLine(`pushing ${branch} to ${cfg.remotes.origin}…`)
    await $`git push -u ${cfg.remotes.origin} ${branch}`
    okLine(`pushed ${branch}`)

    const title = `chore(sync): merge upstream/dev into ${cfg.baseBranch} (${todayStamp()})`
    const body = await buildPRBody(cfg, steps)

    okLine(`creating PR via \`gh pr create\`…`)
    const prOut = await $`gh pr create --base ${cfg.baseBranch} --head ${branch} --title ${title} --body ${body}`.text()
    const prUrl = prOut.trim()
    okLine(`PR created: ${prUrl}`)
    return {
      step: "push-and-create-pr",
      status: "completed",
      message: `pushed ${branch} and created PR: ${prUrl}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      step: "push-and-create-pr",
      status: "failed",
      message: `push or PR creation failed: ${msg}`,
    }
  }
}

/**
 * CQ-2: A completed verification step surfaced in the PR body. The `label` is
 * the human-readable description; `ok` is true when the step succeeded. Steps
 * that did not run (e.g. skipped via resume) are still reported as completed
 * with a `skipped: true` flag so the PR body reflects what actually happened.
 */
interface VerificationItem {
  label: string
  ok: boolean
  skipped?: boolean
}

/**
 * Build the PR body summarizing upstream changes. Uses `git log` between the
 * base branch and the sync branch HEAD — the merge commit + all upstream
 * commits brought in. Output is markdown-formatted for `gh pr create --body`.
 *
 * CQ-2: the verification checklist is built dynamically from the `steps`
 * argument (collected in `main()`), so the PR body always reflects what
 * actually ran instead of a hardcoded template that can drift from behavior.
 */
async function buildPRBody(cfg: SyncConfig, steps: VerificationItem[]): Promise<string> {
  const branch = syncBranchName()
  const base = cfg.baseBranch
  // Commits brought in by this sync (base branch HEAD..sync branch HEAD).
  const logOut = await $`git log --oneline --no-merges ${base}..${branch}`.text().catch(() => "")
  const commits = logOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const commitCount = commits.length
  const commitList = commits.length > 0
    ? commits.slice(0, 50).map((c) => `- ${c}`).join("\n")
    : "_no upstream commits detected by the diff range_"
  const trailer = commitCount > 50 ? `\n\n… and ${commitCount - 50} more (see full log in the branch).\n` : ""
  // CQ-2: build the verification checklist from the actual step results. Each
  // completed step is a checked box; a skipped step is a checked box with a
  // "(skipped: <reason>)" suffix; a failed step would have aborted the run
  // before this point, so we never expect `ok: false` here — but if it ever
  // happens, render it as an unchecked box so a reviewer sees it.
  const checklist = steps.length
    ? steps
        .map((s) => {
          const box = s.ok ? "[x]" : "[ ]"
          const suffix = s.skipped ? " _(skipped via resume)_" : ""
          return `- ${box} ${s.label}${suffix}`
        })
        .join("\n")
    : "- _(no step results recorded)_"
  return [
    `## Upstream Sync — ${todayStamp()}`,
    ``,
    `This PR merges \`upstream/dev\` into \`${cfg.baseBranch}\` via the sync branch \`${branch}\`.`,
    ``,
    `- **Sync branch:** \`${branch}\``,
    `- **Base branch:** \`${base}\``,
    `- **Upstream ref:** \`upstream/dev\``,
    `- **Commits brought in:** ${commitCount}`,
    ``,
    `### Commits`,
    ``,
    commitList,
    trailer,
    ``,
    `### Verification`,
    ``,
    checklist,
    ``,
    `---`,
    `_Generated by \`script/sync-upstream.ts\` (Phase 4). Checklist built dynamically from step results (CQ-2)._`,
  ].join("\n")
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`sync-upstream.ts — upstream sync for the opencode fork.

Usage:
  bun run script/sync-upstream.ts [options]

Options:
  --base-branch <name>   Branch the sync targets and that we must start on.
                           Default: sinh-x-dev
                           Must match ^[a-zA-Z0-9][a-zA-Z0-9._/-]+$
  --dry-run              Run health checks only; skip the fetch + merge +
                           typecheck + PR steps.
  -h, --help             Show this help and exit.

Health checks (FR1) run in order; the script aborts on the first failure with a
clear error naming the failed check. Fetch (FR2) runs only after all checks pass.
Merge chain (FR3-FR5) runs after fetch:
  - ff-only merge upstream/dev into dev, push origin/dev  (FR3)
  - create sync/upstream-YYYY-MM-DD from <base-branch>   (FR4)
  - merge dev into the sync branch; halt on conflict      (FR4/FR5)

Phase 4 — typecheck gate + PR creation (FR7, FR8, AC4, AC6):
  - run \`bun typecheck\` from repo root; halt on failure  (FR8)
  - push sync branch to origin                           (FR7)
  - create PR via \`gh pr create\` targeting <base-branch> (FR7/AC4)
    title: chore(sync): merge upstream/dev into <base-branch> (YYYY-MM-DD)

Resume (FR6/AC5 — Phase 3):
  Re-running the script after a halt (conflict, interrupt, or failure) detects
  completed steps via git ref comparison and skips them:
  - dev already at upstream/dev HEAD and pushed → skip FR3
  - sync/upstream-YYYY-MM-DD already exists with dev merged → skip FR4

  Conflict resolution path: when the merge halts with conflicts, the human
  resolves the files, commits the merge (\`git commit --no-edit\`), then re-runs
  the script. The worktree must be clean before re-run (FR1 precondition).

Exit codes:
  0   success (health + fetch + merge chain + typecheck + push/PR all complete,
       or --dry-run checks pass)
  1   a health check, fetch, merge, typecheck, or PR step failed
  2   merge conflicts detected — human resolution required (FR5/AC3)

Phase 1+2+3 scope: health checks, fetch, merge chain, resume + conflict
handling. Phase 4 adds: typecheck gate + push + PR creation. Phase 5 (agent
playbook) arrives in a later phase.`)
}

/** Safe-branch-name pattern (SQ-1): reject shell-significant characters. */
const SAFE_BRANCH_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._/-]+$/

export function isValidBranchName(name: string): boolean {
  return SAFE_BRANCH_NAME.test(name)
}

function parseCli(): SyncConfig {
  const { values } = parseArgs({
    options: {
      "base-branch": { type: "string", default: "sinh-x-dev" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowNegative: true,
  })

  if (values.help) {
    printHelp()
    process.exit(0)
  }

  const baseBranch = values["base-branch"]
  if (!baseBranch) abort("--base-branch requires a value")
  // SQ-1: validate base-branch against a safe pattern before it flows into any
  // shell command. Reject names containing spaces, semicolons, backticks, or
  // other shell-significant characters.
  if (!isValidBranchName(baseBranch)) {
    abort(
      `--base-branch "${baseBranch}" is not a valid branch name: must match ${SAFE_BRANCH_NAME.source} (alphanumeric start, only [a-zA-Z0-9._/-] afterwards)`,
    )
  }

  return {
    baseBranch,
    dryRun: values["dry-run"] ?? false,
    remotes: { origin: "origin", upstream: "upstream" },
    refs: {
      upstreamDev: "upstream/dev",
      originDev: "origin/dev",
      originBase: `origin/${baseBranch}`,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cfg = parseCli()

  console.log(`sync-upstream.ts — phase 4 (health + fetch + merge chain + typecheck + PR)`)
  console.log(`  base-branch: ${cfg.baseBranch}`)
  console.log(`  dry-run:     ${cfg.dryRun}`)

  // CQ-2: collect verification items as the run progresses so the PR body's
  // checklist reflects what actually happened (no hardcoded template).
  const verification: VerificationItem[] = []

  // FR1 — pre-condition validation. Order: tools → gh auth → remotes → refs →
  // worktree → branch. Tools/auth first so later checks can rely on them.
  const checks: Array<(cfg: SyncConfig) => Promise<CheckResult>> = [
    () => checkTools(),
    () => checkGhAuth(),
    (c) => checkRemotes(c),
    (c) => checkRefs(c),
    () => checkWorktreeClean(),
    (c) => checkBranch(c),
  ]

  using _ = group("Pre-sync health checks")
  const healthStart = Date.now()
  for (const check of checks) {
    const result = await check(cfg)
    if (result.ok) {
      okLine(`${result.name}: ${result.message}`)
    } else {
      failLine(`${result.name}: ${result.message}`)
      // NFR2: Phase 1 performs no local mutation before this point, so nothing
      // to roll back. Fetch (below) is remote-only and does not dirty the
      // worktree. Phase 2 merge steps add git merge --abort + branch restore.
      abort(`health check "${result.name}" failed: ${result.message}`)
    }
  }
  const healthMs = Date.now() - healthStart
  okLine(`all health checks passed in ${healthMs}ms`)
  if (healthMs > 30_000) {
    failLine(`health checks exceeded 30s budget (NFR1): ${healthMs}ms`)
    abort(`NFR1 violation: health checks took ${healthMs}ms`)
  }
  verification.push({
    label: "Pre-sync health checks passed (tools, gh auth+scope, remotes, refs, worktree, branch)",
    ok: true,
  })

  if (cfg.dryRun) {
    console.log("\n--dry-run: skipping fetch + merge chain + typecheck + PR steps")
    return
  }

  await fetchRemotes(cfg)

  // ----- Phase 2: merge chain (FR3, FR4, FR5) -----
  const originalBranch = await currentBranch()

  // FR3 — ff-only merge upstream/dev into dev, push origin/dev.
  const devResult = await stepMergeDevFromUpstream(cfg, originalBranch)
  if (devResult.status === "failed") {
    failLine(`${devResult.step}: ${devResult.message}`)
    abort(devResult.message)
  }
  okLine(`${devResult.step}: ${devResult.message}`)
  verification.push({
    label: "`git merge --ff-only upstream/dev` into `dev` succeeded and pushed to origin/dev",
    ok: true,
    skipped: devResult.message.startsWith("skipped:"),
  })

  // FR4/FR5 — create sync branch from <base-branch>, merge dev, detect conflicts.
  const syncResult = await stepCreateAndMergeSyncBranch(cfg)
  if (syncResult.status === "conflict") {
    // FR5/AC3 — halt with conflicting file list + resolution instructions.
    reportConflictsAndHalt(syncResult)
  }
  if (syncResult.status === "failed") {
    failLine(`${syncResult.step}: ${syncResult.message}`)
    // NFR2 — restore the branch we started on; merge already aborted in the step.
    await checkoutBranch(originalBranch).catch(() => {})
    abort(syncResult.message)
  }
  okLine(`${syncResult.step}: ${syncResult.message}`)
  verification.push({
    label: `Sync branch \`${syncBranchName()}\` created from \`${cfg.baseBranch}\` and \`dev\` merged in (no conflicts)`,
    ok: true,
    skipped: syncResult.message.startsWith("skipped:"),
  })

  // ----- Phase 4: typecheck gate + push + PR creation (FR7, FR8, AC4, AC6) -----

  // FR8/AC6 — typecheck must pass before any push/PR creation.
  const typecheckResult = await stepTypecheck()
  if (typecheckResult.status === "failed") {
    failLine(`${typecheckResult.step}: ${typecheckResult.message}`)
    // Leave the sync branch in place for the human to inspect. Restore the
    // original branch so the repo is not left on the sync branch unexpectedly.
    await checkoutBranch(originalBranch).catch(() => {})
    abort(typecheckResult.message)
  }
  okLine(`${typecheckResult.step}: ${typecheckResult.message}`)
  verification.push({ label: "`bun typecheck` passed", ok: true })

  // FR7/AC4 — push sync branch + create PR targeting the base branch.
  const prResult = await stepPushAndCreatePR(cfg, verification)
  if (prResult.status === "failed") {
    failLine(`${prResult.step}: ${prResult.message}`)
    await checkoutBranch(originalBranch).catch(() => {})
    abort(prResult.message)
  }
  okLine(`${prResult.step}: ${prResult.message}`)

  console.log("\n✓ phase 4 complete: typecheck passed, sync branch pushed, PR created")
  console.log(`  next: phase 5 (agent playbook)`)
}

// CQ-1: only run main() when executed directly (not when imported by tests).
// `import.meta.main` is true for the entry script, false for imported modules.
if (import.meta.main) {
  main().catch((err) => {
    // Bun.$ throws an exit-code-bearing error on non-zero shell exit. Surface it.
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n✗ unexpected error: ${msg}`)
    process.exit(1)
  })
}
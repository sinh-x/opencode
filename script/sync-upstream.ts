#!/usr/bin/env bun
/**
 * sync-upstream.ts — Agent-executable upstream sync script.
 *
 * Phase 1: pre-sync health checks + fetch skeleton (FR1, FR2, AC1).
 * Phase 2 (this implementation): merge chain — dev ← upstream/dev ff-only merge +
 *   push, sync branch creation from sinh-x-dev, dev → sync branch merge with
 *   conflict detection and pause-and-report (FR3, FR4, FR5, NFR2, AC2, AC3).
 *   - Argument parsing (node:util parseArgs, Bun built-ins only — NFR4)
 *   - Health checks: tools, gh auth, remotes, refs, worktree clean, correct branch (FR1)
 *   - Fetch origin and upstream remotes (FR2)
 *   - Merge chain: ff-only merge upstream/dev into dev, push origin/dev, create
 *     sync/upstream-YYYY-MM-DD from sinh-x-dev, merge dev into sync branch,
 *     detect conflicts and halt with file list + resolution instructions (FR3-FR5)
 *
 * Later phases (resume/state-tracking, typecheck gate, PR creation, playbook) are
 * intentionally NOT implemented here. This file is the skeleton those phases extend.
 *
 * Traceability: FR1-FR5, NFR1-NFR4, AC1-AC3.
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

/** YYYY-MM-DD in local time — used for the sync branch name (FR4). */
function todayStamp(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

/** Sync branch name per FR4: `sync/upstream-YYYY-MM-DD`. */
function syncBranchName(): string {
  return `sync/upstream-${todayStamp()}`
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

function toolPath(name: string): string | null {
  // Bun.which is a pure-Bun lookup (no shell) — satisfies NFR4 (no new deps).
  return Bun.which(name)
}

async function ghAuthenticated(): Promise<boolean> {
  try {
    await $`gh auth status`.quiet()
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Health checks (FR1). Each returns a CheckResult; main() aborts on first failure.
// ---------------------------------------------------------------------------

async function checkTools(): Promise<CheckResult> {
  const start = Date.now()
  const missing: string[] = []
  for (const tool of ["git", "gh", "bun"]) {
    if (!toolPath(tool)) missing.push(tool)
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
  const authed = await ghAuthenticated()
  return {
    name: "gh-authenticated",
    ok: authed,
    message: authed ? "gh authenticated" : "gh auth status failed — run `gh auth login`",
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
  return {
    name: "correct-branch",
    ok,
    message: ok
      ? `on ${cfg.baseBranch}`
      : `expected ${cfg.baseBranch}, found ${branch}`,
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
// Merge-chain steps (Phase 2: FR3, FR4, FR5, NFR2, AC2, AC3)
// ---------------------------------------------------------------------------

/**
 * FR3: fast-forward merge upstream/dev into local dev, push origin/dev.
 *
 * Pre: repo is on `cfg.baseBranch`, worktree clean, remotes fetched.
 * Post: local `dev` == upstream/dev and origin/dev reflects that, OR script halts.
 *
 * Safety (NFR2): on any failure we restore the original branch and abort any
 * in-progress merge before reporting.
 */
async function stepMergeDevFromUpstream(cfg: SyncConfig, originalBranch: string): Promise<StepResult> {
  using _ = group("FR3 — ff-merge upstream/dev into dev, push origin/dev")
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
 * Conflict handling (FR5/AC3): when `git merge` reports conflicts we DO NOT abort
 * the merge. The human resolves them in-tree, then re-runs the script (Phase 3 will
 * add resume logic; Phase 2 only detects and reports). The script exits with a
 * dedicated conflict code (2) and prints the conflicting file list.
 */
async function stepCreateAndMergeSyncBranch(cfg: SyncConfig): Promise<StepResult> {
  using _ = group("FR4 — create sync branch, merge dev")
  const branch = syncBranchName()
  try {
    await checkoutBranch(cfg.baseBranch)
    okLine(`checked out ${cfg.baseBranch}`)

    await createSyncBranch(branch, cfg.baseBranch)
    okLine(`created ${branch} from ${cfg.baseBranch}`)

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
  console.error(`\nTo resolve:`)
  console.error(`  1. Edit each conflicted file above, choose the correct hunks.`)
  console.error(`  2. \`git add <file>\` for each resolved file.`)
  console.error(`  3. \`git commit\` to complete the merge.`)
  console.error(`  4. Re-run this script to resume from the next step.`)
  console.error(`  (Phase 3 will add automatic resume; Phase 2 reports and halts.)`)
  process.exit(2)
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
  --dry-run              Run health checks only; skip the fetch + merge steps.
  -h, --help             Show this help and exit.

Health checks (FR1) run in order; the script aborts on the first failure with a
clear error naming the failed check. Fetch (FR2) runs only after all checks pass.
Merge chain (FR3-FR5) runs after fetch:
  - ff-only merge upstream/dev into dev, push origin/dev  (FR3)
  - create sync/upstream-YYYY-MM-DD from <base-branch>   (FR4)
  - merge dev into the sync branch; halt on conflict      (FR4/FR5)

Exit codes:
  0   success (health + fetch + merge chain all complete, or --dry-run checks pass)
  1   a health check, fetch, or merge step failed
  2   merge conflicts detected — human resolution required (FR5/AC3)

Phase 1+2 scope: health checks, fetch, and merge chain. Resume logic, typecheck
gate, PR creation, and agent playbook arrive in later phases.`)
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

  console.log(`sync-upstream.ts — phase 2 (health + fetch + merge chain)`)
  console.log(`  base-branch: ${cfg.baseBranch}`)
  console.log(`  dry-run:     ${cfg.dryRun}`)

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

  if (cfg.dryRun) {
    console.log("\n--dry-run: skipping fetch + merge chain steps")
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

  console.log("\n✓ phase 2 complete: health checks, fetch, and merge chain done")
  console.log(`  next: phase 3 (resume logic) → phase 4 (typecheck + PR) → phase 5 (playbook)`)
}

main().catch((err) => {
  // Bun.$ throws an exit-code-bearing error on non-zero shell exit. Surface it.
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`\n✗ unexpected error: ${msg}`)
  process.exit(1)
})
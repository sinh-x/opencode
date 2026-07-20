#!/usr/bin/env bun
/**
 * sync-upstream.ts — Agent-executable upstream sync script.
 *
 * Phase 1 (this implementation): pre-sync health checks + fetch skeleton.
 *   - Argument parsing (node:util parseArgs, Bun built-ins only — NFR4)
 *   - Health checks: tools, gh auth, remotes, refs, worktree clean, correct branch (FR1)
 *   - Fetch origin and upstream remotes (FR2)
 *
 * Later phases (merge chain, conflict handling, typecheck gate, PR creation) are
 * intentionally NOT implemented here. This file is the skeleton those phases extend.
 *
 * Traceability: FR1, FR2, NFR1, NFR2, NFR3, NFR4, AC1.
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
// CLI
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`sync-upstream.ts — upstream sync for the opencode fork.

Usage:
  bun run script/sync-upstream.ts [options]

Options:
  --base-branch <name>   Branch the sync targets and that we must start on.
                          Default: sinh-x-dev
  --dry-run              Run health checks only; skip the fetch step.
  -h, --help             Show this help and exit.

Health checks (FR1) run in order; the script aborts on the first failure with a
clear error naming the failed check. Fetch (FR2) runs only after all checks pass.

Exit codes:
  0   success
  1   a health check or fetch step failed

Phase 1 scope: health checks + fetch skeleton only. Merge chain, conflict
handling, typecheck gate, and PR creation arrive in later phases.`)
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

  console.log(`sync-upstream.ts — phase 1 (health + fetch)`)
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
      // worktree. Later phases that merge will add git merge --abort on failure.
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
    console.log("\n--dry-run: skipping fetch step")
    return
  }

  await fetchRemotes(cfg)

  console.log("\n✓ phase 1 complete: health checks passed, remotes fetched")
}

main().catch((err) => {
  // Bun.$ throws an exit-code-bearing error on non-zero shell exit. Surface it.
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`\n✗ unexpected error: ${msg}`)
  process.exit(1)
})
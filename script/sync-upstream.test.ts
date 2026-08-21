/**
 * sync-upstream.test.ts — unit tests for the pure logic functions in
 * sync-upstream.ts (CQ-1 from cycle-2 review d-1fa1b8).
 *
 * Covers the five functions flagged by the review as lacking isolated tests:
 *   - todayStamp()         (pure date formatting)
 *   - syncBranchName()     (pure string composition)
 *   - isValidBranchName()  (pure boolean validation against SAFE_BRANCH_NAME)
 *   - checkTools()         (PATH check, tested with an injected `which` fn)
 *   - ghRepoScopeStatus()  (gh auth scope parsing, tested with an injected shell)
 *
 * No real subprocesses are spawned: `checkTools` and `ghRepoScopeStatus` both
 * accept injectable dependencies (added in this change set), so the tests are
 * hermetic. `todayStamp`, `syncBranchName`, and `isValidBranchName` are already
 * pure and take an optional `now`/`name` argument respectively.
 */

import { describe, expect, test } from "bun:test"
import {
  todayStamp,
  syncBranchName,
  isValidBranchName,
  checkTools,
  ghRepoScopeStatus,
  isValidFullSha,
  isValidReleaseTag,
  releaseBranchName,
  verifyReleaseSourceSha,
  parseReleaseArgs,
  type WhichFn,
  type GhShell,
  type ReleaseConfig,
} from "./sync-upstream.ts"

// ---------------------------------------------------------------------------
// todayStamp
// ---------------------------------------------------------------------------

describe("todayStamp", () => {
  test("returns YYYY-MM-DD for a known date (Jan 1, 2026)", () => {
    expect(todayStamp(new Date(2026, 0, 1))).toBe("2026-01-01")
  })

  test("returns YYYY-MM-DD for a known date (Jul 20, 2026)", () => {
    expect(todayStamp(new Date(2026, 6, 20))).toBe("2026-07-20")
  })

  test("zero-pads single-digit month and day", () => {
    expect(todayStamp(new Date(2026, 2, 9))).toBe("2026-03-09")
  })

  test("handles double-digit month and day without extra padding", () => {
    expect(todayStamp(new Date(2026, 10, 25))).toBe("2026-11-25")
  })

  test("handles year boundaries (Dec 31, 2025)", () => {
    expect(todayStamp(new Date(2025, 11, 31))).toBe("2025-12-31")
  })

  test("handles leap day (Feb 29, 2028)", () => {
    expect(todayStamp(new Date(2028, 1, 29))).toBe("2028-02-29")
  })

  test("uses the current date when called with no argument", () => {
    const expected = todayStamp(new Date())
    // Re-run without args; should match (same calendar day in local time).
    expect(todayStamp()).toBe(expected)
  })

  test("output matches the YYYY-MM-DD pattern", () => {
    expect(todayStamp(new Date(2026, 6, 20))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// syncBranchName
// ---------------------------------------------------------------------------

describe("syncBranchName", () => {
  test("returns sync/upstream-YYYY-MM-DD for a known date", () => {
    expect(syncBranchName(new Date(2026, 6, 20))).toBe("sync/upstream-2026-07-20")
  })

  test("zero-pads month and day in the branch name", () => {
    expect(syncBranchName(new Date(2026, 0, 1))).toBe("sync/upstream-2026-01-01")
  })

  test("uses today's date when called with no argument", () => {
    const expected = `sync/upstream-${todayStamp(new Date())}`
    expect(syncBranchName()).toBe(expected)
  })

  test("branch name always starts with sync/upstream-", () => {
    expect(syncBranchName(new Date(2025, 11, 31))).toMatch(/^sync\/upstream-\d{4}-\d{2}-\d{2}$/)
  })

  test("is a valid git branch name (passes isValidBranchName)", () => {
    expect(isValidBranchName(syncBranchName(new Date(2026, 6, 20)))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isValidBranchName
// ---------------------------------------------------------------------------

describe("isValidBranchName", () => {
  test("accepts the default base branch 'sinh-x-dev'", () => {
    expect(isValidBranchName("sinh-x-dev")).toBe(true)
  })

  test("accepts 'dev'", () => {
    expect(isValidBranchName("dev")).toBe(true)
  })

  test("accepts a sync branch name 'sync/upstream-2026-07-20'", () => {
    expect(isValidBranchName("sync/upstream-2026-07-20")).toBe(true)
  })

  test("accepts a feature branch 'feature/PA-042-login-fix'", () => {
    expect(isValidBranchName("feature/PA-042-login-fix")).toBe(true)
  })

  test("accepts a branch with dots 'release/v1.2.3'", () => {
    expect(isValidBranchName("release/v1.2.3")).toBe(true)
  })

  test("accepts a branch with hyphens and underscores 'feat/my_branch-v2'", () => {
    expect(isValidBranchName("feat/my_branch-v2")).toBe(true)
  })

  test("rejects empty string", () => {
    expect(isValidBranchName("")).toBe(false)
  })

  test("rejects a name starting with a dot", () => {
    expect(isValidBranchName(".hidden")).toBe(false)
  })

  test("rejects a name starting with a slash", () => {
    expect(isValidBranchName("/feature/x")).toBe(false)
  })

  test("rejects a name starting with a hyphen", () => {
    expect(isValidBranchName("-branch")).toBe(false)
  })

  test("rejects shell-injection attempt 'evil; rm -rf /'", () => {
    expect(isValidBranchName("evil; rm -rf /")).toBe(false)
  })

  test("rejects shell-injection attempt with backticks", () => {
    expect(isValidBranchName("evil`whoami`")).toBe(false)
  })

  test("rejects shell-injection attempt with $()", () => {
    expect(isValidBranchName("evil$(whoami)")).toBe(false)
  })

  test("rejects a name with spaces", () => {
    expect(isValidBranchName("my branch")).toBe(false)
  })

  test("rejects a name with ampersand", () => {
    expect(isValidBranchName("a&b")).toBe(false)
  })

  test("rejects a name with newline", () => {
    expect(isValidBranchName("a\nb")).toBe(false)
  })

  test("rejects a name with pipe", () => {
    expect(isValidBranchName("a|b")).toBe(false)
  })

  test("rejects a name with semicolon in the middle", () => {
    expect(isValidBranchName("a;b")).toBe(false)
  })

  test("rejects a single-character name that is a slash", () => {
    expect(isValidBranchName("/")).toBe(false)
  })

  test("rejects a single-character name 'a' (regex requires ≥2 chars)", () => {
    // The SAFE_BRANCH_NAME pattern is ^[a-zA-Z0-9][a-zA-Z0-9._/-]+$, so a
    // single character does not satisfy the `+` quantifier on the second
    // class. This is existing behavior; this test pins it.
    expect(isValidBranchName("a")).toBe(false)
  })

  test("accepts a two-character name 'ab'", () => {
    expect(isValidBranchName("ab")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// checkTools
// ---------------------------------------------------------------------------

describe("checkTools", () => {
  test("passes when git, gh, and bun are all on PATH", async () => {
    const which: WhichFn = () => "/usr/bin/fake"
    const result = await checkTools(which)
    expect(result.ok).toBe(true)
    expect(result.name).toBe("tools-available")
    expect(result.message).toBe("git, gh, bun all on PATH")
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("reports the missing tool when only git is missing", async () => {
    const which: WhichFn = (name) => (name === "git" ? null : "/usr/bin/fake")
    const result = await checkTools(which)
    expect(result.ok).toBe(false)
    expect(result.message).toBe("missing from PATH: git")
  })

  test("reports the missing tool when only gh is missing", async () => {
    const which: WhichFn = (name) => (name === "gh" ? null : "/usr/bin/fake")
    const result = await checkTools(which)
    expect(result.ok).toBe(false)
    expect(result.message).toBe("missing from PATH: gh")
  })

  test("reports the missing tool when only bun is missing", async () => {
    const which: WhichFn = (name) => (name === "bun" ? null : "/usr/bin/fake")
    const result = await checkTools(which)
    expect(result.ok).toBe(false)
    expect(result.message).toBe("missing from PATH: bun")
  })

  test("lists all missing tools in order when several are absent", async () => {
    const which: WhichFn = () => null
    const result = await checkTools(which)
    expect(result.ok).toBe(false)
    expect(result.message).toBe("missing from PATH: git, gh, bun")
  })

  test("returns the correct CheckResult shape", async () => {
    const which: WhichFn = () => "/usr/bin/fake"
    const result = await checkTools(which)
    expect(result).toHaveProperty("name")
    expect(result).toHaveProperty("ok")
    expect(result).toHaveProperty("message")
    expect(result).toHaveProperty("durationMs")
    expect(typeof result.durationMs).toBe("number")
  })

  test("uses the real toolPath (Bun.which) when called with no argument", async () => {
    // No mocking — exercises the production default. On the dev/CI machine,
    // git/gh/bun should all be present; if not, the test still passes because
    // we only assert the shape, not the ok value.
    const result = await checkTools()
    expect(result.name).toBe("tools-available")
    expect(typeof result.ok).toBe("boolean")
    expect(typeof result.message).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// ghRepoScopeStatus
// ---------------------------------------------------------------------------

/**
 * Build a fake shell function for ghRepoScopeStatus. The shell receives the
 * command array and returns stdout, or throws to simulate a non-zero exit.
 * Calls are recorded on the returned function for assertion.
 */
function makeShell(responses: Record<string, string | Error>): {
  shell: GhShell
  calls: string[][]
} {
  const calls: string[][] = []
  const shell: GhShell = async (cmd) => {
    calls.push(cmd)
    const key = cmd.join(" ")
    const found = responses[key]
    if (found instanceof Error) throw found
    if (found === undefined) {
      // No explicit response — default to throwing (non-zero exit).
      throw new Error(`mock shell: no response for ${key}`)
    }
    return found
  }
  return { shell, calls }
}

describe("ghRepoScopeStatus", () => {
  test("authed=false when `gh auth status` fails (not logged in)", async () => {
    const { shell } = makeShell({
      "gh auth status": new Error("not authenticated"),
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(false)
    expect(result.hasRepoScope).toBe(false)
    expect(result.detail).toContain("gh auth login")
  })

  test("hasRepoScope=true when scopes include 'repo'", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "Token scopes: gist, read:org, repo\n",
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(true)
    expect(result.detail).toContain("repo scope")
  })

  test("hasRepoScope=true when scopes include 'admin:repo_all'", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "Token scopes: admin:repo_all\n",
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(true)
  })

  test("hasRepoScope=false when scopes are present but missing 'repo'", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "Token scopes: gist, read:org\n",
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(false)
    expect(result.detail).toContain("missing repo scope")
    expect(result.detail).toContain("gist, read:org")
  })

  test("hasRepoScope=false with 'none' detail when scopes line is empty", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "Token scopes: \n",
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(false)
    expect(result.detail).toContain("none")
  })

  test("falls back to canary when --show-token has no scopes line (GitHub Actions)", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "no scope info here\n",
      "gh pr list --limit 1": "",
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(true)
    expect(result.detail).toContain("canary")
  })

  test("canary failure yields hasRepoScope=false while authed=true", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "no scope info here\n",
      "gh pr list --limit 1": new Error("permission denied"),
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(false)
    expect(result.detail).toContain("gh pr list")
  })

  test("falls back to canary when `gh auth status --show-token` throws", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": new Error("token not available"),
      "gh pr list --limit 1": "",
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(true)
    expect(result.detail).toContain("canary")
  })

  test("parses 'Scopes:' with a capital S (case-insensitive regex)", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "Scopes: repo, gist\n",
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(true)
  })

  test("parses lowercase 'scopes:' too", async () => {
    const { shell } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "scopes: repo\n",
    })
    const result = await ghRepoScopeStatus(shell)
    expect(result.authed).toBe(true)
    expect(result.hasRepoScope).toBe(true)
  })

  test("does not call the canary when the scopes line already has 'repo'", async () => {
    const { shell, calls } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "Token scopes: repo\n",
      "gh pr list --limit 1": "",
    })
    await ghRepoScopeStatus(shell)
    const canaryCalled = calls.some((c) => c.join(" ") === "gh pr list --limit 1")
    expect(canaryCalled).toBe(false)
  })

  test("does not call the canary when the scopes line is missing 'repo' (reports false)", async () => {
    const { shell, calls } = makeShell({
      "gh auth status": "",
      "gh auth status --show-token": "Token scopes: gist\n",
    })
    await ghRepoScopeStatus(shell)
    const canaryCalled = calls.some((c) => c.join(" ") === "gh pr list --limit 1")
    // Per the implementation: a scopes line IS present, so we return false
    // immediately without falling through to the canary.
    expect(canaryCalled).toBe(false)
  })

  test("default shell (production path) runs real gh commands", async () => {
    // Smoke test of the default shell path. On a machine where `gh` is not
    // authenticated, this returns authed=false; on an authenticated machine it
    // returns the real status. We only assert the shape — the value depends on
    // the host. The point is that calling without the injected shell does not
    // throw synchronously and returns a well-formed result.
    const result = await ghRepoScopeStatus()
    expect(result).toHaveProperty("authed")
    expect(result).toHaveProperty("hasRepoScope")
    expect(result).toHaveProperty("detail")
    expect(typeof result.authed).toBe("boolean")
    expect(typeof result.hasRepoScope).toBe("boolean")
    expect(typeof result.detail).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// isValidFullSha (release mode — NFR3)
// ---------------------------------------------------------------------------

describe("isValidFullSha", () => {
  test("accepts a 40-character lowercase hex SHA", () => {
    expect(isValidFullSha("2b72179c663cadcb54f54d9f19221b3fb3d11fb6")).toBe(true)
  })

  test("accepts all-zeros SHA", () => {
    expect(isValidFullSha("0000000000000000000000000000000000000000")).toBe(true)
  })

  test("rejects an abbreviated SHA (7 chars)", () => {
    expect(isValidFullSha("2b72179")).toBe(false)
  })

  test("rejects a 39-character SHA", () => {
    expect(isValidFullSha("2b72179c663cadcb54f54d9f19221b3fb3d11fb")).toBe(false)
  })

  test("rejects a 41-character SHA", () => {
    expect(isValidFullSha("2b72179c663cadcb54f54d9f19221b3fb3d11fb66")).toBe(false)
  })

  test("rejects uppercase hex SHA", () => {
    expect(isValidFullSha("2B72179C663CADCB54F54D9F19221B3FB3D11FB6")).toBe(false)
  })

  test("rejects empty string", () => {
    expect(isValidFullSha("")).toBe(false)
  })

  test("rejects a non-hex string of length 40", () => {
    expect(isValidFullSha("gggggggggggggggggggggggggggggggggggggggg")).toBe(false)
  })

  test("rejects a SHA with spaces", () => {
    expect(isValidFullSha("2b72179c663cadcb54f54d9f19221b3fb3d11fb ")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidReleaseTag (release mode — FR1)
// ---------------------------------------------------------------------------

describe("isValidReleaseTag", () => {
  test("accepts v1.18.19", () => {
    expect(isValidReleaseTag("v1.18.19")).toBe(true)
  })

  test("accepts v0.0.1", () => {
    expect(isValidReleaseTag("v0.0.1")).toBe(true)
  })

  test("accepts v2.0.0-rc.1", () => {
    expect(isValidReleaseTag("v2.0.0-rc.1")).toBe(true)
  })

  test("accepts v1.0.0-beta", () => {
    expect(isValidReleaseTag("v1.0.0-beta")).toBe(true)
  })

  test("rejects a tag without leading v", () => {
    expect(isValidReleaseTag("1.18.19")).toBe(false)
  })

  test("rejects a branch name", () => {
    expect(isValidReleaseTag("upstream/dev")).toBe(false)
  })

  test("rejects a moving ref", () => {
    expect(isValidReleaseTag("dev")).toBe(false)
  })

  test("rejects empty string", () => {
    expect(isValidReleaseTag("")).toBe(false)
  })

  test("rejects a tag with spaces", () => {
    expect(isValidReleaseTag("v1.18.19 ")).toBe(false)
  })

  test("rejects shell-injection attempt", () => {
    expect(isValidReleaseTag("v1.18.19; rm -rf /")).toBe(false)
  })

  test("rejects a tag with only two version components", () => {
    expect(isValidReleaseTag("v1.18")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// releaseBranchName (release mode — FR2)
// ---------------------------------------------------------------------------

describe("releaseBranchName", () => {
  test("returns sync/release-<tag> for v1.18.19", () => {
    expect(releaseBranchName("v1.18.19")).toBe("sync/release-v1.18.19")
  })

  test("returns sync/release-<tag> for v2.0.0-rc.1", () => {
    expect(releaseBranchName("v2.0.0-rc.1")).toBe("sync/release-v2.0.0-rc.1")
  })

  test("result is a valid git branch name", () => {
    expect(isValidBranchName(releaseBranchName("v1.18.19"))).toBe(true)
  })

  test("result is distinct from dev-mode sync branch names", () => {
    expect(releaseBranchName("v1.18.19")).not.toMatch(/^sync\/upstream-/)
  })
})

// ---------------------------------------------------------------------------
// verifyReleaseSourceSha (release mode — FR1, NFR3)
// ---------------------------------------------------------------------------

describe("verifyReleaseSourceSha", () => {
  const approvedSha = "2b72179c663cadcb54f54d9f19221b3fb3d11fb6"
  const baseRcfg: ReleaseConfig = {
    releaseTag: "v1.18.19",
    expectedSourceSha: approvedSha,
    dryRun: false,
    remotes: { origin: "origin", upstream: "upstream" },
    baseBranch: "sinh-x-dev",
    releaseBranch: "sync/release-v1.18.19",
  }

  test("passes when remote and local SHAs match the approved SHA", () => {
    const result = verifyReleaseSourceSha(baseRcfg, approvedSha, approvedSha)
    expect(result.ok).toBe(true)
    expect(result.name).toBe("release-source-verified")
    expect(result.message).toContain(approvedSha)
  })

  test("fails when remote tag SHA is null (tag not found on upstream)", () => {
    const result = verifyReleaseSourceSha(baseRcfg, null, approvedSha)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("not found on upstream")
  })

  test("fails when remote tag SHA does not match approved SHA (wrong SHA rejection)", () => {
    const wrongSha = "0000000000000000000000000000000000000000"
    const result = verifyReleaseSourceSha(baseRcfg, wrongSha, approvedSha)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("remote tag SHA")
    expect(result.message).toContain(wrongSha)
    expect(result.message).toContain(approvedSha)
  })

  test("fails when local tag SHA is null (tag not fetched)", () => {
    const result = verifyReleaseSourceSha(baseRcfg, approvedSha, null)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("not found")
    expect(result.message).toContain("git fetch upstream --tags")
  })

  test("fails when local tag SHA does not match approved SHA (tag moved)", () => {
    const wrongSha = "1111111111111111111111111111111111111111"
    const result = verifyReleaseSourceSha(baseRcfg, approvedSha, wrongSha)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("local tag SHA")
    expect(result.message).toContain(wrongSha)
  })

  test("fails when both remote and local are null", () => {
    const result = verifyReleaseSourceSha(baseRcfg, null, null)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("not found on upstream")
  })

  test("fails when remote matches but local differs (stale local tag)", () => {
    const wrongSha = "ffffffffffffffffffffffffffffffffffffffff"
    const result = verifyReleaseSourceSha(baseRcfg, approvedSha, wrongSha)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("local tag SHA")
  })
})

// ---------------------------------------------------------------------------
// parseReleaseArgs (release mode — FR1, mode separation)
// ---------------------------------------------------------------------------

describe("parseReleaseArgs", () => {
  const approvedSha = "2b72179c663cadcb54f54d9f19221b3fb3d11fb6"
  const opts = { dryRun: false, remotes: { origin: "origin", upstream: "upstream" } }

  test("returns null when no release flags are present (dev mode)", () => {
    const result = parseReleaseArgs(undefined, undefined, "sinh-x-dev", opts)
    expect(result).toBe(null)
  })

  test("returns ReleaseConfig when both tag and SHA are valid", () => {
    const result = parseReleaseArgs("v1.18.19", approvedSha, "sinh-x-dev", opts)
    expect(result).not.toBe(null)
    expect(result!.releaseTag).toBe("v1.18.19")
    expect(result!.expectedSourceSha).toBe(approvedSha)
    expect(result!.baseBranch).toBe("sinh-x-dev")
    expect(result!.releaseBranch).toBe("sync/release-v1.18.19")
    expect(result!.dryRun).toBe(false)
  })

  test("returns ReleaseConfig with dryRun=true when opts.dryRun is true", () => {
    const result = parseReleaseArgs("v1.18.19", approvedSha, "sinh-x-dev", { ...opts, dryRun: true })
    expect(result!.dryRun).toBe(true)
  })

  test("releaseBranch is derived from tag via releaseBranchName", () => {
    const result = parseReleaseArgs("v2.0.0", approvedSha, "sinh-x-dev", opts)
    expect(result!.releaseBranch).toBe(releaseBranchName("v2.0.0"))
  })

  test("mode separation: dev-mode sync branch is distinct from release branch", () => {
    const devBranch = syncBranchName(new Date(2026, 7, 21))
    const relBranch = releaseBranchName("v1.18.19")
    expect(devBranch).not.toBe(relBranch)
    expect(devBranch).toMatch(/^sync\/upstream-/)
    expect(relBranch).toMatch(/^sync\/release-/)
  })
})
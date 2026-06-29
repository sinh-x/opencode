import { describe, expect, test } from "bun:test"
import {
  sidebarLaunchEnv,
  sidebarRefreshKey,
  sidebarRefreshState,
  sidebarSelectedRef,
  sidebarSelectedRefKey,
  sidebarStoredSelectedRef,
} from "../../src/feature-plugins/sidebar/git-context"

type VcsBranchSummary = {
  active_branch?: string
  selected_ref?: string
  available_refs: string[]
  commit_total: number
  commit_rows: Array<{ hash: string; subject: string; author: string }>
  diff: {
    total_files: number
    additions: number
    deletions: number
    rows: Array<{ file: string; additions: number; deletions: number }>
  }
}

function summary(overrides: Partial<VcsBranchSummary> = {}): VcsBranchSummary {
  return {
    available_refs: [],
    commit_total: 1,
    commit_rows: [{ hash: "abc1234", subject: "feat: test", author: "sinh" }],
    diff: { total_files: 1, additions: 3, deletions: 1, rows: [{ file: "src/test.ts", additions: 3, deletions: 1 }] },
    ...overrides,
  }
}

describe("git-context utilities", () => {
  describe("sidebarLaunchEnv", () => {
    test("returns all env key entries when values are present", () => {
      const result = sidebarLaunchEnv({
        PA_DEPLOYMENT_ID: "d-abc123",
        PA_MODE: "implement",
        PA_TEAM: "builder",
        PA_TICKET_ID: "OPC-014",
        PA_PROVIDER: "openai",
        PA_MODEL: "gpt-4",
      })

      expect(result).toHaveLength(6)
      expect(result).toEqual([
        { key: "PA_DEPLOYMENT_ID", value: "d-abc123" },
        { key: "PA_MODE", value: "implement" },
        { key: "PA_TEAM", value: "builder" },
        { key: "PA_TICKET_ID", value: "OPC-014" },
        { key: "PA_PROVIDER", value: "openai" },
        { key: "PA_MODEL", value: "gpt-4" },
      ])
    })

    test("skips keys with empty values", () => {
      const result = sidebarLaunchEnv({
        PA_DEPLOYMENT_ID: "d-abc123",
        PA_MODE: "",
        PA_TEAM: "builder",
        PA_TICKET_ID: "",
        PA_PROVIDER: "openai",
        PA_MODEL: "gpt-4",
      })

      expect(result).toHaveLength(4)
      expect(result.map((e) => e.key).sort()).toEqual([
        "PA_DEPLOYMENT_ID",
        "PA_MODEL",
        "PA_PROVIDER",
        "PA_TEAM",
      ])
    })

    test("skips keys with only whitespace values", () => {
      const result = sidebarLaunchEnv({ PA_MODE: "   " })

      expect(result).toHaveLength(0)
    })

    test("skips missing keys entirely", () => {
      const result = sidebarLaunchEnv({
        PA_DEPLOYMENT_ID: "d-abc123",
        PA_TEAM: "builder",
      })

      expect(result).toHaveLength(2)
      expect(result.map((e) => e.key).sort()).toEqual(["PA_DEPLOYMENT_ID", "PA_TEAM"])
    })

    test("returns empty array for empty source", () => {
      const result = sidebarLaunchEnv({})

      expect(result).toHaveLength(0)
    })

    test("accepts custom source parameter", () => {
      const custom = { PA_DEPLOYMENT_ID: "custom-id" }
      const result = sidebarLaunchEnv(custom)

      expect(result).toHaveLength(1)
      expect(result).toEqual([{ key: "PA_DEPLOYMENT_ID", value: "custom-id" }])
    })
  })

  describe("sidebarSelectedRef", () => {
    test("returns undefined when summary is undefined", () => {
      const result = sidebarSelectedRef(undefined, "main")

      expect(result).toBeUndefined()
    })

    test("returns stored ref when it exists in available_refs", () => {
      const result = sidebarSelectedRef(
        summary({ available_refs: ["main", "feat/test"], selected_ref: "dev" }),
        "feat/test",
      )

      expect(result).toBe("feat/test")
    })

    test("falls back to summary selected_ref when stored is not in available_refs", () => {
      const result = sidebarSelectedRef(
        summary({ available_refs: ["main", "feat/test"], selected_ref: "dev" }),
        "unknown-ref",
      )

      expect(result).toBe("dev")
    })

    test("falls back to summary selected_ref when stored is undefined", () => {
      const result = sidebarSelectedRef(
        summary({ available_refs: ["main", "feat/test"], selected_ref: "dev" }),
        undefined,
      )

      expect(result).toBe("dev")
    })

    test("returns undefined when summary has no selected_ref and stored does not match available_refs", () => {
      const result = sidebarSelectedRef(
        summary({ available_refs: ["main"] }),
        "unknown",
      )

      expect(result).toBeUndefined()
    })

    test("returns stored ref when it matches an available_ref exactly", () => {
      const result = sidebarSelectedRef(
        summary({ available_refs: ["origin/main", "main"], selected_ref: "origin/main" }),
        "main",
      )

      expect(result).toBe("main")
    })
  })

  describe("sidebarSelectedRefKey", () => {
    test("uses worktree when provided", () => {
      const result = sidebarSelectedRefKey("/worktree/path", "/dir/path", "/cwd/path")

      expect(result).toBe("sidebar_git_selected_ref:/worktree/path")
    })

    test("falls back to directory when worktree is undefined", () => {
      const result = sidebarSelectedRefKey(undefined, "/dir/path", "/cwd/path")

      expect(result).toBe("sidebar_git_selected_ref:/dir/path")
    })

    test("falls back to cwd when both worktree and directory are undefined", () => {
      const result = sidebarSelectedRefKey(undefined, undefined, "/cwd/path")

      expect(result).toBe("sidebar_git_selected_ref:/cwd/path")
    })

    test("defaults cwd to process.cwd() when not provided", () => {
      const result = sidebarSelectedRefKey(undefined, undefined)

      expect(result).toBe(`sidebar_git_selected_ref:${process.cwd()}`)
    })
  })

  describe("sidebarStoredSelectedRef", () => {
    test("returns repoValue when present", () => {
      const result = sidebarStoredSelectedRef("ref/repo", "ref/legacy")

      expect(result).toBe("ref/repo")
    })

    test("falls back to legacyValue when repoValue is null", () => {
      const result = sidebarStoredSelectedRef(null, "ref/legacy")

      expect(result).toBe("ref/legacy")
    })

    test("falls back to legacyValue when repoValue is empty string", () => {
      const result = sidebarStoredSelectedRef("", "ref/legacy")

      expect(result).toBe("ref/legacy")
    })

    test("returns undefined when both values are null", () => {
      const result = sidebarStoredSelectedRef(null, null)

      expect(result).toBeUndefined()
    })

    test("returns undefined when repoValue is empty and legacyValue is null", () => {
      const result = sidebarStoredSelectedRef("", null)

      expect(result).toBeUndefined()
    })
  })

  describe("sidebarRefreshKey", () => {
    test("joins all fields with newlines", () => {
      const result = sidebarRefreshKey({
        selectedRefKey: "sidebar_git_selected_ref:/repo",
        selectedRef: "main",
        branch: "feat/test",
        pollTick: 42,
      })

      expect(result).toBe("sidebar_git_selected_ref:/repo\nmain\nfeat/test\n42")
    })

    test("handles undefined selectedRef and branch as empty in join", () => {
      const result = sidebarRefreshKey({
        selectedRefKey: "sidebar_git_selected_ref:/repo",
        selectedRef: undefined,
        branch: undefined,
        pollTick: 0,
      })

      expect(result).toBe("sidebar_git_selected_ref:/repo\n\n\n0")
    })

    test("handles pollTick zero", () => {
      const result = sidebarRefreshKey({
        selectedRefKey: "k",
        selectedRef: undefined,
        branch: undefined,
        pollTick: 0,
      })

      expect(result).toBe("k\n\n\n0")
    })
  })

  describe("sidebarRefreshState", () => {
    test("on success returns nextSummary with stale=false", () => {
      const next = summary({ selected_ref: "main" })
      const result = sidebarRefreshState(undefined, next, false)

      expect(result.summary).toBe(next)
      expect(result.stale).toBe(false)
    })

    test("on success returns undefined nextSummary with stale=false", () => {
      const result = sidebarRefreshState(undefined, undefined, false)

      expect(result.summary).toBeUndefined()
      expect(result.stale).toBe(false)
    })

    test("on failure preserves previousSummary and sets stale=true", () => {
      const prev = summary({ selected_ref: "main" })
      const result = sidebarRefreshState(prev, undefined, true)

      expect(result.summary).toBe(prev)
      expect(result.stale).toBe(true)
    })

    test("on failure with undefined previousSummary sets stale=false", () => {
      const result = sidebarRefreshState(undefined, undefined, true)

      expect(result.summary).toBeUndefined()
      expect(result.stale).toBe(false)
    })

    test("on failure preserves previousSummary even when nextSummary is also provided", () => {
      const prev = summary({ selected_ref: "main" })
      const next = summary({ selected_ref: "dev" })
      const result = sidebarRefreshState(prev, next, true)

      expect(result.summary).toBe(prev)
      expect(result.stale).toBe(true)
    })
  })
})

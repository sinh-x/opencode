import { describe, expect, test } from "bun:test"
import {
  sidebarLaunchEnv,
  sidebarRefreshKey,
  sidebarRefreshState,
  sidebarSelectedRef,
  sidebarSelectedRefKey,
  sidebarStoredSelectedRef,
} from "@/cli/cmd/tui/feature-plugins/sidebar/git-context"

describe("sidebarLaunchEnv", () => {
  test("returns only non-empty core PA env vars", () => {
    const result = sidebarLaunchEnv({
      PA_DEPLOYMENT_ID: "d-123",
      PA_MODE: "implement",
      PA_TEAM: "builder",
      PA_TICKET_ID: "",
      PA_PROVIDER: "openai",
      PA_MODEL: "gpt-5",
      PA_SECRET_TOKEN: "nope",
    })
    expect(result).toEqual([
      { key: "PA_DEPLOYMENT_ID", value: "d-123" },
      { key: "PA_MODE", value: "implement" },
      { key: "PA_TEAM", value: "builder" },
      { key: "PA_PROVIDER", value: "openai" },
      { key: "PA_MODEL", value: "gpt-5" },
    ])
  })
})

describe("sidebarSelectedRef", () => {
  test("uses persisted ref when available", () => {
    const result = sidebarSelectedRef(
      {
        active_branch: "feat/test",
        selected_ref: "origin/dev",
        available_refs: ["origin/dev", "develop"],
        commit_total: 0,
        commit_rows: [],
        diff: { total_files: 0, additions: 0, deletions: 0, rows: [] },
      },
      "develop",
    )
    expect(result).toBe("develop")
  })

  test("falls back to backend-selected ref when persisted ref is invalid", () => {
    const result = sidebarSelectedRef(
      {
        active_branch: "feat/test",
        selected_ref: "origin/dev",
        available_refs: ["origin/dev", "develop"],
        commit_total: 0,
        commit_rows: [],
        diff: { total_files: 0, additions: 0, deletions: 0, rows: [] },
      },
      "origin/main",
    )
    expect(result).toBe("origin/dev")
  })
})

describe("sidebarSelectedRefKey", () => {
  test("prefers worktree when worktree and directory differ", () => {
    expect(sidebarSelectedRefKey("/repo/worktree", "/repo/directory")).toBe("sidebar_git_selected_ref:/repo/worktree")
  })

  test("uses worktree when available", () => {
    expect(sidebarSelectedRefKey("/repo-a", "/repo-a")).toBe("sidebar_git_selected_ref:/repo-a")
  })

  test("falls back to directory when worktree is unavailable", () => {
    expect(sidebarSelectedRefKey(undefined, "/repo-b")).toBe("sidebar_git_selected_ref:/repo-b")
  })

  test("produces isolated keys for separate repos", () => {
    expect(sidebarSelectedRefKey("/repo-a", "/repo-a")).not.toBe(sidebarSelectedRefKey("/repo-b", "/repo-b"))
  })
})

describe("sidebarStoredSelectedRef", () => {
  test("prefers repo-scoped value", () => {
    expect(sidebarStoredSelectedRef("origin/dev", "origin/main")).toBe("origin/dev")
  })

  test("falls back to legacy global value", () => {
    expect(sidebarStoredSelectedRef(null, "origin/main")).toBe("origin/main")
  })

  test("returns undefined when both values are missing", () => {
    expect(sidebarStoredSelectedRef(null, null)).toBeUndefined()
  })
})

describe("sidebarRefreshKey", () => {
  test("changes when selected ref changes", () => {
    const branch = "feat/current"
    const selectedRefKey = "sidebar_git_selected_ref:/repo"
    const before = sidebarRefreshKey({ selectedRef: "origin/dev", selectedRefKey, branch, pollTick: 0 })
    const after = sidebarRefreshKey({ selectedRef: "origin/main", selectedRefKey, branch, pollTick: 0 })
    expect(before).not.toBe(after)
  })

  test("changes when branch changes", () => {
    const selectedRef = "origin/dev"
    const selectedRefKey = "sidebar_git_selected_ref:/repo"
    const before = sidebarRefreshKey({ selectedRef, selectedRefKey, branch: "feat/one", pollTick: 0 })
    const after = sidebarRefreshKey({ selectedRef, selectedRefKey, branch: "feat/two", pollTick: 0 })
    expect(before).not.toBe(after)
  })

  test("changes when poll tick changes", () => {
    const selectedRef = "origin/dev"
    const selectedRefKey = "sidebar_git_selected_ref:/repo"
    const branch = "feat/current"
    const before = sidebarRefreshKey({ selectedRef, selectedRefKey, branch, pollTick: 1 })
    const after = sidebarRefreshKey({ selectedRef, selectedRefKey, branch, pollTick: 2 })
    expect(before).not.toBe(after)
  })
})

describe("sidebarRefreshState", () => {
  test("keeps previous summary and marks stale when refresh fails", () => {
    const previous = {
      active_branch: "feat/current",
      selected_ref: "origin/dev",
      available_refs: ["origin/dev"],
      commit_total: 3,
      commit_rows: [{ hash: "abc1234", subject: "before", author: "sinh" }],
      diff: { total_files: 1, additions: 2, deletions: 1, rows: [{ file: "a.ts", additions: 2, deletions: 1 }] },
    }
    const result = sidebarRefreshState(previous, undefined, true)
    expect(result.summary).toEqual(previous)
    expect(result.stale).toBeTrue()
  })

  test("uses next summary and clears stale when refresh succeeds", () => {
    const previous = {
      active_branch: "feat/current",
      selected_ref: "origin/dev",
      available_refs: ["origin/dev"],
      commit_total: 3,
      commit_rows: [{ hash: "abc1234", subject: "before", author: "sinh" }],
      diff: { total_files: 1, additions: 2, deletions: 1, rows: [{ file: "a.ts", additions: 2, deletions: 1 }] },
    }
    const next = {
      active_branch: "feat/current",
      selected_ref: "origin/dev",
      available_refs: ["origin/dev"],
      commit_total: 4,
      commit_rows: [{ hash: "def5678", subject: "after", author: "sinh" }],
      diff: { total_files: 2, additions: 5, deletions: 2, rows: [{ file: "b.ts", additions: 5, deletions: 2 }] },
    }
    const result = sidebarRefreshState(previous, next, false)
    expect(result.summary).toEqual(next)
    expect(result.stale).toBeFalse()
  })
})

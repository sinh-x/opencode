import { describe, expect, test } from "bun:test"
import {
  sidebarLaunchEnv,
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

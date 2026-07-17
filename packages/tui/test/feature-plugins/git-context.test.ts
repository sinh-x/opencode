import { describe, expect, test } from "bun:test"
import { sidebarLaunchEnv, sidebarSelectedRef } from "../../src/feature-plugins/sidebar/git-context"

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
})
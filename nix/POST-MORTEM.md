# Post-Mortem: Nix Source Build of opencode fork — Prior Attempts

> Date: 2026-07-16
> Author: builder/team-manager (deployment d-b364af)
> Ticket: OPC-023
> Phase: 1 (Consolidate WIP + post-mortem)
> Requirements doc: agent-teams/requirements/artifacts/2026-07-16-opencode-nix-source-build-retry.md §12 Reuse Analysis

This document covers all 4 prior attempts to build the opencode fork from source via Nix, the failure cause of each, and the reuse/reject decision. Per FR-7 and AC-7, every attempt is documented with both a failure cause and a reuse/reject decision.

---

## Attempt 1 — `feat/nix-source-build` (PR #9, commit ea8400f03)

**Date:** 2026-06-29
**Scope:** First switch from upstream binary to source build. Changed `flake.nix` to source `bun` from `bun.packages.${system}` and pass `src = self` into `nix/opencode-bin.nix`, reusing the binary-download derivation as a source-build derivation.

**Failure cause:** `bun.packages.${system}` from the nixpkgs bun overlay did not provide a bun that worked in the overlay context. The overlay's `bun` derivation had packaging issues (missing/incorrect closures for the source-build use case), causing the build to fail. This was an overlay/wiring problem, not a source-build logic problem — the derivation in `opencode-bin.nix` was never designed to build from source.

**Reuse decision: REUSE (partial).** The intent (flake default → source build) and the flake wiring shape (`src = self`, `callPackage ./nix/opencode-bin.nix` with bun arg) are sound and reused in concept. The specific bun sourcing (`bun.packages.${system}`) is rejected in favor of `nix/bun-bin.nix` (see Attempt 2).

---

## Attempt 2 — `fix/nix-bun-packages` (PR #10, commit 6f0b6395b)

**Date:** 2026-06-29
**Scope:** Follow-up fix to PR #9. Replaced `bun.packages.${system}` with `final.callPackage ./nix/bun-bin.nix { version = "1.3.14"; }` in the overlay, and `pkgs.callPackage ./nix/bun-bin.nix { version = "1.3.14"; }` in packages. This introduced `nix/bun-bin.nix` as a pinned bun 1.3.14 derivation.

**Failure cause:** This fixed the bun sourcing but did not address the deeper problem: building inside `opencode-bin.nix` (the binary-download derivation) conflates two unrelated derivations. The source build still produced a `--single` standalone binary, which segfaults on NixOS TUI due to embedded Bun runtime libc incompatibility with NixOS glibc. The FOD node_modules problem was also still unaddressed.

**Reuse decision: REUSE.** `nix/bun-bin.nix` (the bun 1.3.14 pin) is already merged to `sinh-x-dev` and in-tree. It remains the correct bun pin for the source build and the wrapper. No further work needed from this branch.

---

## Attempt 3 — `fix/nix-source-fod` (commit 8c2b3a6f6 + stash WIP 490c40397)

**Date:** 2026-06-29
**Scope:** Added a `nix/node-modules.nix` (hyphenated name) FOD derivation to produce `node_modules` in a pure sandbox, separate from the binary derivation. The FOD used `lib.fakeHash` initially. A WIP stash (commit 490c40397, "WIP on fix/nix-source-fod") modified the FOD to drop `--frozen-lockfile` (using `bun install --no-cache` instead) — likely an attempt to work around lockfile resolution failures. The branch was abandoned mid-flight.

**Stash contents (harvested 2026-07-16):** The stash `WIP on fix/nix-source-fod` (commit 490c40397) contains exactly one change: `nix/node-modules.nix` buildPhase `bun install --frozen-lockfile --no-cache` → `bun install --no-cache` (removes `--frozen-lockfile`).

**Stash harvest decision: REJECT.** The stash's FOD was a minimal early prototype (22 lines, `lib.fakeHash`/single hardcoded hash, no CPU/OS targeting, no canonicalize/normalize scripts, no `--ignore-scripts`, no `--filter`). Upstream's `nix/node_modules.nix` (underscore naming, already in-tree) is a strictly superior implementation: it has CPU/OS-targeted installs, package filters, `--frozen-lockfile --ignore-scripts`, the upstream `canonicalize-node-modules.ts` + `normalize-bun-binaries.ts` determinism normalization scripts, `outputHash` from `hashes.json`, and multi-platform support. The stash's change (dropping `--frozen-lockfile`) is a step backwards from upstream's correct frozen-lockfile approach and would reintroduce the non-determinism that caused prior FOD hash mismatches. Nothing from the stash is applied.

**Failure cause (original branch):** The FOD used `lib.fakeHash` (a placeholder) and a minimal buildPhase with no determinism normalization. `bun install` output varied across runs → FOD hash mismatches. The branch was abandoned before a correct hash could be computed, and the stash workaround (dropping `--frozen-lockfile`) would have made determinism worse, not better.

**Reuse decision: REUSE (approach only).** The FOD approach — a separate fixed-output derivation for `node_modules` — is correct and is now aligned with upstream's `nix/node_modules.nix` already in-tree. The specific `nix/node-modules.nix` file and stash contents are rejected in favor of upstream's implementation.

---

## Attempt 4 — `fix/source-build-v2` (commit 81041062c, 2026-06-29)

**Date:** 2026-06-29
**Scope:** FOD hash fix. Changed `nix/node-modules.nix` `outputHash` from `lib.fakeHash` to a computed real hash (`sha256-VkO53IyHWzI/z+tE7ri3FKC+MRQacmkA9tgbB66BQWQ=`). Also switched the FOD's `stdenv` to `stdenvNoCC` (per the commit history — to avoid store-path references leaking into the FOD output, which breaks purity).

**Failure cause:** Building the source inside `opencode-bin.nix` (the binary-download derivation) was the wrong architecture. The source build and the binary download are fundamentally different derivations and conflating them caused repeated issues. Additionally, the FOD hash fix alone did not resolve the standalone-binary segfault on NixOS TUI (the `--single` build embeds a Bun runtime incompatible with NixOS glibc). PR #11 ("revert-nix-source-build", commit c6e62b4a9) reverted this entire approach back to the binary download and shipped upstream binary v1.17.11 instead (commit d7cc1ac23).

**Reuse decision: REUSE (lessons).** Two lessons carry forward:
1. **`stdenvNoCC` for FOD** — avoid store-path references in FOD output (breaks purity). Upstream `node_modules.nix` already uses `stdenvNoCC`.
2. **Hash workflow** — compute the real hash via a local recompute script, not `lib.fakeHash`. This is the basis for Phase 4 (FOD hash recompute).

**Reject decision:** Building the source inside `opencode-bin.nix`. Keep `opencode-bin.nix` (binary download) and `opencode.nix` (source build) as separate derivations. The `--single` standalone binary is also rejected in favor of unbundled JS + bun wrapper (per FR-4).

---

## Uncommitted WIP — `plugin-sidebar-guide` (discarded 2026-07-16)

**Date:** 2026-06-29 → 2026-07-16
**Scope:** The `plugin-sidebar-guide` branch contained both a git-context sidebar plugin (discarded — builtin sidebar already exists on `sinh-x-dev`) and nix source-build WIP. The nix WIP was saved as `deployments/d-0bc8af/team-manager/plugin-sidebar-guide-wip.patch` before the branch was discarded.

**Nix WIP contents (applied in Phase 1):**
- `nix/opencode.nix`: buildPhase `bun --bun ./script/build.ts --single --skip-install` → `bun --bun ./script/nix-build.ts`; installPhase `install -Dm755 dist/opencode-*/bin/opencode` → bun-wrapper over unbundled `dist/opencode-linux-x64/bin/index.js` via `makeWrapper ${bun}/bin/bun`
- `packages/opencode/script/nix-build.ts`: env-overridable `OPENCODE_VERSION`/`OPENCODE_CHANNEL` (falls back to `Script.version`/`Script.channel`)
- `flake.lock`: nixpkgs bump (rev `8c91a71d...` → `e52c192b...`, 2025-06-29 → 2025-07-01 range)
- `bun.lock`: `@types/bun`/`bun-types` 1.3.13 → 1.3.14
- `packages/sdk/js/package.json`: exports `./src/...` → `./dist/...` (needed for unbundled JS to resolve SDK imports)

**Not applied (per Phase 1 instructions):** `.opencode/plugins/git-context-custom.tsx` and `.opencode/tui.json` — already on `sinh-x-dev` as builtin sidebar.

**Reuse decision: REUSE (starting point).** This is the starting point for the retry. Applied to `feat/OPC-023-nix-source-build` in Phase 1.

---

## Stale Branches — Deletion Candidates

Per FR-9, the following branches are stale (work consolidated onto `feat/OPC-023-nix-source-build`). They are listed here as deletion candidates — **do NOT delete yet**; deletion happens after the full source build is verified working (later phases).

| Branch | Last commit | Status | Deletion candidate |
|--------|-------------|--------|--------------------|
| `feat/nix-source-build` | `ea8400f03` (PR #9, merged & superseded) | Merged to `sinh-x-dev`, then reverted by PR #11 | Yes — after Phase 5 verifies the new source build |
| `fix/nix-bun-packages` | `6f0b6395b` (PR #10, merged) | Merged to `sinh-x-dev`; `nix/bun-bin.nix` in-tree | Yes — after Phase 5 (bun-bin.nix already in use) |
| `fix/nix-source-fod` | `8c2b3a6f6` + stash `490c40397` | Abandoned mid-flight; stash harvested & rejected | Yes — after Phase 5 (FOD approach adopted via upstream `node_modules.nix`) |
| `fix/source-build-v2` | `81041062c` | Reverted by PR #11; superseded by binary bump | Yes — after Phase 5 (stdenvNoCC + hash lessons captured) |

**Deletion prerequisite:** All four branches are deletion candidates only after Phase 5 (`nix build .#opencode` green + runtime smoke) confirms the new source build works. Deleting earlier risks losing the only reference to prior FOD hash attempts if the retry fails and needs to consult them.

---

## Summary: Reuse/Reject Matrix

| Attempt | Failure cause | Reuse | Reject |
|---------|---------------|-------|--------|
| PR #9 `feat/nix-source-build` | `bun.packages` overlay broken; `opencode-bin.nix` not designed for source build | Intent + flake wiring shape | `bun.packages.${system}` sourcing |
| PR #10 `fix/nix-bun-packages` | Source still produced `--single` segfault; FOD unaddressed | `nix/bun-bin.nix` 1.3.14 pin (in-tree) | — |
| `fix/nix-source-fod` (+stash) | `lib.fakeHash`; no determinism normalization; stash drops `--frozen-lockfile` (worse) | FOD approach (via upstream `node_modules.nix`) | Stash contents; early `node-modules.nix` prototype |
| `fix/source-build-v2` | Built source inside `opencode-bin.nix`; `--single` segfault persists | `stdenvNoCC` lesson; hash workflow | Building inside `opencode-bin.nix`; `--single` binary |

All four prior attempts shared two root causes:
1. **FOD non-determinism** — `bun install` output varied without canonicalize/normalize scripts → hash mismatches. Upstream's `canonicalize-node-modules.ts` + `normalize-bun-binaries.ts` (in-tree) solve this.
2. **`--single` standalone binary segfault** — embedded Bun runtime incompatible with NixOS glibc. The retry uses unbundled JS + bun wrapper (FR-4) to avoid this entirely.
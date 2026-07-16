# Nix packaging for the sinh-x opencode fork

This directory holds the Nix derivations that build the fork from source.

## Packages

| Attribute | Description |
|---|---|
| `.#opencode` | Source build: unbundled JS built by `script/nix-build.ts` + bun 1.3.14 wrapper (default package + overlay) |
| `.#opencode-bin` | Upstream binary fallback (v1.17.11) |
| `.#node_modules_updater` | FOD hash-recompute helper (uses `lib.fakeHash` so the build fails and reveals the correct hash) |

## Recomputing the FOD hash after `bun.lock` changes

`nix/node_modules.nix` is a fixed-output derivation (FOD) whose hash is stored in
`nix/hashes.json` per platform. Whenever `bun.lock` or any of the filtered
source inputs change, the x86_64-linux hash must be recomputed locally.

Single command (run from repo root):

```sh
nix/scripts/recompute-hashes.sh
```

What it does:

1. Builds `.#node_modules_updater`, which overrides the FOD `hash` with
   `lib.fakeHash` so the derivation runs once and fails with a hash-mismatch
   error that prints the real SRI hash.
2. Extracts the `got: sha256-...` value from the build log.
3. Writes the new hash into `nix/hashes.json` under `nodeModules.<system>`
   (defaults to the current host system; pass a system name as the first
   argument to target another platform).
4. Verifies the new hash by rebuilding `.#node_modules`.

Typical runtime is a few minutes (one sandboxed `bun install`). The script
does not depend on GitHub CI — it is purely local.

### Manual alternative

If you prefer to update `hashes.json` by hand:

```sh
nix build .#node_modules_updater --no-link 2>&1 | grep 'got:'
# copy the sha256-... value into nix/hashes.json -> nodeModules.x86_64-linux
nix build .#opencode --no-link   # should now pass the FOD stage
```

### Determinism

The FOD uses `nix/scripts/canonicalize-node-modules.ts` and
`nix/scripts/normalize-bun-binaries.ts` to normalize symlinks and `.bin`
entries so `bun install` output is deterministic across builds. Verify
stability by deleting the FOD store path and rebuilding; the revealed hash
must be identical across two consecutive clean builds.

## Regression guard

After syncing upstream changes that touch `bun.lock` or anything under `nix/`,
run the regression guard to confirm the source build still works:

```sh
nix/scripts/regression-guard.sh
```

What it does:

1. Reads the last known-good commit from `.regression-guard.state`
   (gitignored). On first run there is no state, so it builds immediately.
2. Diffs the watched paths (`bun.lock` and `nix/`) between that commit and the
   current working tree (including uncommitted changes).
3. If relevant files changed, runs `nix build .#opencode` (override with the
   `REGRESSION_GUARD_BUILD_CMD` environment variable).
4. On success, records the current `HEAD` as the new known-good commit and
   exits 0. On failure, exits non-zero without updating state.

Flags:

- `--force` — rebuild even when no changes are detected.
- `--reset` — forget the stored known-good commit and exit (no build).
- `--status` — report whether a build is needed; do not build.

The guard is modeled after `script/upstream-status.sh` (report-only helpers)
and exits 0 on success, non-zero on failure. CI adoption is deferred (FR-8 is a
`Should`); this is a local-only check.

## Files

- `flake.nix` — flake outputs (packages, devShells, overlays)
- `opencode.nix` — source-build derivation (bun-wrapper over unbundled JS)
- `opencode-bin.nix` — upstream binary fallback
- `node_modules.nix` — FOD `node_modules` derivation
- `hashes.json` — per-platform FOD hashes
- `bun-bin.nix` — bun 1.3.14 pin
- `scripts/canonicalize-node-modules.ts` — determinism normalization
- `scripts/normalize-bun-binaries.ts` — determinism normalization
- `scripts/recompute-hashes.sh` — local FOD hash recompute
- `scripts/regression-guard.sh` — source-build regression guard after upstream syncs
- `desktop.nix` — desktop packaging (out of scope for the source-build work)
- `POST-MORTEM.md` — prior attempt post-mortem
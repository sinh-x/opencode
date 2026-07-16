#!/usr/bin/env bash
# Regression guard for the opencode Nix source build.
#
# Detects changes to `bun.lock` or anything under `nix/` since the last
# known-good build and, when changes are present, verifies the source build
# still passes (`nix build .#opencode`). Exits 0 on success (or when no
# changes are detected), non-zero on build failure.
#
# The last known-good commit is recorded in a local state file
# (`.regression-guard.state`, gitignored) so the guard only rebuilds when
# something relevant actually changed.
#
# Usage:
#   nix/scripts/regression-guard.sh            # check + build if needed
#   nix/scripts/regression-guard.sh --force    # always build, ignore state
#   nix/scripts/regression-guard.sh --reset     # forget last-known-good, exit
#   nix/scripts/regression-guard.sh --status   # report only, no build
#
# Environment overrides:
#   REGRESSION_GUARD_BUILD_CMD  command used to verify the build
#                               (default: nix build .#opencode --no-link)
#
# Requirements: nix with flakes enabled; run from the repo root (or anywhere
# inside the repo). Modeled after script/upstream-status.sh (report-only
# helpers, set -eu) and nix/scripts/recompute-hashes.sh.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "error: not inside a git repository" >&2
  exit 1
}

state_file="$repo_root/.regression-guard.state"
build_cmd="${REGRESSION_GUARD_BUILD_CMD:-nix build .#opencode --no-link}"

# Watched paths: bun.lock plus everything under nix/.
watched_paths="bun.lock nix/"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

# Print the list of files that changed under the watched paths between the
# stored known-good commit and the current working tree (including
# uncommitted changes). Empty output means no relevant changes.
changed_files() {
  local base=$1
  git -C "$repo_root" diff --name-only "$base" -- $watched_paths
}

current_head() {
  git -C "$repo_root" rev-parse HEAD
}

read_state() {
  [[ -f "$state_file" ]] && cat "$state_file" || true
}

write_state() {
  printf '%s\n' "$1" >"$state_file"
}

mode=check
for arg in "$@"; do
  case "$arg" in
    --force) mode=force ;;
    --reset) mode=reset ;;
    --status) mode=status ;;
    -h | --help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "unknown argument: $arg (try --help)" ;;
  esac
done

if [[ "$mode" == "reset" ]]; then
  rm -f "$state_file"
  echo "[regression-guard] state reset ($state_file removed)"
  exit 0
fi

base=$(read_state)
if [[ -z "$base" ]]; then
  echo "[regression-guard] no prior known-good state recorded; will build."
  base=$(current_head)
  must_build=1
elif [[ "$mode" == "force" ]]; then
  echo "[regression-guard] --force: rebuilding regardless of state."
  must_build=1
else
  changes=$(changed_files "$base")
  if [[ -z "$changes" ]]; then
    must_build=0
  else
    echo "[regression-guard] changes detected since last known-good ($base):"
    printf '  %s\n' $changes
    must_build=1
  fi
fi

if [[ "$mode" == "status" ]]; then
  if [[ -n "$base" && -z "${must_build:-}" ]]; then
    echo "[regression-guard] no relevant changes; build up to date (base $base)."
  else
    echo "[regression-guard] build needed (base ${base:-<none>})."
  fi
  exit 0
fi

if [[ "${must_build:-0}" == "0" ]]; then
  echo "[regression-guard] no relevant changes; skipping build. (base $base)"
  exit 0
fi

echo "[regression-guard] running: $build_cmd"
if $build_cmd; then
  write_state "$(current_head)"
  echo "[regression-guard] OK: build passed. State updated to $(current_head)."
  exit 0
fi

fail "build failed; source build regression detected. Re-run with --force after fixing, or --reset to forget the known-good baseline."
#!/usr/bin/env bash
# Recompute the FOD hash for opencode-node_modules and update nix/hashes.json.
#
# Usage:
#   nix/scripts/recompute-hashes.sh [system]
#
# system defaults to the current host system (x86_64-linux on most NixOS hosts).
# The script builds .#node_modules_updater (which uses lib.fakeHash) so the FOD
# build runs once and fails with the correct hash printed in the error output.
# The revealed SRI hash is then written into nix/hashes.json under
# nodeModules.<system>.
#
# Requirements: nix with flakes enabled; run from the repo root.
# Expected runtime: a few minutes (one sandboxed `bun install`).
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
hashes_file="$repo_root/nix/hashes.json"

system="${1:-$(nix eval --raw --impure --expr 'builtins.currentSystem' 2>/dev/null || echo x86_64-linux)}"

echo "[recompute-hashes] system=$system"
echo "[recompute-hashes] building .#node_modules_updater (fakeHash) to reveal FOD hash..."

build_log=$(mktemp -t recompute-hashes.XXXXXX.log)
trap 'rm -f "$build_log"' EXIT

# Build the updater; it is expected to fail with a hash mismatch that reveals
# the real fixed-output hash.
nix build ".#node_modules_updater" --no-link --print-build-logs 2>&1 | tee "$build_log" || true

# Extract the "got:" SRI hash from the error output.
new_hash=$(grep -Eo 'got:[[:space:]]+sha256-[A-Za-z0-9+/=]+' "$build_log" | head -n1 | sed -E 's/^got:[[:space:]]+//')

if [[ -z "$new_hash" ]]; then
  echo "error: could not extract FOD hash from build log." >&2
  echo "expected a line of the form: got: sha256-..." >&2
  exit 1
fi

echo "[recompute-hashes] revealed hash: $new_hash"

# Update hashes.json using nix's builtins to keep JSON formatting stable.
tmp_json=$(mktemp -t hashes.XXXXXX.json)
trap 'rm -f "$build_log" "$tmp_json"' EXIT

nix eval --json --impure --expr "
  let
    existing = builtins.fromJSON (builtins.readFile $hashes_file);
    updated = existing.nodeModules // { \"$system\" = \"$new_hash\"; };
  in existing // { nodeModules = updated }
" > "$tmp_json"

# Pretty-print through nix for stable, readable output.
nix eval --json --impure --expr "builtins.fromJSON (builtins.readFile $tmp_json)" \
  | nix fmt 2>/dev/null \
  || python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))' \
  > "$hashes_file"

echo "[recompute-hashes] updated $hashes_file for $system"
cat "$hashes_file"

# Sanity: verify the new hash actually passes the FOD check.
echo "[recompute-hashes] verifying with nix build .#node_modules (FOD check)..."
nix build ".#node_modules" --no-link
echo "[recompute-hashes] OK: FOD hash accepted."
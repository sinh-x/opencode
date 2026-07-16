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
trap 'rm -f "$build_log" "$hashes_file.tmp"' EXIT

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

# Update hashes.json: merge the new hash into the nodeModules map for the
# target system. Previously this used shell-interpolated variables inside a
# `nix eval --impure --expr` string (an injection risk if values ever came
# from untrusted sources). Now the merge is done in python3 with no DSL
# interpolation; the script already depends on python3 for pretty-printing.
python3 -c '
import json, sys
system = sys.argv[1]
new_hash = sys.argv[2]
with open(sys.argv[3]) as f:
    data = json.load(f)
data.setdefault("nodeModules", {})[system] = new_hash
print(json.dumps(data, indent=2))
' "$system" "$new_hash" "$hashes_file" > "$hashes_file.tmp" && mv "$hashes_file.tmp" "$hashes_file"

echo "[recompute-hashes] updated $hashes_file for $system"
cat "$hashes_file"

# Sanity: verify the new hash actually passes the FOD check.
echo "[recompute-hashes] verifying with nix build .#node_modules (FOD check)..."
nix build ".#node_modules" --no-link
echo "[recompute-hashes] OK: FOD hash accepted."
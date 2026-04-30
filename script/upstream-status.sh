#!/bin/sh

set -eu

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

remote_has_repo() {
  git -C "$repo_root" config --get-all "remote.$1.url" | while IFS= read -r url; do
    case "$url" in
      *"$2"* | *"$3"*)
        printf '%s\n' yes
        break
        ;;
    esac
  done
}

require_remote() {
  git -C "$repo_root" remote get-url "$1" >/dev/null 2>&1 || fail "Missing required remote: $1"
}

require_ref() {
  git -C "$repo_root" rev-parse --verify --quiet "$1^{commit}" >/dev/null || fail "Missing required ref after fetch: $1"
}

print_counts() {
  left_ref=$1
  right_ref=$2
  set -- $(git -C "$repo_root" rev-list --left-right --count "$left_ref...$right_ref")
  printf '%s...%s:\n' "$left_ref" "$right_ref"
  printf '  %s ahead of %s: %s\n' "$left_ref" "$right_ref" "$1"
  printf '  %s behind %s: %s\n' "$left_ref" "$right_ref" "$2"
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "Current directory is not inside a git repository"

[ -f "$repo_root/.opencode/branch-strategy.yaml" ] || fail "Current repository is not the OpenCode repository: missing .opencode/branch-strategy.yaml"
[ -f "$repo_root/AGENTS.md" ] || fail "Current repository is not the OpenCode repository: missing AGENTS.md"

require_remote origin
require_remote upstream

[ -n "$(remote_has_repo origin sinh-x/opencode sinh-x/opencode.git)" ] || fail "origin must point to sinh-x/opencode"
[ -n "$(remote_has_repo upstream anomalyco/opencode anomalyco/opencode.git)" ] || fail "upstream must point to anomalyco/opencode"

printf 'Fetching origin...\n'
git -C "$repo_root" fetch origin
printf 'Fetching upstream...\n'
git -C "$repo_root" fetch upstream

require_ref upstream/dev
require_ref dev
require_ref origin/dev
require_ref sinh-x-dev
require_ref origin/sinh-x-dev

printf '\nUpstream status report for %s\n' "$repo_root"
printf '\n'
print_counts dev upstream/dev
printf '\n'
print_counts sinh-x-dev dev

if [ -n "$(git -C "$repo_root" status --porcelain)" ]; then
  printf '\nWARNING: Worktree has uncommitted changes. Do not proceed with mutating sync steps until reviewed.\n'
fi

printf '\nSuggested next steps:\n'
printf '  1. Review the counts above and confirm whether an upstream sync is needed.\n'
printf '  2. If upstream sync is needed, ask Sinh before any branch switch, integration, or publication step.\n'
printf '  3. Keep flow one-way: upstream/dev -> dev -> sinh-x-dev.\n'
printf '  4. Keep PA and Sinh-specific work on sinh-x-dev or feature branches targeting sinh-x-dev.\n'

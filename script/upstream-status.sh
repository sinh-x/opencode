#!/bin/sh

set -eu

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

remote_has_exact_url() {
  remote_name=$1
  expected_ssh=$2
  expected_https=$3

  git -C "$repo_root" config --get-all "remote.$remote_name.url" | while IFS= read -r url; do
    case "$url" in
      "$expected_ssh" | "$expected_https")
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

remote_urls() {
  git -C "$repo_root" config --get-all "remote.$1.url"
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

[ -n "$(remote_has_exact_url origin git@github.com:sinh-x/opencode.git https://github.com/sinh-x/opencode.git)" ] || fail "origin must be git@github.com:sinh-x/opencode.git or https://github.com/sinh-x/opencode.git. Actual: $(remote_urls origin)"
[ -n "$(remote_has_exact_url upstream git@github.com:anomalyco/opencode.git https://github.com/anomalyco/opencode.git)" ] || fail "upstream must be git@github.com:anomalyco/opencode.git or https://github.com/anomalyco/opencode.git. Actual: $(remote_urls upstream)"

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
current_branch=$(git -C "$repo_root" branch --show-current)
if [ -n "$current_branch" ]; then
  printf 'Current branch: %s\n' "$current_branch"
else
  printf 'Current branch: detached HEAD (%s)\n' "$(git -C "$repo_root" rev-parse --short HEAD)"
fi
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

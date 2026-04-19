#!/bin/bash
#
# PAiA — release preflight checks.
#
# Run this BEFORE tagging a release. Catches all the dumb mistakes that
# would otherwise burn a CI run.
#
# Usage:
#   bash scripts/release-preflight.sh

set -u  # error on undefined vars but allow individual checks to fail and report

# Move to the project root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# ── colors ──────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  RESET='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; RESET=''
fi

PASS=0
FAIL=0
WARN=0

ok()    { printf "  ${GREEN}✓${RESET} %s\n" "$1"; PASS=$((PASS+1)); }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$1"; FAIL=$((FAIL+1)); }
warn()  { printf "  ${YELLOW}!${RESET} %s\n" "$1"; WARN=$((WARN+1)); }
header(){ printf "\n${GREEN}═══${RESET} %s ${GREEN}═══${RESET}\n" "$1"; }

# ── git state ───────────────────────────────────────────────────
header "git state"

if ! git rev-parse --git-dir &>/dev/null; then
  fail "not in a git repository"
else
  ok "in a git repository"

  if [ -n "$(git status --porcelain)" ]; then
    fail "uncommitted changes — commit or stash before tagging"
    git status --short | sed 's/^/      /'
  else
    ok "working tree is clean"
  fi

  current_branch=$(git rev-parse --abbrev-ref HEAD)
  if [ "$current_branch" != "main" ] && [ "$current_branch" != "master" ]; then
    warn "you are on branch '$current_branch', not main/master"
  else
    ok "on $current_branch"
  fi
fi

# ── version + changelog ─────────────────────────────────────────
header "version + changelog"

if [ -f "package.json" ]; then
  pkg_version=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")
  ok "package.json version: $pkg_version"

  if [ -f "CHANGELOG.md" ]; then
    if grep -q "## v$pkg_version" CHANGELOG.md; then
      ok "CHANGELOG.md has an entry for v$pkg_version"
    else
      fail "CHANGELOG.md missing entry for v$pkg_version"
    fi
  else
    fail "CHANGELOG.md not found"
  fi

  if git rev-parse "v$pkg_version" &>/dev/null; then
    warn "tag v$pkg_version already exists — bump version before tagging again"
  else
    ok "tag v$pkg_version is available"
  fi
fi

# ── secrets that should NOT be in the repo ──────────────────────
header "secret leakage"

leaked=0
for pattern in "PAIA_PRIVATE_KEY_B64=[^\"'\$]" "sk_live_" "sk_test_" "whsec_[a-zA-Z0-9]" "BEGIN.*PRIVATE KEY"; do
  if git grep -lE "$pattern" -- ':!OPERATIONS.md' ':!server/deploy/.env.example' ':!server/license-server.mjs' ':!server/README.md' ':!CHANGELOG.md' ':!**/*.test.ts' &>/dev/null; then
    fail "potential secret leaked (pattern: $pattern)"
    git grep -lE "$pattern" -- ':!OPERATIONS.md' ':!server/deploy/.env.example' ':!server/license-server.mjs' ':!server/README.md' ':!CHANGELOG.md' ':!**/*.test.ts' | sed 's/^/      /'
    leaked=1
  fi
done

if [ -d ".keys" ]; then
  if git ls-files .keys | grep -q .; then
    fail ".keys/ contents are tracked by git — remove them with: git rm -r --cached .keys/"
    leaked=1
  fi
fi

if [ $leaked -eq 0 ]; then
  ok "no secrets detected in tracked files"
fi

# ── package.json publish config ────────────────────────────────
header "publish config"

if grep -q '"REPLACE_ME"' package.json; then
  fail "package.json still contains REPLACE_ME — set build.publish.owner to your real GitHub user/org"
else
  ok "package.json publish config looks customised"
fi

# ── icons ───────────────────────────────────────────────────────
header "icons"

if [ -f "assets/icon.svg" ]; then
  ok "assets/icon.svg present"
else
  fail "assets/icon.svg missing"
fi

for f in icon.png icon.ico icon.icns; do
  if [ -f "assets/$f" ]; then
    ok "assets/$f built"
  else
    warn "assets/$f not built — run 'npm run build:icons'"
  fi
done

# ── lint + tests ────────────────────────────────────────────────
header "lint + tests"

if command -v npm &>/dev/null; then
  if npm run lint --silent 2>&1 | tail -5 | grep -qiE 'error TS|error\b'; then
    fail "TypeScript lint errors — run 'npm run lint' to see them"
  else
    ok "lint clean"
  fi

  if npm test --silent 2>&1 | tail -5 | grep -q "FAIL"; then
    fail "unit tests failing — run 'npm test' to see them"
  else
    ok "unit tests passing"
  fi
else
  fail "npm not available"
fi

# ── build ───────────────────────────────────────────────────────
header "build"

if npm run build --silent 2>&1 | tail -5 | grep -qiE 'error\b'; then
  fail "build failed — run 'npm run build' to see the error"
else
  ok "build succeeds"
fi

# ── CI workflow file ────────────────────────────────────────────
header "CI workflow"

if [ -f ".github/workflows/build.yml" ]; then
  ok ".github/workflows/build.yml present"
  if grep -q "REPLACE_ME" .github/workflows/build.yml; then
    fail ".github/workflows/build.yml still contains REPLACE_ME"
  fi
else
  warn ".github/workflows/build.yml not found"
fi

# ── summary ─────────────────────────────────────────────────────
header "summary"

printf "  ${GREEN}%d passed${RESET}, ${RED}%d failed${RESET}, ${YELLOW}%d warnings${RESET}\n" $PASS $FAIL $WARN

if [ $FAIL -gt 0 ]; then
  printf "\n${RED}✗${RESET} preflight FAILED — fix the items above before tagging\n\n"
  exit 1
fi

if [ $WARN -gt 0 ]; then
  printf "\n${YELLOW}!${RESET} preflight passed with warnings — review them before tagging\n\n"
  exit 0
fi

printf "\n${GREEN}✓${RESET} preflight PASSED — safe to tag\n\n"
printf "  Next:\n"
printf "    git tag v%s\n" "$pkg_version"
printf "    git push origin v%s\n" "$pkg_version"
printf "\n"

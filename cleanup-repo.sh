#!/bin/bash
#
# PAiA repo cleanup — non-destructive.
#
# Moves the legacy WinUI prototype + the redundant nested copies into a
# single `legacy/` folder so the top level shows only the active product.
#
# This script DOES NOT DELETE ANYTHING. Everything is moved, not removed.
# If you want to actually delete the legacy stuff, do it manually after
# you've verified the move is correct.
#
# Usage:
#   bash cleanup-repo.sh           # dry run, shows what would happen
#   bash cleanup-repo.sh --apply   # actually do the moves

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APPLY=0
if [ "${1:-}" = "--apply" ]; then
  APPLY=1
fi

if [ -t 1 ]; then
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  RESET='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; RESET=''
fi

ok()    { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn()  { printf "  ${YELLOW}!${RESET} %s\n" "$1"; }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$1"; }

printf "\n${GREEN}═══${RESET} PAiA repo cleanup ${GREEN}═══${RESET}\n\n"

if [ $APPLY -eq 0 ]; then
  warn "DRY RUN — nothing will actually be moved. Re-run with --apply to commit."
  printf "\n"
fi

# Items to move into legacy/
LEGACY_ITEMS=(
  "PAiA.WinUI"
  "PAiA.Tests"
  "PAiA.sln"
  "Installer"
  "publish.ps1"
  "ARCHITECTURE.md"
  "FAQ.md"
  "GETTING_STARTED.md"
  "PRIVACY.md"
  "README.legacy.md"
  "PAiA"
  "files"
  "files.zip"
)

# Step 1: report what's going to happen.
printf "Plan:\n"
printf "  Create legacy/\n"
for item in "${LEGACY_ITEMS[@]}"; do
  if [ -e "$item" ]; then
    printf "  Move  %s → legacy/%s\n" "$item" "$item"
  else
    printf "  Skip  %s (not present)\n" "$item"
  fi
done
printf "\n"

# Step 2: warn about uncommitted changes that would be affected.
if git rev-parse --git-dir &>/dev/null; then
  dirty_in_scope=0
  for item in "${LEGACY_ITEMS[@]}"; do
    if [ -e "$item" ] && [ -n "$(git status --porcelain "$item" 2>/dev/null)" ]; then
      if [ $dirty_in_scope -eq 0 ]; then
        warn "uncommitted changes in items being moved:"
        dirty_in_scope=1
      fi
      git status --porcelain "$item" 2>/dev/null | sed 's/^/      /'
    fi
  done
  if [ $dirty_in_scope -eq 1 ]; then
    printf "\n"
    warn "the moves will preserve these changes (git mv keeps history)."
    warn "but you should commit or stash before running --apply, just in case."
    printf "\n"
  fi
fi

if [ $APPLY -eq 0 ]; then
  printf "Re-run with: ${GREEN}bash cleanup-repo.sh --apply${RESET}\n\n"
  exit 0
fi

# Step 3: actually do it.
printf "Applying...\n"
mkdir -p legacy

moved=0
for item in "${LEGACY_ITEMS[@]}"; do
  if [ ! -e "$item" ]; then continue; fi

  if git rev-parse --git-dir &>/dev/null && git ls-files --error-unmatch "$item" &>/dev/null; then
    # Tracked file/dir — use git mv to preserve history
    if git mv "$item" "legacy/$item" 2>/dev/null; then
      ok "git mv $item → legacy/$item"
      moved=$((moved+1))
    else
      # git mv can fail on dirty paths; fall back to plain mv
      mv "$item" "legacy/$item" && ok "mv $item → legacy/$item (fallback)" && moved=$((moved+1)) || fail "could not move $item"
    fi
  else
    mv "$item" "legacy/$item" && ok "mv $item → legacy/$item" && moved=$((moved+1)) || fail "could not move $item"
  fi
done

printf "\n${GREEN}═══${RESET} Done — $moved item(s) moved into legacy/ ${GREEN}═══${RESET}\n\n"
printf "Next steps:\n"
printf "  1. Inspect the result:  ${GREEN}ls${RESET}\n"
printf "  2. Verify legacy/ contents look right:  ${GREEN}ls legacy/${RESET}\n"
printf "  3. Update any lingering links to the moved files\n"
printf "  4. Commit:  ${GREEN}git add -A && git commit -m 'Archive legacy WinUI prototype into legacy/'${RESET}\n"
printf "\n"

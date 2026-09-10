#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPOSITORY_ROOT="$(cd "$FRONTEND_ROOT/../.." && pwd)"
BACKUP_ROOT="$REPOSITORY_ROOT/.proof-toolkit-clean-state-backup.$$"
PATHS=(
  "$REPOSITORY_ROOT/src/compiler/bin"
  "$REPOSITORY_ROOT/src/compiler/obj"
  "$REPOSITORY_ROOT/src/preview/bin"
  "$REPOSITORY_ROOT/src/preview/obj"
  "$FRONTEND_ROOT/.generated-public/compiler"
  "$FRONTEND_ROOT/.generated-public/preview"
)
ORIGINAL_PRESENT=()

restore_intermediates() {
  local exit_code=$?
  trap - EXIT INT TERM
  for index in "${!PATHS[@]}"; do
    if [[ "${ORIGINAL_PRESENT[$index]:-0}" == "1" && -e "$BACKUP_ROOT/$index" ]]; then
      rm -rf "${PATHS[$index]}"
      mkdir -p "$(dirname "${PATHS[$index]}")"
      mv "$BACKUP_ROOT/$index" "${PATHS[$index]}"
    else
      rm -rf "${PATHS[$index]}"
    fi
  done
  [[ ! -d "$BACKUP_ROOT" ]] || rmdir "$BACKUP_ROOT"
  exit "$exit_code"
}

trap restore_intermediates EXIT INT TERM
mkdir "$BACKUP_ROOT"
for index in "${!PATHS[@]}"; do
  if [[ -e "${PATHS[$index]}" ]]; then
    ORIGINAL_PRESENT[$index]=1
    mv "${PATHS[$index]}" "$BACKUP_ROOT/$index"
  else
    ORIGINAL_PRESENT[$index]=0
  fi
done

npm --prefix "$FRONTEND_ROOT" run stage:compiler
npm --prefix "$FRONTEND_ROOT" run stage:preview
test -f "$REPOSITORY_ROOT/src/compiler/obj/project.assets.json"
test -f "$REPOSITORY_ROOT/src/preview/obj/project.assets.json"
test -f "$FRONTEND_ROOT/.generated-public/compiler/compiler-build.json"
test -f "$FRONTEND_ROOT/.generated-public/preview/preview-build.json"
echo "Clean-state compiler and preview staging passed; local intermediates will be restored."

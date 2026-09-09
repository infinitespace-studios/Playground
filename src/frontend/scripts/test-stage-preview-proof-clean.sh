#!/usr/bin/env bash
set -euo pipefail

# Clean-state PROOF preview staging check. Mirrors test-stage-preview-clean.sh
# but stages the PROOF profile and asserts the proof-only runtime surface is
# present in the staged output while the product preview.js stays proof-clean.
# Local build intermediates are backed up and restored so this is side-effect
# free for a developer's working tree.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPOSITORY_ROOT="$(cd "$FRONTEND_ROOT/../.." && pwd)"
BACKUP_ROOT="$REPOSITORY_ROOT/.stage-preview-proof-backup.$$"
PATHS=(
  "$REPOSITORY_ROOT/src/preview/bin"
  "$REPOSITORY_ROOT/src/preview/obj"
  "$FRONTEND_ROOT/.generated-public/preview"
)
ORIGINAL_PRESENT=()

restore_intermediates() {
  local exit_code=$?
  trap - EXIT INT TERM

  for index in "${!PATHS[@]}"; do
    if [[ "${ORIGINAL_PRESENT[$index]:-0}" == "1" ]]; then
      if [[ -e "$BACKUP_ROOT/$index" ]]; then
        rm -rf "${PATHS[$index]}"
        mkdir -p "$(dirname "${PATHS[$index]}")"
        mv "$BACKUP_ROOT/$index" "${PATHS[$index]}"
      fi
    else
      rm -rf "${PATHS[$index]}"
    fi
  done

  if [[ -d "$BACKUP_ROOT" ]]; then
    rmdir "$BACKUP_ROOT"
  fi

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

for path in "${PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    echo "Clean-state setup failed; path still exists: $path" >&2
    exit 1
  fi
done

npm --prefix "$FRONTEND_ROOT" run stage:preview:proof

STAGED="$FRONTEND_ROOT/.generated-public/preview"
test -f "$STAGED/index.html"
test -f "$STAGED/preview.js"
test -f "$STAGED/preview-build.json"

# Required proof-only runtime surface must be present in the PROOF staging.
test -f "$STAGED/preview-proof-extension.js"
test -f "$STAGED/issue033-negative-observer.js"
grep -q "installIssue040AudioProbe" "$STAGED/preview-proof-extension.js"
grep -q "previewIssue040Proof" "$STAGED/preview-proof-extension.js"
grep -q "createProofExpectationRegistry" "$STAGED/preview-proof-extension.js"

# The shipping preview.js must remain proof-clean even in the proof staging.
for symbol in previewIssue installIssue040AudioProbe createProofExpectationRegistry \
  QueryIssue039State QueryStoppedGameProof Issue034FileSystemProbe; do
  if grep -q "$symbol" "$STAGED/preview.js"; then
    echo "Proof symbol \"$symbol\" leaked into staged preview.js" >&2
    exit 1
  fi
done

# Non-vacuous floor: it IS the product preview runtime.
grep -q "createPreviewEndpoint" "$STAGED/preview.js"
grep -q "verifyRuntimeAsset" "$STAGED/preview.js"

echo "Clean-state PROOF preview staging passed; local intermediates will be restored."

#!/usr/bin/env bash
set -euo pipefail

# Clean-state PRODUCT compiler staging check. Stages the product compiler from a
# clean intermediate state and asserts the staged compiler runtime carries no
# proof surface (no proof extension/shared proof endpoints, no proof
# export/handshake symbols in compiler-harness.js, and a neutral index.html),
# while confirming it IS the product compiler runtime (non-vacuous floor). Local
# build intermediates are backed up and restored so this is side-effect free.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPOSITORY_ROOT="$(cd "$FRONTEND_ROOT/../.." && pwd)"
BACKUP_ROOT="$REPOSITORY_ROOT/.stage-compiler-backup.$$"
PATHS=(
  "$REPOSITORY_ROOT/src/compiler/bin"
  "$REPOSITORY_ROOT/src/compiler/obj"
  "$FRONTEND_ROOT/.generated-public/compiler"
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

npm --prefix "$FRONTEND_ROOT" run stage:compiler

STAGED="$FRONTEND_ROOT/.generated-public/compiler"
test -f "$STAGED/index.html"
test -f "$STAGED/compiler-harness.js"
test -f "$STAGED/compiler-build.json"

# Proof-only runtime surface must be ABSENT from the product staging.
for asset in compiler-proof-extension.js ProtocolEndpointsProof.js; do
  if [[ -e "$STAGED/$asset" ]]; then
    echo "Proof-only asset \"$asset\" leaked into product compiler staging" >&2
    exit 1
  fi
done

# The shipping compiler-harness.js must carry no proof export/handshake symbol.
for symbol in compilerProof compilerIssue21Proof initializeCompilerProofMode \
  createProofExpectationRegistry AuthorizeRetentionProof CompleteRetentionProof \
  GetRetentionState runRetentionBehaviorProof proof-state; do
  if grep -q "$symbol" "$STAGED/compiler-harness.js"; then
    echo "Proof symbol \"$symbol\" leaked into staged compiler-harness.js" >&2
    exit 1
  fi
done

# The product index.html must not reference the proof extension or proof DOM.
if grep -q "compiler-proof-extension.js\|proof-state" "$STAGED/index.html"; then
  echo "Product staged compiler index.html references a proof-only extension/DOM" >&2
  exit 1
fi

# Non-vacuous floor: it IS the product compiler runtime.
grep -q "createCompilerEndpoint" "$STAGED/compiler-harness.js"
grep -q "CompileAndRetain" "$STAGED/compiler-harness.js"

echo "Clean-state PRODUCT compiler staging passed; local intermediates will be restored."

#!/usr/bin/env bash
set -euo pipefail

# Clean-state PROOF compiler staging check. Mirrors test-stage-compiler-clean.sh
# but stages the PROOF profile and asserts the proof-only runtime surface is
# present in the staged output (proof extension + shared proof endpoints, proof
# index.html loading the extension before the harness) while the product
# compiler-harness.js stays proof-clean. Local build intermediates are backed up
# and restored so this is side-effect free for a developer's working tree.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPOSITORY_ROOT="$(cd "$FRONTEND_ROOT/../.." && pwd)"
BACKUP_ROOT="$REPOSITORY_ROOT/.stage-compiler-proof-backup.$$"
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

npm --prefix "$FRONTEND_ROOT" run stage:compiler:proof

STAGED="$FRONTEND_ROOT/.generated-public/compiler"
test -f "$STAGED/index.html"
test -f "$STAGED/compiler-harness.js"
test -f "$STAGED/compiler-build.json"

# Required proof-only runtime surface must be present in the PROOF staging.
test -f "$STAGED/compiler-proof-extension.js"
test -f "$STAGED/Issue21EndpointsProof.js"
grep -q "initializeCompilerProofMode" "$STAGED/compiler-proof-extension.js"
grep -q "compilerIssue21Proof" "$STAGED/compiler-proof-extension.js"
grep -q "runRetentionBehaviorProof" "$STAGED/compiler-proof-extension.js"
grep -q "createProofExpectationRegistry" "$STAGED/Issue21EndpointsProof.js"
# The proof index must load the extension before the harness and render proof state.
grep -q "compiler-proof-extension.js" "$STAGED/index.html"
grep -q "proof-state" "$STAGED/index.html"

# The shipping compiler-harness.js must remain proof-clean even in the proof staging.
for symbol in compilerProof compilerIssue21Proof initializeCompilerProofMode \
  createProofExpectationRegistry AuthorizeRetentionProof runRetentionBehaviorProof \
  proof-state; do
  if grep -q "$symbol" "$STAGED/compiler-harness.js"; then
    echo "Proof symbol \"$symbol\" leaked into staged compiler-harness.js" >&2
    exit 1
  fi
done

# Non-vacuous floor: it IS the product compiler runtime.
grep -q "createCompilerEndpoint" "$STAGED/compiler-harness.js"
grep -q "CompileAndRetain" "$STAGED/compiler-harness.js"

echo "Clean-state PROOF compiler staging passed; local intermediates will be restored."

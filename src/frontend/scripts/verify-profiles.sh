#!/usr/bin/env bash
# Profile verification: prove the product/proof artifact separation binds to
# FRESH, PROFILE-SPECIFIC staging, and that a product build after a proof build
# stays clean (cross-profile cleanliness) — including the .NET-staged compiler
# and preview runtimes copied verbatim from publicDir into each build.
#
# WHY THIS IS A REAL FRESH SEQUENCE (Stage 6 remediation):
#   The .NET staging is NO LONGER profile-independent. `stage:compiler` /
#   `stage:preview` publish the PRODUCT runtime (no proof extension, neutral
#   index.html), while `stage:compiler:proof` / `stage:preview:proof` publish the
#   PROOF runtime (proof extension + shared proof endpoints + proof DOM/observer)
#   into the SAME `.generated-public/` publicDir. Vite copies publicDir verbatim
#   into each build's output (dist/compiler, dist/preview, ...). Therefore a
#   single shared stage cannot serve both profiles: whichever profile was staged
#   last would be baked into BOTH dist/ and dist-proof/. Staging once and then
#   running vite for product → proof → product (the old, now-removed shortcut)
#   would emit a proof-contaminated product or a product-contaminated proof.
#
#   To prove separation honestly we perform a genuine per-profile stage before
#   each vite build:
#     1. stage PRODUCT  -> vite PRODUCT  -> dist/       + product graph check
#                                                       + staged-runtime PRODUCT check
#     2. stage PROOF     -> vite PROOF    -> dist-proof/ + proof graph check
#                                                       + staged-runtime PROOF check
#     3. RESTAGE PRODUCT -> vite PRODUCT  -> dist/       + product graph check
#                                                       + staged-runtime PRODUCT check
#                          (proves the product build after a proof build never
#                           inherits proof-only .NET output or a proof manifest)
#     4. sibling separation: dist/ stays "product", dist-proof/ stays "proof",
#        the proof extension/observer/proof-state exist ONLY under dist-proof/,
#        and NO proof extension/staged symbol survives the FINAL product build.
#
# Each vite build empties only its own outDir (build.emptyOutDir) and each stage
# rewrites the profile-specific publicDir, so stale artifacts are removed per
# profile and the sibling profile output stays untouched. The graph checker
# validates each per-build profile-manifest.json; the staged-runtime checks here
# validate the actual .NET runtime files copied into each dist tree.
#
# `--skip-stage` was REMOVED (Stage 6 remediation): a single reused
# `.generated-public/` can only ever hold ONE profile's .NET runtime, so it can
# never prove BOTH profile-specific staged sets. Reusing it would make the proof
# leg (or the product leg) validate the wrong runtime. There is no safe reuse
# mode; the verification is intentionally a full fresh sequence.
#
# Usage: bash scripts/verify-profiles.sh
#   (no options; any argument is rejected)

set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$FRONTEND_DIR"

if [ "$#" -gt 0 ]; then
  echo "verify-profiles.sh takes no arguments (got: $*)." >&2
  echo "The '--skip-stage' shortcut was removed: a single reused .generated-public/" >&2
  echo "holds only one profile and cannot prove both profile-specific staged sets." >&2
  exit 2
fi

# Assert the proof-only .NET runtime surface is PRESENT (proof) or ABSENT
# (product) in a built dist tree's staged compiler/preview, and that the real
# product runtime IS present either way (non-vacuous floor). This is what a
# single-shared-stage regression breaks: the wrong profile's runtime would be
# copied into the tree, so the expected present/absent set would flip.
#
#   $1 = dist directory (e.g. dist or dist-proof)
#   $2 = expected profile (product|proof)
assert_staged_runtime() {
  local dist="$1" expected="$2"
  local compiler="$dist/compiler" preview="$dist/preview"

  # Non-vacuous floor: the real product .NET runtime must always be present.
  # (Both profiles ship the product harness/preview.js; only the proof EXTENSION
  # surface differs.) A failed/empty copy would trip these first.
  grep -q "createCompilerEndpoint" "$compiler/compiler-harness.js" \
    || { echo "[$expected] $compiler/compiler-harness.js missing product floor createCompilerEndpoint." >&2; return 1; }
  grep -q "CompileAndRetain" "$compiler/compiler-harness.js" \
    || { echo "[$expected] $compiler/compiler-harness.js missing product floor CompileAndRetain." >&2; return 1; }
  grep -q "createPreviewEndpoint" "$preview/preview.js" \
    || { echo "[$expected] $preview/preview.js missing product floor createPreviewEndpoint." >&2; return 1; }

  # Proof-only staged surface: files + the compiler proof DOM reference.
  local proof_assets=(
    "$compiler/compiler-proof-extension.js"
    "$compiler/ProtocolEndpointsProof.js"
    "$preview/preview-proof-extension.js"
    "$preview/preview-proof-state.js"
    "$preview/preview-proof-audio.js"
    "$preview/preview-proof-bridge.js"
    "$preview/preview-proof-lifecycle.js"
    "$preview/preview-no-wasm-eval-observer.js"
    "$preview/ProtocolEndpointsProof.js"
  )

  if [ "$expected" = "proof" ]; then
    local asset
    for asset in "${proof_assets[@]}"; do
      [ -f "$asset" ] || { echo "[proof] expected proof-only staged asset missing: $asset" >&2; return 1; }
    done
    grep -q "compiler-proof-extension.js" "$compiler/index.html" \
      || { echo "[proof] $compiler/index.html does not load the proof extension." >&2; return 1; }
    grep -q "proof-state" "$compiler/index.html" \
      || { echo "[proof] $compiler/index.html has no proof DOM (proof-state)." >&2; return 1; }
    echo "[proof] staged runtime OK: proof extension/observer/endpoints present under $dist."
  else
    local asset leaked=0
    for asset in "${proof_assets[@]}"; do
      if [ -e "$asset" ]; then
        echo "[product] proof-only staged asset leaked into product build: $asset" >&2
        leaked=1
      fi
    done
    if grep -q "compiler-proof-extension.js\|proof-state" "$compiler/index.html"; then
      echo "[product] $compiler/index.html references a proof-only extension/DOM." >&2
      leaked=1
    fi
    [ "$leaked" -eq 0 ] || return 1
    echo "[product] staged runtime OK: no proof extension/observer/endpoints/DOM under $dist."
  fi
}

echo "=== [1/3] Stage PRODUCT (.NET) + vite PRODUCT + checks ==="
npm run stage
npm run build:vite
node scripts/check-profile-artifacts.mjs product
assert_staged_runtime dist product

echo ""
echo "=== [2/3] Stage PROOF (.NET) + vite PROOF + checks ==="
npm run stage:proof
npm run build:vite:proof
node scripts/check-profile-artifacts.mjs proof
assert_staged_runtime dist-proof proof

echo ""
echo "=== [3/3] RESTAGE PRODUCT (.NET) + vite PRODUCT + checks (cross-profile cleanliness) ==="
npm run stage
npm run build:vite
node scripts/check-profile-artifacts.mjs product
assert_staged_runtime dist product

echo ""
echo "=== Verifying sibling profile outputs stayed separate ==="
# The final product rebuild must not have touched dist-proof/, both manifests
# must still be stamped with their own profile, and the proof-only staged
# surface must exist ONLY under dist-proof/ (never under the final dist/).
PROD_PROFILE="$(node -e "process.stdout.write(require('./dist/profile-manifest.json').profile)")"
PROOF_PROFILE="$(node -e "process.stdout.write(require('./dist-proof/profile-manifest.json').profile)")"
[ "$PROD_PROFILE" = "product" ] || { echo "dist/ manifest profile is '$PROD_PROFILE', expected 'product'." >&2; exit 1; }
[ "$PROOF_PROFILE" = "proof" ] || { echo "dist-proof/ manifest profile is '$PROOF_PROFILE', expected 'proof'." >&2; exit 1; }
echo "dist/ -> $PROD_PROFILE, dist-proof/ -> $PROOF_PROFILE (separate manifests)."

# Re-assert the final product tree is proof-clean and the proof tree still holds
# the proof surface — proves no proof extension/staged symbol survives the final
# product build while the sibling proof build kept its proof runtime.
assert_staged_runtime dist product
assert_staged_runtime dist-proof proof
echo "Proof-only .NET runtime surface exists only under dist-proof/, never dist/."

echo ""
echo "=== Profile verification passed (fresh product -> proof -> product, per-profile staged) ==="

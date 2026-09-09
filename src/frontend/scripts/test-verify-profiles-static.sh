#!/usr/bin/env bash
# Static (no-build) regression tests for scripts/verify-profiles.sh.
#
# These guard the Stage 6 remediation of the profile-contamination gap WITHOUT
# running the expensive .NET staging + vite builds. The core invariant they
# protect: verify-profiles.sh must perform a REAL fresh per-profile staging
# sequence (stage PRODUCT -> build -> stage PROOF -> build -> restage PRODUCT ->
# build), never a single shared stage reused across profiles. Reverting to one
# shared stage — which would bake whichever profile was staged last into BOTH
# dist/ and dist-proof/ — must fail these tests.
#
# Plus: `--skip-stage` must be gone (no safe single-stage reuse exists), and the
# staged-runtime proof/product surface assertion must be present.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY="$SCRIPT_DIR/verify-profiles.sh"

fail() { echo "FAIL: $1" >&2; exit 1; }

# 0. The script must parse.
bash -n "$VERIFY" || fail "verify-profiles.sh has a syntax error"
echo "PASS bash -n verify-profiles.sh"

# 1. `--skip-stage` must be REMOVED, not merely undocumented. No SKIP_STAGE
#    variable, no acceptance of the flag, and the removal must be explained.
grep -q "SKIP_STAGE" "$VERIFY" && fail "SKIP_STAGE handling still present (must be removed)"
grep -Eq -- '--skip-stage\)[[:space:]]*SKIP_STAGE' "$VERIFY" \
  && fail "--skip-stage is still accepted as an option"
grep -Fq -- "--skip-stage" "$VERIFY" \
  || fail "verify-profiles.sh must mention (and explain the removal of) --skip-stage"
echo "PASS --skip-stage is removed"

# 1b. Behavioral: passing ANY argument must be rejected (exit != 0) and must not
#     start staging. This runs the real script but the arg guard exits first.
if bash "$VERIFY" --skip-stage >/dev/null 2>&1; then
  fail "verify-profiles.sh accepted --skip-stage instead of rejecting it"
fi
if bash "$VERIFY" --anything >/dev/null 2>&1; then
  fail "verify-profiles.sh accepted an unknown argument"
fi
echo "PASS unknown/removed arguments are rejected"

# 2. Real fresh per-profile sequence: there must be a PROOF stage AND at least
#    two PRODUCT stages (before the first product build and before the final
#    product rebuild). A single-shared-stage revert collapses this to one stage.
product_stage_count="$(grep -cE '^[[:space:]]*npm run stage$' "$VERIFY" || true)"
proof_stage_count="$(grep -cE '^[[:space:]]*npm run stage:proof$' "$VERIFY" || true)"
vite_build_count="$(grep -cE '^[[:space:]]*npm run build:vite(:proof)?$' "$VERIFY" || true)"
total_stage_count=$((product_stage_count + proof_stage_count))

[ "$proof_stage_count" -ge 1 ] || fail "no PROOF stage (npm run stage:proof) — proof build would reuse product staging"
[ "$product_stage_count" -ge 2 ] \
  || fail "expected >=2 PRODUCT stages (initial + restage after proof), found $product_stage_count"
[ "$vite_build_count" -ge 3 ] \
  || fail "expected >=3 vite builds (product, proof, product), found $vite_build_count"
# The decisive single-shared-stage guard: every vite build must be backed by its
# own preceding stage, so total stages must be >= total vite builds.
[ "$total_stage_count" -ge "$vite_build_count" ] \
  || fail "fewer stages ($total_stage_count) than vite builds ($vite_build_count): a shared stage is reused across profiles"
echo "PASS per-profile staging (product x$product_stage_count, proof x$proof_stage_count, builds x$vite_build_count)"

# 3. Ordering: the PROOF stage must precede the PROOF vite build, and a PRODUCT
#    stage must precede the FINAL PRODUCT vite build (proves restaging happens
#    AFTER the proof build, i.e. cross-profile cleanliness is exercised fresh).
proof_stage_line="$(grep -nE '^[[:space:]]*npm run stage:proof$' "$VERIFY" | head -1 | cut -d: -f1)"
proof_build_line="$(grep -nE '^[[:space:]]*npm run build:vite:proof$' "$VERIFY" | head -1 | cut -d: -f1)"
last_product_stage_line="$(grep -nE '^[[:space:]]*npm run stage$' "$VERIFY" | tail -1 | cut -d: -f1)"
last_product_build_line="$(grep -nE '^[[:space:]]*npm run build:vite$' "$VERIFY" | tail -1 | cut -d: -f1)"

[ "$proof_stage_line" -lt "$proof_build_line" ] \
  || fail "proof stage does not precede the proof vite build"
[ "$proof_build_line" -lt "$last_product_stage_line" ] \
  || fail "final product restage does not happen AFTER the proof build"
[ "$last_product_stage_line" -lt "$last_product_build_line" ] \
  || fail "final product stage does not precede the final product vite build"
echo "PASS staging ordering (proof stage<proof build<restage<final product build)"

# 4. Staged-runtime proof/product surface assertion must exist and be real: the
#    proof extension is required under the proof tree and forbidden under the
#    product tree, with a non-vacuous product floor.
grep -q "assert_staged_runtime" "$VERIFY" || fail "missing assert_staged_runtime helper"
grep -q "compiler-proof-extension.js" "$VERIFY" \
  || fail "staged-runtime check does not reference the compiler proof extension"
grep -q "issue033-negative-observer.js" "$VERIFY" \
  || fail "staged-runtime check does not reference the preview negative observer"
grep -q "createCompilerEndpoint" "$VERIFY" \
  || fail "staged-runtime check has no non-vacuous product floor (createCompilerEndpoint)"
# Both the product and proof trees must be asserted.
grep -q "assert_staged_runtime dist product" "$VERIFY" || fail "product tree staged-runtime not asserted"
grep -q "assert_staged_runtime dist-proof proof" "$VERIFY" || fail "proof tree staged-runtime not asserted"
echo "PASS staged-runtime proof/product surface assertion present"

# 5. The removed single-stage shortcut language must not reappear.
grep -qi "Staging .NET assets (once)" "$VERIFY" \
  && fail "the old single-shared-stage step ('Staging .NET assets (once)') is back"
echo "PASS no single-shared-stage shortcut remains"

echo "ALL verify-profiles static regression tests passed."

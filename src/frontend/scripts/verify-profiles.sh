#!/usr/bin/env bash
# Stage 1 profile verification: prove product/proof artifact separation binds to
# FRESH builds, and that a product build after a proof build stays clean
# (cross-profile cleanliness).
#
# Design (honest, avoids repeating expensive .NET staging):
#   1. Stage the .NET assets ONCE (stage:monogame/compiler/preview). These
#      populate .generated-public/ (publicDir) and are profile-independent.
#   2. Vite-only PRODUCT build  -> dist/       + check product
#   3. Vite-only PROOF build    -> dist-proof/ + check proof
#   4. Vite-only PRODUCT rebuild-> dist/       + check product   (proves the
#      product build after a proof build never inherits proof-only output)
#
# Each Vite build empties only its own outDir (build.emptyOutDir), so stale
# artifacts are removed per profile and the sibling profile output stays
# untouched. The checker validates the per-build profile-manifest.json, so a
# stale/foreign/missing manifest fails.
#
# Usage: bash scripts/verify-profiles.sh [--skip-stage]
#   --skip-stage  reuse existing .generated-public/ (fast; assumes staged)

set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$FRONTEND_DIR"

SKIP_STAGE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-stage) SKIP_STAGE=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "$SKIP_STAGE" -eq 0 ]; then
  echo "=== [1/4] Staging .NET assets (once) ==="
  npm run stage
else
  echo "=== [1/4] Skipping staging (reusing .generated-public/) ==="
  [ -d ".generated-public" ] || { echo "No .generated-public/; run without --skip-stage." >&2; exit 1; }
fi

echo ""
echo "=== [2/4] PRODUCT build (vite-only) + check ==="
npm run build:vite
node scripts/check-profile-artifacts.mjs product

echo ""
echo "=== [3/4] PROOF build (vite-only) + check ==="
npm run build:vite:proof
node scripts/check-profile-artifacts.mjs proof

echo ""
echo "=== [4/4] PRODUCT rebuild after PROOF (cross-profile cleanliness) + check ==="
npm run build:vite
node scripts/check-profile-artifacts.mjs product

echo ""
echo "=== Verifying sibling profile outputs stayed separate ==="
# The product rebuild must not have touched dist-proof/, and both manifests must
# still be stamped with their own profile.
PROD_PROFILE="$(node -e "process.stdout.write(require('./dist/profile-manifest.json').profile)")"
PROOF_PROFILE="$(node -e "process.stdout.write(require('./dist-proof/profile-manifest.json').profile)")"
[ "$PROD_PROFILE" = "product" ] || { echo "dist/ manifest profile is '$PROD_PROFILE', expected 'product'." >&2; exit 1; }
[ "$PROOF_PROFILE" = "proof" ] || { echo "dist-proof/ manifest profile is '$PROOF_PROFILE', expected 'proof'." >&2; exit 1; }
echo "dist/ -> $PROD_PROFILE, dist-proof/ -> $PROOF_PROFILE (separate)."

echo ""
echo "=== Profile verification passed (product -> proof -> product, all fresh) ==="

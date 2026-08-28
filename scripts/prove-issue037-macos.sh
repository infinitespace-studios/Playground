#!/usr/bin/env bash
# Issue 037 multi-process packaged proof
#
# Proves that the first-run warning modal and its acknowledgement persist
# across genuine app process termination and relaunch.
#
# Phase 1: Fresh process → clear store → Run → modal → Cancel → Run → modal →
#           Confirm → game renders → store persists → exit(0)
# Phase 2: New process → store survives → Run → no modal → game renders →
#           clear store → identity reverts → validation → exit(0)
#
# Usage:
#   scripts/prove-issue037-macos.sh [--skip-build]
#
# Requires a built and bundled macOS app at the default release path.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/src/desktop"
APP_BINARY="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/MonoGame Playground.app/Contents/MacOS/monogame-playground"
BUILD_APP=1

while [ "$#" -gt 0 ]; do
    case "$1" in
        --skip-build) BUILD_APP=0; shift ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

if [ "$(uname -s)" != "Darwin" ]; then
    echo "This proof script requires macOS." >&2
    exit 1
fi

if [ "$BUILD_APP" -eq 1 ]; then
    echo "=== Building frontend ==="
    (cd "$REPO_ROOT/src/frontend" && npm run build)
    echo "=== Building release bundle ==="
    (cd "$DESKTOP_DIR" && npm run tauri -- build 2>&1 | tail -5)
fi

if [ ! -x "$APP_BINARY" ]; then
    echo "App binary not found: $APP_BINARY" >&2
    exit 1
fi

echo ""
echo "=== Phase 1: First process — modal flow ==="
MONOGAME_ISSUE037_PROOF=1 \
MONOGAME_ISSUE037_PROOF_PHASE=1 \
  "$APP_BINARY" 2>&1 | tee /dev/stderr | grep -q "ISSUE037_REPORT="
PHASE1_EXIT=$?
echo "Phase 1 exit: $PHASE1_EXIT"
if [ "$PHASE1_EXIT" -ne 0 ]; then
    echo "FAIL: Phase 1 did not produce a report." >&2
    exit 1
fi

echo ""
echo "=== Phase 2: Second process — persistence + clear ==="
MONOGAME_ISSUE037_PROOF=1 \
MONOGAME_ISSUE037_PROOF_PHASE=2 \
  "$APP_BINARY" 2>&1 | tee /dev/stderr | grep -q "ISSUE037_REPORT="
PHASE2_EXIT=$?
echo "Phase 2 exit: $PHASE2_EXIT"
if [ "$PHASE2_EXIT" -ne 0 ]; then
    echo "FAIL: Phase 2 did not produce a report." >&2
    exit 1
fi

echo ""
echo "=== Issue 037 multi-process proof complete ==="
echo "Both phases produced reports. Verify JSON content for acceptance criteria."

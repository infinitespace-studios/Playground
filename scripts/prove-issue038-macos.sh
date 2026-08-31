#!/usr/bin/env bash
# Complete packaged proof runner for macOS.
# Runs 023/024/025/033/033-no-wasm/034/035/036/037/038 proofs sequentially.
# Uses target/release binary (macOS 26 redirects .app bundle stdout to syslog).
# Usage: scripts/prove-issue038-macos.sh [--skip-build]
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/src/desktop/src-tauri/target/release/monogame-playground"
EVIDENCE="$REPO/artifacts"
BUILD=1
while [ "$#" -gt 0 ]; do case "$1" in --skip-build) BUILD=0; shift ;; *) echo "Unknown: $1" >&2; exit 2 ;; esac; done
[ "$(uname -s)" = "Darwin" ] || { echo "macOS required." >&2; exit 1; }
[ "$BUILD" -eq 1 ] && { echo "Building..."; npm --prefix "$REPO/src/desktop" run tauri -- build; }
[ -x "$BIN" ] || { echo "Binary not found: $BIN" >&2; exit 1; }
mkdir -p "$EVIDENCE"

# PID-specific stale check
STALE=$(pgrep -x monogame-playground 2>/dev/null || true)
if [ -n "$STALE" ]; then
    echo "Stale PID $STALE; waiting 10s..."
    for i in $(seq 1 10); do kill -0 "$STALE" 2>/dev/null || break; sleep 1; done
    kill -0 "$STALE" 2>/dev/null && { echo "Stale $STALE still alive." >&2; exit 1; }
fi

FAILED=0
run() {
    local ISSUE="$1" ENVVAR="$2" RKEY="$3"
    local EV="$EVIDENCE/issue${ISSUE}-proof.log"
    echo ""; echo "=== ISSUE $ISSUE ==="
    set +e; env "${ENVVAR}=1" "$BIN" >"$EV" 2>&1; set -e
    if ! grep -q "^${RKEY}=" "$EV"; then
        echo "$ISSUE: FAIL (no report)"
        grep "CHECKPOINT=" "$EV" 2>/dev/null | tail -3 || true
        FAILED=1; return
    fi
    local R; R=$(grep "^${RKEY}=" "$EV" | head -1 | sed "s/^${RKEY}=//")
    if echo "$R" | python3 -c "
import sys,json; r=json.loads(sys.stdin.read())
if 'failure' in r: print(f'$ISSUE: FAIL — {r[\"failure\"][:100]}'); sys.exit(1)
print(f'$ISSUE: PASS')
"; then :; else FAILED=1; fi
}

run 038 MONOGAME_ISSUE038_PROOF ISSUE038_REPORT
run 024 MONOGAME_ISSUE024_PROOF ISSUE024_REPORT
run 025 MONOGAME_ISSUE025_PROOF ISSUE025_REPORT
run 023 MONOGAME_ISSUE023_PROOF ISSUE023_REPORT
run 033 MONOGAME_ISSUE033_PROOF ISSUE033_REPORT
run 033nwe MONOGAME_ISSUE033_NO_WASM_EVAL_PROOF ISSUE033_NO_WASM_EVAL_REPORT
run 034 MONOGAME_ISSUE034_PROOF ISSUE034_REPORT
run 035 MONOGAME_ISSUE035_PROOF ISSUE035_REPORT
run 036 MONOGAME_ISSUE036_PROOF ISSUE036_REPORT

# Issue 037 two-phase proof: phase1 then phase2 sharing proof store
echo ""; echo "=== ISSUE 037 (phase 1) ==="
set +e; env MONOGAME_ISSUE037_PROOF=1 MONOGAME_ISSUE037_PROOF_PHASE=1 "$BIN" >"$EVIDENCE/issue037-phase1-proof.log" 2>&1; set -e
if grep -q "^ISSUE037_REPORT=" "$EVIDENCE/issue037-phase1-proof.log"; then
    grep "^ISSUE037_REPORT=" "$EVIDENCE/issue037-phase1-proof.log" | head -1 | sed 's/^ISSUE037_REPORT=//' | python3 -c "
import sys,json; r=json.loads(sys.stdin.read())
if 'failure' in r: print(f'037p1: FAIL — {r[\"failure\"][:100]}'); sys.exit(1)
print('037p1: PASS')
" || FAILED=1
else echo "037p1: FAIL (no report)"; FAILED=1; fi

echo ""; echo "=== ISSUE 037 (phase 2) ==="
set +e; env MONOGAME_ISSUE037_PROOF=1 MONOGAME_ISSUE037_PROOF_PHASE=2 "$BIN" >"$EVIDENCE/issue037-phase2-proof.log" 2>&1; set -e
if grep -q "^ISSUE037_REPORT=" "$EVIDENCE/issue037-phase2-proof.log"; then
    grep "^ISSUE037_REPORT=" "$EVIDENCE/issue037-phase2-proof.log" | head -1 | sed 's/^ISSUE037_REPORT=//' | python3 -c "
import sys,json; r=json.loads(sys.stdin.read())
if 'failure' in r: print(f'037p2: FAIL — {r[\"failure\"][:100]}'); sys.exit(1)
print('037p2: PASS')
" || FAILED=1
else echo "037p2: FAIL (no report)"; FAILED=1; fi

echo ""
ORPHANS=$({ pgrep -x monogame-playground 2>/dev/null || true; } | wc -l | tr -d ' ')
echo "Orphan processes: $ORPHANS"
[ "$ORPHANS" -eq 0 ] || FAILED=1

echo ""
# Scan all evidence files for leaked invoke key patterns
KEY_LEAK=0
for EV in "$EVIDENCE"/issue*-proof.log "$EVIDENCE"/issue*-phase*-proof.log; do
    [ -f "$EV" ] || continue
    if grep -q "__TAURI_INVOKE_KEY__ expected" "$EV" 2>/dev/null; then
        echo "CRITICAL: invoke key leaked in $EV — deleting"
        rm -f "$EV"
        KEY_LEAK=1
        FAILED=1
    fi
done
[ "$KEY_LEAK" -eq 0 ] && echo "Key leak scan: clean" || echo "Key leak scan: FAILED"

[ "$FAILED" -eq 0 ] && echo "=== ALL PROOFS PASS ===" || { echo "=== SOME PROOFS FAILED ==="; exit 1; }

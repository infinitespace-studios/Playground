#!/usr/bin/env bash
# Canonical Stage-4 packaged verification path — durable SCENARIO runner (macOS).
#
# This is the canonical packaged verification entrypoint after Stage 4. It
# orchestrates the eight durable, responsibility-named scenarios instead of
# requiring the operator to think in per-issue ordering. Each scenario is run by
# name; internally this runner TRANSLATES each scenario to the EXISTING Rust env
# gates (MONOGAME_ISSUE0xx_PROOF...) and report keys (ISSUE0xx_REPORT=), which are
# unchanged in Stage 4 (their renames are Stage 6). The per-issue scripts
# (prove-issue03x/04x/packaged-offline) remain as compatibility wrappers.
#
# Scenario → sub-proof (env gate / report key) mapping:
#   1 compile-run-stop     : 021, 023, 024, 025, 030
#   2 compiler-diagnostics : 022, 031, 032
#   3 runtime-exception    : 029
#   4 output-capture       : 027, 028
#   5 content-workflow     : 039, 040          (039/040 have their own scripts too)
#   6 preview-security     : 033, 033-no-wasm-eval, 034, 035, 036
#   7 project-lifecycle    : project-lifecycle.test.ts (node --test) + 037 phases 1&2
#   8 performance          : 041 benchmark (gated by MONOGAME_ISSUE041_BENCHMARK)
#
# Usage: scripts/prove-scenarios-macos.sh [--skip-build] [--scenario N]...
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/src/desktop/src-tauri/target/release/monogame-playground"
EVIDENCE="$REPO/artifacts"
BUILD=1
SELECTED=()
while [ "$#" -gt 0 ]; do
    case "$1" in
        --skip-build) BUILD=0; shift ;;
        --scenario) SELECTED+=("$2"); shift 2 ;;
        *) echo "Unknown: $1" >&2; exit 2 ;;
    esac
done
[ "$(uname -s)" = "Darwin" ] || { echo "macOS required." >&2; exit 1; }
[ "$BUILD" -eq 1 ] && { echo "Building (PROOF profile)..."; npm --prefix "$REPO/src/desktop" run tauri -- build --config src-tauri/tauri.proof.conf.json; }
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

# Run one issue sub-proof, translating to its existing env gate + report key.
run_subproof() {
    local ISSUE="$1" ENVVAR="$2" RKEY="$3"
    local EV="$EVIDENCE/issue${ISSUE}-proof.log"
    echo "  - sub-proof $ISSUE ($ENVVAR / $RKEY)"
    set +e; env "${ENVVAR}=1" "$BIN" >"$EV" 2>&1; set -e
    if ! grep -q "^${RKEY}=" "$EV"; then
        echo "    $ISSUE: FAIL (no report)"
        grep "CHECKPOINT=" "$EV" 2>/dev/null | tail -3 || true
        FAILED=1; return
    fi
    local R; R=$(grep "^${RKEY}=" "$EV" | head -1 | sed "s/^${RKEY}=//")
    if echo "$R" | python3 -c "
import sys,json; r=json.loads(sys.stdin.read())
failure=r.get('failure')
if failure: print(f'    $ISSUE: FAIL — {failure if isinstance(failure,str) else failure}'[:120]); sys.exit(1)
print('    $ISSUE: PASS')
"; then :; else FAILED=1; fi
}

# issue037 two-phase (shared proof store across two processes).
run_issue037_phases() {
    for PHASE in 1 2; do
        local EV="$EVIDENCE/issue037-phase${PHASE}-proof.log"
        echo "  - sub-proof 037 (phase $PHASE)"
        set +e; env MONOGAME_ISSUE037_PROOF=1 MONOGAME_ISSUE037_PROOF_PHASE="$PHASE" "$BIN" >"$EV" 2>&1; set -e
        if grep -q "^ISSUE037_REPORT=" "$EV"; then
            grep "^ISSUE037_REPORT=" "$EV" | head -1 | sed 's/^ISSUE037_REPORT=//' | python3 -c "
import sys,json; r=json.loads(sys.stdin.read())
if r.get('failure'): print(f'    037p${PHASE}: FAIL'); sys.exit(1)
print('    037p${PHASE}: PASS')
" || FAILED=1
        else echo "    037p${PHASE}: FAIL (no report)"; FAILED=1; fi
    done
}

scenario_wanted() {
    [ "${#SELECTED[@]}" -eq 0 ] && return 0
    local want
    for want in "${SELECTED[@]}"; do [ "$want" = "$1" ] && return 0; done
    return 1
}

scenario() {
    local NUM="$1" NAME="$2"; shift 2
    scenario_wanted "$NUM" || return 0
    echo ""; echo "=== SCENARIO $NUM: $NAME ==="
    "$@"
}

# --- Scenario 7 feature-test layer (no native binary) runs first ---
scenario 7 "project-lifecycle (feature tests + first-run packaged phase)" \
    bash -c '
        echo "  - feature tests: project-lifecycle.test.ts";
        if node --experimental-strip-types --test "'"$REPO"'/src/frontend/src/project-lifecycle.test.ts" >/dev/null 2>&1; then
            echo "    project-lifecycle.test.ts: PASS";
        else
            echo "    project-lifecycle.test.ts: FAIL"; exit 1;
        fi
    ' || FAILED=1
scenario_wanted 7 && run_issue037_phases

scenario 1 "compile-run-stop" bash -c ':'
if scenario_wanted 1; then
    run_subproof 021 MONOGAME_ISSUE021_PROOF ISSUE021_REPORT
    run_subproof 023 MONOGAME_ISSUE023_PROOF ISSUE023_REPORT
    run_subproof 024 MONOGAME_ISSUE024_PROOF ISSUE024_REPORT
    run_subproof 025 MONOGAME_ISSUE025_PROOF ISSUE025_REPORT
    run_subproof 030 MONOGAME_ISSUE030_PROOF ISSUE030_REPORT
fi

scenario 2 "compiler-diagnostics" bash -c ':'
if scenario_wanted 2; then
    run_subproof 022 MONOGAME_ISSUE022_PROOF ISSUE022_REPORT
    run_subproof 031 MONOGAME_ISSUE031_PROOF ISSUE031_REPORT
    run_subproof 032 MONOGAME_ISSUE032_PROOF ISSUE032_REPORT
fi

scenario 3 "runtime-exception" bash -c ':'
scenario_wanted 3 && run_subproof 029 MONOGAME_ISSUE029_PROOF ISSUE029_REPORT

scenario 4 "output-capture" bash -c ':'
if scenario_wanted 4; then
    run_subproof 027 MONOGAME_ISSUE027_PROOF ISSUE027_REPORT
    run_subproof 028 MONOGAME_ISSUE028_PROOF ISSUE028_REPORT
fi

scenario 5 "content-workflow" bash -c ':'
if scenario_wanted 5; then
    run_subproof 039 MONOGAME_ISSUE039_PROOF ISSUE039_REPORT
    run_subproof 040 MONOGAME_ISSUE040_PROOF ISSUE040_REPORT
fi

scenario 6 "preview-security" bash -c ':'
if scenario_wanted 6; then
    run_subproof 033 MONOGAME_ISSUE033_PROOF ISSUE033_REPORT
    run_subproof 033nwe MONOGAME_ISSUE033_NO_WASM_EVAL_PROOF ISSUE033_NO_WASM_EVAL_REPORT
    run_subproof 034 MONOGAME_ISSUE034_PROOF ISSUE034_REPORT
    run_subproof 035 MONOGAME_ISSUE035_PROOF ISSUE035_REPORT
    run_subproof 036 MONOGAME_ISSUE036_PROOF ISSUE036_REPORT
fi

scenario 8 "performance" bash -c ':'
scenario_wanted 8 && run_subproof 041 MONOGAME_ISSUE041_BENCHMARK ISSUE041_REPORT

echo ""
ORPHANS=$({ pgrep -x monogame-playground 2>/dev/null || true; } | wc -l | tr -d ' ')
echo "Orphan processes: $ORPHANS"
[ "$ORPHANS" -eq 0 ] || FAILED=1

# Scan evidence for a leaked invoke key. The real leak signature is the literal
# token `__TAURI_INVOKE_KEY__` appearing in captured output (e.g. a rejection
# echoing the expected key); match that text directly rather than a phrase that
# never occurs.
KEY_LEAK=0
for EV in "$EVIDENCE"/issue*-proof.log "$EVIDENCE"/issue*-phase*-proof.log; do
    [ -f "$EV" ] || continue
    if grep -q "__TAURI_INVOKE_KEY__" "$EV" 2>/dev/null; then
        echo "CRITICAL: invoke key leaked in $EV — deleting"; rm -f "$EV"; KEY_LEAK=1; FAILED=1
    fi
done
[ "$KEY_LEAK" -eq 0 ] && echo "Key leak scan: clean" || echo "Key leak scan: FAILED"

echo ""
[ "$FAILED" -eq 0 ] && echo "=== ALL SCENARIOS PASS ===" || { echo "=== SOME SCENARIOS FAILED ==="; exit 1; }

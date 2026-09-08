#!/usr/bin/env bash
# Issue 039 complete packaged proof runner for macOS.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/src/desktop/src-tauri/target/release/monogame-playground"
EVIDENCE="$REPO/artifacts"
BUILD=1
while [ "$#" -gt 0 ]; do case "$1" in --skip-build) BUILD=0; shift ;; *) echo "Unknown: $1" >&2; exit 2 ;; esac; done
[ "$(uname -s)" = "Darwin" ] || { echo "macOS required." >&2; exit 1; }
mkdir -p "$EVIDENCE"
[ "$BUILD" -eq 1 ] && { echo "=== Building (PROOF profile) ==="; npm --prefix "$REPO/src/desktop" run tauri -- build --config src-tauri/tauri.proof.conf.json 2>&1 | tail -3; }
[ -x "$BIN" ] || { echo "Binary not found: $BIN" >&2; exit 1; }
node --check "$REPO/src/preview/wwwroot/preview.js"
# PROOF profile emits into dist-proof/, so validate the actual proof output.
node --check "$REPO/src/frontend/dist-proof/preview/preview.js"
STALE=$(pgrep -x monogame-playground 2>/dev/null || true)
[ -n "$STALE" ] && { for i in $(seq 1 10); do kill -0 "$STALE" 2>/dev/null || break; sleep 1; done; }
FAILED=0

run_with_timeout() {
    local TIMEOUT="$1" LOG="$2"; shift 2
    "$@" >"$LOG" 2>&1 &
    local PID=$!
    local ELAPSED=0
    while kill -0 "$PID" 2>/dev/null; do
        sleep 1; ELAPSED=$((ELAPSED + 1))
        if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
            kill "$PID" 2>/dev/null; sleep 2
            kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null
            wait "$PID" 2>/dev/null
            echo "TIMEOUT after ${TIMEOUT}s (PID $PID)" >> "$LOG"
            return 124
        fi
    done
    wait "$PID"; local RC=$?
    if [ "$RC" -ne 0 ]; then echo "NONZERO_EXIT=$RC" >> "$LOG"; fi
    return "$RC"
}

run() {
    local ISSUE="$1" ENVVAR="$2" RKEY="$3" TIMEOUT="${4:-90}"
    local EV="$EVIDENCE/issue${ISSUE}-proof.log"
    echo ""; echo "=== ISSUE $ISSUE ==="
    set +e; run_with_timeout "$TIMEOUT" "$EV" env "${ENVVAR}=1" "$BIN"; RC=$?; set -e
    if [ "$RC" -ne 0 ] && [ "$RC" -ne 124 ]; then
        echo "$ISSUE: FAIL (nonzero exit $RC)"
        grep "CHECKPOINT=" "$EV" 2>/dev/null | tail -5 || true
        FAILED=1; return
    fi
    if [ "$RC" -eq 124 ]; then echo "$ISSUE: FAIL (timeout)"; FAILED=1; return; fi
    if pgrep -x monogame-playground >/dev/null 2>&1; then echo "$ISSUE: FAIL (orphan)"; FAILED=1; return; fi
    if [ "$(grep -c "^${RKEY}=" "$EV" 2>/dev/null)" -ne 1 ]; then
        echo "$ISSUE: FAIL (expected exactly 1 ${RKEY})"; grep "CHECKPOINT=" "$EV" 2>/dev/null | tail -5 || true; FAILED=1; return; fi
    grep "^${RKEY}=" "$EV" | head -1 | sed "s/^${RKEY}=//" | python3 -c "
import sys,json; r=json.loads(sys.stdin.read())
if 'failure' in r: print(f'$ISSUE: FAIL — {r[\"failure\"][:200]}'); sys.exit(1)
print(f'$ISSUE: PASS')
" || { FAILED=1; return; }
}

# ── Issue 039 packaged proof ──────────────────────────────────────
echo ""; echo "=== ISSUE 039 PACKAGED PROOF ==="
EV039="$EVIDENCE/issue039-proof.log"
set +e; run_with_timeout 120 "$EV039" env MONOGAME_ISSUE039_PROOF=1 "$BIN"; RC=$?; set -e
if [ "$RC" -ne 0 ] && [ "$RC" -ne 124 ]; then
    echo "039: FAIL (nonzero exit $RC)"
    FAILED=1
elif [ "$RC" -eq 124 ]; then echo "039: FAIL (timeout)"; FAILED=1; else
pgrep -x monogame-playground >/dev/null 2>&1 && { echo "039: FAIL (orphan)"; FAILED=1; }
RCOUNT=$(grep -c "^ISSUE039_REPORT=" "$EV039" 2>/dev/null || echo 0)
[ "$RCOUNT" -ne 1 ] && { echo "039: FAIL (expected 1 ISSUE039_REPORT, got $RCOUNT)"; grep "ISSUE039_CHECKPOINT=" "$EV039" | tail -10; FAILED=1; } || {
R039=$(grep "^ISSUE039_REPORT=" "$EV039" | head -1 | sed 's/^ISSUE039_REPORT=//')
echo "$R039" | python3 -c "
import sys, json
r = json.loads(sys.stdin.read())
if 'failure' in r:
    print(f'039: FAIL — {r[\"failure\"][:200]}'); sys.exit(1)
p = r.get('positive', {})
n = r.get('negative', {})

# Positive assertions
assert p.get('fixtureHash') == 'ec8c5439755b300163c43165a3c1c374063f076a8347a982a320d2508106b629', f'hash: {p.get(\"fixtureHash\")}'
assert p.get('fixtureByteLength') == 224, f'length: {p.get(\"fixtureByteLength\")}'
assert p.get('mountedFileCount') == 1, f'files: {p.get(\"mountedFileCount\")}'
assert p.get('mountedByteLength') == 224, f'bytes: {p.get(\"mountedByteLength\")}'
assert p.get('contentRootDirectory') == 'Content', f'root: {p.get(\"contentRootDirectory\")}'
assert p.get('tamperedManifestRejected') is True, 'tampered rejected'
assert p.get('tamperedMountResponseCode') == 'PREVIEW_LOAD_FAILED', 'tampered code'
assert p.get('tamperedMountCountUnchanged') is True, 'tampered mount count changed'
assert p.get('gateFreeBefore') is True, 'gate not free before mount'
assert p.get('gateReleasedAfter') is True, 'gate not released after mount'
assert p.get('loadSuccess') is True, 'load failed'
assert p.get('startSuccess') is True, 'start failed'
assert p.get('hasNonClearPixel') is True, 'no non-clear pixels'
assert p.get('hasRedPixel') is True, 'no red pixel'
assert p.get('distinctColorCount', 0) >= 3, f'distinct: {p.get(\"distinctColorCount\")}'
px = p.get('pixelRow0Col0', [0,0,0,0])
assert px[0] > 200 and px[1] < 50 and px[2] < 50, f'Row0Col0 not Red: {px}'
assert p.get('frameCount', 0) > 0, f'frameCount: {p.get(\"frameCount\")}'
assert p.get('constructionAttempts') == 1, f'construction: {p.get(\"constructionAttempts\")}'
assert p.get('runAttempts') == 1, f'runs: {p.get(\"runAttempts\")}'
assert p.get('disposeAttempts') == 1, f'disposeAttempts: {p.get(\"disposeAttempts\")}'
assert p.get('disposeCount') == 1, f'disposeCount: {p.get(\"disposeCount\")}'
assert p.get('stopSuccess') is True, 'stop failed'
assert p.get('windowGoneAfterRetire') is True, 'window not gone'
assert p.get('transferCleared') is True, 'transfer not cleared'

# Validator self-test
vt = p.get('validatorSelfTest', {})
EXPECTED_VALIDATOR = {
    'good-fixture': (True, None),
    'wrong-platform': (False, 'PG0010_CONTENT_PLATFORM_MISMATCH'),
    'compressed': (False, 'PG0203_CONTENT_COMPRESSED'),
    'truncated': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'bad-magic': (False, 'PG0201_CONTENT_INVALID_HEADER'),
    'bad-size': (False, 'PG0204_CONTENT_SIZE_MISMATCH'),
    'appended-bytes': (False, 'PG0204_CONTENT_SIZE_MISMATCH'),
    'suffixed-reader': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'multi-reader': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'unsupported-reader': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'bad-root-index': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'wrong-mip-size': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'zero-width': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'excess-mip-count': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'nonzero-shared-resources': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'malformed-7bit': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'wrong-reader-version': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'wrong-reader-assembly': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'invalid-utf8': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'overlong-7bit': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'dimension-impossible-mips': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-good-fixture': (True, None),
    'sound-good-stereo-8bit': (True, None),
    'sound-wrong-platform': (False, 'PG0010_CONTENT_PLATFORM_MISMATCH'),
    'sound-compressed-flag': (False, 'PG0203_CONTENT_COMPRESSED'),
    'sound-non-pcm-format': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'sound-bad-format-size': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'sound-nonzero-cbsize': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'sound-bad-channels': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'sound-bad-bits': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'sound-bad-sample-rate': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'sound-block-align-mismatch': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-average-bytes-mismatch': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-zero-data': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-unaligned-data': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-data-size-overflow': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-loop-out-of-range': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-negative-loop-start': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-duration-mismatch': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-trailing-bytes': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-truncated-tail': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-multi-reader': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-suffixed-reader': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'sound-wrong-reader-version': (False, 'PG0206_CONTENT_UNSUPPORTED_TYPE'),
    'sound-bad-root-index': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
    'sound-nonzero-shared-resources': (False, 'PG0205_CONTENT_MALFORMED_READERS'),
}
assert set(vt.keys()) == set(EXPECTED_VALIDATOR.keys()), f'validator cases: {set(vt.keys())} != {set(EXPECTED_VALIDATOR.keys())}'
for case_name, (exp_valid, exp_diag) in EXPECTED_VALIDATOR.items():
    actual = vt[case_name]
    assert actual.get('valid') == exp_valid, f'validator {case_name}: valid={actual.get(\"valid\")} expected={exp_valid}'
    assert actual.get('diagnosticId') == exp_diag, f'validator {case_name}: diag={actual.get(\"diagnosticId\")} expected={exp_diag}'

# Atomic mount self-test
at = p.get('atomicMountSelfTest', {})
assert at.get('initialMountValidated') is True, 'atomic: initialMountValidated'
assert at.get('firstAssetStaged') is True, 'atomic: firstAssetStaged'
assert at.get('secondAssetFailed') is True, 'atomic: secondAssetFailed'
assert at.get('mountedCountAfterAbort') == 0, 'atomic: mountedCountAfterAbort'
assert at.get('stagedCountAfterAbort') == 0, 'atomic: stagedCountAfterAbort'
assert at.get('pendingMountClearedAfterAbort') is True, 'atomic: pendingMountClearedAfterAbort'
assert at.get('staleMountValidated') is True, 'atomic: staleMountValidated'
assert at.get('staleAssetStaged') is True, 'atomic: staleAssetStaged'
assert at.get('replacementMountValidated') is True, 'atomic: replacementMountValidated'
assert at.get('staleStagingCleared') is True, 'atomic: staleStagingCleared'
assert at.get('staleCommitRejected') is True, 'atomic: staleCommitRejected'
assert at.get('mountedCountAfterReplacement') == 0, 'atomic: mountedCountAfterReplacement'
assert at.get('stagedCountAfterReplacement') == 0, 'atomic: stagedCountAfterReplacement'
assert at.get('pendingMountIdAfterReplacement') == 'issue039-atomic-selftest-3', 'atomic: pendingMountIdAfterReplacement'
assert at.get('rollbackAttempted') is True, 'atomic: rollbackAttempted'
assert at.get('rollbackFirstFileDeleted') is True, 'atomic: rollbackFirstFileDeleted'
assert at.get('rollbackMountedAssetsZero') is True, 'atomic: rollbackMountedAssetsZero'
assert at.get('rollbackCommittedIdAbsent') is True, 'atomic: rollbackCommittedIdAbsent'
assert at.get('rollbackMountedSuccessUnchanged') is True, 'atomic: rollbackMountedSuccessUnchanged'
assert at.get('startupCommitRejected') is True, 'atomic: startupCommitRejected'
assert at.get('startupMountedZero') is True, 'atomic: startupMountedZero'
assert at.get('startupStagingCleared') is True, 'atomic: startupStagingCleared'
assert at.get('startupPendingCleared') is True, 'atomic: startupPendingCleared'

# Negative assertions
assert n.get('mountSuccess') is False, 'wrong-platform mount succeeded'
assert n.get('diagnosticId') == 'PG0010_CONTENT_PLATFORM_MISMATCH', f'diag: {n.get(\"diagnosticId\")}'
assert n.get('diagnosticContainsMonoGamePlatformWeb') is True, 'missing MonoGamePlatform=Web'
assert n.get('noPartialMount') is True, 'partial mount'
assert n.get('constructionAttempts') == 0, f'neg construct: {n.get(\"constructionAttempts\")}'
assert n.get('runAttempts') == 0, f'neg runs: {n.get(\"runAttempts\")}'
assert n.get('state') == 'loaded', f'neg state: {n.get(\"state\")}'
assert n.get('negTransferCleared') is True, 'neg transfer not cleared'

print('039: PASS (all semantic assertions)')
" || FAILED=1
}
fi

# ── Regressions ───────────────────────────────────────────────────
run 038 MONOGAME_ISSUE038_PROOF ISSUE038_REPORT 90
run 024 MONOGAME_ISSUE024_PROOF ISSUE024_REPORT 90
run 025 MONOGAME_ISSUE025_PROOF ISSUE025_REPORT 90
run 023 MONOGAME_ISSUE023_PROOF ISSUE023_REPORT 180

# ── Static tests ──────────────────────────────────────────────────
echo ""; echo "=== STATIC TESTS ==="
cd "$REPO/src/frontend"
set +e; node --experimental-strip-types --test src/protocol.test.ts src/issue039.test.ts >"$EVIDENCE/issue039-static.log" 2>&1; STATIC=$?; set -e
[ "$STATIC" -ne 0 ] && { echo "Static: FAIL"; tail -10 "$EVIDENCE/issue039-static.log"; FAILED=1; } || echo "Static: PASS ($(grep -c '^✔' "$EVIDENCE/issue039-static.log") tests)"
set +e; npx tsc --noEmit >"$EVIDENCE/issue039-tsc.log" 2>&1; TSC=$?; set -e
[ "$TSC" -ne 0 ] && { echo "TSC: FAIL"; FAILED=1; } || echo "TSC: PASS"

echo ""
[ "$FAILED" -eq 0 ] && echo "=== ALL ISSUE 039 PROOFS AND REGRESSIONS PASSED ===" || { echo "=== SOME FAILED ==="; exit 1; }

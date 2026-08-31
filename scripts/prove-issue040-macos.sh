#!/usr/bin/env bash
# Issue 040 complete packaged proof runner for macOS.
# Bounded: every phase has a hard timeout and orphan processes fail the run.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$REPO/src/desktop/src-tauri/target/release/monogame-playground"
EVIDENCE="$REPO/artifacts"
BUILD=1
REGRESSIONS=1
while [ "$#" -gt 0 ]; do
    case "$1" in
        --skip-build) BUILD=0; shift ;;
        --skip-regressions) REGRESSIONS=0; shift ;;
        *) echo "Unknown: $1" >&2; exit 2 ;;
    esac
done
[ "$(uname -s)" = "Darwin" ] || { echo "macOS required." >&2; exit 1; }
mkdir -p "$EVIDENCE"
[ "$BUILD" -eq 1 ] && { echo "=== Building ==="; npm --prefix "$REPO/src/desktop" run tauri -- build 2>&1 | tail -3; }
[ -x "$BIN" ] || { echo "Binary not found: $BIN" >&2; exit 1; }
node --check "$REPO/src/preview/wwwroot/preview.js"
node --check "$REPO/src/frontend/dist/preview/preview.js"
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

# ── Fixture provenance ────────────────────────────────────────────
echo "=== ISSUE 040 FIXTURE PROVENANCE ==="
node "$REPO/scripts/build-issue040-sound-fixture.mjs" --check || { echo "Fixture: FAIL"; FAILED=1; }
FIXTURE_SHA=$(shasum -a 256 "$REPO/examples/ContentExample/Content/audio/blip.xnb" | cut -d' ' -f1)
echo "Committed fixture SHA-256: $FIXTURE_SHA"
[ "$FIXTURE_SHA" = "247f196aa6e26aa2982286d20dbd8a91a40beaa90b76e445bf70fda6ba4a70eb" ] \
    || { echo "Fixture: FAIL (unexpected SHA-256)"; FAILED=1; }

# ── Issue 040 packaged proof ──────────────────────────────────────
echo ""; echo "=== ISSUE 040 PACKAGED PROOF ==="
EV040="$EVIDENCE/issue040-proof.log"
set +e; run_with_timeout 300 "$EV040" env MONOGAME_ISSUE040_PROOF=1 "$BIN"; RC=$?; set -e
if [ "$RC" -ne 0 ] && [ "$RC" -ne 124 ]; then
    echo "040: FAIL (nonzero exit $RC)"
    grep "ISSUE040_CHECKPOINT=" "$EV040" 2>/dev/null | tail -10 || true
    FAILED=1
elif [ "$RC" -eq 124 ]; then
    echo "040: FAIL (timeout)"; grep "ISSUE040_CHECKPOINT=" "$EV040" | tail -10 || true; FAILED=1
else
pgrep -x monogame-playground >/dev/null 2>&1 && { echo "040: FAIL (orphan)"; FAILED=1; }
RCOUNT=$(grep -c "^ISSUE040_REPORT=" "$EV040" 2>/dev/null || echo 0)
if [ "$RCOUNT" -ne 1 ]; then
    echo "040: FAIL (expected 1 ISSUE040_REPORT, got $RCOUNT)"
    grep "ISSUE040_CHECKPOINT=" "$EV040" | tail -10 || true
    FAILED=1
else
grep "^ISSUE040_REPORT=" "$EV040" | head -1 | sed 's/^ISSUE040_REPORT=//' | python3 -c "
import sys, json
r = json.loads(sys.stdin.read())
if 'failure' in r:
    print(f'040: FAIL — {r[\"failure\"][:400]}'); sys.exit(1)

fixture = r['fixture']
assert fixture['sha256'] == '247f196aa6e26aa2982286d20dbd8a91a40beaa90b76e445bf70fda6ba4a70eb', fixture
assert fixture['byteLength'] == 44280, fixture
assert fixture['assetName'] == 'audio/blip', fixture
assert r['freshPreview'] is True, 'second preview was not a fresh instance'

# Validator matrix: Texture2D behaviour retained, SoundEffect added, fail-closed.
vt = r['validatorSelfTest']
accepted = sorted(name for name, case in vt.items() if case['valid'])
assert accepted == ['good-fixture', 'sound-good-fixture', 'sound-good-stereo-8bit'], accepted
assert vt['wrong-platform']['diagnosticId'] == 'PG0010_CONTENT_PLATFORM_MISMATCH'
assert vt['sound-wrong-platform']['diagnosticId'] == 'PG0010_CONTENT_PLATFORM_MISMATCH'
assert vt['sound-non-pcm-format']['diagnosticId'] == 'PG0206_CONTENT_UNSUPPORTED_TYPE'
assert vt['sound-trailing-bytes']['diagnosticId'] == 'PG0205_CONTENT_MALFORMED_READERS'
assert len([n for n in vt if n.startswith('sound-')]) >= 20, 'sound validator coverage'

instances = r['instances']
assert len(instances) == 2, f'expected 2 preview instances, got {len(instances)}'
realms = set()
for instance in instances:
    tag = f\"instance{instance['instanceIndex']}\"
    realms.add(instance['realmToken'])

    mount = instance['mount']
    assert mount['mountedFileCount'] == 1, f'{tag} mount files'
    assert mount['mountedByteLength'] == 44280, f'{tag} mount bytes'
    assert mount['contentRootDirectory'] == 'Content', f'{tag} content root'
    assert mount['sha256'] == fixture['sha256'], f'{tag} mount hash'

    load = instance['contentLoad']
    assert load['soundLoadedCount'] == 1, f'{tag} Content.Load<SoundEffect> count'
    assert load['soundAssetName'] == 'audio/blip', f'{tag} asset name'
    assert load['soundDurationMilliseconds'] == 1000, f'{tag} duration'

    before = instance['audioBeforeGesture']
    assert before['contextCount'] >= 1, f'{tag} no audio context created'
    assert before['analyserInstalled'] is True, f'{tag} no analyser on the audio destination'
    assert before['state'] in ('running', 'suspended'), f\"{tag} unexpected device-open state {before['state']}\"
    assert before['trustedInputEvents'] == 0, f'{tag} unexpected input before the gesture'

    # The proof re-locks the device so the only route back to 'running' is a real gesture.
    locked = instance['audioLocked']
    assert locked and all(entry['after'] == 'suspended' for entry in locked), f'{tag} audio lock {locked}'

    activation = instance['audioActivation']
    assert activation['stateAtDeviceOpen'] == before['state'], f'{tag} device-open state mismatch'
    assert activation['stateBeforeGesture'] == 'suspended', f'{tag} pre-gesture state'
    assert activation['stateAfterGesture'] == 'running', f'{tag} post-gesture state'
    gesture = activation['trustedGesture']
    assert gesture['trusted'] is True, f'{tag} gesture not trusted'
    assert gesture['type'] == 'keydown' and gesture['code'] == 'Space', f'{tag} gesture {gesture}'
    assert activation['userActivation']['hasBeenActive'] is True, f'{tag} user activation'

    play = instance['playback']
    assert play['playInvocationCount'] == 1, f'{tag} play invocations'
    assert play['stateAfterPlay'] == 'Playing', f\"{tag} state after Play(): {play['stateAfterPlay']}\"
    assert play['triggerSource'] == 'keyboard-space', f\"{tag} trigger {play['triggerSource']}\"
    assert play['observedPlayingUpdateCount'] > 5, f'{tag} playing updates'
    playing = play['playingSample']
    assert playing['contextState'] == 'running', f'{tag} playback context state'
    assert playing['maxPeak'] > 0.005, f\"{tag} playback peak {playing['maxPeak']}\"
    assert playing['nonSilentWindows'] > 5, f\"{tag} non-silent windows {playing['nonSilentWindows']}\"

    stop = instance['stop']
    assert stop['stopInvocationCount'] == 1, f'{tag} stop invocations'
    assert stop['stateAfterStop'] == 'Stopped', f\"{tag} state after Stop(): {stop['stateAfterStop']}\"
    assert stop['currentInstanceState'] == 'Stopped', f'{tag} instance state after stop'
    assert instance['managedFinal']['observedPlayingUpdateCount'] == stop['playingUpdatesAtStop'], \\
        f'{tag} instance resumed playing after Stop()'
    stopped = stop['stoppedSample']
    assert stopped['nonSilentWindows'] == 0, f\"{tag} audio still audible after Stop(): {stopped}\"
    assert stopped['maxPeak'] < playing['maxPeak'] / 10, f\"{tag} post-stop peak {stopped['maxPeak']}\"

    assert (instance['managedFinal'].get('audioErrorText') or '') == '', f'{tag} managed audio errors'
    assert instance['teardown']['disposeAttempts'] == 1, f'{tag} disposeAttempts'
    assert instance['teardown']['disposeCount'] == 1, f'{tag} disposeCount'
    assert instance['retirement']['windowGone'] is True, f'{tag} window not retired'
    assert instance['retirement']['assetTransferCleared'] is True, f'{tag} asset transfer not cleared'

assert len(realms) == 2, 'both previews reported the same realm token'
first, second = instances
assert first['previewId'] != second['previewId'], 'preview ids repeated'
assert first['generation'] != second['generation'], 'generations repeated'

print('040: PASS (all semantic assertions)')
print(f\"  play peaks: {[i['playback']['playingSample']['maxPeak'] for i in instances]}\")
print(f\"  stop peaks: {[i['stop']['stoppedSample']['maxPeak'] for i in instances]}\")
" || FAILED=1
fi
fi

# ── Proof gating: an ungated run must be silent ───────────────────
echo ""; echo "=== ISSUE 040 PROOF GATING ==="
UNGATED="$EVIDENCE/issue040-ungated.log"
set +e; run_with_timeout 15 "$UNGATED" env "$BIN"; RC=$?; set -e
if [ "$RC" -ne 0 ] && [ "$RC" -ne 124 ]; then
    echo "Gating: FAIL (nonzero exit $RC)"; FAILED=1
elif [ "$(grep -c "ISSUE040_" "$UNGATED" 2>/dev/null)" -ne 0 ]; then
    echo "Gating: FAIL (ungated run emitted issue 040 proof output)"
    grep "ISSUE040_" "$UNGATED" | head -3; FAILED=1
else
    echo "Gating: PASS (no issue 040 output without MONOGAME_ISSUE040_PROOF=1)"
fi
pgrep -x monogame-playground >/dev/null 2>&1 && { echo "Gating: FAIL (orphan)"; FAILED=1; }

# ── Regressions ───────────────────────────────────────────────────
if [ "$REGRESSIONS" -eq 1 ]; then
    run 039 MONOGAME_ISSUE039_PROOF ISSUE039_REPORT 180
    run 038 MONOGAME_ISSUE038_PROOF ISSUE038_REPORT 90
    run 025 MONOGAME_ISSUE025_PROOF ISSUE025_REPORT 90
    run 024 MONOGAME_ISSUE024_PROOF ISSUE024_REPORT 90
fi

# ── Static tests ──────────────────────────────────────────────────
echo ""; echo "=== STATIC TESTS ==="
cd "$REPO/src/frontend"
set +e
node --test src/issue040.test.ts src/issue039.test.ts src/protocol.test.ts >"$EVIDENCE/issue040-static.log" 2>&1
STATIC=$?
set -e
[ "$STATIC" -ne 0 ] && { echo "Static: FAIL"; tail -20 "$EVIDENCE/issue040-static.log"; FAILED=1; } \
    || echo "Static: PASS ($(grep -c '^✔' "$EVIDENCE/issue040-static.log") tests)"
set +e; npx tsc --noEmit >"$EVIDENCE/issue040-tsc.log" 2>&1; TSC=$?; set -e
[ "$TSC" -ne 0 ] && { echo "TSC: FAIL"; tail -10 "$EVIDENCE/issue040-tsc.log"; FAILED=1; } || echo "TSC: PASS"
cd "$REPO/src/desktop/src-tauri"
set +e; cargo test --lib >"$EVIDENCE/issue040-cargo.log" 2>&1; CARGO=$?; set -e
[ "$CARGO" -ne 0 ] && { echo "Cargo: FAIL"; tail -20 "$EVIDENCE/issue040-cargo.log"; FAILED=1; } \
    || echo "Cargo: PASS ($(grep -o '[0-9]* passed' "$EVIDENCE/issue040-cargo.log" | head -1))"

echo ""
[ "$FAILED" -eq 0 ] && echo "=== ALL ISSUE 040 PROOFS AND REGRESSIONS PASSED ===" || { echo "=== SOME FAILED ==="; exit 1; }

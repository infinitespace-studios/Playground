#!/usr/bin/env bash
# Static (no-binary, no-build) tests for scripts/prove-packaged-offline-macos.sh.
#
# The legacy offline runner launched the obsolete MONOGAME_ISSUE011_PROOF and
# graded on the mere presence of an ISSUE011_REPORT= line (existence-only). This
# guards the Stage-5 remediation that re-pointed the runner at the durable
# EMBEDDED issue040 content/audio sub-proof, added truthy-failure JSON grading,
# and made the run bounded/fail-clean so a missing report can never hang and only
# the owned process is terminated — without altering system networking.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$REPO_ROOT/scripts/prove-packaged-offline-macos.sh"

fail() { echo "FAIL: $1" >&2; exit 1; }

# 0. The runner must parse.
bash -n "$RUNNER" || fail "prove-packaged-offline-macos.sh has a syntax error"
echo "PASS bash -n prove-packaged-offline-macos.sh"

# 1. The obsolete issue011 top-level-canvas gate must be gone.
grep -Fq "MONOGAME_ISSUE011_PROOF" "$RUNNER" && fail "runner still launches the obsolete MONOGAME_ISSUE011_PROOF"
grep -Fq "ISSUE011_REPORT" "$RUNNER" && fail "runner still keys on the retired ISSUE011_REPORT"
echo "PASS runner no longer uses the retired issue011 gate/report"

# 2. The runner must exercise the durable embedded issue040 content/audio sub-proof.
grep -Fq "MONOGAME_ISSUE040_PROOF" "$RUNNER" || fail "runner does not launch the embedded MONOGAME_ISSUE040_PROOF sub-proof"
grep -Fq "ISSUE040_REPORT" "$RUNNER" || fail "runner does not key on ISSUE040_REPORT"
echo "PASS runner exercises the embedded issue040 content/audio sub-proof"

# 3. It must run the RAW release binary, not the .app bundle (the bundle would
#    relaunch via LaunchServices and open a report-relay socket, escaping the
#    sandbox network denial and leaking a process we do not own).
grep -Eq 'APP_BINARY=.*target/release/monogame-playground"?$' "$RUNNER" \
    || fail "runner does not target the raw target/release binary"
grep -Fq "bundle/macos" "$RUNNER" && fail "runner still launches the packaged .app bundle inner binary"
echo "PASS runner targets the raw release binary (no LaunchServices relaunch)"

# 4. Report existence alone must NEVER pass: require exactly one report and grade
#    on a TRUTHY failure value.
grep -Fq 'REPORT_COUNT" -ne 1' "$RUNNER" || fail "runner does not require exactly one report line"
grep -Fq "report.get('failure')" "$RUNNER" || fail "runner does not grade on report.get('failure')"
grep -Fq "if 'failure' in report" "$RUNNER" && fail "runner grades on key presence, not truthiness"
echo "PASS runner requires one report and grades on failure truthiness"

# 4b. Mirror the grader semantics: truthy → FAIL, clean/null/empty → PASS.
grade() {
    python3 -c "
import sys, json
report = json.loads(sys.stdin.read())
failure = report.get('failure')
if failure:
    sys.exit(1)
print('PASS')
"
}
if echo '{"failure":"boom"}' | grade >/dev/null 2>&1; then fail "truthy failure was graded PASS"; fi
echo '{"ok":true}'      | grade >/dev/null 2>&1 || fail "clean report was graded FAIL"
echo '{"failure":null}' | grade >/dev/null 2>&1 || fail "null failure was graded FAIL"
echo '{"failure":""}'   | grade >/dev/null 2>&1 || fail "empty failure was graded FAIL"
echo "PASS grader rejects truthy failure and accepts clean/null/empty"

# 5. The run must be bounded and fail-clean, terminating only the owned PID.
grep -Fq "RUN_TIMEOUT" "$RUNNER" || fail "runner has no bounded timeout"
grep -Fq 'ELAPSED" -ge "$RUN_TIMEOUT"' "$RUNNER" || fail "runner does not enforce the timeout bound"
grep -Fq 'kill "$APP_PID"' "$RUNNER" || fail "cleanup does not terminate the owned process"
grep -Fq "pkill" "$RUNNER" && fail "runner uses pkill (could kill processes it does not own)"
grep -Eq 'pgrep' "$RUNNER" && fail "runner scans by name and could act on unowned processes"
echo "PASS runner is bounded and terminates only the owned PID"

# 6. System networking must be denied only for the app process; never altered.
grep -Fq "(deny network*)" "$RUNNER" || fail "runner does not deny network for the sandboxed process"
grep -Fq "sandbox-exec" "$RUNNER" || fail "runner does not use sandbox-exec isolation"
for forbidden in networksetup ifconfig pfctl "route delete" "route add" "Wi-Fi off"; do
    grep -Fq "$forbidden" "$RUNNER" && fail "runner mutates system networking via '$forbidden'"
done
echo "PASS runner isolates only the app process and never mutates system networking"

echo "ALL STATIC OFFLINE PROOF TESTS PASS"

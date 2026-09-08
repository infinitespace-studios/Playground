#!/usr/bin/env bash
# Static (no-binary, no-build) tests for scripts/prove-scenarios-macos.sh.
#
# Guards the two grading/scan defects fixed in the latest remediation without
# running the packaged proofs:
#   1. Report grading must key on a TRUTHY `failure` value (r.get('failure')),
#      not the mere PRESENCE of a `failure` key (a null/empty failure must PASS).
#   2. The invoke-key leak scan must match the actual `__TAURI_INVOKE_KEY__`
#      token, not a phrase that never appears in captured output.
# Plus a `bash -n` syntax check of the runner itself.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$REPO_ROOT/scripts/prove-scenarios-macos.sh"

fail() { echo "FAIL: $1" >&2; exit 1; }

# 0. The runner must parse.
bash -n "$RUNNER" || fail "prove-scenarios-macos.sh has a syntax error"
echo "PASS bash -n prove-scenarios-macos.sh"

# 1a. A truthy failure string must be graded as FAIL.
grade() {
    # Mirrors the run_subproof grader: truthy `failure` → exit 1, else PASS.
    python3 -c "
import sys,json
r=json.loads(sys.stdin.read())
failure=r.get('failure')
if failure:
    sys.exit(1)
print('PASS')
"
}
if echo '{"failure":"boom"}' | grade >/dev/null 2>&1; then
    fail "truthy failure was graded PASS"
fi
echo "PASS grader rejects truthy failure"

# 1b. A report with NO failure key must PASS.
echo '{"ok":true}' | grade >/dev/null 2>&1 || fail "clean report was graded FAIL"
echo "PASS grader accepts clean report"

# 1c. A null / empty failure must PASS (presence-only checks would wrongly fail).
echo '{"failure":null}' | grade >/dev/null 2>&1 || fail "null failure was graded FAIL"
echo '{"failure":""}'   | grade >/dev/null 2>&1 || fail "empty failure was graded FAIL"
echo "PASS grader treats null/empty failure as PASS"

# 1d. The runner source must use r.get('failure') truthiness, not `'failure' in r`.
grep -Fq "r.get('failure')" "$RUNNER" || fail "runner does not grade on r.get('failure')"
grep -Fq "if 'failure' in r" "$RUNNER" && fail "runner still grades on key presence"
echo "PASS runner grades on failure truthiness"

# 2a. The leak scan must grep the real token.
grep -Fq 'grep -q "__TAURI_INVOKE_KEY__"' "$RUNNER" \
    || fail "leak scan does not match the real __TAURI_INVOKE_KEY__ token"
grep -Fq "__TAURI_INVOKE_KEY__ expected" "$RUNNER" \
    && fail "leak scan still uses the never-matching phrase"
echo "PASS leak scan matches the real invoke-key token"

# 2b. The scan detects a leaked token and misses a clean line.
scan() { grep -q "__TAURI_INVOKE_KEY__" <<<"$1"; }
scan 'JSON error: missing field `__TAURI_INVOKE_KEY__`' || fail "scan missed a leaked key"
if scan 'CHECKPOINT=all clear'; then fail "scan false-positived on a clean line"; fi
echo "PASS leak scan detects leaks and passes clean output"

echo "ALL STATIC SCENARIO TESTS PASS"

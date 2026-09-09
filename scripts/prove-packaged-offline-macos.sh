#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/src/desktop"
# The PROOF profile packages as "MonoGame Playground Proof.app" (distinct
# productName/identifier via tauri.proof.conf.json). The measurement/proof gates
# run against the raw Cargo release binary, NOT the packaged .app: launching the
# bundle under an active packaged-pipeline proof gate would relaunch through
# LaunchServices (/usr/bin/open) and open a 127.0.0.1 report-relay socket, which
# would (a) escape the sandbox network denial and (b) leave a process we do not
# own. Running the raw binary keeps the whole proof inside the single sandboxed
# process we launched (packaged_app_bundle() returns None → no relaunch, report
# is printed to stdout).
APP_BINARY="$DESKTOP_DIR/src-tauri/target/release/monogame-playground"
EVIDENCE_FILE="$REPO_ROOT/artifacts/offline-proof-macos.log"
BUILD_APP=1
# Hard bound so a missing/late report can never hang the runner indefinitely.
# The embedded issue040 content/audio sub-proof drives two full preview
# instances (mount → load → trusted Space activation → playback → Stop →
# teardown → retirement) and then exits; 300s matches prove-issue040-macos.sh.
RUN_TIMEOUT="${MONOGAME_OFFLINE_TIMEOUT:-300}"

# The durable EMBEDDED scenario exercised offline: issue040 content/audio.
# It renders with embedded (bundled) texture/audio fixtures, requires trusted
# native Space/Escape input, performs runtime cleanup/teardown, and emits an
# exiting report — a good offline rendering + trusted-input witness that does
# not depend on any obsolete top-level canvas or the retired isolated window.
PROOF_ENV_VAR="MONOGAME_ISSUE040_PROOF"
REPORT_KEY="ISSUE040_REPORT"

usage() {
    cat <<'EOF'
Usage: scripts/prove-packaged-offline-macos.sh [options]

Build and launch the packaged MonoGame Playground with networking denied only
for the app process. System networking remains unchanged. The offline run
exercises the durable EMBEDDED issue040 content/audio sub-proof (bundled
texture/audio, trusted native Space/Escape input, runtime cleanup, exiting
report), proving offline rendering + trusted input without any obsolete
top-level canvas.

Options:
  --skip-build       Use the existing packaged application.
  --evidence <path>  Write application proof output to this file.
  --timeout <secs>   Hard bound on the sandboxed run (default: 300).
  -h, --help         Show this help.

The run is bounded: if no exiting report is captured within the timeout, only
the process we launched is terminated and the run fails. It never hangs.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --skip-build)
            BUILD_APP=0
            shift
            ;;
        --evidence)
            if [ "$#" -lt 2 ]; then
                echo "Missing path after --evidence." >&2
                exit 2
            fi
            EVIDENCE_FILE="$2"
            shift 2
            ;;
        --timeout)
            if [ "$#" -lt 2 ]; then
                echo "Missing seconds after --timeout." >&2
                exit 2
            fi
            RUN_TIMEOUT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if ! printf '%s' "$RUN_TIMEOUT" | grep -Eq '^[1-9][0-9]*$'; then
    echo "Invalid --timeout value: $RUN_TIMEOUT (expected a positive integer)." >&2
    exit 2
fi

if [ "$(uname -s)" != "Darwin" ]; then
    echo "This proof script requires macOS." >&2
    exit 1
fi

for command in npm sandbox-exec python3; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Required command not found: $command" >&2
        exit 1
    fi
done

if [ "$BUILD_APP" -eq 1 ]; then
    echo "Building packaged application (PROOF profile) before network isolation..."
    npm --prefix "$DESKTOP_DIR" run tauri -- build --config src-tauri/tauri.proof.conf.json --features proof-harness
fi

if [ ! -x "$APP_BINARY" ]; then
    echo "Packaged application binary not found: $APP_BINARY" >&2
    echo "Run without --skip-build to create it." >&2
    exit 1
fi

mkdir -p "$(dirname "$EVIDENCE_FILE")"
EVIDENCE_FILE="$(cd "$(dirname "$EVIDENCE_FILE")" && pwd)/$(basename "$EVIDENCE_FILE")"

SANDBOX_PROFILE="$(mktemp "${TMPDIR:-/tmp}/monogame-offline.XXXXXX")"
SANDBOX_PROBE_LOG="$(mktemp "${TMPDIR:-/tmp}/monogame-offline-probe.XXXXXX")"
APP_PID=""

cleanup() {
    # Terminate only the process we own, if it is still alive.
    if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
        kill "$APP_PID" 2>/dev/null || true
        for _ in 1 2 3; do
            kill -0 "$APP_PID" 2>/dev/null || break
            sleep 1
        done
        kill -0 "$APP_PID" 2>/dev/null && kill -9 "$APP_PID" 2>/dev/null || true
        wait "$APP_PID" 2>/dev/null || true
    fi
    rm -f "$SANDBOX_PROFILE" "$SANDBOX_PROBE_LOG"
}
trap cleanup EXIT

cat >"$SANDBOX_PROFILE" <<'EOF'
(version 1)
(allow default)
(deny network*)
EOF

echo "Checking that the macOS sandbox denies network system calls..."
if sandbox-exec -f "$SANDBOX_PROFILE" \
    python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0))' \
    >"$SANDBOX_PROBE_LOG" 2>&1; then
    echo "Offline proof aborted: the sandbox network-denial probe unexpectedly succeeded." >&2
    exit 1
fi

if ! grep -Eiq 'not permitted|denied|sandbox|permission' "$SANDBOX_PROBE_LOG"; then
    echo "Offline proof aborted: network probe failed for an unexpected reason:" >&2
    cat "$SANDBOX_PROBE_LOG" >&2
    exit 1
fi

echo "Network denial confirmed."
echo "Launching the packaged app with all network operations denied."
echo "System Wi-Fi/Ethernet remain enabled; only this app and its children are isolated."
echo "Exercising the embedded issue040 content/audio sub-proof ($PROOF_ENV_VAR)."
echo "The run is bounded to ${RUN_TIMEOUT}s and exits itself on the exiting report."
echo "Evidence: $EVIDENCE_FILE"

# Launch in the background WITHOUT a tee pipe so $! is the sandboxed app process
# we own (sandbox-exec execs the binary in place). A separate reader tails the
# evidence file to the console. Because the report gate exits the process
# (app.exit(0)) after emitting the exiting report, the normal path finishes well
# inside the timeout; the timeout only guards a missing/late report.
: >"$EVIDENCE_FILE"
env "$PROOF_ENV_VAR=1" \
    sandbox-exec -f "$SANDBOX_PROFILE" "$APP_BINARY" >"$EVIDENCE_FILE" 2>&1 &
APP_PID=$!

APP_STATUS=""
ELAPSED=0
while kill -0 "$APP_PID" 2>/dev/null; do
    if [ "$ELAPSED" -ge "$RUN_TIMEOUT" ]; then
        echo "Offline proof aborted: no exiting report within ${RUN_TIMEOUT}s; terminating the owned process." >&2
        # cleanup() (EXIT trap) terminates only $APP_PID.
        exit 1
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

set +e
wait "$APP_PID"
APP_STATUS=$?
set -e
# The process has been reaped; do not let cleanup try to kill it again.
APP_PID=""

cat "$EVIDENCE_FILE"

if [ "$APP_STATUS" -ne 0 ]; then
    echo "Packaged app exited with status $APP_STATUS." >&2
    exit "$APP_STATUS"
fi

# Report existence alone must NEVER pass. Require exactly one exiting report and
# then parse it as JSON, failing on any truthy `failure` value.
REPORT_COUNT="$(grep -c "^${REPORT_KEY}=" "$EVIDENCE_FILE" 2>/dev/null || true)"
if [ "$REPORT_COUNT" -ne 1 ]; then
    echo "Offline run completed, but expected exactly 1 ${REPORT_KEY}, found ${REPORT_COUNT}." >&2
    echo "Inspect the evidence file before accepting the offline proof." >&2
    exit 1
fi

if ! grep "^${REPORT_KEY}=" "$EVIDENCE_FILE" | head -1 | sed "s/^${REPORT_KEY}=//" | python3 -c "
import sys, json
report = json.loads(sys.stdin.read())
failure = report.get('failure')
if failure:
    text = failure if isinstance(failure, str) else json.dumps(failure)
    print(f'Offline proof FAILED — {text[:400]}')
    sys.exit(1)
print('Offline proof report parsed: no truthy failure.')
"; then
    echo "Offline run captured a structured report with a truthy failure." >&2
    exit 1
fi

echo "Offline run completed with a clean structured ${REPORT_KEY} (offline rendering + trusted input)."
echo "System networking was never changed."

#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/src/desktop"
APP_BINARY="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/MonoGame Playground.app/Contents/MacOS/monogame-playground"
EVIDENCE_FILE="$REPO_ROOT/artifacts/offline-proof-macos.log"
BUILD_APP=1

usage() {
    cat <<'EOF'
Usage: scripts/prove-packaged-offline-macos.sh [options]

Build and launch the packaged MonoGame Playground with networking denied only
for the app process. System networking remains unchanged.

Options:
  --skip-build       Use the existing packaged application.
  --evidence <path>  Write application proof output to this file.
  -h, --help         Show this help.

Close the application normally when the offline test is complete.
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
    echo "Building packaged application before network isolation..."
    npm --prefix "$DESKTOP_DIR" run tauri -- build
fi

if [ ! -x "$APP_BINARY" ]; then
    echo "Packaged application not found: $APP_BINARY" >&2
    echo "Run without --skip-build to create it." >&2
    exit 1
fi

mkdir -p "$(dirname "$EVIDENCE_FILE")"
EVIDENCE_FILE="$(cd "$(dirname "$EVIDENCE_FILE")" && pwd)/$(basename "$EVIDENCE_FILE")"

SANDBOX_PROFILE="$(mktemp "${TMPDIR:-/tmp}/monogame-offline.XXXXXX.sb")"
SANDBOX_PROBE_LOG="$(mktemp "${TMPDIR:-/tmp}/monogame-offline-probe.XXXXXX.log")"

cleanup() {
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
echo "Confirm rendering and input, then close the app normally."
echo "Evidence: $EVIDENCE_FILE"

set +e
MONOGAME_ISSUE011_PROOF=1 \
    sandbox-exec -f "$SANDBOX_PROFILE" "$APP_BINARY" 2>&1 | tee "$EVIDENCE_FILE"
APP_STATUS="${PIPESTATUS[0]}"
set -e

if [ "$APP_STATUS" -ne 0 ]; then
    echo "Packaged app exited with status $APP_STATUS." >&2
    exit "$APP_STATUS"
fi

if ! grep -q '^ISSUE011_REPORT=' "$EVIDENCE_FILE"; then
    echo "Offline run completed, but no structured rendering report was captured." >&2
    echo "Inspect the evidence file before accepting issue 012." >&2
    exit 1
fi

echo "Offline run completed with structured rendering evidence."
echo "System networking was never changed."

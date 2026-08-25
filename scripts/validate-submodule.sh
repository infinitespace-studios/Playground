#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd -P)
SUBMODULE_DIR="$REPO_ROOT/external/MonoGame"
MANIFEST_PATH="$REPO_ROOT/docs/toolchain-manifest.json"

submodule_not_initialized() {
    cat >&2 <<'EOF'
MonoGame submodule is not initialized.

Run:

    git submodule update --init --recursive
EOF
    exit 1
}

if [ ! -d "$SUBMODULE_DIR" ] || [ -z "$(ls -A "$SUBMODULE_DIR" 2>/dev/null)" ]; then
    submodule_not_initialized
fi

if ! SUBMODULE_TOPLEVEL=$(git -C "$SUBMODULE_DIR" rev-parse --show-toplevel 2>/dev/null) ||
    [ "$(cd "$SUBMODULE_DIR" && pwd -P)" != "$(cd "$SUBMODULE_TOPLEVEL" && pwd -P)" ] ||
    ! GITLINK=$(git -C "$REPO_ROOT" ls-files --stage -- external/MonoGame 2>/dev/null) ||
    [[ "$GITLINK" != 160000\ * ]]; then
    submodule_not_initialized
fi

MANIFEST_VALUES=$(python3 - "$MANIFEST_PATH" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as manifest_file:
        monogame = json.load(manifest_file)["monogame"]
    values = (
        monogame["commitSha"],
        monogame["protectedRef"],
        monogame["branch"],
    )
    if not all(isinstance(value, str) and value for value in values):
        raise ValueError("monogame values must be non-empty strings")
except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
    print(f"Unable to read MonoGame pins from {path}: {error}", file=sys.stderr)
    sys.exit(1)

print("\t".join(values))
PY
)
IFS=$'\t' read -r EXPECTED PROTECTED_REF BRANCH <<<"$MANIFEST_VALUES"

if ! ACTUAL=$(git -C "$SUBMODULE_DIR" rev-parse HEAD 2>/dev/null); then
    submodule_not_initialized
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "MonoGame submodule commit mismatch: expected $EXPECTED, found $ACTUAL. Run 'git submodule update --init --recursive' or update docs/toolchain-manifest.json if this is an intentional pointer bump." >&2
    exit 1
fi

if ! DIRTY_STATE=$(git -C "$SUBMODULE_DIR" status --porcelain); then
    echo "Unable to inspect the MonoGame submodule working tree." >&2
    exit 1
fi
if [ -n "$DIRTY_STATE" ]; then
    echo "MonoGame submodule has uncommitted changes; commit or discard them inside external/MonoGame before building." >&2
    exit 1
fi

REMOTE_REF="refs/remotes/origin/$PROTECTED_REF"
CHECK_REACHABILITY=true
if ! git -C "$SUBMODULE_DIR" rev-parse --verify --quiet "$REMOTE_REF^{commit}" >/dev/null; then
    if ! FETCH_ERROR=$(git -C "$SUBMODULE_DIR" fetch origin "$PROTECTED_REF" --quiet 2>&1); then
        case "$FETCH_ERROR" in
            *"Could not resolve host"*|*"Could not resolve hostname"*|*"Failed to connect"*|*"Network is unreachable"*|*"Connection timed out"*|*"Operation timed out"*)
                echo "Warning: unable to fetch origin/$PROTECTED_REF while offline; skipping the protected-ref reachability check." >&2
                CHECK_REACHABILITY=false
                ;;
            *)
                echo "Unable to fetch MonoGame protected ref origin/$PROTECTED_REF: $FETCH_ERROR. Check the origin remote and monogame.protectedRef in docs/toolchain-manifest.json." >&2
                exit 1
                ;;
        esac
    fi
fi

if [ "$CHECK_REACHABILITY" = true ]; then
    if ! git -C "$SUBMODULE_DIR" rev-parse --verify --quiet "$REMOTE_REF^{commit}" >/dev/null; then
        echo "MonoGame protected ref origin/$PROTECTED_REF is unavailable after fetch. Check the origin remote and monogame.protectedRef in docs/toolchain-manifest.json." >&2
        exit 1
    fi
    if ! git -C "$SUBMODULE_DIR" merge-base --is-ancestor "$ACTUAL" "origin/$PROTECTED_REF"; then
        echo "MonoGame pinned commit $ACTUAL is not reachable from protected ref origin/$PROTECTED_REF. Update the submodule to a commit on that ref, or update docs/toolchain-manifest.json for an intentional pin change." >&2
        exit 1
    fi
fi

echo "MonoGame submodule OK: $ACTUAL (branch $BRANCH)"

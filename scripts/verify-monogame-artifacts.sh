#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="$REPO_ROOT/artifacts/monogame"

if [ "$#" -gt 0 ]; then
    if [ "$#" -ne 2 ] || [ "$1" != "--artifacts-dir" ]; then
        echo "Usage: $0 [--artifacts-dir <path>]" >&2
        exit 2
    fi
    ARTIFACTS_DIR="$2"
    if [[ "$ARTIFACTS_DIR" != /* ]]; then
        ARTIFACTS_DIR="$REPO_ROOT/$ARTIFACTS_DIR"
    fi
fi

# Verify the native WASM archives are present and their provenance matches the
# pinned toolchain (host-independent). We intentionally do NOT pin per-file
# hashes or a frozen file inventory: the MonoGame Web payload is fingerprinted
# and rebuilt fresh on every emsdk/MonoGame bump, so byte- or filename-exact
# pins churn constantly without adding real integrity over provenance.
node "$REPO_ROOT/scripts/verify-preview-native-artifacts.mjs" --artifacts-dir "$ARTIFACTS_DIR"

# Confirm the fresh build's provenance commit matches the pinned MonoGame commit
# (or an explicitly recorded retained-artifact commit) in the toolchain manifest.
python3 - \
    "$REPO_ROOT/docs/toolchain-manifest.json" \
    "$ARTIFACTS_DIR" <<'PY'
import json
import sys
from pathlib import Path


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


toolchain_path = Path(sys.argv[1])
artifacts_dir = Path(sys.argv[2])

try:
    with toolchain_path.open(encoding="utf-8") as source:
        toolchain = json.load(source)
except (OSError, json.JSONDecodeError) as error:
    fail(f"Unable to read toolchain manifest {toolchain_path}: {error}")

toolchain_sha = toolchain.get("monogame", {}).get("commitSha")
if not isinstance(toolchain_sha, str) or not toolchain_sha:
    fail("Toolchain manifest is missing monogame.commitSha.")

provenance_path = artifacts_dir / "provenance.json"
if not provenance_path.is_file():
    fail(f"MonoGame artifact provenance is missing: {provenance_path}")

try:
    with provenance_path.open(encoding="utf-8") as source:
        provenance = json.load(source)
except (OSError, json.JSONDecodeError) as error:
    fail(f"Unable to read artifact provenance {provenance_path}: {error}")

provenance_sha = provenance.get("commitSha")
if provenance_sha != toolchain_sha:
    fail(
        "MonoGame commit SHA mismatch: "
        f"toolchain pins {toolchain_sha!r}, built artifacts came from {provenance_sha!r}."
    )

print(f"MonoGame artifacts verified: built from pinned commit {toolchain_sha}.")
PY

#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$REPO_ROOT/artifacts/monogame"
FIXTURE="$REPO_ROOT/artifacts/preview-native-verifier-fixture"

cleanup() {
    rm -rf "$FIXTURE"
}
trap cleanup EXIT

rm -rf "$FIXTURE"
mkdir -p "$FIXTURE/native"
cp "$SOURCE/provenance.json" "$FIXTURE/provenance.json"
cp "$SOURCE/native/"*.a "$FIXTURE/native/"

node "$REPO_ROOT/scripts/verify-preview-native-artifacts.mjs" --artifacts-dir "$FIXTURE"

expect_failure() {
    local label="$1"
    if node "$REPO_ROOT/scripts/verify-preview-native-artifacts.mjs" \
        --artifacts-dir "$FIXTURE" >/dev/null 2>&1; then
        echo "Expected native artifact verification to reject $label." >&2
        exit 1
    fi
}

rm "$FIXTURE/native/mgruntime.a"
expect_failure "a missing archive"
cp "$SOURCE/native/mgruntime.a" "$FIXTURE/native/mgruntime.a"

printf 'tamper' >> "$FIXTURE/native/mgruntime.a"
expect_failure "a tampered archive"
cp "$SOURCE/native/mgruntime.a" "$FIXTURE/native/mgruntime.a"

python3 - "$FIXTURE/provenance.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as source:
    provenance = json.load(source)
provenance["commitSha"] = "0" * 40
with open(path, "w", encoding="utf-8") as destination:
    json.dump(provenance, destination)
PY
expect_failure "retained artifacts without matching source provenance"
cp "$SOURCE/provenance.json" "$FIXTURE/provenance.json"

cp "$SOURCE/native/mgruntime.a" "$FIXTURE/native/unexpected.a"
expect_failure "an extra archive"
rm "$FIXTURE/native/unexpected.a"

node "$REPO_ROOT/scripts/verify-preview-native-artifacts.mjs" --artifacts-dir "$FIXTURE"
echo "Preview native artifact clean-state regression passed."

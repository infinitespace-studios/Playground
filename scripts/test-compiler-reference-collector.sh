#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_ROOT="$REPO_ROOT/src/compiler/obj/reference-collector-tests-$PPID-$$"
FIXTURE_REFERENCES="$FIXTURE_ROOT/References"
FIXTURE_MANIFEST="$FIXTURE_ROOT/reference-allowlist.json"
VERIFY="$REPO_ROOT/scripts/collect-compiler-references.sh"

cleanup() {
    rm -rf "$FIXTURE_ROOT"
}
trap cleanup EXIT

expect_failure() {
    local name="$1"
    local expected="$2"
    shift 2
    local log="$FIXTURE_ROOT/$name.log"
    if "$@" >"$log" 2>&1; then
        echo "Negative case unexpectedly succeeded: $name" >&2
        exit 1
    fi
    if ! grep -Fq "$expected" "$log"; then
        echo "Negative case returned the wrong failure: $name" >&2
        cat "$log" >&2
        exit 1
    fi
    echo "PASS $name"
}

mkdir -p "$FIXTURE_ROOT"
cp -R "$REPO_ROOT/src/compiler/References" "$FIXTURE_REFERENCES"
cp "$REPO_ROOT/docs/reference-allowlist.json" "$FIXTURE_MANIFEST"

mkdir "$FIXTURE_ROOT/unsafe-destination"
printf 'preserve\n' >"$FIXTURE_ROOT/unsafe-destination/marker"
expect_failure unsafe-nonverify-destination "only valid with --verify" \
    "$VERIFY" --references-dir "$FIXTURE_ROOT/unsafe-destination"
test -f "$FIXTURE_ROOT/unsafe-destination/marker"

ln -s "$FIXTURE_REFERENCES" "$FIXTURE_ROOT/symlink-references"
expect_failure symlink-destination "must not contain symlinks" \
    "$VERIFY" --verify --references-dir "$FIXTURE_ROOT/symlink-references"

"$VERIFY" --verify --references-dir "$FIXTURE_REFERENCES"

rm "$FIXTURE_REFERENCES/System.Console.dll"
expect_failure missing "inventory mismatch" \
    "$VERIFY" --verify --references-dir "$FIXTURE_REFERENCES"
cp "$REPO_ROOT/src/compiler/References/System.Console.dll" "$FIXTURE_REFERENCES/"

cp "$FIXTURE_REFERENCES/System.Collections.dll" "$FIXTURE_REFERENCES/System.Console.dll"
python3 - "$FIXTURE_MANIFEST" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as source:
    manifest = json.load(source)
entries = {entry["simpleName"]: entry for entry in manifest["assemblies"]}
entries["System.Console"]["sha256"] = entries["System.Collections"]["sha256"]
with open(path, "w", encoding="utf-8") as destination:
    json.dump(manifest, destination, indent=2)
    destination.write("\n")
PY
expect_failure wrong-identity-updated-hash "Destination identity/hash mismatch" \
    "$VERIFY" --verify --manifest "$FIXTURE_MANIFEST" \
    --references-dir "$FIXTURE_REFERENCES"
cp "$REPO_ROOT/src/compiler/References/System.Console.dll" "$FIXTURE_REFERENCES/"
cp "$REPO_ROOT/docs/reference-allowlist.json" "$FIXTURE_MANIFEST"

printf 'tampered' >>"$FIXTURE_REFERENCES/System.Console.dll"
expect_failure tampered "hash mismatch" \
    "$VERIFY" --verify --references-dir "$FIXTURE_REFERENCES"
cp "$REPO_ROOT/src/compiler/References/System.Console.dll" "$FIXTURE_REFERENCES/"

cp "$FIXTURE_REFERENCES/System.Console.dll" "$FIXTURE_REFERENCES/Unexpected.dll"
expect_failure extra "inventory mismatch" \
    "$VERIFY" --verify --references-dir "$FIXTURE_REFERENCES"
rm "$FIXTURE_REFERENCES/Unexpected.dll"

python3 - "$FIXTURE_MANIFEST" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as source:
    manifest = json.load(source)
for entry in manifest["assemblies"]:
    if entry["simpleName"] == "MonoGame.Framework":
        entry["version"] = "3.8.3.1"
with open(path, "w", encoding="utf-8") as destination:
    json.dump(manifest, destination, indent=2)
    destination.write("\n")
PY
expect_failure monogame-version-drift "identity has drifted between the toolchain and reference manifests" \
    "$VERIFY" --verify --manifest "$FIXTURE_MANIFEST" \
    --references-dir "$FIXTURE_REFERENCES"
cp "$REPO_ROOT/docs/reference-allowlist.json" "$FIXTURE_MANIFEST"

python3 - "$FIXTURE_MANIFEST" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as source:
    manifest = json.load(source)
manifest["monogameCommitSha"] = "0" * 40
with open(path, "w", encoding="utf-8") as destination:
    json.dump(manifest, destination, indent=2)
    destination.write("\n")
PY
expect_failure manifest-drift "has drifted from docs/toolchain-manifest.json" \
    "$VERIFY" --verify --manifest "$FIXTURE_MANIFEST" \
    --references-dir "$FIXTURE_REFERENCES"

echo "All compiler reference collector negative cases passed."

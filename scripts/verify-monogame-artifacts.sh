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

node "$REPO_ROOT/scripts/verify-preview-native-artifacts.mjs" --artifacts-dir "$ARTIFACTS_DIR"

python3 - \
    "$REPO_ROOT/docs/monogame-artifacts.json" \
    "$REPO_ROOT/docs/toolchain-manifest.json" \
    "$ARTIFACTS_DIR" <<'PY'
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


def read_json(path, description):
    try:
        with path.open(encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        fail(f"Unable to read {description} {path}: {error}")


inventory_path = Path(sys.argv[1])
toolchain_path = Path(sys.argv[2])
artifacts_dir = Path(sys.argv[3])

inventory = read_json(inventory_path, "artifact inventory")
toolchain = read_json(toolchain_path, "toolchain manifest")

if inventory.get("schemaVersion") != 1:
    fail("Unsupported MonoGame artifact inventory schemaVersion; expected 1.")

commit_sha = inventory.get("monogameCommitSha")
if not isinstance(commit_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
    fail("Artifact inventory monogameCommitSha must be a lowercase 40-character SHA.")

toolchain_sha = toolchain.get("monogame", {}).get("commitSha")
if commit_sha != toolchain_sha:
    fail(
        "MonoGame commit SHA mismatch: "
        f"artifact inventory has {commit_sha!r}, toolchain manifest has {toolchain_sha!r}."
    )

build_configuration = inventory.get("buildConfiguration")
if not isinstance(build_configuration, str) or not build_configuration:
    fail("Artifact inventory buildConfiguration must be a non-empty string.")

provenance_file = inventory.get("provenanceFile")
if not isinstance(provenance_file, str) or not provenance_file:
    fail("Artifact inventory provenanceFile must be a non-empty string.")

required_files = inventory.get("requiredFiles")
if not isinstance(required_files, list) or not required_files:
    fail("Artifact inventory requiredFiles must be a non-empty array.")
if required_files != sorted(required_files):
    fail("Artifact inventory requiredFiles must be sorted.")
if len(required_files) != len(set(required_files)):
    fail("Artifact inventory requiredFiles must not contain duplicates.")

for relative_path in required_files:
    if not isinstance(relative_path, str) or not relative_path:
        fail("Artifact inventory requiredFiles entries must be non-empty strings.")
    parsed_path = PurePosixPath(relative_path)
    if (
        parsed_path.is_absolute()
        or parsed_path.as_posix() != relative_path
        or "\\" in relative_path
        or ".." in parsed_path.parts
    ):
        fail(f"Artifact inventory contains an unsafe relative path: {relative_path!r}.")

if provenance_file not in required_files:
    fail("Artifact inventory provenanceFile must also appear in requiredFiles.")

missing = [
    relative_path
    for relative_path in required_files
    if not (artifacts_dir.joinpath(*PurePosixPath(relative_path).parts)).is_file()
]

provenance_path = artifacts_dir.joinpath(*PurePosixPath(provenance_file).parts)
if provenance_path.is_file():
    provenance = read_json(provenance_path, "artifact provenance")
    provenance_sha = provenance.get("commitSha")
    if commit_sha != provenance_sha:
        fail(
            "MonoGame commit SHA mismatch: "
            f"artifact inventory has {commit_sha!r}, artifact provenance has {provenance_sha!r}."
        )

    recorded_status_hash = provenance.get("preBuildStatusSha256")
    status = provenance.get("preBuildStatus")
    if not isinstance(status, str) or not isinstance(recorded_status_hash, str):
        fail("Artifact provenance must contain preBuildStatus and preBuildStatusSha256 strings.")
    actual_status_hash = hashlib.sha256(status.encode("utf-8")).hexdigest()
    if actual_status_hash != recorded_status_hash:
        fail(
            "Artifact provenance preBuildStatusSha256 mismatch: "
            f"recorded {recorded_status_hash!r}, computed {actual_status_hash!r}."
        )
else:
    provenance = None

if missing:
    print("Missing required MonoGame artifacts:", file=sys.stderr)
    for relative_path in missing:
        print(f" - {relative_path}", file=sys.stderr)
    raise SystemExit(1)

file_entries = []
for relative_path in required_files:
    artifact_path = artifacts_dir.joinpath(*PurePosixPath(relative_path).parts)
    digest = hashlib.sha256()
    with artifact_path.open("rb") as artifact:
        for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(chunk)
    file_entries.append({"path": relative_path, "sha256": digest.hexdigest()})

output = {
    "schemaVersion": 1,
    "inventorySchemaVersion": inventory["schemaVersion"],
    "monogameCommitSha": commit_sha,
    "buildConfiguration": build_configuration,
    "provenance": {
        "file": provenance_file,
        "dotnetSdkVersion": provenance.get("dotnetSdkVersion"),
        "allowDirty": provenance.get("allowDirty"),
        "preBuildStatusSha256": provenance.get("preBuildStatusSha256"),
    },
    "files": file_entries,
}

output_path = artifacts_dir / "artifact-hashes.json"
try:
    with output_path.open("w", encoding="utf-8") as destination:
        json.dump(output, destination, indent=2, sort_keys=True)
        destination.write("\n")
except OSError as error:
    fail(f"Unable to write artifact hash manifest {output_path}: {error}")

print(
    f"All {len(file_entries)} required MonoGame artifacts are present; "
    f"hashes written to {output_path}"
)
PY

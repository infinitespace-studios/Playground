#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMODULE_DIR="$REPO_ROOT/external/MonoGame"
STAGING_DIR="$REPO_ROOT/artifacts/monogame"
WEB_OUTPUT="$SUBMODULE_DIR/Example/bin/Web/Debug/net9.0/wwwroot"
WEB_STATIC="$SUBMODULE_DIR/Example/wwwroot"
NATIVE_OUTPUT="$SUBMODULE_DIR/Artifacts/native/mgruntime/wasm/emscripten/Release"
NATIVE_STAGING="$STAGING_DIR/native"
ALLOW_DIRTY=false

check_required_artifact_patterns() {
    local framework_dir="$1"
    local required_pattern
    local required_patterns=(
        "dotnet.native.*.wasm"
        "dotnet.native.*.js"
        "dotnet.runtime.*.js"
        "Example.Web.*.wasm"
        "MonoGame.Framework.*.wasm"
    )

    # Fingerprinted builds may retain multiple generations; completeness requires at least one match per pattern.
    for required_pattern in "${required_patterns[@]}"; do
        if ! compgen -G "$framework_dir/$required_pattern" >/dev/null; then
            echo "MonoGame Web runtime output is incomplete; missing artifact pattern: $required_pattern" >&2
            return 1
        fi
    done
}

if [ "$#" -gt 1 ]; then
    echo "Usage: $0 [--allow-dirty]" >&2
    exit 2
fi
if [ "$#" -eq 1 ]; then
    if [ "$1" != "--allow-dirty" ]; then
        echo "Unknown argument: $1" >&2
        echo "Usage: $0 [--allow-dirty]" >&2
        exit 2
    fi
    ALLOW_DIRTY=true
fi

cd "$REPO_ROOT"

PRE_BUILD_STATUS_WITH_SENTINEL="$(git -C external/MonoGame status --short; printf '\034')"
PRE_BUILD_STATUS="${PRE_BUILD_STATUS_WITH_SENTINEL%$'\034'}"
COMMIT_SHA="$(git -C external/MonoGame rev-parse HEAD)"
DOTNET_SDK_VERSION="$(dotnet --version)"
MONOGAME_BUILD_DOTNET_SDK_VERSION="$(cd external/MonoGame && dotnet --version)"
PRE_BUILD_STATUS_SHA256="$(
    printf '%s' "$PRE_BUILD_STATUS" |
        python3 -c 'import hashlib, sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
)"

if [ "$ALLOW_DIRTY" = true ]; then
    bash scripts/validate-submodule.sh --allow-dirty
else
    bash scripts/validate-submodule.sh
fi
bash scripts/check-emsdk-env.sh

echo "Building MonoGame at commit $COMMIT_SHA"
cd external/MonoGame
dotnet run --project build/Build.csproj
cd ../..

dotnet build external/MonoGame/Example/Example.Web.csproj --configuration Debug

required_paths=(
    "$WEB_STATIC/index.html"
    "$WEB_STATIC/main.js"
    "$WEB_OUTPUT/_framework/blazor.boot.json"
)
for required_path in "${required_paths[@]}"; do
    if [ ! -f "$required_path" ]; then
        echo "Required MonoGame Web runtime artifact not found: $required_path" >&2
        exit 1
    fi
done

check_required_artifact_patterns "$WEB_OUTPUT/_framework"
for archive in mgruntime.a libSDL2.a libFAudio.a; do
    if [ ! -f "$NATIVE_OUTPUT/$archive" ]; then
        echo "Required MonoGame Emscripten archive not found: $NATIVE_OUTPUT/$archive" >&2
        exit 1
    fi
done

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$WEB_STATIC"/. "$STAGING_DIR"/
cp -R "$WEB_OUTPUT"/. "$STAGING_DIR"/
mkdir -p "$NATIVE_STAGING"
cp "$NATIVE_OUTPUT"/mgruntime.a "$NATIVE_OUTPUT"/libSDL2.a "$NATIVE_OUTPUT"/libFAudio.a "$NATIVE_STAGING"/

EMSCRIPTEN_VERSION="$(emcc --version | sed -En '1s/.*emcc \([^)]*\) ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p')"
if [ "$EMSCRIPTEN_VERSION" != "3.1.56" ]; then
    echo "Unexpected Emscripten compiler version: $EMSCRIPTEN_VERSION" >&2
    exit 1
fi

COMMIT_SHA="$COMMIT_SHA" \
DOTNET_SDK_VERSION="$DOTNET_SDK_VERSION" \
MONOGAME_BUILD_DOTNET_SDK_VERSION="$MONOGAME_BUILD_DOTNET_SDK_VERSION" \
EMSCRIPTEN_VERSION="$EMSCRIPTEN_VERSION" \
ALLOW_DIRTY="$ALLOW_DIRTY" \
PRE_BUILD_STATUS="$PRE_BUILD_STATUS" \
PRE_BUILD_STATUS_SHA256="$PRE_BUILD_STATUS_SHA256" \
python3 - "$STAGING_DIR/provenance.json" <<'PY'
import json
import os
import sys

provenance = {
    "commitSha": os.environ["COMMIT_SHA"],
    "dotnetSdkVersion": os.environ["DOTNET_SDK_VERSION"],
    "monoGameBuildDotnetSdkVersion": os.environ["MONOGAME_BUILD_DOTNET_SDK_VERSION"],
    "emscriptenVersion": os.environ["EMSCRIPTEN_VERSION"],
    "nativeBuildConfiguration": "Release",
    "allowDirty": os.environ["ALLOW_DIRTY"] == "true",
    "preBuildStatus": os.environ["PRE_BUILD_STATUS"],
    "preBuildStatusSha256": os.environ["PRE_BUILD_STATUS_SHA256"],
}
with open(sys.argv[1], "w", encoding="utf-8") as output:
    json.dump(provenance, output, indent=2)
    output.write("\n")
PY

POST_BUILD_STATUS_WITH_SENTINEL="$(git -C external/MonoGame status --short; printf '\034')"
POST_BUILD_STATUS="${POST_BUILD_STATUS_WITH_SENTINEL%$'\034'}"

PRE_BUILD_STATUS="$PRE_BUILD_STATUS" POST_BUILD_STATUS="$POST_BUILD_STATUS" python3 - <<'PY'
import os

pre = os.environ["PRE_BUILD_STATUS"].splitlines()
post = os.environ["POST_BUILD_STATUS"].splitlines()
pre_set = set(pre)
post_set = set(post)
additions = [entry for entry in post if entry not in pre_set]
removals = [entry for entry in pre if entry not in post_set]

print("Pre-existing external/MonoGame status:")
print("\n".join(pre) if pre else "(clean)")
print("Post-build external/MonoGame status:")
print("\n".join(post) if post else "(clean)")
print("Post-build additions:")
print("\n".join(additions) if additions else "(none)")
print("Pre-existing entries no longer reported:")
print("\n".join(removals) if removals else "(none)")
PY

echo "Staged MonoGame Web runtime artifacts in $STAGING_DIR"

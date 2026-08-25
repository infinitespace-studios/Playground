#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
emsdk_path="$(dirname "$repository_root")/emsdk"

print_environment_error() {
  echo "Emscripten environment is not active in this shell." >&2
  echo "Run this exact command in your current shell before continuing:" >&2
  echo "" >&2
  echo "    source ../emsdk/emsdk_env.sh" >&2
  echo "" >&2
  echo "Note: this must be sourced, not executed, because emsdk_env.sh sets variables in the calling shell." >&2
}

if [ ! -d "$emsdk_path" ]; then
  echo "Emscripten SDK not found at ../emsdk (expected as a sibling of this repository)." >&2
  echo "Clone it from https://github.com/emscripten-core/emsdk into ../emsdk and install/activate the pinned version." >&2
  exit 1
fi

if [ -z "${EMSDK:-}" ] || ! command -v emcc >/dev/null 2>&1; then
  print_environment_error
  exit 1
fi

if ! emcc_version="$(emcc --version 2>/dev/null)"; then
  print_environment_error
  exit 1
fi

emcc_version="${emcc_version%%$'\n'*}"
echo "emsdk environment OK: EMSDK=$EMSDK, emcc=$emcc_version"
exit 0

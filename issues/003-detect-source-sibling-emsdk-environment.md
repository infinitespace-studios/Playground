# Detect and source sibling emsdk environment

**Type:** AFK
**Status:** Ready
**Blocked by:** [001-record-pinned-toolchain-manifest.md](001-record-pinned-toolchain-manifest.md)
**PRD references:** 11.2
**User stories:** US8
**Triage:** needs-triage

## Context

PRD section 11.2 requires the Emscripten SDK to be located beside the playground repository at `../emsdk`, and requires developers to run `source ../emsdk/emsdk_env.sh` before any MonoGame native/WebAssembly build, because `emsdk_env.sh` sets environment variables in the *current shell* — running it as a child process does not persist those variables. Build scripts must detect when this has not been done and report the exact command to run. This issue creates the detection helper that issue 4's MonoGame build step depends on.

## What to build

Create `scripts/check-emsdk-env.sh` (and `.ps1` twin) that (a) verifies `../emsdk` exists relative to the repository root, (b) verifies the Emscripten environment is actually sourced in the current shell (e.g. `EMSDK` environment variable is set and `emcc --version` succeeds), and (c) if not sourced, prints the exact required command `source ../emsdk/emsdk_env.sh` and exits non-zero without attempting to source it itself (since sourcing must happen in the caller's shell, not a subshell the script controls).

## Scope

### In scope

- `scripts/check-emsdk-env.sh` and `scripts/check-emsdk-env.ps1`
- Detection logic only: presence of `../emsdk`, presence of `EMSDK` env var, `emcc` on PATH and runnable
- Documentation addition to `docs/build.md` describing the sibling emsdk convention

### Out of scope

- Installing or downloading emsdk
- Running the MonoGame build itself (issue 4)
- Modifying shell profile files (`.bashrc`, `.zshrc`, etc.)

## Implementation guidance

1. `scripts/check-emsdk-env.sh` logic:
```bash
#!/usr/bin/env bash
set -uo pipefail
if [ ! -d ../emsdk ]; then
  echo "Emscripten SDK not found at ../emsdk (expected as a sibling of this repository)." >&2
  echo "Clone it from https://github.com/emscripten-core/emsdk into ../emsdk and install/activate the pinned version." >&2
  exit 1
fi
if [ -z "${EMSDK:-}" ] || ! command -v emcc >/dev/null 2>&1; then
  echo "Emscripten environment is not active in this shell." >&2
  echo "Run this exact command in your current shell before continuing:" >&2
  echo "" >&2
  echo "    source ../emsdk/emsdk_env.sh" >&2
  echo "" >&2
  echo "Note: this must be sourced, not executed, because emsdk_env.sh sets variables in the calling shell." >&2
  exit 1
fi
echo "emsdk environment OK: EMSDK=$EMSDK, emcc=$(emcc --version | head -n1)"
exit 0
```
2. Mirror in `scripts/check-emsdk-env.ps1` using `$env:EMSDK` and `Get-Command emcc -ErrorAction SilentlyContinue`.
3. Update `docs/build.md` (created in issue 1) with a subsection "Emscripten environment" documenting the sibling `../emsdk` layout and the mandatory `source` command, quoting it exactly as written in PRD section 11.2.

## Acceptance criteria

- [ ] Running the script without `../emsdk` present and without EMSDK set prints the missing-directory message and exits non-zero
- [ ] Running the script after `source ../emsdk/emsdk_env.sh` (or after manually exporting `EMSDK` and ensuring `emcc` is on PATH in a test shell) exits 0 and prints the emsdk/emcc version
- [ ] The failure message contains the exact literal text `source ../emsdk/emsdk_env.sh`
- [ ] `docs/build.md` documents the sibling emsdk convention and the mandatory `source` requirement

## Verification

In a fresh shell without sourcing emsdk:
```bash
bash scripts/check-emsdk-env.sh; echo "exit=$?"
```
Expect non-zero exit and the exact `source ../emsdk/emsdk_env.sh` line in stderr. Then, if `../emsdk/emsdk_env.sh` exists in this environment, run:
```bash
source ../emsdk/emsdk_env.sh && bash scripts/check-emsdk-env.sh; echo "exit=$?"
```
Expect exit 0. If `../emsdk` does not exist in the verifier's environment, it is acceptable to verify only the failure path plus a code review confirming the success branch logic is correct; record which path was exercised in the verification log.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `scripts: detect and require sourced emsdk environment`

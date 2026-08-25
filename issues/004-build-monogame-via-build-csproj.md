# Build MonoGame via build/Build.csproj

**Type:** AFK
**Status:** Ready
**Blocked by:** [002-validate-recursive-monogame-submodule-checkout.md](002-validate-recursive-monogame-submodule-checkout.md), [003-detect-source-sibling-emsdk-environment.md](003-detect-source-sibling-emsdk-environment.md)
**PRD references:** 11.2, 11.4
**User stories:** US8
**Triage:** needs-triage

## Context

PRD section 11.2 mandates that MonoGame is built before the playground using the exact sequence: `source ../emsdk/emsdk_env.sh`, then `cd external/MonoGame`, then `dotnet run --project build/Build.csproj`, then `cd ../..`, all in the same shell so the native Emscripten build inherits the sourced environment. Section 11.4 says build outputs required by the playground may be copied into a generated staging directory, suggested as `artifacts/monogame/`, which must not be committed. This issue wires the previous two validation scripts (issues 2 and 3) into one orchestration script that actually runs the MonoGame build and stages its outputs, without modifying anything inside the `external/MonoGame` submodule itself (the build only produces artifacts in its own `bin`/`obj`/`Artifacts` directories, which is normal build output, not a source change).

## What to build

Create `scripts/build-monogame.sh` (and `.ps1` twin) that: runs `scripts/validate-submodule.sh`, runs `scripts/check-emsdk-env.sh`, and if both pass, executes the required build command sequence exactly as specified in PRD 11.2, then copies the resulting native/WASM build outputs into `artifacts/monogame/` at the repository root (create this directory; it must be listed in `.gitignore` — check `.gitignore` first and add an entry only if one for `artifacts/` is not already present).

## Scope

### In scope

- `scripts/build-monogame.sh` and `scripts/build-monogame.ps1`
- Adding `artifacts/` to `.gitignore` if not already ignored
- Running the build and copying known output paths into `artifacts/monogame/`
- Printing the pinned commit SHA being built, per PRD 11.2 item 3

### Out of scope

- Hashing/verifying artifacts (issue 5)
- Building the playground frontend/desktop shell
- Changing anything inside `external/MonoGame` source

## Implementation guidance

1. Before writing the script, run the two prerequisite checks manually to confirm they pass in this environment: `bash scripts/validate-submodule.sh && bash scripts/check-emsdk-env.sh` (source emsdk first if needed).
2. `scripts/build-monogame.sh` body:
```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
bash scripts/validate-submodule.sh
bash scripts/check-emsdk-env.sh
echo "Building MonoGame at commit $(git -C external/MonoGame rev-parse HEAD)"
cd external/MonoGame
dotnet run --project build/Build.csproj
cd ../..
mkdir -p artifacts/monogame
# Copy the exact output directories this MonoGame revision produces; inspect
# external/MonoGame/build/Build.csproj and external/MonoGame/Example/Example.Web.csproj
# to confirm real output paths (e.g. MonoGame.Framework.Native build output under
# external/MonoGame/Artifacts/ or external/MonoGame/MonoGame.Framework/bin/**) and
# copy only files needed by the playground preview runtime (see issue 5 for the
# authoritative expected-file list).
```
   Replace the trailing comment with real `cp -R` / `rsync` commands once you inspect the actual output paths produced by running `dotnet run --project build/Build.csproj` in `external/MonoGame` (run it first, then use `find external/MonoGame -newer <timestamp-before-build> -type f` to discover exactly what changed).
3. Mirror in `scripts/build-monogame.ps1`.
4. Check `.gitignore` for an existing `artifacts/` or `artifacts` entry; if absent, append `artifacts/` on its own line.
5. Do not commit anything under `external/MonoGame`; the build only writes to its own `bin`/`obj`/build-output directories which are already gitignored inside that submodule (verify with `git -C external/MonoGame status --short` after the build — it must remain empty; if the build modifies tracked files, stop and report this rather than committing it, since that would be a submodule content change requiring separate review per PRD section 2.4).

## Acceptance criteria

- [ ] `scripts/build-monogame.sh` runs the exact three commands from PRD 11.2 in the same shell (`cd external/MonoGame`, `dotnet run --project build/Build.csproj`, `cd ../..`)
- [ ] The script fails fast with the validation-script messages if the submodule or emsdk checks fail
- [ ] After a successful run, `artifacts/monogame/` contains the native/WebAssembly build outputs needed to run the MonoGame web example
- [ ] `git -C external/MonoGame status --short` is empty after the build (no tracked submodule files were modified)
- [ ] `.gitignore` ignores `artifacts/`

## Verification

Run:
```bash
source ../emsdk/emsdk_env.sh
bash scripts/build-monogame.sh
echo "exit=$?"
ls -la artifacts/monogame
git -C external/MonoGame status --short
git status --short
```
Expect exit 0, a non-empty `artifacts/monogame` listing containing recognizable MonoGame native/WASM build outputs, an empty `git -C external/MonoGame status --short`, and `git status --short` showing only the new script files and the `.gitignore` change (not `artifacts/`, which must be ignored). This build can take several minutes on first run; give it at least 20 minutes before treating it as hung. The verifier must attach the full console log of the build.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `scripts: build MonoGame via build/Build.csproj and stage artifacts`

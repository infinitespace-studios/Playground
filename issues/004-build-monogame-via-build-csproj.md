# Build MonoGame via build/Build.csproj

**Type:** AFK
**Status:** Done
**Blocked by:** [002-validate-recursive-monogame-submodule-checkout.md](002-validate-recursive-monogame-submodule-checkout.md), [003-detect-source-sibling-emsdk-environment.md](003-detect-source-sibling-emsdk-environment.md)
**PRD references:** 11.2, 11.4
**User stories:** US8
**Triage:** needs-triage

## Context

PRD section 11.2 mandates that MonoGame is built before the playground using the exact sequence: `source ../emsdk/emsdk_env.sh`, then `cd external/MonoGame`, then `dotnet run --project build/Build.csproj`, then `cd ../..`, all in the same shell so the native Emscripten build inherits the sourced environment. Section 11.4 says build outputs required by the playground may be copied into a generated staging directory, suggested as `artifacts/monogame/`, which must not be committed. This issue wires the previous two validation scripts (issues 2 and 3) into one orchestration script that actually runs the MonoGame build and stages its outputs, without modifying anything inside the `external/MonoGame` submodule itself (the build only produces artifacts in its own `bin`/`obj`/`Artifacts` directories, which is normal build output, not a source change).

## What to build

Create `scripts/build-monogame.sh` (and `.ps1` twin) that: runs `scripts/validate-submodule.sh`, runs `scripts/check-emsdk-env.sh`, and if both pass, executes the required build command sequence exactly as specified in PRD 11.2, then copies the resulting native/WASM build outputs into `artifacts/monogame/` at the repository root (create this directory; it must be listed in `.gitignore` — check `.gitignore` first and add an entry only if one for `artifacts/` is not already present).

For local development only, the script must support an explicit `--allow-dirty` (`-AllowDirty` in PowerShell) override requested by the repository owner. The override may bypass only the clean-worktree failure: initialization, pinned HEAD, protected-ref, emsdk, build, and artifact checks remain mandatory. Default and CI/release behavior must remain strict.

## Scope

### In scope

- `scripts/build-monogame.sh` and `scripts/build-monogame.ps1`
- Adding `artifacts/` to `.gitignore` if not already ignored
- Running the build and copying known output paths into `artifacts/monogame/`
- Printing the pinned commit SHA being built, per PRD 11.2 item 3
- Adding an opt-in dirty-worktree flag to the validation/build scripts while preserving strict default behavior
- Writing generated artifact provenance that records the pinned SHA, active SDK, dirty override, and SHA-256 of the exact pre-build `git status --short` output

### Out of scope

- Hashing/verifying artifacts (issue 5)
- Building the playground frontend/desktop shell
- Changing anything inside `external/MonoGame` source

## Implementation guidance

1. Before writing the script, run the two prerequisite checks manually. In a dirty development checkout, confirm strict validation fails, then use only the explicit `--allow-dirty` path after recording the exact status. Source emsdk first.
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
3. Add `--allow-dirty` to `scripts/validate-submodule.sh` and `-AllowDirty` to its PowerShell twin. With the flag, emit a prominent warning and continue only past the dirty-state check. Without it, retain issue 002 behavior exactly.
4. When dirty override is used, write `artifacts/monogame/provenance.json` containing `commitSha`, `dotnetSdkVersion`, `allowDirty: true`, the full pre-build status text, and its SHA-256. Clean builds record `allowDirty: false`.
5. Mirror build behavior in `scripts/build-monogame.ps1`.
6. Check `.gitignore` for an existing `artifacts/` or `artifacts` entry; if absent, append `artifacts/` on its own line.
7. Do not commit anything under `external/MonoGame`. Compare pre/post status and report any new tracked or untracked entries introduced by the build separately from the pre-existing baseline.

## Acceptance criteria

- [ ] `scripts/build-monogame.sh` runs the exact three commands from PRD 11.2 in the same shell (`cd external/MonoGame`, `dotnet run --project build/Build.csproj`, `cd ../..`)
- [ ] The script fails fast with the validation-script messages if the submodule or emsdk checks fail
- [ ] Strict validation still exits non-zero on a dirty submodule; explicit dirty override prints a warning and records complete provenance
- [ ] After a successful run, `artifacts/monogame/` contains the native/WebAssembly build outputs needed to run the MonoGame web example
- [ ] Any post-build submodule status difference from the recorded pre-build baseline is limited to expected generated build outputs and is documented; no user changes are reverted or staged
- [ ] `.gitignore` ignores `artifacts/`

## Verification

Run:
```bash
source ../emsdk/emsdk_env.sh
bash scripts/validate-submodule.sh; echo "strict_exit=$?"
bash scripts/build-monogame.sh --allow-dirty
echo "exit=$?"
ls -la artifacts/monogame
python3 -m json.tool artifacts/monogame/provenance.json
git -C external/MonoGame status --short
git status --short
```
Expect strict validation to reject a dirty checkout, the explicit override build to exit 0 with a prominent warning, a non-empty `artifacts/monogame` listing containing recognizable MonoGame native/WASM outputs, and valid provenance matching the pre-build status. Compare pre/post submodule snapshots and confirm no user change was reverted or staged. `git status --short` must show only issue-scoped source changes; `artifacts/` must be ignored. This build can take several minutes on first run; give it at least 20 minutes before treating it as hung. The verifier must attach the full console log.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent background verifier `a49063f4-8da4-4cc9-a293-c29de72c7ca8`
- **Date:** 2026-08-25
- **Evidence:** Strict validator rejected dirty state; explicit `--allow-dirty` bypassed only that check and retained initialization, pinned-SHA, protected-ref, and emsdk gates. Owner explicitly authorized building the current dirty checkout. Sourced emsdk and `dotnet run --project build/Build.csproj` completed with SDK `9.0.315`; Debug `Example.Web` output staged 370 files, and all 176 boot-manifest references hash-verified. Provenance commit/status/hash matched verifier baseline; pre/post submodule state was identical and no user changes were removed or staged. Release Web build remains blocked by an upstream `wasm-opt` validation pass omitting thread support for atomic SDL2/FAudio instructions; issue 004 accepts Debug artifacts, while Release packaging must resolve this downstream. Bash and PowerShell validators/builders passed syntax or semantic parity review, including independent per-pattern artifact checks that permit multiple fingerprint generations but reject every missing category.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `scripts: build MonoGame via build/Build.csproj and stage artifacts`

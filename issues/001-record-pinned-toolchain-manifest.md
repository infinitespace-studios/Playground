# Record pinned toolchain manifest

**Type:** AFK
**Status:** Done
**Blocked by:** None
**PRD references:** 2.3, 2.6, 11.2, 24 (Phase 0)
**User stories:** US8
**Triage:** needs-triage

## Context

The playground repository must be reproducible: any contributor or CI worker must be able to build the exact same MonoGame revision and toolchain. PRD section 2.6 requires a versioned toolchain manifest pinning the MonoGame commit SHA and protected ref, .NET SDK/runtime version, .NET WebAssembly workload, Emscripten SDK version, Rust/Tauri CLI (or Electron) version, Node.js and package manager version, and frontend lockfile identity. PRD section 2.3 requires the selected MonoGame commit SHA to be recorded during Phase 0. The repository currently has `external/MonoGame` checked out as a submodule (see `.gitmodules`) but no manifest file exists yet. Read `external/MonoGame/AGENTS.md` before touching anything under `external/MonoGame`; this issue only *reads* the submodule's current commit, it does not modify submodule content.

## What to build

Create a single versioned JSON manifest file at `docs/toolchain-manifest.json` that records the exact pinned MonoGame commit SHA (read via `git -C external/MonoGame rev-parse HEAD`), the MonoGame branch/protected ref (`feature/openglnative`), the .NET SDK version required to build both MonoGame and the playground, the .NET WebAssembly workload identifier, the Emscripten SDK version/tag expected in `../emsdk`, and placeholders (with explicit `"pending"` values and a comment field) for the desktop shell toolchain (Tauri CLI + Rust, or Electron) and Node.js/package manager versions that later issues will fill in. Add a `schemaVersion` field.

## Scope

### In scope

- Creating `docs/toolchain-manifest.json` with a documented JSON schema (top-level `schemaVersion`, `monogame`, `dotnet`, `emscripten`, `frontend`, `shell` objects)
- Recording the exact current `external/MonoGame` commit SHA and branch name
- Documenting the manifest's purpose and update procedure in `docs/build.md` (create this file if absent)
- Adding a short `docs/README.md` index entry only if `docs/README.md` already exists (do not create a new docs index file)

### Out of scope

- Building MonoGame or the playground (issues 4+)
- Installing or pinning the Tauri/Electron toolchain (issue 6+)
- Writing CI workflows (not covered by the 56-issue breakdown)
- Modifying `.gitmodules` or `external/MonoGame` content

## Implementation guidance

1. Determine the pinned commit: `git -C external/MonoGame rev-parse HEAD` and `git -C external/MonoGame rev-parse --abbrev-ref HEAD` (expect `eb687a0ec226b56f0b2b2a1a01ad811a841fc116` on branch/ref related to `feature/openglnative`; use whatever the checkout actually reports).
2. Determine the .NET SDK version required by the pinned MonoGame revision from its checked-in `global.json` files. Record that required version even if it is not installed locally. Also inspect `dotnet --version` and `dotnet --list-sdks`; document any mismatch as a local setup prerequisite rather than changing the pin to an incompatible installed version.
3. Determine the .NET WebAssembly workload state with `dotnet workload list`; record whether `wasm-tools` / `wasm-experimental` (or the workload name used by this MonoGame revision) is installed.
4. Inspect `external/MonoGame/build/Build.csproj` and any `global.json` under `external/MonoGame` (e.g. `external/MonoGame/Example/global.json`) to confirm the SDK version MonoGame itself expects; the manifest's `dotnet.sdkVersion` must match the checked-in requirement. Do not substitute a newer locally installed SDK merely to make resolution succeed.
5. Create `docs/toolchain-manifest.json` with this shape (fill real values, do not leave TODO markers for fields you can determine now):
```json
{
  "schemaVersion": 1,
  "monogame": {
    "repository": "https://github.com/infinitespace-studios/MonoGame.git",
    "branch": "feature/openglnative",
    "commitSha": "<exact sha from step 1>",
    "protectedRef": "<branch or tag that must contain commitSha>"
  },
  "dotnet": {
    "sdkVersion": "<exact version from step 2>",
    "wasmWorkload": "<workload id, or null with a comment if not yet installed>"
  },
  "emscripten": {
    "expectedPath": "../emsdk",
    "version": "pending-issue-3"
  },
  "shell": {
    "kind": "pending-issue-6",
    "tauriCli": null,
    "rustToolchain": null
  },
  "frontend": {
    "nodeVersion": "pending-issue-6",
    "packageManager": "pending-issue-6"
  }
}
```
6. Create `docs/build.md` describing what the manifest is, where it lives, and the rule that CI/build scripts must verify it against the live environment before building (this verification is implemented by later issues, not this one).
7. Before reading the submodule, capture `git -C external/MonoGame status --short` as the shared-worktree baseline. Do not modify `external/MonoGame` in any way; after implementation, its status must match that baseline byte-for-byte. Pre-existing user changes are permitted and must not be reverted, staged, reformatted, or included in this issue.

## Acceptance criteria

- [ ] `docs/toolchain-manifest.json` exists, is valid JSON, and includes `schemaVersion`, `monogame.commitSha`, `monogame.branch`, `monogame.protectedRef`, `dotnet.sdkVersion`, `emscripten.expectedPath`
- [ ] The recorded `monogame.commitSha` exactly matches the output of `git -C external/MonoGame rev-parse HEAD` at the time the manifest was written
- [ ] `docs/build.md` exists and explains the manifest's purpose, location, and update procedure
- [ ] `git -C external/MonoGame status --short` is identical to the baseline captured before implementation; this issue introduces no new submodule changes
- [ ] Compared with the pre-implementation parent-worktree baseline, this issue changes only in-scope `docs/` files and issue 001's workflow metadata

## Verification

Run from the repository root:
```bash
python3 -c "import json; d=json.load(open('docs/toolchain-manifest.json')); assert d['monogame']['commitSha']; print('OK', d['monogame']['commitSha'])"
git -C external/MonoGame rev-parse HEAD
git -C external/MonoGame status --short
git status --short
```
The verifier must confirm: the JSON parses without error; the printed `commitSha` from the manifest matches the `git rev-parse HEAD` output exactly; current submodule status matches the implementer's recorded pre-implementation baseline exactly; and the issue-specific parent diff contains only in-scope `docs/` files plus issue 001 workflow metadata. Pre-existing parent or submodule changes must remain untouched. Record both SHA values, both submodule-status snapshots, and the issue-specific changed-file list as evidence.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent background verifier `f48eda4b-c30b-4ce7-9270-961a65eae56f`
- **Date:** 2026-08-25
- **Evidence:** Manifest parsed successfully and recorded `eb687a0ec226b56f0b2b2a1a01ad811a841fc116`, exactly matching `git -C external/MonoGame rev-parse HEAD`. Branch and protected ref matched `feature/openglnative`; required SDK matched `external/MonoGame/Example/global.json` at `9.0.112`; local `9.0.315` mismatch was documented without weakening the pin; `wasm-tools` and emsdk `3.1.56` were confirmed. Final submodule status matched the pre-implementation baseline byte-for-byte. Issue-specific files were limited to `docs/toolchain-manifest.json`, `docs/build.md`, and workflow metadata.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record pinned toolchain manifest`

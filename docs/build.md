# Reproducible build toolchain

The versioned toolchain manifest at
[`docs/toolchain-manifest.json`](toolchain-manifest.json) is the source of truth
for the MonoGame revision and tools used to build the playground. It prevents a
build from silently following a branch head or using whatever tool versions
happen to be installed.

## Manifest schema

`schemaVersion` identifies the manifest format. The remaining top-level objects
have these roles:

| Object | Contents |
| --- | --- |
| `monogame` | Repository, branch, immutable commit SHA, and protected ref that must contain the commit |
| `dotnet` | Required .NET SDK and WebAssembly workload identifier |
| `emscripten` | Repository-relative sibling path and expected Emscripten SDK tag |
| `shell` | Desktop-shell selection and its tool versions |
| `frontend` | Node.js, package-manager, and lockfile identity |

The `shell` and `frontend` values explicitly marked `pending-issue-6` are
placeholders. Issue 006 will replace them after selecting the desktop and
frontend toolchains.

## Current local prerequisite

The pinned MonoGame checkout's `Example/global.json` requires .NET SDK
`9.0.112`, so that is the manifest pin. This machine currently resolves
`dotnet --version` to `9.0.315` and does not have `9.0.112` installed. Install
SDK `9.0.112` before building; do not replace the manifest pin with the
incompatible installed SDK. The `wasm-tools` workload is present in the current
SDK installation, but build validation must verify or restore it for the pinned
SDK.

The expected Emscripten checkout is `../emsdk`, relative to the repository root,
at tag `3.1.56`. On macOS or Linux, initialize it in the shell that will run the
MonoGame build:

```bash
source ../emsdk/emsdk_env.sh
```

## Updating the manifest

Update the manifest only as part of an intentional, reviewed toolchain change:

1. Read `external/MonoGame/AGENTS.md`, then record the checkout with
   `git -C external/MonoGame rev-parse HEAD` and
   `git -C external/MonoGame rev-parse --abbrev-ref HEAD`.
2. Confirm the commit is reachable from the recorded protected ref.
3. Read MonoGame's checked-in `global.json` files and record their required SDK;
   inspect `dotnet --version`, `dotnet --list-sdks`, and
   `dotnet workload list` without substituting an incompatible local SDK.
4. Record the expected `../emsdk` tag. Once selected, also record exact shell,
   Rust or Electron, Node.js, package-manager, and lockfile values.
5. Increment `schemaVersion` when changing the manifest structure, keep the file
   valid JSON, and review the diff with the associated lockfiles.

CI and build scripts must verify every non-pending manifest value against the
live environment before building. In particular, they must reject the wrong
MonoGame SHA, SDK, workload, or Emscripten version. Automated verification and
restoration are implemented by later issues; builds must not silently update
the submodule or relax a version pin.

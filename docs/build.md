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
| `compiler` | Compiler-only SDK, target, Roslyn, WebAssembly SDK pack, and reference-pack pins |
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

The existing browser compiler is a deliberately scoped exception: its restore,
reference collection, and AppBundle build use `compiler.sdkVersion` `9.0.315`,
`Microsoft.NET.Sdk.WebAssembly.Pack` `9.0.19`, and
`Microsoft.NETCore.App.Ref` `9.0.19`. This does not repin MonoGame or the global
playground toolchain. The collector resolves that exact reference pack from
`src/compiler/obj/project.assets.json` and rejects any SDK or pack drift.
`src/compiler/global.json` pins that SDK with roll-forward disabled. Run compiler
SDK commands with `src/compiler` as the working directory so .NET discovers the
scoped pin:

```bash
cd src/compiler
dotnet build --configuration Release
```

The project also rejects a mismatched `NETCoreSdkVersion`, so a build launched
from another working directory cannot silently use a different installed SDK.

## Committed compiler references

`src/compiler/References/` contains the raw reference DLLs identified by
[`docs/reference-allowlist.json`](reference-allowlist.json). They are committed
build inputs rather than an ignored cache so a clean clone can build the
compiler without rebuilding MonoGame. Run
`scripts/collect-compiler-references.sh` (or its PowerShell counterpart) only
when intentionally refreshing them from the exact restored compiler reference
pack and the pinned existing MonoGame Native Release output. Normal compiler
builds run the collector in verification mode and fail on missing, extra, or
hash-drifted inputs; they never rebuild MonoGame.
Verification independently reads each destination PE identity and compares its
simple name, assembly version, public key token, hash, and MonoGame
informational version where applicable.

The collector's `--manifest` and `--references-dir` overrides are restricted to
non-destructive verification fixtures. On Windows the PowerShell wrapper tries,
in order, Python 3 as `python3`, `py -3`, and `python`, verifies the interpreter
major version, and otherwise reports the Python 3 prerequisite.

`scripts/ReferenceIdentity/bin/` and `scripts/ReferenceIdentity/obj/` are normal
generated .NET build outputs and remain excluded by the repository's existing
case-insensitive `bin`/`obj` ignore rules.

## Emscripten environment

The expected Emscripten checkout is `../emsdk`, relative to the repository root,
at tag `3.1.56`. Before any MonoGame native or WebAssembly build on macOS or
Linux, initialize it in the same shell that will run the build:

```bash
source ../emsdk/emsdk_env.sh
```

This command is mandatory and must be run from the repository root. It must be
sourced rather than executed as a child process, because `emsdk_env.sh` sets
environment variables in the calling shell. Use `scripts/check-emsdk-env.sh`
(or its PowerShell twin, `scripts/check-emsdk-env.ps1`) to confirm that the
environment is active before building.

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

# Build runtime/reference assembly allowlist

**Type:** AFK
**Status:** Done
**Blocked by:** [017-compile-valid-csharp-library-to-dll-pdb.md](017-compile-valid-csharp-library-to-dll-pdb.md)
**PRD references:** 12.3, 9.6
**User stories:** US1, US9
**Triage:** needs-triage

## Context

PRD section 12.3 requires a controlled, versioned allowlist of metadata references generated from the pinned runtime and MonoGame revision, explicitly covering core runtime types, `System.Runtime`, `System.Console`, `System.Collections`, `System.Linq`, `System.Numerics`/`System.Numerics.Vectors`, `System.Threading`/`System.Threading.Tasks`, `System.Runtime.InteropServices`, `System.Memory`, `System.Diagnostics.Debug`, `netstandard`, and the MonoGame Native profile. Capabilities are distinct from physical assembly identities: `System.Runtime` supplies core runtime types in the .NET 9 reference pack, and `MonoGame.Framework.Native.csproj` emits the assembly identity and file `MonoGame.Framework`. The MonoGame reference must come from the pinned submodule revision, not an unrelated NuGet package. Section 9.6 requires the reference allowlist and preview runtime assemblies to be generated from the same toolchain manifest, and CI must fail if their assembly identities drift. This issue replaces issue 17's minimal hard-coded reference set with the real, documented allowlist.

## What to build

Create a versioned reference-assembly allowlist manifest (`docs/reference-allowlist.json`) enumerating every required capability and actual assembly identity by name and version, a script (`scripts/collect-compiler-references.sh`/`.ps1`) that locates the actual `.dll` files for each entry from the exact restored .NET reference pack and the MonoGame build output, copies them into `src/compiler/References/`, and updates `CompilationService.Compile` to load its `MetadataReference` list from embedded bytes instead of the ad-hoc set used in issue 17.

## Scope

### In scope

- `docs/reference-allowlist.json`: the authoritative list of required assembly names
- `scripts/collect-compiler-references.sh` / `.ps1`: locates and copies the actual reference DLLs into `src/compiler/References/`
- Updating `CompilationService`/`CompilerExports` to build its reference list from the collected DLLs embedded as manifest resources rather than browser-incompatible host paths
- A check that fails loudly if any required assembly is missing after collection

### Out of scope

- The supported-API *policy* document (allowed/prohibited namespaces, analyzers) — that is issue 31, which builds on this allowlist
- Sourcing MonoGame's reference assembly from any unrelated NuGet package (explicitly prohibited by the PRD — the MonoGame reference must come from `artifacts/monogame/` or the submodule build output)

## Implementation guidance

1. Create `docs/reference-allowlist.json`:
```json
{
  "schemaVersion": 1,
  "monogameCommitSha": "<same value as docs/toolchain-manifest.json>",
  "assemblies": [
    "System.Runtime", "System.Console", "System.Collections",
    "System.Linq", "System.Numerics", "System.Numerics.Vectors", "System.Threading",
    "System.Threading.Tasks", "System.Runtime.InteropServices", "System.Memory",
    "System.Diagnostics.Debug", "netstandard", "MonoGame.Framework"
  ]
}
```
   Record `core-runtime-types` and `MonoGame.Framework.Native` as capabilities on
   `System.Runtime` and `MonoGame.Framework` respectively; do not require invented
   `System.Private.CoreLib.dll` or `MonoGame.Framework.Native.dll` reference files.
2. `scripts/collect-compiler-references.sh`:
   - Resolve the exact `Microsoft.NETCore.App.Ref` version and package folder from the compiler's restored `project.assets.json`; do not guess relative to the `dotnet` executable.
   - For every .NET reference-pack entry, copy the matching `.dll` into `src/compiler/References/`.
   - For the MonoGame Native capability, copy the actual `MonoGame.Framework.dll` managed assembly produced by `MonoGame.Framework.Native.csproj` from the pinned submodule build output (or a product-staged raw-DLL artifact with equivalent provenance) — do not download it from NuGet.
   - After copying, verify every required name in `docs/reference-allowlist.json` has a corresponding `.dll` in `src/compiler/References/`; if any are missing, print the missing names and exit non-zero.
3. Update `CompilationService`/`CompilerExports` (from issue 17) to create metadata references from the collected DLLs' embedded bytes, replacing the browser-incompatible host-path approach and the ad-hoc reference set used to prove issue 17.
4. Re-run the issue 17 verification harness with the trivial `Foo` class to confirm compilation still succeeds using only the new reference set (this proves the allowlist is sufficient for basic compilation).
5. Additionally compile a small MonoGame-referencing sample (e.g. `using Microsoft.Xna.Framework; public class Foo : Game {}`) to prove the `MonoGame.Framework.Native` reference resolves correctly.

## Acceptance criteria

- [x] `docs/reference-allowlist.json` covers exactly the capabilities enumerated in PRD section 12.3 using actual, non-duplicated physical assembly identities
- [x] `scripts/collect-compiler-references.sh` populates `src/compiler/References/` with one `.dll` per required entry and exits non-zero listing any that are missing
- [x] The Native-profile `MonoGame.Framework.dll` reference originates from the pinned submodule build, not a NuGet package — confirmed by provenance and by checking there is no MonoGame NuGet `PackageReference` in `Playground.Compiler.csproj`
- [x] `CompilationService` compiles both a trivial non-MonoGame class and a class deriving from `Microsoft.Xna.Framework.Game` using only the references collected by this script

## Verification

```bash
bash scripts/collect-compiler-references.sh
ls src/compiler/References
grep -i PackageReference src/compiler/Playground.Compiler.csproj
cd src/compiler
dotnet build --configuration Release
```
Expect one `.dll` per physical entry in `docs/reference-allowlist.json`'s `assemblies`, and no MonoGame NuGet `PackageReference` in the project file. Then run the extended issue 17 harness with both the trivial class and the `Game`-deriving class and confirm both compile successfully. The verifier must list the actual files present and cross-check them one-by-one against `docs/reference-allowlist.json`.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

### Attempt 1

- **Verdict:** FAIL
- **Verifier:** Issue 019 Verifier (`13fc9d5b-326f-4853-8c5e-f90b7a40b699`)
- **Date:** 2026-08-27
- **Evidence:** All 13 checked-in references matched their declared .NET 9.0.19 or pinned MonoGame Native sources, the 14 PRD capabilities were covered, collection/negative tests/build/browser compilation passed, and the references were embedded exactly. However, verify mode trusted filename/hash without independently checking PE identity, and compiler SDK 9.0.315 was recorded but not selected by a scoped `global.json`.

### Attempt 2

- **Verdict:** PASS
- **Verifier:** Issue 019 Verifier (`13fc9d5b-326f-4853-8c5e-f90b7a40b699`)
- **Date:** 2026-08-27
- **Evidence:** Verify mode independently rejected wrong assembly name, version, token, hash, and MonoGame informational version even when fixture hashes were updated. `src/compiler/global.json` selected SDK 9.0.315 with roll-forward disabled while the global MonoGame pin remained 9.0.112; compiler and identity-tool assets resolved under SDK 9.0.315 and a missing-SDK fixture failed without rolling. Positive collection, all destructive-path/symlink/inventory/provenance negative cases, and a fresh scoped Release build passed with zero warnings/errors. The manifest contains 13 unique physical identities covering exactly 14 PRD capabilities. Twelve files are byte-identical to Microsoft.NETCore.App.Ref 9.0.19; `MonoGame.Framework` is byte-identical to the pinned Native Release output and reports informational version `3.8.3.1+eb687a0ec226b56f0b2b2a1a01ad811a841fc116`. Exactly 13 resources plus the manifest were embedded and runtime-validated. Trusted browser proof compiled trivial and `Game`-derived samples with zero diagnostics and valid DLL/PDB output in one runtime; issue 17/18 regressions and local-only loading passed. PowerShell was statically reviewed because it was unavailable in this environment.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `compiler: build versioned reference/runtime assembly allowlist`

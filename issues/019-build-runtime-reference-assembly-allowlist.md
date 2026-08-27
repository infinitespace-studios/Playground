# Build runtime/reference assembly allowlist

**Type:** AFK
**Status:** Ready
**Blocked by:** [017-compile-valid-csharp-library-to-dll-pdb.md](017-compile-valid-csharp-library-to-dll-pdb.md)
**PRD references:** 12.3, 9.6
**User stories:** US1, US9
**Triage:** needs-triage

## Context

PRD section 12.3 requires a controlled, versioned allowlist of metadata references generated from the pinned runtime and MonoGame revision, explicitly covering core runtime types, `System.Runtime`, `System.Console`, `System.Collections`, `System.Linq`, `System.Numerics`/`System.Numerics.Vectors`, `System.Threading`/`System.Threading.Tasks`, `System.Runtime.InteropServices`, `System.Memory`, `System.Diagnostics.Debug`, `netstandard`, and `MonoGame.Framework.Native`. The MonoGame reference must come from the pinned submodule revision, not an unrelated NuGet package. Section 9.6 requires the reference allowlist and preview runtime assemblies to be generated from the same toolchain manifest, and CI must fail if their assembly identities drift. This issue replaces issue 17's minimal hard-coded reference set with the real, documented allowlist.

## What to build

Create a versioned reference-assembly allowlist manifest (`docs/reference-allowlist.json`) enumerating every required assembly identity by name and version, a script (`scripts/collect-compiler-references.sh`/`.ps1`) that locates the actual `.dll` files for each entry from the installed browser-wasm SDK ref pack and the MonoGame build output (issue 4/5's `artifacts/monogame/`), copies them into `src/compiler/References/`, and updates `CompilationService.Compile` to load its `MetadataReference` list from these files instead of the ad-hoc set used in issue 17.

## Scope

### In scope

- `docs/reference-allowlist.json`: the authoritative list of required assembly names
- `scripts/collect-compiler-references.sh` / `.ps1`: locates and copies the actual reference DLLs into `src/compiler/References/`
- Updating `CompilationService`/`CompilerExports` to build its reference list from `src/compiler/References/*.dll` rather than hard-coded paths
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
  "requiredAssemblies": [
    "System.Private.CoreLib", "System.Runtime", "System.Console", "System.Collections",
    "System.Linq", "System.Numerics", "System.Numerics.Vectors", "System.Threading",
    "System.Threading.Tasks", "System.Runtime.InteropServices", "System.Memory",
    "System.Diagnostics.Debug", "netstandard", "MonoGame.Framework.Native"
  ]
}
```
2. `scripts/collect-compiler-references.sh`:
   - Locate the browser-wasm ref pack directory (typically under the .NET SDK's `packs/Microsoft.NETCore.App.Ref` or the browser-wasm-specific ref pack — find it with `find $(dirname $(which dotnet))/../packs -iname 'System.Runtime.dll' -path '*ref*' 2>/dev/null` or equivalent, adapting to the actual SDK layout discovered in this environment).
   - For every entry in `requiredAssemblies` except `MonoGame.Framework.Native`, copy the matching ref-pack `.dll` into `src/compiler/References/`.
   - For `MonoGame.Framework.Native`, copy the actual managed assembly produced by the MonoGame build in `artifacts/monogame/` (from issue 4/5's staged output) — do not download it from NuGet.
   - After copying, verify every required name in `docs/reference-allowlist.json` has a corresponding `.dll` in `src/compiler/References/`; if any are missing, print the missing names and exit non-zero.
3. Update `CompilationService`/`CompilerExports` (from issue 17) to enumerate `src/compiler/References/*.dll` and build `MetadataReference.CreateFromFile(path)` for each, replacing the ad-hoc reference set used to prove issue 17.
4. Re-run the issue 17 verification harness with the trivial `Foo` class to confirm compilation still succeeds using only the new reference set (this proves the allowlist is sufficient for basic compilation).
5. Additionally compile a small MonoGame-referencing sample (e.g. `using Microsoft.Xna.Framework; public class Foo : Game {}`) to prove the `MonoGame.Framework.Native` reference resolves correctly.

## Acceptance criteria

- [ ] `docs/reference-allowlist.json` lists exactly the assembly names enumerated in PRD section 12.3
- [ ] `scripts/collect-compiler-references.sh` populates `src/compiler/References/` with one `.dll` per required entry and exits non-zero listing any that are missing
- [ ] The `MonoGame.Framework.Native` reference file originates from `artifacts/monogame/` (the pinned submodule build), not a NuGet package — confirmed by checking there is no `PackageReference` for a MonoGame NuGet package in `Playground.Compiler.csproj`
- [ ] `CompilationService` compiles both a trivial non-MonoGame class and a class deriving from `Microsoft.Xna.Framework.Game` using only the references collected by this script

## Verification

```bash
bash scripts/collect-compiler-references.sh
ls src/compiler/References
grep -i PackageReference src/compiler/Playground.Compiler.csproj
```
Expect one `.dll` per entry in `docs/reference-allowlist.json`'s `requiredAssemblies`, and no MonoGame NuGet `PackageReference` in the project file. Then run the extended issue 17 harness with both the trivial class and the `Game`-deriving class and confirm both compile successfully. The verifier must list the actual files present and cross-check them one-by-one against `docs/reference-allowlist.json`.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `compiler: build versioned reference/runtime assembly allowlist`

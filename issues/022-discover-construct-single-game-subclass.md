# Discover/construct exactly one Game subclass

**Type:** AFK
**Status:** Done
**Blocked by:** [021-transfer-load-dll-and-portable-pdb.md](021-transfer-load-dll-and-portable-pdb.md)
**PRD references:** 13.1, 13.2
**User stories:** US1, US2
**Triage:** needs-triage

## Context

PRD section 13.1 requires the runner to load the compiled assembly, inspect its types, find concrete types deriving from `Microsoft.Xna.Framework.Game`, validate the result, and construct the game. Section 13.2 requires exactly one non-abstract `Game` subclass with a public parameterless constructor for the MVP; the class may be in any namespace and need not be named `Game1`. Validation failures must be returned as structured playground diagnostics displayed in the Problems panel before construction. This issue implements the discovery/validation logic on top of the assembly-loading proof from issue 21, for three cases: exactly one valid subclass, zero subclasses, and more than one subclass.

## What to build

Implement `GameRunner.cs` in `src/preview/` with a `DiscoverGameType(Assembly assembly)` method that reflects over the loaded assembly's types, finds concrete (non-abstract) classes deriving from `Microsoft.Xna.Framework.Game`, and returns either the single matching `Type` or a structured `PlaygroundDiagnostic` (per `src/shared/Protocol.md`'s diagnostics shape from issue 15) for the "no Game subclass", "multiple Game subclasses", or "missing public parameterless constructor" cases. Construct (but do not yet `Run()`) the discovered type via `Activator.CreateInstance` to prove construction succeeds.

## Scope

### In scope

- `src/preview/GameRunner.cs` with `DiscoverGameType` and `ConstructGame` methods
- Testing all three PRD 13.2 validation cases: zero subclasses, exactly one valid subclass, more than one subclass
- Testing the missing-public-parameterless-constructor case (e.g. a `Game` subclass with only a constructor taking arguments)
- Returning `PlaygroundDiagnostic` values (not exceptions) for every validation failure, matching the shape defined in issue 15's protocol

### Out of scope

- Calling `Run()` on the constructed game (issue 23)
- Rendering (issue 23)
- Wiring these diagnostics into the actual Problems panel UI (issue 48)

## Implementation guidance

1. `src/preview/GameRunner.cs`:
```csharp
using System.Reflection;

public static class GameRunner
{
    public static (Type? GameType, PlaygroundDiagnostic? Error) DiscoverGameType(Assembly assembly)
    {
        var candidates = assembly.GetTypes()
            .Where(t => t != typeof(Microsoft.Xna.Framework.Game) && t.IsClass && !t.IsAbstract && typeof(Microsoft.Xna.Framework.Game).IsAssignableFrom(t))
            .ToList();

        if (candidates.Count == 0)
            return (null, new PlaygroundDiagnostic("error", "PG0001_NO_GAME_SUBCLASS", "No concrete Game subclass was found. Define one class that inherits from Microsoft.Xna.Framework.Game.", "", 0, 0));

        if (candidates.Count > 1)
            return (null, new PlaygroundDiagnostic("error", "PG0002_MULTIPLE_GAME_SUBCLASSES", $"Multiple concrete Game subclasses were found: {string.Join(", ", candidates.Select(c => c.FullName))}. Exactly one is required.", "", 0, 0));

        var gameType = candidates[0];
        if (gameType.GetConstructor(Type.EmptyTypes) is null)
            return (null, new PlaygroundDiagnostic("error", "PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR", $"{gameType.FullName} must have a public parameterless constructor.", "", 0, 0));

        return (gameType, null);
    }

    public static Microsoft.Xna.Framework.Game ConstructGame(Type gameType)
        => (Microsoft.Xna.Framework.Game)Activator.CreateInstance(gameType)!;
}
```
   (Match `PlaygroundDiagnostic`'s exact field names/order to whatever was defined in `src/shared/Protocol.md`/`MessageContracts.ts` in issue 15; adjust the record shape above if it differs.)
2. Write three throwaway compiler inputs (using the issue 17 compile harness) to test each case:
   - Zero subclasses: `public class NotAGame {}`.
   - Exactly one valid subclass: `public class MyGame : Microsoft.Xna.Framework.Game {}` (with the MonoGame reference resolved via issue 19's allowlist).
   - Multiple subclasses: two classes both inheriting `Game` in the same compile.
   - Missing parameterless constructor: `public class MyGame : Microsoft.Xna.Framework.Game { public MyGame(int x) {} }`.
3. For each case, compile, load via issue 21's `LoadUserAssembly`, call `DiscoverGameType`, and assert the expected diagnostic code (`PG0001_NO_GAME_SUBCLASS`/`PG0002_MULTIPLE_GAME_SUBCLASSES`/`PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR`) or successful discovery.
4. For the successful case, call `ConstructGame` and confirm no exception is thrown and the returned object is assignable to `Microsoft.Xna.Framework.Game`.

## Acceptance criteria

- [x] Compiling a source file with zero `Game` subclasses and running `DiscoverGameType` returns diagnostic code `PG0001_NO_GAME_SUBCLASS` with a clear message
- [x] Compiling a source file with two `Game` subclasses returns diagnostic code `PG0002_MULTIPLE_GAME_SUBCLASSES` naming both discovered types
- [x] Compiling a `Game` subclass with only a parameterized constructor returns diagnostic code `PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR` naming the offending type
- [x] Compiling exactly one valid `Game` subclass with a public parameterless constructor returns the type successfully and `ConstructGame` instantiates it without throwing

## Verification

From the repository root, source the pinned toolchain with
`source ../emsdk/emsdk_env.sh`, then run
`npm --prefix src/frontend run test:protocol`,
`npm --prefix src/frontend run typecheck`,
`npm --prefix src/frontend run test:preview-native-artifacts`,
`npm --prefix src/frontend run test:stage-issue21-clean`,
`npm --prefix src/frontend run test:stage-preview-clean`,
`dotnet build src/compiler/Playground.Compiler.csproj --configuration Release`,
`dotnet build src/preview/Playground.Preview.csproj --configuration Release`,
`npm --prefix src/frontend run build`,
`node scripts/inspect-preview-wasm.mjs`, and
`cd src/desktop && npx --yes @tauri-apps/cli@2.11.4 build`.
Directly launch the packaged Release executable with
`MONOGAME_ISSUE022_PROOF=1` and capture `ISSUE022_REPORT`. The report must show
the four required real compiler → transferable binary → fresh preview →
`Assembly.Load` cases (plus the lifecycle edge cases), exact diagnostic IDs and
global locations for the three failures, ordinal names for both multiple
candidates, the constructed `ValidCase.BrowserGame` assignable to `Game`, one
compiler runtime, one fresh preview per case, explicit idempotent teardowns,
detached binary senders, portable-PDB load proofs, top-level rendered frames,
and zero unexpected errors or external resources. Keep the process alive
during the report delay and independently verify it has no external sockets
with `lsof`.

The loaded preview lifecycle is single-load. Discovery and construction are cached and idempotent within that load; validation/construction failure taints the mutated preview, and the host destroys each case iframe. A successful constructed `Game` remains strongly retained for issue 23 and is released only with preview teardown.

The pinned Native-profile `MonoGame.Framework` constructor initializes its SDL-backed platform. Therefore the Release preview links the already-verified browser `mgruntime`, SDL, and FAudio archives; managed code remains interpreter-only and `WasmEnableThreads=false`. Merely loading the managed framework without those native archives is not a valid construction proof.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

### Independent verification — 2026-08-27

- **Verdict:** **FAIL**
- **Verifier:** GitHub Copilot CLI (independent verifier)
- **Date:** 2026-08-27
- **Evidence directory:** `/Users/dean/.copilot/session-state/2e0cf413-640e-4fbe-81a7-170cd90d7218/files/issue022-verification/`
- **Documented commands:** the 28 issue-21 protocol tests, TypeScript typecheck, clean absent-`bin`/`obj` compiler+preview staging, explicit compiler/preview Release builds, and Tauri Release package build passed. The preview build emitted three warnings: unresolved `sched_get_priority_max`/`sched_get_priority_min` and Emscripten JS-library warnings (`frontend-documented-verification.txt`, `preview-release-build.txt`, `compiler-release-build.txt`, `tauri-release-build.txt`).
- **Packaged acceptance failure:** a direct `MONOGAME_ISSUE022_PROOF=1` packaged launch produced only a failure report: the top-level runtime never rendered (`renderedFramesObserved: 0`). Consequently none of the four live compiler/preview cases ran in this verification, including the required personal Alpha/Zulu rerun. External `lsof` during the wait found no sockets. Window-bounds automation was unavailable because System Events lacked assistive access (`packaged-proof.log`, `lsof-during-proof.txt`, `window-bounds.txt`).
- **Native/runtime failure:** `WasmEnableThreads=false` conflicts with explicit `WasmOptConfigurationFlags=--enable-threads`; the actual wasm-opt invocation contains `--enable-threads`. Linking uses `--allow-undefined`, and the supplied SDL/FAudio archives reference pthread APIs and the two unresolved scheduler APIs. The three archives are ignored, untracked local products with no repository-recorded hashes or reproducible provenance; a clean clone cannot satisfy the project’s native-artifact existence gate after only the prescribed repository build. `docs/toolchain-manifest.json` still describes issue-20 settings but omits the now-true native build, archive identities/hashes, undefined-symbol policy, and thread-feature override (`native-archives.txt`, `native-provenance-tracking.txt`, `native-symbols-features.txt`, `runtime-properties-and-manifest.txt`).
- **Runner/lifecycle gaps:** exact pinned-`Game` assignability, deterministic names, bounded global diagnostics, `ReflectionTypeLoadException` sanitization, locking, caching, and strong retention are present. However, `TargetInvocationException` classifies every constructor inner failure as expected, including unexpected/fatal failures; `Dispose` marks the runner disposed before `Game.Dispose`, does not clear the retained game in `finally`, and has no boundary mapping if disposal throws. No teardown path explicitly calls it. Public/non-generic visibility is additionally folded into `PG0003` although PRD 13.2 specifies a public parameterless constructor, not public type visibility.
- **Coverage/protocol gaps:** shared response validation does validate diagnostic schema, and discovery failures correctly use normative load-phase `PREVIEW_LOAD_FAILED`. The existing tests contain no issue-22 coverage for malformed/repeated/concurrent discovery, constructor throws, implicit/nested/generic/visibility cases, or disposal. Construction errors occur inside `preview.load.response` as `PREVIEW_START_FAILED`, while unexpected post-load managed errors are broadly remapped to `PREVIEW_LOAD_FAILED`; these phase/state semantics are not tested.
- **Proof review:** the four configured inputs are genuine Roslyn source requests over issue-21 private ports, relevant cases derive the pinned MonoGame type, and each case creates/removes a fresh preview with transferable DLL/PDB buffers. No Base64/precompiled substitution or query/user-spoofable top-level proof activation was found. The current failed run cannot validate their observed outputs. The implementer also created untracked repository evidence under `files/issue022/`; it was preserved and must be cleaned or excluded before commit (`repository-issue022-evidence.txt`).
- **Required fixes:** make the direct packaged proof reliably reach and report all four cases with frames; use a reproducible, hash-pinned native artifact flow available to a clean clone; remove or justify the thread-feature contradiction and eliminate/strictly account for undefined native symbols; update the toolchain manifest; classify constructor/disposal failures without swallowing unexpected/fatal errors and guarantee reference cleanup; add focused issue-22 lifecycle/concurrency/malformed/constructor/disposal tests and reconcile type-visibility and construction-phase semantics with the PRD/protocol.
- **Hygiene:** `git diff --check` passed; generated outputs remain ignored/untracked. Recursive `external/MonoGame` HEAD, submodule statuses, working-tree records, and changed/untracked content hashes are exactly identical before and after verification. No external file was edited, built, cleaned, reset, stashed, or reverted (`external-pre-state.txt`, `external-post-state.txt`, `external-state-comparison.txt`).

### Remediation note — 2026-08-27

The FAIL above is intentionally preserved pending another independent
verification. Remediation now stages the three Release/Emscripten archives from
the prescribed MonoGame build output, binds their source/configuration/SHA-256/
size/toolchain provenance in the manifest, rejects missing/tampered/extra
staged inputs, and links with `WasmAllowUndefinedSymbols=false`. Product-owned
Emscripten scheduler shims remove the linker warnings. Final-wasm inspection
observes atomic instructions from the static inputs but one **unshared** memory,
no worker assets or constructors, and both scheduler imports resolved by the
generated shim definitions; `.NET` threading remains disabled.

The runner no longer requires public type visibility. It distinguishes
load/discovery diagnostics from sanitized constructor failures, rethrows fatal
constructor causes, caches competing construction calls, and explicitly
retains then tears down the game. Teardown clears the reference before calling
user disposal, maps nonfatal disposal failure to `PREVIEW_STOP_FAILED`, and is
idempotent. Browser coverage now includes the four required cases plus implicit
construction, internal/public/private nested types, open generic, abstract,
constructor failure/recovery, before-load rejection, competing calls, and
successful/failing repeated teardown.

A fresh headless Chromium supplemental run and the final direct packaged `.app`
run each completed all 14 real Roslyn/WASM cases with 20 top-level renderer
frames, one compiler runtime, 14 fresh preview runtimes and teardowns, and empty
unexpected-error/external-resource channels. External `lsof` captured during
the successful packaged run found no IPv4/IPv6 sockets. Window enumeration was
unavailable in the current macOS session, so the retained window-bounded image
is the browser viewport supplemental screenshot. Evidence is under the
session-state `files/issue022-remediation/` directory.

### Independent re-verification — 2026-08-27

- **Verdict:** **PASS**
- **Verifier:** GitHub Copilot CLI (independent verifier)
- **Date:** 2026-08-27
- **Evidence directory:** `/Users/dean/.copilot/session-state/2e0cf413-640e-4fbe-81a7-170cd90d7218/files/issue022-reverification/`
- **Documented verification:** after sourcing pinned Emscripten 3.1.56, all 28 protocol tests, typecheck, native missing/tampered/extra regression, both absent-`bin`/`obj` staging regressions, compiler and preview Release builds, frontend production build, final-wasm inspection, and exact Tauri 2.11.4 Release build passed. The remediated native-linked preview build emitted zero scheduler/undefined-symbol warnings (`documented-validation.log`, `tauri-release-build.log`).
- **Native provenance/fail-closed behavior:** all three product-staged archives are byte-identical to the pinned submodule build outputs and match committed sizes/SHA-256 values. The prescribed clean-clone script validates the submodule/toolchain, runs MonoGame's build, stages Release/Emscripten outputs with provenance, and exact verification precedes every preview build. Independent stale-provenance rejection passed. A deliberate staged-archive mutation made an otherwise cached `dotnet build --no-restore` fail before linking; restoring the original bytes restored a successful build. No submodule rebuild was performed (`native-provenance-coherence.txt`, `stale-provenance-test.log`, `cached-build-tamper-test.log`, `cached-build-restored.log`).
- **Final native module:** strict `WasmAllowUndefinedSymbols=false` linking completed without undefined-symbol warnings. Inspection found one unshared memory, no worker files or `Worker` constructors, and no pthread imports. The static archives contain atomic instructions, so Binaryen reports the threads proposal and requires `--enable-threads` to validate its input; this does not enable .NET threads, shared memory, or workers. Both scheduler imports are backed by generated JS definitions with exact Emscripten 3.1.56 `int(int)` semantics: policies `SCHED_FIFO`/`SCHED_RR` return 99/1 and all others return 0, matching upstream behavior without an errno side effect (`final-wasm-inspection.json`, `wasm-import-inventory.json`, `runtime-properties in documented-validation.log`).
- **Runner/protocol review:** candidate selection is the exact concrete subclass rule against the pinned `Game` identity, without a public-type restriction. Public implicit/explicit parameterless constructors work for public, internal, and nested types; abstract/base-only and open-generic cases produce the correct bounded, sanitized global diagnostics. Ordinal names, including `Alpha.FirstGame` before `Zulu.SecondGame`, are deterministic. Reflection enumeration failures are sanitized. Constructor causes are unwrapped, nonfatal failures become sanitized `PREVIEW_START_FAILED`, fatal causes escape, and discovery remains `PREVIEW_LOAD_FAILED`. Locking/caching yields one construction attempt. Teardown precedes frame removal, exchanges/clears the retained reference before disposal, maps nonfatal failure to sanitized `PREVIEW_STOP_FAILED`, permits fatal escape, and is exactly-once/idempotent.
- **Live proof:** the direct packaged `.app` proof personally executed 14 genuine Roslyn compile → transferable private-port DLL/PDB → fresh preview → `Assembly.Load` cases. It observed one compiler runtime, 14 preview runtimes, 14 explicit double-call teardown proofs, one construction attempt per constructible case, matching PE/PDB identities, detached senders, 20 top-level frames, and empty unexpected-error/external-resource channels. Required outcomes were exact PG0001, PG0002 with both ordinal names, PG0003 naming `ConstructorCase.NeedsArgumentGame`, and constructed/assignable `ValidCase.BrowserGame`. Constructor failure tainted and tore down its preview; the next fresh preview succeeded. Before-load, malformed endpoint, competing/repeated operation, constructor, and disposal behavior are covered by the protocol suite and live cases (`packaged-proof.log`, `packaged-report.json`, `packaged-report-validation.txt`).
- **Runtime/security/hygiene:** external `lsof` during the packaged proof found no IPv4/IPv6 sockets. Proof commands remain environment-gated and normal defaults inert; iframe proof bootstrap is restricted to the expected parent/origin. The optional remediation screenshot was inspected and is strictly the 1280×800 application browser viewport with no unrelated content. Repository-local `files/` is absent; generated/native/package outputs are ignored and no generated output is tracked; `git diff --check` passed. Recursive `external/MonoGame` HEAD, nested submodules, working-tree records, and changed/untracked content hashes are exactly identical before and after verification (`lsof-during-proof.txt`, `screenshot-inspection.txt`, `final-hygiene.txt`, `external-state-comparison.txt`).

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: discover and construct exactly one Game subclass`

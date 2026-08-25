# Boot persistent Roslyn WASM compiler context

**Type:** AFK
**Status:** Ready
**Blocked by:** [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md)
**PRD references:** 12.1, 12.4, 19
**User stories:** US1
**Triage:** needs-triage

## Context

PRD section 12.1 requires a compiler service using Roslyn's `CSharpCompilation` API. Section 12.4 requires compilation to not make editor input unresponsive for more than 100 ms at a time, and prefers a dedicated worker or separately scheduled WebView with a persistent .NET WebAssembly runtime that remains alive between runs. Critical feasibility question 7 (section 19) asks whether Roslyn can compile source inside browser WebAssembly at all — this is the foundational proof for the entire compiler pipeline (issues 17+). Nothing under `src/compiler/` exists yet; this issue creates the project and proves the WASM host boots and Roslyn's assemblies load, without yet compiling anything (that is issue 17).

## What to build

Create `src/compiler/Playground.Compiler.csproj` targeting `browser-wasm` (or the equivalent .NET WebAssembly project template used elsewhere in this MonoGame/.NET toolchain), reference the Roslyn `Microsoft.CodeAnalysis.CSharp` package, and prove that a minimal `[JSExport]`-annotated method can be called from JavaScript inside a persistent (not-per-call) .NET WebAssembly runtime instance, confirming the runtime boots without invoking `CSharpCompilation` yet.

## Scope

### In scope

- `src/compiler/Playground.Compiler.csproj` project scaffold targeting `browser-wasm`
- A minimal `CompilerExports.cs` with one `[JSExport] public static string Ping()` method proving the JS↔WASM interop boundary works
- A minimal HTML/JS harness (e.g. `src/compiler/wwwroot/index.html` or a page under `src/frontend/`) that boots the WASM runtime once and calls `Ping()` to prove persistence (call it twice across two button clicks and confirm the same runtime instance answers both, e.g. via a static counter that increments)

### Out of scope

- Actually compiling C# source with Roslyn (issue 17)
- Diagnostics (issue 18)
- Reference allowlist (issue 19)
- Wiring this into the real Tauri shell/toolbar (later Workbench issues)

## Implementation guidance

1. Scaffold the project: `dotnet new wasmbrowser -o src/compiler -n Playground.Compiler` (or the current .NET template name for a browser-wasm class library/app; verify with `dotnet new list` in this environment) — adapt if the installed SDK uses a different template id, but the end result must be a `browser-wasm` targeted project at `src/compiler/Playground.Compiler.csproj`.
2. Add the Roslyn package reference: `dotnet add src/compiler/Playground.Compiler.csproj package Microsoft.CodeAnalysis.CSharp`. Pin the version explicitly (record it in `docs/toolchain-manifest.json` under a new `compiler.roslynVersion` field) rather than using a floating range.
3. Create `src/compiler/CompilerExports.cs`:
```csharp
using System.Runtime.InteropServices.JavaScript;

public static partial class CompilerExports
{
    private static int _callCount;

    [JSExport]
    public static string Ping()
    {
        _callCount++;
        return $"compiler-context-alive call={_callCount}";
    }
}
```
4. Build for browser-wasm: `dotnet build src/compiler/Playground.Compiler.csproj -c Release`, then confirm the expected `.wasm`/`dotnet.js` output appears under `src/compiler/bin/Release/net*/browser-wasm/AppBundle` (path depends on SDK version — inspect actual output).
5. Add a minimal test harness page that loads the compiler's `dotnet.js` runtime, calls `Ping()` twice via two separate button clicks (not two calls in the same script tick), and displays both results, confirming the second call shows `call=2` proving the same runtime instance persisted between the two invocations rather than being recreated.
6. Record the working template/target framework moniker in `docs/toolchain-manifest.json` (`compiler.targetFramework`).

## Acceptance criteria

- [ ] `src/compiler/Playground.Compiler.csproj` builds successfully for `browser-wasm` in Release configuration
- [ ] `CompilerExports.Ping()` is callable from JavaScript after the WASM runtime boots
- [ ] Calling `Ping()` twice via two separate user-triggered events returns `call=1` then `call=2`, proving the runtime instance persists between calls rather than being recreated per call
- [ ] `docs/toolchain-manifest.json` records the exact Roslyn package version and target framework moniker used

## Verification

```bash
dotnet build src/compiler/Playground.Compiler.csproj -c Release
```
Expect a successful build with browser-wasm output present. Then load the test harness page in a browser (serve statically, e.g. `python3 -m http.server` from the output `AppBundle` directory — a plain dev server is acceptable for this isolated proof since it is not yet integrated into the Tauri shell), click the test button twice, and confirm the second result shows `call=2`. The verifier must capture the build output and a screenshot/description of both button-click results.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `compiler: boot persistent Roslyn WASM compiler context`

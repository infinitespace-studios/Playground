# Boot isolated Release preview runtime

**Type:** AFK
**Status:** Ready
**Blocked by:** [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md)
**PRD references:** 9.6, 16, 19
**User stories:** US3, US9
**Triage:** needs-triage

## Context

PRD section 9.6 requires the preview runtime to pin an exact .NET SDK/runtime version, keep WebAssembly interpreter support enabled for dynamically loaded IL, disable AOT-only execution for user assemblies, and either disable trimming or root the complete supported public API surface. Section 16 requires the preview to run in a sandboxed, less-trusted context distinct from the trusted top-level application. Critical feasibility question 16 (section 19) asks whether a Release-packaged build preserves the full supported dynamic-code API surface after trimming. This issue creates the preview project skeleton (`src/preview/`) and proves it boots in Release configuration inside an isolated iframe context within the Tauri shell, without yet loading any user assembly (that is issue 21) or applying the full sandbox policy (that is issue 33).

## What to build

Create `src/preview/Playground.Preview.csproj` targeting `browser-wasm`, referencing `MonoGame.Framework.Native` from the pinned submodule build (same artifact source as issue 19), configure Release publish settings with the interpreter enabled and trimming either disabled or rooted per PRD 9.6, and prove this project boots inside an iframe loaded by the Tauri shell (distinct from the top-level frontend's own origin/context) without yet running any game code.

## Scope

### In scope

- `src/preview/Playground.Preview.csproj` scaffold targeting `browser-wasm` in Release configuration
- Referencing the MonoGame native build artifacts from `artifacts/monogame/`
- Configuring `PublishTrimmed=false` (or equivalent rooting via a linker descriptor file) and confirming the interpreter (`WasmEnableThreads=false`, `RunAOTCompilation` appropriately set to keep interpreter fallback available for dynamically loaded assemblies) per PRD 9.6
- Loading this Release-published preview inside an `<iframe>` in the Tauri shell's frontend, proving it boots (e.g. a `[JSExport] Ping()` call succeeds) without a dev server

### Out of scope

- Loading/executing any user-compiled DLL (issue 21)
- Full sandbox/CSP/opaque-origin hardening (issue 33)
- Game discovery and running (issues 22-23)

## Implementation guidance

1. Scaffold: `dotnet new wasmbrowser -o src/preview -n Playground.Preview` (adapt template id to what is actually available, matching the approach used in issue 16 for the compiler project).
2. Add a project reference/file reference to the MonoGame native managed assembly from `artifacts/monogame/` (mirror how issue 19 references it for the compiler, but here it is a runtime dependency of the preview host itself, not just a Roslyn metadata reference — the preview needs the actual native Emscripten glue and `.wasm`, not just the managed reference DLL).
3. In `Playground.Preview.csproj`, explicitly set the properties required by PRD 9.6:
```xml
<PropertyGroup>
  <PublishTrimmed>false</PublishTrimmed>
  <WasmEnableThreads>false</WasmEnableThreads>
  <RunAOTCompilation>false</RunAOTCompilation>
</PropertyGroup>
```
   (If a future issue finds trimming must be enabled for size reasons, it must switch to a linker descriptor rooting the full supported API surface instead of just disabling trimming — but for this issue, disabling trimming is the simplest way to satisfy PRD 9.6 first, with a `TODO` comment noting issue 43 will revisit this for package-size measurement.)
4. `dotnet publish src/preview/Playground.Preview.csproj -c Release` and confirm output under `src/preview/bin/Release/net*/browser-wasm/publish/wwwroot` (or equivalent).
5. Add a minimal `PreviewExports.cs` with `[JSExport] public static string Ping() => "preview-context-alive";`.
6. In the Tauri frontend (`src/frontend/`), add an `<iframe>` element pointing at the published preview's `index.html`, confirm it loads and `Ping()` is callable from within the iframe's own JS context (not the top-level frontend's context — prove this is a genuinely separate `.NET` runtime instance by checking the iframe has its own `window` distinct from the parent, e.g. via `iframe.contentWindow !== window`).
7. Record the exact `RunAOTCompilation`/`PublishTrimmed`/interpreter settings used in `docs/toolchain-manifest.json` under a new `preview` section for later cross-referencing by issue 43.

## Acceptance criteria

- [ ] `src/preview/Playground.Preview.csproj` publishes successfully in Release configuration with `PublishTrimmed=false` (or a documented rooting descriptor), `WasmEnableThreads=false`, and `RunAOTCompilation=false`
- [ ] The published Release preview boots inside an `<iframe>` in the Tauri shell and answers a `Ping()` `[JSExport]` call
- [ ] The iframe's JS context is confirmed distinct from the top-level frontend's context (`iframe.contentWindow !== window`)
- [ ] `docs/toolchain-manifest.json` records the preview's trimming/AOT/interpreter configuration

## Verification

```bash
dotnet publish src/preview/Playground.Preview.csproj -c Release
```
Expect success. Then load the Tauri shell (issue 8's packaged build extended with the new iframe), open devtools, and from the top-level frontend's console evaluate `document.querySelector('iframe').contentWindow !== window` (expect `true`), then trigger the `Ping()` call from within the iframe's context (e.g. via a button inside the iframe page) and confirm `"preview-context-alive"` is returned/displayed. The verifier must capture the publish output and the devtools evidence.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: boot isolated Release preview runtime in iframe`

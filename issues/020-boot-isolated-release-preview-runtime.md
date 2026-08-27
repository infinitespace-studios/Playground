# Boot isolated Release preview runtime

**Type:** AFK
**Status:** Done
**Blocked by:** [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md)
**PRD references:** 9.6, 16, 19
**User stories:** US3, US9
**Triage:** needs-triage

## Context

PRD section 9.6 requires the preview runtime to pin an exact .NET SDK/runtime version, keep WebAssembly interpreter support enabled for dynamically loaded IL, disable AOT-only execution for user assemblies, and either disable trimming or root the complete supported public API surface. Section 16 requires the preview to run in a sandboxed, less-trusted context distinct from the trusted top-level application. Critical feasibility question 16 (section 19) asks whether a Release-packaged build preserves the full supported dynamic-code API surface after trimming. This issue creates the preview project skeleton (`src/preview/`) and proves it boots in Release configuration inside an isolated iframe context within the Tauri shell, without yet loading any user assembly (that is issue 21) or applying the full sandbox policy (that is issue 33).

## What to build

Create `src/preview/Playground.Preview.csproj` targeting `browser-wasm`, referencing the actual `MonoGame.Framework` assembly emitted by the `MonoGame.Framework.Native` source project and captured as issue 19's committed, product-owned raw reference, configure Release publish settings with the interpreter enabled and trimming either disabled or rooted per PRD 9.6, and prove this project boots inside an iframe loaded by the Tauri shell (distinct JS global, .NET runtime, and lifecycle context) without yet running any game code. This same-WebView iframe spike is not the final security boundary required by PRD section 16; issue 33 owns opaque-origin sandbox and CSP hardening.

## Scope

### In scope

- `src/preview/Playground.Preview.csproj` scaffold targeting `browser-wasm` in Release configuration
- Referencing only committed `src/compiler/References/MonoGame.Framework.dll`, whose issue 19 manifest provenance identifies the pinned Native Release build
- Configuring `PublishTrimmed=false` (or equivalent rooting via a linker descriptor file) and confirming the interpreter (`WasmEnableThreads=false`, `RunAOTCompilation` appropriately set to keep interpreter fallback available for dynamically loaded assemblies) per PRD 9.6
- Loading this Release-published preview inside an `<iframe>` in the Tauri shell's frontend, proving it boots (e.g. a `[JSExport] Ping()` call succeeds) without a dev server

### Out of scope

- Loading/executing any user-compiled DLL (issue 21)
- Full sandbox/CSP/opaque-origin hardening (issue 33)
- Game discovery and running (issues 22-23)

## Implementation guidance

1. Scaffold: `dotnet new wasmbrowser -o src/preview -n Playground.Preview` (adapt template id to what is actually available, matching the approach used in issue 16 for the compiler project).
2. Add a file reference to committed `src/compiler/References/MonoGame.Framework.dll` (mirror issue 19's identity/hash/provenance validation, but copy it as a runtime dependency rather than embedding it only as Roslyn metadata). The source project is `MonoGame.Framework.Native`; its actual assembly identity and filename are `MonoGame.Framework`.
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

- [x] `src/preview/Playground.Preview.csproj` publishes successfully in Release configuration with `PublishTrimmed=false` (or a documented rooting descriptor), `WasmEnableThreads=false`, and `RunAOTCompilation=false`
- [x] The published Release preview boots inside an `<iframe>` in the Tauri shell and answers a `Ping()` `[JSExport]` call
- [x] The iframe's JS context is confirmed distinct from the top-level frontend's context (`iframe.contentWindow !== window`)
- [x] `docs/toolchain-manifest.json` records the preview's trimming/AOT/interpreter configuration

## Verification

```bash
cd src/preview
dotnet publish Playground.Preview.csproj -c Release
```
Expect success. Then load the Tauri shell (issue 8's packaged build extended with the new iframe), open devtools, and from the top-level frontend's console evaluate `document.querySelector('iframe').contentWindow !== window` (expect `true`), then trigger the `Ping()` call from within the iframe's context (e.g. via a button inside the iframe page) and confirm `"preview-context-alive"` is returned/displayed. The verifier must capture the publish output and the devtools evidence.

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
- **Evidence directory:** `/Users/dean/.copilot/session-state/2e0cf413-640e-4fbe-81a7-170cd90d7218/files/issue020-verification/`
- **Documented command:** `dotnet publish src/preview/Playground.Preview.csproj -c Release` from the repository root passed. Root SDK resolution did **not** honor nested `src/preview/global.json`; it honored `/Users/dean/Documents/Sandbox/global.json`. Both resolve exact SDK `9.0.315`, so the command passes under the repository-area pin (`documented-publish.txt`, `sdk-resolution.txt`).
- **Clean-clone acceptance failure:** with only `src/preview/bin` and `src/preview/obj` moved aside and subsequently restored, `npm --prefix src/frontend run stage:preview` failed with `NETSDK1004` because `stage-preview.mjs` invokes `dotnet publish --no-restore` and therefore requires ignored `src/preview/obj/project.assets.json` (`clean-intermediates-stage-preview.txt`). Required fix: make staging restore-capable (remove `--no-restore` or perform an explicit restore) so a clean clone builds.
- **Configuration/assets:** `dotnet msbuild Playground.Preview.csproj -p:Configuration=Release -getProperty:NETCoreSdkVersion,TargetFramework,RuntimeIdentifier,Configuration,PublishTrimmed,PublishAot,RunAOTCompilation,WasmEnableThreads,WasmBuildNative,WasmMainJSPath,WasmGenerateAppBundle,WasmAppDir` confirmed SDK `9.0.315`, `net9.0`, `browser-wasm`, Release, trimming/AOT/native build/threads disabled and interpreter-compatible settings. Published assets contained no AOT/worker asset (`evaluated-properties.txt`, `published-assets-analysis.txt`).
- **MonoGame provenance:** `dotnet run --project scripts/ReferenceIdentity/ReferenceIdentity.csproj --configuration Release -- src/compiler/References/MonoGame.Framework.dll` and `shasum -a 256 ...` confirmed identity `MonoGame.Framework`, version `3.8.3.1`, null token, informational source commit and allowlisted source hash. Native is provenance profile only. One physical fingerprinted runtime asset was staged and its hash matched deterministic metadata (`monogame-source-identity.txt`, `allowlist-runtime-comparison.txt`, `preview-build.json`).
- **Stage/package checks:** stale staged output was removed; two stage runs produced identical file hashes; generated `bin`, `obj`, `.generated-public`, and `dist` files are ignored and none are tracked. No application external/CDN resource URL was found. Published path assumptions matched actual output (`stage-preview-success.txt`, `staged-determinism.diff`, `published-files.txt`, `external-reference-scan-focused.txt`).
- **Build commands passed:** `npm --prefix src/frontend run build`; `(cd src/frontend && npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2023,DOM src/main.ts)`; `(cd src/compiler && dotnet build Playground.Compiler.csproj --configuration Release)`; `(cd src/desktop/src-tauri && cargo check)`; `npm --prefix src/desktop run tauri -- build` (`frontend-build.txt`, `typescript-typecheck.txt`, `compiler-regression-build.txt`, `tauri-cargo-check.txt`, `tauri-release-build.txt`).
- **Packaged runtime:** launched `MONOGAME_ISSUE020_PROOF=1 'src/desktop/src-tauri/target/release/bundle/macos/MonoGame Playground.app/Contents/MacOS/monogame-playground'` directly, without a dev server. Auto-ready structured evidence proves one nested runtime, distinct parent/child windows and realm tokens, in-iframe `Ping()` returning `preview-context-alive`, verified MonoGame runtime asset, and no reported startup errors. `lsof -nP -a -p 41296 -i` showed no network sockets (`packaged-runtime.txt`, `packaged-runtime-sockets.txt`).
- **Runtime limitation:** the loginwindow session exposed no application window to System Events, so a trusted click and window-bounded capture were unavailable. Auto-Ping is sufficient for the iframe boot/Ping criterion, but trusted-click behavior and the issue-007 top-level render regression were not independently verified; the only checkpoint observed had top-level state `starting` and zero rendered frames (`window-bounds-attempt.txt`, `packaged-runtime.txt`).
- **Instrumentation review:** issue-020 Tauri commands are environment-gated/inert by default, add no plugin/capability or privilege, and stdout proof leakage is gated. Event/API usage is valid and duplicate final reports are guarded. The always-running 250 ms preview diagnostics interval is not cleaned up, though it is page-lifetime scoped. UI wording correctly describes lifecycle/runtime separation and defers security isolation to issue 33.
- **Repository hygiene:** `git diff --check` passed. All verifier-owned app processes were stopped, preview intermediates were restored, and recursive submodule state is byte-for-byte unchanged (`submodules-pre.txt`, `submodules-post-before-record.txt`). No `external/MonoGame` build or modification was performed.

### Remediation after independent verification FAIL

- Removed `--no-restore` from preview staging. `stage-preview.mjs` now performs one normal, fail-hard `dotnet publish` from `src/preview`, so SDK 9.0.315 is selected by the preview's scoped `global.json` and a clean checkout restores before publishing.
- Added `npm --prefix src/frontend run test:stage-preview-clean`, which temporarily moves existing preview `bin`/`obj` and staged preview output aside, proves staging recreates restore, publish, and staged assets from an absent state, then restores the original local intermediates even on failure.
- Updated the documented publish command to run from `src/preview`, avoiding accidental reliance on an ancestor SDK pin.
- Reviewed the remaining verifier notes. The page-lifetime diagnostics timer needs no cross-page cleanup, and the trusted-click/window-capture/top-level-animation limitations came from the locked loginwindow verification session rather than a staging defect; no privilege or security-boundary claim was expanded.
- Re-verification is required; the failed verdict above remains authoritative until an independent verifier records a later PASS.

### Independent re-verification — 2026-08-27

- **Verdict:** **PASS**
- **Verifier:** GitHub Copilot CLI (independent verifier)
- **Date:** 2026-08-27
- **Evidence directory:** `/Users/dean/.copilot/session-state/2e0cf413-640e-4fbe-81a7-170cd90d7218/files/issue020-reverification/`
- **Remediation verified:** `stage-preview.mjs` no longer passes `--no-restore`; it runs fail-hard `dotnet publish Playground.Preview.csproj --configuration Release` with `cwd=src/preview`. `npm --prefix src/frontend run test:stage-preview-clean` passed from absent preview `bin`, `obj`, and staged-preview destination, performed a real restore, published, staged required files, and restored byte-identical pre-existing intermediates (`test-stage-preview-clean.txt`, `intermediates-pre.sha256`, `intermediates-post.sha256`, `intermediates-restoration.diff`).
- **Test-script safety:** `test-stage-preview-clean.sh` uses three fixed repository-owned paths, no wildcard deletion, a collision-safe fail-closed backup `mkdir`, same-filesystem moves, and EXIT/INT/TERM restoration. Independent injected exit 42 and TERM/143 tests both restored byte-identical contents and left no backup directory (`test-stage-preview-clean-failure.txt`, `failure-restoration.diff`, `test-stage-preview-clean-signal.txt`, `signal-restoration.diff`). The fixed `rm -rf` calls remove only newly generated replacements immediately before restoring originals (or clean generated output that was initially absent); no broad path/glob or `external/MonoGame` risk was found. The Bash features used are compatible with the repository's macOS/Linux expectations.
- **Documented command:** `(cd src/preview && dotnet publish Playground.Preview.csproj -c Release)` passed. `dotnet --version` returned exactly `9.0.315`, and `dotnet --info` identified `src/preview/global.json`, proving the intended scoped SDK pin is honored (`documented-publish-preview-cwd.txt`).
- **Determinism/hygiene:** two normal `npm --prefix src/frontend run stage:preview` executions produced identical complete staged-file SHA-256 inventories and removed an injected stale file. Generated preview `bin`/`obj`, `.generated-public`, and frontend `dist` are ignored and none are tracked; no external application resource URL was found (`staging-run1.sha256`, `staging-run2.sha256`, `staging-determinism.diff`, `generated-assets-git.txt`, `external-refs.txt`).
- **Configuration/provenance:** evaluated Release properties remain SDK `9.0.315`, `net9.0/browser-wasm`, `PublishTrimmed=false`, `PublishAot=false`, `RunAOTCompilation=false`, `WasmEnableThreads=false`, and `WasmBuildNative=false`. The allowlisted product DLL remains managed identity `MonoGame.Framework` 3.8.3.1, null token, expected informational commit and SHA-256; Native remains source profile only. The publish manifest and filesystem contain exactly one MonoGame runtime assembly asset, its hash matches staged metadata, and there are no AOT/worker assets (`evaluated-properties.txt`, `monogame-identity.txt`, `published-assets.txt`).
- **Regression commands passed:** `npm --prefix src/frontend run build`; `(cd src/frontend && npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2023,DOM src/main.ts)`; `(cd src/compiler && dotnet build Playground.Compiler.csproj --configuration Release)`; `(cd src/desktop/src-tauri && cargo check)`; `git diff --check` (`frontend-build.txt`, `typescript-typecheck.txt`, `compiler-build.txt`, `cargo-check.txt`, `diff-check.txt`).
- **Runtime evidence validity:** the complete staged preview SHA-256 inventory is byte-for-byte identical to the previously packaged/runtime-tested output (`runtime-output-vs-prior.diff`). The remediation changes only restore behavior, the targeted safety test, package script, and documentation; it cannot alter packaged runtime bytes. Therefore the prior direct packaged-app auto-Ping evidence remains valid: one iframe-owned .NET runtime, distinct window/realm tokens, `preview-context-alive`, verified MonoGame asset, no startup errors, and no sockets. GUI-only trusted-click/capture and top-level animation observation remain unavailable in the loginwindow session and are not explicit acceptance requirements.
- **Final hygiene:** all verifier-created processes exited, all moved intermediates were restored, all pre-existing/untracked files were preserved, and recursive `external/MonoGame` submodule state is exactly unchanged (`submodules-pre.txt`, `submodules-post.txt`, `final-hygiene.txt`).

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: boot isolated Release preview runtime in iframe`

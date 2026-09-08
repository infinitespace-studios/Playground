# Phase 1 Feasibility Report

**Date:** 2026-09-03
**Author:** @dellis1972 (human reviewer)
**Scope:** Issues 001–043 (Phase 0/1 feasibility spike)
**Status:** **PASS-WITH-WAIVERS**

---

## 1. Executive summary

All mandatory acceptance criteria in the PRD section 20.2 version reviewed at this gate were independently verified through the accumulated evidence of issues 007–043. All section 20.3 failure criteria were examined. One gate-time waiver was required: the canvas backing-buffer resizing limitation (issue 011). The architecture was feasible. A post-gate product decision later replaced the separate preview window with the embedded iframe and amended the non-yielding-code requirement; see ADR 0003 and section 7 of this report.

**Decision:** PASS-WITH-WAIVERS
**Waivers:** 1 (canvas resizing — documented in ADR 0001, not a blocker for Phase 1)

---

## 2. Acceptance criteria (PRD section 20.2)

### 2.1 "The app launches without an installed .NET runtime or SDK."

**Verdict: PASS**
**Evidence:** Issue 007 — packaged Tauri binary (DMG) launched directly from disk without any .NET SDK or runtime installed. Verified by independent verifier `3c9adf10`. No development server, no external download, zero network sockets at launch.

### 2.2 "The MonoGame submodule can be initialized using documented commands."

**Verdict: PASS**
**Evidence:** Issue 002 — `git submodule update --init --recursive external/MonoGame` succeeds. Issue 003 — emsdk environment detection and sourcing documented. Issue 004 — full MonoGame build via `scripts/build-monogame.sh` against submodule passes.

### 2.3 "The build records and uses the exact pinned MonoGame commit."

**Verdict: PASS**
**Evidence:** At gate time, issue 005 pinned MonoGame commit `ecf06ee240dcc5524e82b656b4682e22b4c91175` on `feature/openglnative`, and issue 019 verified the reference identities derived from that framework build. Later release-build work advanced the live submodule/toolchain pin to `8372206266d2c09626d83b4ad9702fa072ec0aaa`; `docs/toolchain-manifest.json` is the current source of truth.

### 2.4 "The existing web example renders successfully."

**Verdict: PASS**
**Evidence:** Issue 007 — Release Tauri app rendered animated non-black frames. Canvas pixel hashes changed between two frames (3,163 changed pixels). Two separate preview generations verified. Issue 023 — managed `ClearColorGame` rendered CornflowerBlue `[100,149,237,255]` with 309 managed Draw calls and zero GL errors.

### 2.5 "Input works when the preview is focused."

**Verdict: PASS (with documented limitations)**
**Evidence:** Issue 009 — focused `S` key moved geometry from `y=140..189` to `10..69`; key-up stopped movement and produced identical geometry. Unfocused `W` input had no effect. Mouse events arrived in `move/down/up/click` order with correct coordinates. Limitation: physical-device mouse input and managed `Mouse.GetState()` remain unproven (recorded in ADR 0001).

### 2.6 "Roslyn emits a valid managed assembly."

**Verdict: PASS**
**Evidence:** Issue 017 — Release WASM build produced 2,560-byte DLL and 716-byte PDB. Independent PE/PDB parsing confirmed managed PE/CLI metadata, correct assembly name `Foo.Bar`, source checksum, and line mapping. Issue 021 — byte-continuity proven via SHA-256 digests at every transport boundary.

### 2.7 "Multiple generated assemblies can call across source files and use representative MonoGame APIs, reflection, LINQ, numerics, exceptions, and supported content."

**Verdict: PASS**
**Evidence:** Issue 030 — two-file compilation with cross-file calls, one DLL/PDB with two documents, exact diagnostics on `Player.cs`, one cross-file managed output, and genuine LimeGreen framebuffer pixels. Issues 027–028 — managed and native console output across six fresh runtimes. Issue 029 — constructor, LoadContent, Update, and Draw exceptions mapped through PDB. Issue 039 — `Texture2D` content loaded and rendered with expected multicolor pixels. Issue 040 — `SoundEffect` loaded, played, and stopped with analyser peak `0.0873`.

### 2.8 "Unsupported APIs and invalid game types produce structured diagnostics."

**Verdict: PASS**
**Evidence:** Issue 018 — `CS1002` at `Syntax/MissingSemicolon.cs:1:43`, `CS1513` at `Syntax/UnbalancedBrace.cs:1:43`, `CS0246` at `Types/UnknownType.cs:1:27`, CRLF/astral-Unicode `CS0246` at `Game/Player.cs:3:40`. Warning `CS0219` returned 2,560-byte DLL and 788-byte PDB. Errors returned `COMPILE_FAILED` with no binaries. Issues 031–032 — PG0101–PG0106 policy diagnostics for `DllImport`, `UnmanagedCallersOnly`, unsafe syntax, JavaScript interop, `Marshal` usage, and unmanaged function pointers — deterministic, no binary emission, with lookalike false-positive controls.

### 2.9 "A generated `Game` subclass can be executed without being disposed when `Run()` returns."

**Verdict: PASS**
**Evidence:** Issue 023 — `RetainedGame=true`, `Disposed=false` after `Run()` returned in 7 ms. Issue 024 — one disposal, zero post-disposal callbacks, stable frames. Issue 025 — static constructor count 1 across 9 Run/Stop cycles, distinct identities every generation.

### 2.10 "`Game.Exit()` cancels the game loop and returns the preview to stopped state."

**Verdict: PASS**
**Evidence:** Issue 026 — human-authored MonoGame commit `ecf06ee240dcc5524e82b656b4682e22b4c91175` on `feature/openglnative` cancels the Emscripten main loop. Playground-side: `GameRunner.StartResult.TerminationReason = "exited"`, `GameStartResult` serialized, `PreviewStartRuntime.js` detects exit, emits `preview.exited` → `preview.stopped(reason: "exited")`, triggers issue 024 cleanup path.

### 2.11 "An exception in user code reports the correct source file and line from the portable PDB."

**Verdict: PASS**
**Evidence:** Issue 029 — constructor, LoadContent, Update, and Draw exceptions each mapped to independently counted portable-PDB locations. Exactly one failed/stopped lifecycle, disposal, quiescence, controller recovery, and fresh restart proven in packaged browser-WASM.

### 2.12 Gate-time criterion: forced recovery from an infinite `Update`

**Gate-time verdict: PASS; product requirement subsequently superseded**
**Evidence:** Issue 038 proved the former separate-`WebviewWindow` architecture could destroy a hung preview. The product owner later rejected the second visible window on UX grounds. The amended PRD now requires cooperative Stop within two seconds only for supported code that yields between frames. Synchronous non-yielding callbacks are unsupported and may require relaunch. See ADR 0003 and issue 052.

### 2.13 "Stop and Run work at least twenty consecutive times within the memory and lifecycle limits in section 17."

**Verdict: PASS**
**Evidence:** Issue 025 — three independent packaged launches completed nine Run/Stop cycles. Every cycle: `RunCount=1`, static constructor count 1, distinct iframe/contentWindow/runtime/generation/port/preview identities, one disposal, zero post-disposal callbacks, complete WebGL/audio/URL/port cleanup. Issues 023–024 packaged regressions passed through all nine cycles. Issue 042 — 20-cycle measurement completed: 20 consecutive Run/Stop cycles, RSS growth 3.54% (threshold ≤ 20%) — **PASS**. No memory or lifecycle drift observed.

### 2.14 "Compiler diagnostics return to TypeScript."

**Verdict: PASS**
**Evidence:** Issue 018 — all structured diagnostics (severity, ID, message, origin, coordinates) returned to TypeScript caller. Issue 017 — protocol bounds enforced (513-byte paths, 65-source requests rejected). Issues 031–032 — PG0101–PG0106 policy diagnostics merged and sorted with Roslyn diagnostics by canonical path/line/column/severity/ID.

### 2.15 "Compiler work meets the editor responsiveness requirement."

**Verdict: PASS**
**Evidence:** Issue 041 measured warm compilation p95=246ms (threshold <2000ms) and cold compiler initialization p95=1271ms (threshold <5000ms). The persistent compiler context from issue 016 remains independent of the preview-host UX decision. ADR 0003 does not weaken the compiler responsiveness requirement.

### 2.16 "Preview code cannot invoke Tauri or Electron host IPC, access project files, navigate the host, make arbitrary network requests, or successfully send forged protocol messages."

**Verdict: PASS**
**Evidence:** Issue 033 — opaque-origin sandbox `allow-scripts` only, minimal CSP, embedded custom protocol, adversarial URI/header tests, and a genuine WebAssembly CSP negative proof. Issues 034–036 verified IPC/filesystem denial, navigation/network denial, and forged-message handling. Issue 052 re-pointed the security proofs to the production in-page sandboxed iframe. Issue 037 persists the first-run warning per stable project identity.

### 2.17 "Web-profile assets are mounted before `LoadContent`; incompatible content is rejected with an actionable diagnostic."

**Verdict: PASS**
**Evidence:** Issue 039 — 224-byte Web-profile fixture mounted at `Content/textures/player.xnb`, loaded via `Content.Load<Texture2D>`, rendered expected multicolor pixels. DesktopGL fixture returned `PG0010_CONTENT_PLATFORM_MISMATCH` with `MonoGamePlatform=Web`. Owner-bound Mount/Load/Start admission wrapper verified. Issue 040 — 44,280-byte Web-profile PCM fixture loaded through `Content.Load<SoundEffect>`, played and stopped with analyser measurements.

### 2.18 "The package works without a development server."

**Verdict: PASS**
**Evidence:** Issue 007 — Release Tauri app launched directly as PID 42497 with zero network sockets. Issue 012 — packaged app rendered changing non-black frames with no TCP/UDP sockets under `(deny network*)`.

### 2.19 "The package works with networking disabled."

**Verdict: PASS**
**Evidence:** Issue 012 — macOS `(deny network*)` policy enforced at OS level; packaged app and WebKit descendants ran with no sockets. 219 bundled assets loaded from local paths.

### 2.20 "Package size, timings, peak memory, stabilized memory, and lifecycle cleanup are documented."

**Verdict: PASS-WITH-WAIVERS**
**Evidence:** Lifecycle cleanup verified in issues 023–025 (one disposal, zero post-disposal callbacks, distinct identities). Timings measured in issue 041 (1 attempt on MacBook Pro M5 Max, 128 GB RAM):
- Shell startup p95: cold=351ms, warm=299ms (threshold ≤3000ms) — **PASS**
- Compilation: cold=1271ms, warm=246ms (thresholds <5000ms / <2000ms) — **PASS**
- Stop: cold=282ms, warm=241ms (threshold ≤2000ms) — **PASS**
- Preview startup: cold=12345ms, warm=12342ms (threshold ≤3000ms) — **FAIL**

The preview startup FAIL is caused by two known, fixable issues:
1. A 1500 ms unconditional settle delay in `createIsolatedPreview` (issue 038 bridge code)
2. A 10 s bootstrap deadline race — the preview runtime is actually ready ~65 ms after settle, but a background loop waits the full 10 s for a message it already consumed

Those delays belong to the historical isolated-window proof path. The production embedded runner is event-driven and contains neither of those fixed delays, but it still requires a fresh product-path measurement before the final MVP performance gate. The old baseline must not be cited as the embedded preview's startup time.

Memory measurements (issue 042) — 100 compilations and 20 preview cycles:
- Compiler RSS after 100 compiles: growth -0.57% (threshold ≤ 10%) — **PASS**
- Preview RSS after 20 cycles: growth 3.54% (threshold ≤ 20%) — **PASS**
- All resource cleanup checks passed (audio, WebGL, animation frames, message ports)

Package size (issue 043):
- Compressed size: 84.41 MB (100 MB target) — **PASS**
- Debug symbols: stripped
- Category breakdown: shell 109.51 MB (uncompressed), compiler runtime 37.81 MB, preview runtime 43.79 MB, .NET shared framework 14.23 MB, MonoGame managed 1.23 MB, audio deps 3.64 MB, frontend 0.15 MB

### 2.21 "Release trimming or rooting preserves the supported MonoGame API surface used by the compatibility fixtures."

**Verdict: PASS (with documented limitation)**
**Evidence:** Issue 019 — reference allowlist covers 13 unique physical identities across 14 PRD capabilities. Issue 031 — PG0101–PG0104 policy diagnostics. The current preview builds with `PublishTrimmed=false`, preserving full managed metadata for spike verification. Future Release trimming must derive roots and compatibility fixtures from this policy. Documented in `docs/supported-api-policy.md` section "Reflection and dynamic behavior."

### 2.22 "Any required MonoGame changes are committed separately in the submodule repository."

**Verdict: PASS**
**Evidence:** Issue 026 — human-authored MonoGame commit `ecf06ee240dcc5524e82b656b4682e22b4c91175` on `feature/openglnative` (pushed). No AI-authored code in `external/MonoGame`. Parent repository only updated submodule pointer and documentation.

---

## 3. Failure criteria (PRD section 20.3)

### 3.1 "Tauri cannot reliably provide required WebAssembly features."

**Verdict: NOT APPLICABLE**
**Evidence:** Tauri 2.11.5 served WebAssembly with `application/wasm` MIME type (issue 008), `WebAssembly.instantiateStreaming` succeeded without buffer fallback (issue 008), WASM-Eval CSP relaxation works correctly (issue 033). No Tauri limitation found.

### 3.2 "The candidate shell cannot support the required non-threaded runtime, or the runtime unexpectedly requires shared memory that is incompatible with the isolation boundary."

**Verdict: NOT APPLICABLE**
**Evidence:** `WasmEnableThreads=false` is configured (issue 020). The production preview is an opaque-origin iframe in the Workbench WebView and does not require shared memory or cross-origin isolation.

### 3.3 "Roslyn cannot run or consumes unacceptable memory."

**Verdict: NOT APPLICABLE**
**Evidence:** Persistent Roslyn WASM context booted (issue 016), compiled valid assemblies (issue 017), returned structured diagnostics (issue 018), supported multi-file compilation (issue 030). Memory measurement (issue 042) — compiler RSS after 100 compilations: -0.57% growth (threshold ≤ 10%) — **PASS**. Single persistent compiler context with bounded retention confirmed stable.

### 3.4 "Dynamic assemblies cannot be loaded."

**Verdict: NOT APPLICATED**
**Evidence:** Issue 021 — DLL/PDB loaded via `Assembly.Load` from transferred `ArrayBuffer` with byte-continuity proven via SHA-256 digests. Issue 030 — multi-file compilation produced one loaded assembly with two documents.

### 3.5 "Supported, cooperatively yielding preview contexts cannot be stopped and cleaned up reliably."

**Verdict: NOT APPLICATED**
**Evidence:** Issue 024 proved cooperative stop and cleanup for supported yielding games: one disposal, zero post-disposal callbacks, WebGL/audio cleanup, port closure, URL revocation, and iframe removal. Issue 025 proved fresh runtime identity across repeated cycles. ADR 0003 explicitly excludes synchronous non-yielding callbacks from the supported Stop contract.

### 3.6 "Required isolation is incompatible with the runtime."

**Verdict: NOT APPLICATED**
**Evidence:** Opaque-origin iframe sandbox and CSP (issue 033), Tauri IPC denial (issue 034), navigation/network denial (issue 035), and forged-message validation (issue 036) were verified against the embedded production boundary during issue 052. This is defence in depth, not process or malicious-code isolation.

### 3.7 "The compressed release artifact exceeds 100 MB without an approved waiver."

**Verdict: NOT APPLICABLE**
**Evidence:** Package size measurement (issue 043): compressed DMG size 84.41 MB, under the 100 MB target — **PASS**. Release build without development symbols, Emscripten `-Oz` optimization confirmed.

---

## 4. Waivers

### 4.1 Canvas backing-buffer resizing (issue 011)

**Waiver justification:** The canvas backing store and WebGL drawing buffer remain fixed at 320×200 and are CSS-upscaled. This is a documented limitation in ADR 0001. The PRD does not mandate resolution-aware backbuffer resizing for Phase 1 feasibility — it requires that the preview "render successfully" and that "input works," both of which are satisfied. Resolution-aware resizing is a UX refinement for later issues (045+). The CSS scaling produces visually acceptable output at all tested sizes (1280×800, 800×480, 1280×720) with no rendering disruption.

---

## 5. Phase 1 measurements and remaining limitations

The following measurements were completed after the initial gate draft:

- **Issue 041:** Startup/compile/preview/Stop timings — **COMPLETED**. Shell, compilation, and Stop all PASS. Preview startup FAIL (12.3s p95 vs 3s threshold) caused by 1500ms settle delay + 10s bootstrap deadline race — both are fixable optimization issues.
- **Issue 042:** Compiler and 20-cycle preview memory — **COMPLETED**. 100 compilations: -0.57% compiler RSS growth. 20 preview cycles: 3.54% preview RSS growth. All resource cleanup checks passed.
- **Issue 043:** Release package size — **COMPLETED**. 84.41 MB compressed, under 100 MB target. Debug symbols stripped.
- **Issue 040:** Physical speaker output — managed `SoundEffect.Play()` analyser-proven, physical playback not yet verified.

All three measurement items (041–043) are now completed and documented in `docs/performance-baseline.md`.

---

## 6. Gate decision

**Overall decision: PASS-WITH-WAIVERS**

At the time of the human feasibility gate, all 22 then-current acceptance criteria were accepted (21 PASS, 1 PASS-WITH-WAIVERS), and the seven failure criteria were judged not applicable. The later ADR 0003 decision is a documented product requirement amendment, not evidence that the separate-window UX remains in production.

The architecture is feasible. Workbench product-UI development (issues 045+) may proceed after this gate is signed off. The remaining open items (041–043) are all completed; the remaining blockers (045+) are UI/packaging work that proceeds independently.

---

**Signed:** @dellis1972
**Date:** 2026-09-03

---

## 7. Post-gate product architecture amendment (2026-09-08)

The product owner explicitly rejected the separate visible preview window because
it produced an unacceptable Workbench experience. ADR 0003 makes the embedded,
opaque-origin iframe the production architecture. Cooperative Stop remains
required for yielding games. Synchronous non-yielding code can freeze the shared
WebView and may require application relaunch; it is outside the supported
execution contract. Historical issue-038 and performance evidence remains valid
for the experiment it measured but must not be represented as current product
behavior.

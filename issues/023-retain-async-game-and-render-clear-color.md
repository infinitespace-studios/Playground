# Retain asynchronous Game and render clear-color frame

**Type:** AFK
**Status:** Done
**Blocked by:** [022-discover-construct-single-game-subclass.md](022-discover-construct-single-game-subclass.md)
**PRD references:** 13.1, 13.3, 8.2
**User stories:** US1, US3
**Triage:** needs-triage

## Context

PRD section 13.1 states that on the WebGL platform, `Game.Run()` schedules an asynchronous Emscripten loop and returns immediately; the runner must retain a strong reference to the game and must not wrap it in a scope that disposes it after `Run()` returns, keeping the managed host alive until the preview is stopped or the game exits. Section 13.3 defines the preview lifecycle states (`stopped → starting → running → stopping → stopped`, with `failed` and `forced-stopping` branches). Section 8.2 describes the full Run workflow. This is the first issue where a user-authored game actually renders inside the packaged product: it calls `Run()` on the game constructed in issue 22 and confirms the game keeps rendering frames (proven via a visible clear-color change) after the initial JS call returns, i.e. proving the asynchronous retention model works and the object is not garbage-collected or disposed prematurely.

## What to build

Call `Run()` on the `Game` instance constructed in issue 22, store a strong static/global reference to it inside the preview runtime so it is not collected, and confirm via a compiled test `Game1`-like class that clears the screen to a distinctive color (e.g. `Color.CornflowerBlue`) that the color is visibly rendered in the preview canvas and continues to render across multiple animation frames (not just one frame before disappearing), proving the asynchronous Emscripten loop keeps running after the initiating JS call returns.

## Scope

### In scope

- Extending `GameRunner.cs`/`PreviewExports.cs` with a `RunGame(Microsoft.Xna.Framework.Game game)` method that calls `game.Run()` and retains a static reference (e.g. `private static Game? _activeGame;`)
- A `[JSExport] public static string RunLoadedGame()` entry point orchestrating discover → construct → run for the currently loaded assembly
- Compiling and running a test `Game1`-equivalent class (matching the PRD section 4 example) that clears to a distinctive color in `Draw`
- Confirming via the canvas (visually, or via a WebGL readback/screenshot mechanism if available) that the clear color renders and persists across multiple frames

### Out of scope

- Stop/cleanup behavior (issue 24)
- Restart/clean-state behavior (issue 25)
- Content loading beyond the built-in clear color

## Implementation guidance

1. In `PreviewExports.cs`:
```csharp
private static Microsoft.Xna.Framework.Game? _activeGame;

[JSExport]
public static string RunLoadedGame()
{
    var (gameType, error) = GameRunner.DiscoverGameType(_loadedAssembly!); // _loadedAssembly set by issue 21's LoadUserAssembly
    if (error is not null) return System.Text.Json.JsonSerializer.Serialize(error);

    _activeGame = GameRunner.ConstructGame(gameType!);
    _activeGame.Run(); // returns immediately on WebGL; loop continues asynchronously via Emscripten
    return "running";
}
```
   Do not wrap `_activeGame` in a `using` statement or any construct that disposes it after this method returns; the static field is the retention mechanism required by PRD 13.1.
2. Compile a test source matching the PRD section 4 example almost verbatim:
```csharp
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

public sealed class Game1 : Game
{
    private readonly GraphicsDeviceManager _graphics;
    public Game1() { _graphics = new GraphicsDeviceManager(this); Content.RootDirectory = "Content"; }
    protected override void Draw(GameTime gameTime) { GraphicsDevice.Clear(Color.CornflowerBlue); base.Draw(gameTime); }
}
```
3. Run this through the full compile (issue 17) → load (issue 21) → discover/construct (issue 22) → `RunLoadedGame` pipeline inside the packaged Tauri shell's preview iframe.
4. Visually confirm the canvas turns Cornflower Blue and stays that color across at least several seconds (proving the loop keeps running, not just rendering one frame then stopping or crashing).
5. Add a temporary counter in `Draw` (logged to console every N frames) to prove `Draw` is being called repeatedly by the asynchronous loop, then remove or gate the temporary logging behind a debug flag once confirmed.

## Acceptance criteria

- [x] `RunLoadedGame` calls `Game.Run()` and retains a strong static reference to the game instance so it is not disposed or garbage-collected when the JS call returns
- [x] The compiled `Game1`-equivalent test class renders `Color.CornflowerBlue` in the preview canvas
- [x] The clear color persists and `Draw` is confirmed (e.g. via a temporary frame counter) to be called repeatedly across multiple frames after `RunLoadedGame` returns, not just once
- [x] No exception is thrown during `Run()` or subsequent frames

## Verification

Implementation verification (not independent acceptance verification):

```sh
cd src/frontend
npm run test:protocol
npm run typecheck
npm run test:stage-preview-clean
npm run test:stage-issue21-clean
npm run test:preview-native-artifacts

cd ../preview
dotnet build -c Release --no-restore

cd ../desktop
npm run tauri build -- --no-bundle
MONOGAME_ISSUE023_PROOF=1 src-tauri/target/release/monogame-playground
```

The environment-gated packaged proof compiles and transfers a live
`ClearColorGame`, sends exact `preview.start.request`, requires the terminal
`preview.start.response` before the causally correlated, sequence-1
`preview.started`, and samples five WebGL pixels twice at least five seconds
apart. It also requires a strictly increasing managed `Draw` counter,
`Run()` having returned, one run attempt, retained/not-disposed state, detached
DLL/PDB sender buffers, one compiler and one active preview runtime, top-level
frames, a live WebGL context, and empty unexpected-error/external-resource
arrays. The iframe remains visible and retained for the 20-second report
window. At 18 seconds it invokes the issue 22 teardown export exactly once and
removes the iframe; this is proof cleanup, not issue 24 cooperative-stop
behavior.

The ownership chain is `PreviewExports._gameRunner` → the instance
`GameRunner._game`. No separate static `Game` global is used, no `using` scope
owns the game, and `GameRunner.RunGame` does not hold its state lock across
`Game.Run()`.

Implementation evidence is in the session artifact directory
`files/issue023/`: `report.json`, `checkpoint.json`, `packaged-proof.log`, and
`lsof-running.txt`. The successful packaged report records 20 top-level
frames; a nested 800×480 drawing buffer; exact RGBA
`[100,149,237,255]` at center and four corners in both samples 5,115 ms apart;
managed frames 2→309; one 6 ms returned `Run` call; retained `true`, disposed
`false`; exact load/start IDs; sequence 1; and one final Dispose. The lsof
capture contains no IPv4/IPv6 sockets. Automated screenshot capture was not
available because macOS did not expose window bounds to the non-interactive
process; pixel readback is the primary render evidence. An independent
verifier must still personally observe the bounded preview and fill the record
below.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

### Independent verification — 2026-08-27

- **Verdict:** **FAIL (code failure, not merely HITL-blocked)**
- **Verifier:** GitHub Copilot CLI (independent verifier)
- **Date:** 2026-08-27
- **Evidence directory:** `/Users/dean/.copilot/session-state/2e0cf413-640e-4fbe-81a7-170cd90d7218/files/issue023-verification/`
- **Documented commands:** all 34 protocol tests, typecheck, both clean-staging regressions, native-artifact regression, preview Release `--no-restore` build, and Tauri Release `--no-bundle` build passed with zero build warnings/errors (`frontend-documented-verification.txt`, `preview-release-build.txt`, `tauri-release-build.txt`). `git diff --check` passed.
- **Successful proof-gated path:** the direct packaged proof performed live Roslyn compile, transferred detached DLL/PDB buffers, loaded the assembly, constructed `ClearColorGame`, and used exact load/start protocol IDs. For the primary run: compile `649b2e5c-53b7-4afd-9e33-dbf10f7936ed`, preview `c5f39556-710b-4bee-add9-de901c05df6c`, compile correlation `e0748ade-c414-46b5-96a1-2d46701f88c0`, load correlation `24d23520-69cb-456f-a8dc-5a6d61f1467f`, and start correlation `278a2604-1424-4d9b-9962-148ccd1398aa`. It observed `preview.start.response` before correlated `preview.started` sequence 1, one compiler/runtime/run attempt, `Run()` returned in 7 ms, retained/not disposed state, and explicit proof cleanup disposing exactly once.
- **Rendering evidence:** the nested `#canvas` had an 800×480 backing/drawing buffer. Center plus four corners were `[100,149,237,255]` in both samples 5,117 ms apart; `gl.getError()` was zero and managed Draw count increased 2→309. The top-level renderer independently reached 20 frames. Reported unexpected console/unhandled/compiler/preview errors and external resources were empty; external `lsof` of exact live PID 70570 and its descendants found no IPv4/IPv6 sockets (`packaged-report.json`, `packaged-proof.log`, `process-tree-and-lsof.txt`).
- **Blocking normal-mode defect:** the trusted normal **Run clear-color Game** control fails with `PREVIEW_START_FAILED: The preview is not in a startable loaded state.` In `preview.js`, construction is enabled only when `issue022Proof || issue023Proof`; `compileLoadStartIssue23(... proofMode: false)` therefore loads but never calls `DiscoverAndConstructGame` before `RunLoadedGame`. The normal Tauri-authorized user path cannot render at all (`normal-clear-color-first.png`, `normal-clear-color-second.png`). The preceding trusted issue-21 control did pass and displayed `Loaded Issue021Foo · 2 sequence points` (`issue021-control-final.png`).
- **Protocol/lifecycle defects:** synchronous `Run()` failure returns failed `preview.start.response` then `preview.failed`, but never performs the Protocol.md-required cleanup or emits terminal `preview.stopped`. Receiver/requester start timeout likewise only taints/closes the port; it does not force teardown or produce the required stopped completion. No stop implementation was added, but these start-failure terminal semantics are normative now. Fatal managed startup exceptions cross into the broad JS catch and are converted to an ordinary handled `PREVIEW_START_FAILED`.
- **Coverage gaps:** tests exercise utility/endpoint wrong version/type/source, repeated start, same-correlation concurrency, and client late response, but not the actual preview runtime for malicious/concurrent starts. There is no distinct-correlation concurrent-start race, managed `GameRunner` race, synchronous `Run()` failure with failed/stopped ordering, delayed `preview.started`, receiver-side delayed timeout/teardown, context-loss assertion, or normal-mode start test. Consequently the proof-only construction gate escaped coverage.
- **Prior-invariant regression:** a fresh packaged issue-22 regression completed all 14 live Roslyn/WASM cases with one compiler, 14 previews, 14 teardowns, 20 top-level frames, and empty reported errors/resources (`issue022-report.json`, `issue022-regression.log`). The issue-21 trusted control and top-level render also passed as noted above.
- **Visual acceptance:** macOS exposed the exact 1280×800 app window, so only that window was captured. Two proof-run captures six seconds apart showed the top-level renderer because proof cleanup had already removed the nested iframe; the trusted normal run then visibly failed as above. The required personal observation of nested CornflowerBlue continuing for at least five seconds was therefore **not satisfied**.
- **Hygiene/external state:** no implementation was altered. `external/MonoGame` was never built, cleaned, reset, stashed, reverted, or edited. Its recursive HEAD/status/submodule record and SHA-256 inventory of every changed/untracked regular file are byte-for-byte identical before and after verification; the preserved state includes six modified `.mgfxo` files, dirty `external/MonoGame.Templates`, untracked/dirty FAudio state, and three untracked `Example/wwwroot/Content` files (`external-pre-state.txt`, `external-post-state.txt`, `external-state-comparison.txt`).
- **Required fixes:** enable discovery/construction in the trusted normal run path; implement Protocol.md start-failure/timeout cleanup and stopped completion without prematurely adding cooperative Stop; preserve fatal exception semantics; add actual-runtime start failure, timeout, delayed-event, repeated/distinct-concurrent start and managed race tests; assert WebGL context remains live; then repeat the bounded visual observation.

### Remediation after independent FAIL — 2026-08-27

The FAIL verdict above is intentionally preserved. The remediation separates
the production `runGamePipeline` bootstrap capability from proof
authorization: both normal and proof runs now share compile → load → discover
→ construct → start, while `issue023Proof` gates only queries/reporting. A
trusted normal packaged click now reaches one run and displays
`Running clear-color Game in retained preview.`

Synchronous nonfatal start failure now returns the failed
`preview.start.response`, emits correlated `preview.failed` phase `start`
(sequence N), disposes the constructed game once, emits correlated
`preview.stopped` reason `failed` (sequence N+1), and retires the port/iframe.
Receiver deadline failure follows the same ordering. Requester timeout retires
the iframe immediately and discards late traffic. An exception escaping the
managed structured boundary is treated as unexpected `INTERNAL_ERROR`, not
normal `PREVIEW_START_FAILED`; fatal exceptions remain excluded by the managed
catch filter. No cooperative stop semantics were added.

Remediation evidence is in `files/issue023-remediation/`. The packaged report
records one compiler, one successful preview, one 6 ms returned run, Draw
2→309, exact CornflowerBlue at five points 5,114 ms apart, and
`contextLost: false` at both
samples. `report-window.png` captures the 1280×800 app with the nested blue
preview still visible during the report window; `normal-control.png` captures
the trusted non-proof control successfully running the same Game.
`lsof-report-window.txt` contains no IPv4/IPv6 sockets. The post-report
checkpoint records exactly one Dispose after the visual window. The packaged
report also contains a real compiled `ThrowingRunGame`: its sanitized managed
boundary recorded one Run attempt, retained false, disposed true exactly once,
then wire order `preview.start.response` → `preview.failed` sequence 1 →
`preview.stopped` sequence 2 with one initiating correlation and no
`preview.started`. Automated
tests cover normal controller success/failure, before-load/second/same-ID and
distinct-ID concurrent starts, exact failure event order/correlation/sequences,
no started event on failure, late response discard, and forced requester
retirement, plus delayed correlated started-event ordering. Independent
verification and its personal visual observation
remain required; no acceptance box or verdict is changed here.

### Independent re-verification — 2026-08-27

- **Verdict:** **FAIL (remaining verification/coverage blockers)**
- **Verifier:** GitHub Copilot CLI (independent verifier)
- **Date:** 2026-08-27
- **Evidence directory:** `/Users/dean/.copilot/session-state/2e0cf413-640e-4fbe-81a7-170cd90d7218/files/issue023-reverification/`
- **Documented commands:** all 39 protocol tests, typecheck, both clean-staging regressions, native-artifact regression, preview Release `--no-restore` build, and Tauri Release `--no-bundle` build passed. Preview/Tauri builds completed with zero warnings/errors and `git diff --check` passed (`frontend-documented-verification.txt`, `preview-release-build.txt`, `tauri-release-build.txt`).
- **Normal trusted path now passes:** without any proof flag, the trusted issue-21 control displayed `Loaded Issue021Foo · 2 sequence points`; the trusted issue-23 control then used the production compile/load/discover/construct/start path and displayed `Running clear-color Game in retained preview.` The dedicated nested canvas was visibly CornflowerBlue in two exact 1280×800 app-window captures six seconds apart while the top-level legacy renderer continued animating. Proof authorization now gates queries/reporting rather than construction/start (`normal-issue21-control.png`, `normal-clear-color-first.png`, `normal-clear-color-second.png`, `visual-capture-times.txt`).
- **Live packaged proof passes its exercised path:** live Roslyn source contains `GraphicsDeviceManager` and `Draw` clearing `Color.CornflowerBlue`; DLL/PDB senders detached over private compiler/preview ports. Exact IDs were compile `116c55f3-5998-4fd6-8fb8-0e190a834186`, preview `f9e14f21-9250-45c7-a0b9-2560c3108e8c`, compile correlation `4ba6fdca-17cd-4483-ba0d-ea0ada73f277`, load correlation `62519f32-8a5e-4100-b4c2-4d387791f26f`, and start correlation `12f2c9ab-2653-4a30-b6ad-421704436be7`. Wire order was response then correlated `preview.started` sequence 1. `Run()` returned in 6 ms, the runner stayed retained/not disposed at report time, and managed Draw increased 2→309.
- **Rendering/report honesty:** both actual WebGL samples used the nested 800×480 canvas/drawing buffer. Center and four corners were exactly `[100,149,237,255]` in both samples 5,109 ms apart, `glError` was zero, and `isContextLost` was false. The nested blue canvas remained visible during the report window; the post-report checkpoint later recorded exactly one successful disposal after the scheduled 18-second delay. One compiler and one active successful preview were reported, top-level frames reached 20, and reported console/unhandled/compiler/preview errors and external resources were empty. Exact live PID 79044 had no descendants and external `lsof` found no IPv4/IPv6 sockets (`issue023-report.json`, `packaged-proof.log`, `report-window-first.png`, `process-tree-and-lsof.txt`).
- **Synchronous failure path passes live proof:** compiled `ThrowingRunGame` produced failed `preview.start.response`, correlated `preview.failed` sequence 1, then correlated `preview.stopped` sequence 2 reason `failed`; no `preview.started` was emitted. It recorded one Run attempt, sanitized error text, retained false, disposed true, and one dispose attempt before host iframe removal/port retirement.
- **Prior regressions pass:** a fresh issue-21 packaged proof completed with the top-level runtime rendering 20 frames and empty reported error/resource channels. A fresh issue-22 packaged proof completed all 14 Roslyn/WASM cases with one compiler, 14 previews, 14 teardowns, 20 top-level frames, and empty reported error/resource channels (`issue021-report.json`, `issue022-report.json`).
- **Remaining blocker — tests do not exercise the claimed runtime races:** same-correlation, distinct-correlation, before-load, repeated-start, and failure-order tests instantiate `createPreviewEndpoint` with mocked `executeStart`; they do not execute `preview.js`, `PreviewExports.RunLoadedGame`, or `GameRunner.RunGame`. Repository search finds no managed `GameRunner` tests at all. Thus one-Run admission, retention/reference clearing, and Run/teardown/dispose races are inferred from code and the single live success/failure cases, not independently exercised as requested.
- **Remaining blocker — timeout test is not an end-to-end timeout proof:** `requester timeout immediately retires its preview` passes a synthetic promise that rejects after 5 ms into `withForcedPreviewRetirement` and asserts only that a callback ran once. It does not use an actual port/runtime, measure the two-second bound, prove iframe removal and port closure, or prove absence of false lifecycle events. The separate late-response test checks `ProtocolPortClient` only. Receiver deadline failure and delayed response/event behavior are likewise not exercised through the real preview runtime.
- **Remaining blocker — fatal/unexpected exception behavior is unproven and still broadly caught:** managed fatal exceptions are excluded by `GameRunner`'s filter, but `preview.js` then catches every exception escaping `RunLoadedGame` with an unqualified `catch`, calls teardown, and converts it to `INTERNAL_ERROR`. No test drives a fatal managed exception or independently proves it is not swallowed/remapped. Later unexpected JS exceptions are also handled by a broad catch and may become ordinary `PREVIEW_START_FAILED`; only the deliberate nonfatal managed start failure is covered live.

### Remediation 2 after independent re-verification FAIL — 2026-08-27

Both historical FAIL verdicts above are intentionally preserved. The actual
preview start implementation is now the importable
`PreviewStartRuntime.js` production module used directly by `preview.js`.
Tauri-authorized proof bootstrap may inject only deterministic start delay or
an unexpected-boundary failure when constructing that handler; query
parameters and normal product behavior cannot enable those dependencies. The
preview staging allowlist copies and requires this production module.

`MONOGAME_ISSUE023_PROOF=1` now reports `runtimeLifecycleCases` from fresh
browser-WASM iframe contexts using real private MessagePorts, the real
endpoint, `PreviewExports`, and `GameRunner`: before-load start, duplicate
same-correlation arrival, distinct-correlation concurrency while the admitted
start is delayed, successful then repeated start, delayed `preview.started`,
live nonfatal `BeginRun` failure, receiver deadline expiry, requester timeout,
and an unexpected JS-export boundary failure. The observed concurrent and
repeated losers are `INVALID_STATE` (or the exact duplicate-correlation
control), each successful context records one managed Run attempt, and every
constructed auxiliary Game is torn down with one Dispose. Structured failure
orders response → `preview.failed` sequence 1 → `preview.stopped` sequence 2.
Unexpected boundary failure returns `INTERNAL_ERROR`, records unexpected
classification, emits no false started/failed/stopped lifecycle, and closes
the context. Requester timeout removed the iframe and closed its port in
519 ms, under the two-second bound.

The managed JSExport behavioral self-test uses a real `Game` and the
production admission/teardown methods with a Run seam whose default is exactly
`Game.Run`. A reentrant competing start observes the reserved Starting state,
only one callback executes, RunAttempts is one, teardown racing the callback
clears retention, one Dispose occurs, and repeated teardown is idempotent.
Safe classifier tests identify `OutOfMemoryException`,
`StackOverflowException`, `AccessViolationException`,
`AppDomainUnloadedException`, and `CannotUnloadAppDomainException` as fatal
while rejecting `InvalidOperationException`; no fatal exception is actually
thrown. Browser WASM has `WasmEnableThreads=false`, so true parallel managed
threads are unavailable; all reachable managed reentrant interleavings are
tested deterministically while MessagePort cases cover external concurrency.

Remediation-2 evidence is in `files/issue023-remediation-2/`. The packaged
primary runtime retained its Game and returned from Run in 7 ms, rendered
exact `[100,149,237,255]` at five WebGL locations in two samples 5,110 ms
apart, kept `isContextLost() === false`, and advanced managed Draw from 2 to
309. The report contains empty acceptance error/resource arrays and schedules
issue-22 teardown only after the report window. All 42 protocol/controller/
production-executor tests pass, as do typecheck, clean staging, native
artifact validation, preview Release, and Tauri Release. Independent
verification remains required; no acceptance checkbox, status, or verdict is
changed here.
- **Scope/hygiene:** no `preview.stop.request` or cooperative Stop implementation was added. No implementation was changed during re-verification. `external/MonoGame` was never edited, built, cleaned, reset, stashed, or reverted; recursive HEAD/status/submodules and SHA-256 inventory of all changed/untracked regular files are byte-for-byte identical before and after (`external-pre-state.txt`, `external-post-state.txt`, `external-state-comparison.txt`).
- **Required before PASS:** add real preview-runtime tests for same/distinct concurrent, before-load, repeated and delayed starts; add managed `GameRunner` Run/teardown/dispose race tests; exercise receiver and requester timeout end-to-end with measured retirement, port/iframe cleanup, late discard, and no false event; and prove fatal plus unexpected-JS exception classification without broad remapping/swallowing.

### Independent re-verification 3 — FAIL (2026-08-27)

- **Verdict:** **FAIL.** Remediation 2 closes the prior production-runtime and managed-race coverage gaps, and both proof and normal clear-color paths pass, but the required fresh requester-timeout late-discard observation is absent and the packaged issue-21/22 regressions reproducibly fail. The two earlier FAIL records remain preserved.
- **Documented commands:** all 42 protocol/controller/production-executor tests passed, as did typecheck, both clean-staging regressions, native-artifact validation, preview Release `--no-restore`, and Tauri Release `--no-bundle` with zero build warnings/errors. Clean preview staging included `PreviewStartRuntime.js`; `git diff --check` passed.
- **Fresh primary proof:** live packaged Roslyn/WASM compile, detached DLL/PDB transfer, assembly load, discovery, construction, and exact start protocol succeeded. Exact IDs were compile `0b4be97e-6170-4e85-938c-f2e0fb73fe77`, preview `33be3651-1ba5-4863-a51c-761721362342`, compile correlation `cfdadfbb-26f7-452e-b148-eb80f89c2d3d`, load correlation `818f45f1-f40d-4a47-8110-655f06042cf7`, and start correlation `9d08b280-85df-48f1-a872-a9921ac024b3`. The observed wire order was exactly response then correlated `preview.started` sequence 1; one compiler and one preview runtime started; `Run()` returned in 7 ms; the Game stayed retained/not disposed through report time; Draw advanced 2→309.
- **Lifecycle and ownership cases:** fresh browser-WASM contexts exercised before-load, duplicate same-correlation, distinct concurrent, successful then repeated, delayed started, synchronous Run failure, receiver deadline, requester timeout, and unexpected boundary behavior through the real private endpoint, `PreviewExports`, and `GameRunner`. Successful contexts admitted one Run and disposed once during explicit proof teardown. Synchronous failure and receiver deadline each observed response → `preview.failed` sequence 1 → `preview.stopped` sequence 2 reason `failed`, no started event, cleared retention, and one Dispose. The managed behavioral self-test used a real retained `Game`, admitted one Run callback/attempt, rejected the reentrant competitor with `INVALID_STATE`, cleared the reference during teardown interleaving, disposed exactly once, and made repeated teardown idempotent. Its non-throwing classifier recognized all five listed fatal types and rejected `InvalidOperationException`; production escaped-boundary handling reported `INTERNAL_ERROR` rather than `PREVIEW_START_FAILED`.
- **Rendering and visual acceptance:** the actual nested 800×480 WebGL drawing buffer returned exact `[100,149,237,255]` at center plus four corners in both samples 5,113 ms apart, with `glError` zero and `isContextLost() === false`. Two exact 1280×800 app-window captures six seconds apart personally showed the nested CornflowerBlue surface continuing while the top-level renderer animated; no unrelated window or full screen was captured. The delayed checkpoint recorded proof-only cleanup after the report with one Dispose and cleared retention.
- **Normal trusted path:** without proof flags, the trusted issue-21 control displayed `Loaded Issue021Foo · 2 sequence points`; the normal issue-23 control then displayed `Running clear-color Game in retained preview.` and kept its dedicated nested canvas visibly CornflowerBlue in two app-only captures six seconds apart. Normal product construction/start therefore shares the real pipeline and remains independent of proof instrumentation.
- **Blocking requester-timeout evidence gap:** the fresh browser-WASM timeout case retired its iframe and closed its port in 519 ms with zero lifecycle events, but its own observation is `discardedUnknownOrLate: 0`. Destruction prevents the delayed runtime from delivering late traffic, so this proves forced retirement and no false event, not the explicitly requested observed late discard. Only a separate unit-level `ProtocolPortClient` test observes a late response being discarded. The unexpected-boundary runtime case similarly reports the terminal `INTERNAL_ERROR`, unexpected channel, and no lifecycle events, but its packaged case does not expose an observation proving endpoint closure; closure is established only by code inspection.
- **Blocking prior regressions:** fresh packaged issue-21 proof failed twice and fresh packaged issue-22 proof failed once with `Top-level MonoGame runtime did not render` and `renderedFramesObserved: 0`; WASM streaming succeeded and reported error arrays were empty. This is reproducible even though the longer issue-23 proof observed 20 top-level frames and the normal-control captures visibly showed the top-level animation. Required issue-21/22 packaged regressions therefore do not pass.
- **Report/network/hygiene:** the primary report recorded detached buffers, empty top-level/compiler/preview error arrays, no external resources, and no Base64 transport. Exact live PID `90126` had no descendants and external `lsof` found no IPv4/IPv6 sockets. No stop/exit implementation was added. No implementation or status was changed, and no commit was made. `external/MonoGame` was never built, cleaned, reset, stashed, reverted, or edited; recursive HEAD/status/submodules and SHA-256 hashes of every changed/untracked regular file are byte-for-byte identical before and after, including the six modified `.mgfxo` files, dirty template/FAudio submodules, and three untracked content files. Evidence is in `files/issue023-reverification-2/`.

### Remediation 3 after independent re-verification 3 FAIL — 2026-08-27

All three historical FAIL records above are intentionally preserved. Status,
acceptance checkboxes, and the independent verification record remain
unchanged.

The production requester-timeout behavior still closes its port and removes
its iframe immediately. A separate Tauri-authorized fresh browser-WASM case
now allows an 800 ms production start delay and a bounded proof-only grace
after the requester’s 250 ms deadline. The real endpoint attempted its late
successful `preview.start.response` and correlated `preview.started`; the
actual `ProtocolPortClient` observed three total messages (the load terminal
plus those two late messages), incremented `discardedUnknownOrLate` to **2**,
kept `lifecycleEvents` at **0**, did not settle the timed-out start, and then
closed its port and removed the iframe after **829 ms** total. The normal
immediate-retirement case remains separate and unchanged.

The unexpected-boundary case now registers the exact authorized correlation,
port identity, generation, request/response route, phase
`unexpected-start-boundary`, and expected `INTERNAL_ERROR`. Its read-only
proof snapshot directly observed `closed: true`, exact close reason
`unexpected-start-boundary`, no lifecycle events, one consumed expected
rejection, and an empty unexpected-error array. A subsequent request on the
still-open host side timed out because the production endpoint was closed.
The host then removed the iframe and closed its client with exact reason
`Failed preview retired.` No ordinary unexpected error is excluded from
acceptance diagnostics.

The prior zero-frame issue-21/22 failures were reproduced during remediation:
WASM streaming succeeded and error arrays were empty, but the one-shot Tauri
focus request had not produced a visible/focused WebView, so the top-level
animation-driven MonoGame Draw loop remained at zero before nested work.
Issue-21, issue-22, and issue-23 now share a bounded readiness barrier that
retries show/unminimize/focus, requires OS visible/focused/not-minimized state,
`document.visibilityState === "visible"`, two progressing animation frames,
and at least one actual top-level Draw before creating compiler or preview
contexts. It fails honestly after ten seconds and never synthesizes frames.

Final evidence is in `files/issue023-remediation-3/`. Three fresh consecutive
issue-21 processes each reported 20 top-level frames. Three fresh consecutive
issue-22 processes each reported 20 top-level frames, 14 preview runtimes, and
14 teardowns. Every launch checked for stale app processes before and after,
used a three-second cooldown, and had no IPv4/IPv6 lsof entries. The final
issue-23 primary returned from Run in 7 ms, advanced Draw 2→309, and read exact
CornflowerBlue at five points twice 5,112 ms apart with live WebGL contexts.
Two bounded normal-control captures six seconds apart show the trusted
non-proof path still rendering CornflowerBlue. All 42 tests, typecheck, clean
staging/native checks, preview Release, Tauri Release, diff hygiene, and exact
recursive submodule-state checks pass. No cooperative Stop implementation was
added and no commit was created.

### Independent re-verification 4 — FAIL (2026-08-27)

- **Verdict:** **FAIL.** Remediation 3 closes the late-discard and unexpected-boundary evidence gaps, and the successful issue-23 rerun plus normal control satisfy the runtime/rendering criteria, but the new packaged-proof readiness/focus barrier is not reliable: the required three consecutive fresh issue-21 and issue-22 runs did not all pass. All earlier FAIL records remain preserved.
- **Documented commands:** all 42 protocol/controller/production-executor tests passed, along with typecheck, both clean-staging regressions, native-artifact validation, preview Release `--no-restore`, and Tauri Release `--no-bundle` with zero build warnings/errors. Staging included the production `PreviewStartRuntime.js`; `git diff --check` passed.
- **Late discard now passes actual-runtime scrutiny:** the Tauri-authorized `actualLateDiscard` case used a fresh browser-WASM preview, the production private endpoint, and the real `ProtocolPortClient`. The requester deadline completed/retired the start correlation before the endpoint later posted its successful terminal and correlated `preview.started` sequence 1. The independent report observed three total messages (the load terminal plus both late start messages), `discardedUnknownOrLate: 2`, one accepted terminal total, zero accepted lifecycle events, no wire-order/state resettlement, and the real endpoint snapshot contained both terminals plus the attempted started event. The frame and port remained connected/open during the bounded grace, then the host closed the port and removed the iframe in 842 ms, under two seconds. Normal timeout remains immediate-retirement code; the delay case and grace are reachable only from the Tauri-authorized issue-23 proof bootstrap.
- **Unexpected boundary now passes actual-runtime scrutiny:** the fresh production endpoint snapshot directly recorded `closed: true`, sole close reason `unexpected-start-boundary`, zero lifecycle events, one exact keyed authorized `INTERNAL_ERROR` expectation, and an empty unexpected-error array. A subsequent request timed out because the endpoint was closed; before host retirement the iframe remained connected and client open, then host cleanup removed the frame and closed the client with `Failed preview retired.` Ordinary unexpected outcomes still populate acceptance errors.
- **Primary issue-23 proof passes on rerun:** exact IDs were compile `a2c48a8b-054f-4c52-aa1d-544088621945`, preview `d825fbe1-d45b-40af-adbf-f690394bf0d9`, compile correlation `cc819ae6-0088-4618-8a43-5275de5ffb95`, load correlation `85b5ded6-9120-47fa-8045-e7d287c5fe83`, and start correlation `af35f80e-a2c4-4c97-8ecd-3c05b9e12887`. It observed response then correlated started sequence 1, one compiler/preview runtime, Run returning in 6 ms, retained/not-disposed state through report, Draw increasing by 307, and exact `[100,149,237,255]` at center plus four corners in two live 800×480 WebGL samples 5,105 ms apart with no GL error or context loss. The post-report checkpoint recorded one delayed proof cleanup Dispose and cleared retention. Managed admission/race/fatal classification and all prior success/failure/concurrency/timeout cases remained genuine and passed.
- **Visual and normal control pass:** two exact app-window captures six seconds apart personally showed the issue-23 proof's dedicated nested CornflowerBlue canvas continuing while the real top-level animation progressed. Without proof flags, the trusted issue-21 control displayed `Loaded Issue021Foo · 2 sequence points`, then the normal issue-23 control displayed `Running clear-color Game in retained preview.` and remained visibly CornflowerBlue in two app-only captures six seconds apart. No full-screen or unrelated-app capture was taken.
- **Blocking readiness reliability failure:** the mandated independent fresh-run matrix failed. Issue-21 PID `99782` succeeded with a visible/focused, non-minimized, document-visible readiness snapshot and real Draw progress, but PIDs `99815` and `99867` failed after the bounded barrier with `Packaged proof window did not become visible and focused.` All three issue-22 processes, PIDs `99948`, `101`, and `155`, failed with the same readiness error before completing their 14 cases. The first fresh issue-23 PID `211` also failed identically with zero observed frames. A second issue-23 PID `284` succeeded only after 69 focus attempts and 7,151 ms to readiness. Thus retries are proof-gated and finite, and failures are honest rather than fabricated, but remediation does not meet the explicit three-consecutive-run reliability requirement.
- **Network/process/hygiene:** every recorded proof process had no child process or IPv4/IPv6 `lsof` entry and exited before the next launch; all owned app processes were cleaned up. No implementation, acceptance checkbox, status, or Done marker was changed, and no commit was created. `external/MonoGame` was never built, cleaned, reset, stashed, reverted, or edited; recursive HEAD/status/submodules and SHA-256 hashes of all changed/untracked regular files are byte-for-byte identical before and after. Evidence is in `files/issue023-reverification-3/`.

### Remediation 4 after independent re-verification 4 FAIL — 2026-08-27

All four historical FAIL records above are intentionally preserved. Status,
acceptance checkboxes, independent verification, and the commit gate remain
unchanged.

The proof readiness path now makes one proof-gated Tauri IPC call instead of
up to 100 browser-side focus calls. On macOS that command dispatches to the
AppKit main thread, ensures the process has Regular activation policy,
unhides and activates the current `NSApplication` and
`NSRunningApplication`, activates while ignoring other apps as the
compatibility fallback, and orders the exact Tauri `NSWindow` key and front
before asking Tauri to focus it. It permits at most three native attempts
inside the one command while awaiting the OS transition. Non-macOS keeps the
safe Tauri show/unminimize/focus path. The command remains unavailable unless
issue-21, issue-22, or issue-23 packaged proof authorization is present, and a
Rust gate test covers rejection outside proof mode.

Readiness is independently established after activation: the document must be
visible, two real `requestAnimationFrame` callbacks must advance, and the
top-level managed Draw observation must strictly increase. Failure diagnostics
include native policy/activation results, attempt count and duration, Tauri
window state, document visibility, animation timestamps, initial/final Draw
counts, and runtime state. No focus, visibility, or frame observation is
fabricated. Proof authorization is now established before readiness can cause
the issue-21 compiler/preview iframes to bootstrap, removing a deterministic
authorization race exposed by the faster activation path.

The first diagnostic matrix preserved in
`files/issue023-remediation-4/pre-modern-activation/` includes three successful
one-attempt issue-21 launches followed by an honest inactive-AppKit failure.
The final transaction adds modern `NSApplication.activate()` before and after
exact-window ordering, invokes Tauri focus before waiting on each bounded OS
transition, and retains the legacy ignoring-other-apps call only as fallback.

The final fresh-process matrix completed **5/5 issue-21**, **5/5 issue-22**,
and **5/5 issue-23** runs without manual interaction or retry-until-pass.
Every process passed on its first launch with one native activation attempt,
108–119 ms native activation time, 291–317 ms total readiness time, and a
strict three-frame top-level Draw increase at readiness. Each launch had a
unique PID, emitted its complete report, remained alive for external `lsof`,
exited before the next launch, and was followed by a two-second cooldown; no
stale matching process or IPv4/IPv6 socket was found.

All five issue-23 reports observed 20 top-level frames, a 307–308 managed
preview frame delta, exact CornflowerBlue `[100,149,237,255]` at five points
in both samples 5,106–5,117 ms apart, and live WebGL contexts. Each also
observed two discarded late start messages, direct endpoint
`closed: true` with sole reason `unexpected-start-boundary`, and empty
acceptance error arrays. A normal packaged launch with all proof variables
absent remained running without invoking any proof report or activation
instrumentation.

Reproducible validation used `npm --prefix src/frontend run test:protocol`,
`npm --prefix src/frontend run typecheck`,
`cargo check --manifest-path src/desktop/src-tauri/Cargo.toml`,
`cargo test --manifest-path src/desktop/src-tauri/Cargo.toml`, the clean
staging/native checks, and `npm --prefix src/desktop run tauri -- build`,
followed by five sequential direct packaged launches for each proof variable.
All 42 frontend tests and the Rust proof-gate test pass. Exact recursive
`external/MonoGame` HEAD, dirty status, nested submodule state, and dirty-file
contents remain unchanged; it was never edited, built, cleaned, reset,
stashed, or reverted. No cooperative Stop implementation was added and no
commit was created. Final evidence is in `files/issue023-remediation-4/`.

### Final independent re-verification — PASS (2026-08-27)

- **Verdict:** **PASS.** All four historical FAIL records remain preserved. Remediation 4 resolves the packaged readiness reliability blocker without weakening proof authorization or normal-mode behavior, and every issue-023 acceptance criterion is independently satisfied.
- **Native activation safety and authorization:** the macOS path obtains the exact Tauri `NSWindow`, keeps its owning `tauri::Window` alive, and dereferences it only inside `run_on_main_thread` closures after `MainThreadMarker` verification. It sets Regular policy, unhides, invokes modern `NSApplication.activate()`, orders that exact window key/front, requests Tauri focus, then observes active/key state on the main thread. Deprecated ignoring-other-apps calls are explicitly isolated as a compatibility fallback; Rust check/test and Release compilation report no warning or API error. Activation is bounded to three attempts with two-second callback deadlines. The IPC command rejects unless an issue-21/22/23 proof environment gate is present, as covered by the Rust gate test; all issue auto-proofs establish authorization before readiness can trigger compiler/preview bootstrap. Normal mode returns before this path and cannot emit proof reports.
- **Strict fresh-process matrix:** three issue-21 PIDs `18810`, `18849`, `18883`; three issue-22 PIDs `18917`, `18960`, `19003`; and three issue-23 PIDs `19045`, `19109`, `19180` all passed on their first and only launch, with a fixed two-second cooldown and no retry-until-pass. Every process used one native activation attempt, 106–110 ms native activation, 284–341 ms total readiness, visible/focused/non-minimized AppKit and Tauri window state, visible document state, advancing `requestAnimationFrame`, a strict three-frame managed Draw increase at readiness, and 20 final top-level frames. Issue-21 reports completed their protocol invariants; issue-22 reports completed one compiler, 14 previews, and 14 teardowns. Each exact PID had no descendant and no IPv4/IPv6 `lsof` entry during its report window, exited before the next launch, and left no stale process.
- **Issue-23 runtime/lifecycle:** all three reports observed response before correlated `preview.started` sequence 1, one compiler and one primary preview runtime, retained/not-disposed ownership through the report window, one Run, and delayed proof cleanup disposing exactly once. Every actual-runtime case passed: before-load, same-correlation duplicate, distinct concurrent start, successful then repeated start, delayed started event, synchronous Run failure, receiver deadline, immediate requester timeout, actual late discard, unexpected boundary, and the managed admission/retention/teardown/fatal-classifier self-test. The late case observed exactly two discarded messages and zero accepted lifecycle events; the unexpected case directly observed endpoint `closed: true`, sole reason `unexpected-start-boundary`, one keyed authorized `INTERNAL_ERROR`, no lifecycle or unexpected acceptance error, and timeout of the subsequent request.
- **Rendering and personal visual acceptance:** issue-23 run 1 used compile `f754b8c1-af13-46f7-ad50-1aee61d83c61`, preview `d620bd5a-8ae6-48cb-878a-d7629e6f8764`, compile correlation `c57f8d1f-f223-4e54-b4de-c4a98b198e0c`, load correlation `29372ed2-5733-48ea-a008-a0dc6f999a7c`, and start correlation `37357781-05cc-4e84-ba6d-02d566855295`. Run returned in 6 ms, managed Draw advanced by 307, and the live nested 800×480 WebGL buffer returned exact `[100,149,237,255]` at center plus four corners twice 5,109 ms apart with zero GL error and no context loss. Two exact app-window captures six seconds apart personally show the dedicated nested CornflowerBlue canvas persisting while the separate top-level animation advances; no unrelated app or full screen was captured.
- **Normal mode and regressions:** with all proof variables absent, the packaged app remained running and emitted zero proof report/checkpoint output. The trusted issue-21 control displayed `Loaded Issue021Foo · 2 sequence points`; the normal issue-23 control displayed `Running clear-color Game in retained preview.` and stayed visibly CornflowerBlue in two app-only captures six seconds apart. Normal startup did not call proof activation/report instrumentation. Prior issue-21/22 protocol, isolation, teardown, and top-level rendering invariants all passed.
- **Commands and hygiene:** all 42 frontend tests, Rust check and proof-gate test, typecheck, clean preview/issue-21 staging, native-artifact validation, compiler Release, preview Release, and Tauri Release passed with zero build warnings/errors. Cargo pins and lock resolution use the same `objc2 0.6.4`/`objc2-app-kit 0.3.2` family already used transitively by Tauri. `git diff --check` passed. No stop/exit implementation was added. `external/MonoGame` was never built, cleaned, reset, stashed, reverted, or edited; recursive HEAD/status/submodules and SHA-256 hashes of every changed/untracked regular file are byte-for-byte identical before and after. No status or Done marker was changed and no commit was created. Independent evidence is in `files/issue023-reverification-4/`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: run Game asynchronously and retain strong reference`

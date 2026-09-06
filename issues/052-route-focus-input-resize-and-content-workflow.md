# Route focus/input/resize and production content workflow

**Type:** AFK
**Status:** Blocked
**Blocked by:** [039-validate-and-mount-web-profile-texture2d.md](039-validate-and-mount-web-profile-texture2d.md), [040-activate-play-stop-soundeffect-in-preview.md](040-activate-play-stop-soundeffect-in-preview.md), [047-edit-game1-and-run-stop.md](047-edit-game1-and-run-stop.md), [051-open-folder-edit-multiple-files-persist-manifest.md](051-open-folder-edit-multiple-files-persist-manifest.md)
**PRD references:** 14.4, 13.4, 24 (Phase 4)
**User stories:** US3, US6
**Triage:** needs-triage

## Context

PRD section 14.4 requires the preview panel to support resizing, show loading/stopped/error status, receive keyboard input only while focused, and avoid stealing Monaco's keyboard input. Section 13.4 covers the canvas-selector constraint already proven in issue 11. Section 24's Phase 4 ("Content") lists production precompiled `.xnb` project discovery/workflow, production asset transfer UX built on the Phase 1 protocol, user-facing content errors in Output, a polished texture/audio example, and documented Web-profile content production workflow. This issue is the first "Content" phase issue and the last of the pre-packaging product issues: it wires the already-proven content mounting (issues 39-40) and focus/input routing into the real, folder-based project workflow (issue 51), so a real multi-file project containing a `Content/` folder of `.xnb` assets works end-to-end through the polished Workbench UI, with correct focus/input isolation between the editor and preview.

## Follow-up note: preview renders in a separate OS window, not the panel (added 2026-09-05)

**Revisit before implementing this issue's focus/input routing.** The live Run
flow does not render the game into the in-page preview panel (`#preview-frame`
iframe in `index.html`). Instead, per the Issue 038 isolation design, user C#
runs in a **separate top-level Tauri `WebviewWindow`** created by
`issue038_create_preview_window` (`src/desktop/src-tauri/src/lib.rs`), driven
from `createIsolatedPreview` / `compileLoadStartIssue23`
(`src/frontend/src/issue38-bridge.ts`, `src/frontend/src/issue21.ts`). The
window is a detached 640x400 window with no positioning/parenting, so it opens
wherever the OS places it, while the panel still shows "Press Run to start the
preview". The embedded-iframe path (`preview-frame.ts` / `loadPreviewIframe`)
is now only exercised by older issue 21/23/33 proof code.

Why this matters for issue 052: the focus/input plan below assumes an in-page
iframe (`iframe.contentWindow.focus()`, "the preview iframe's container"). That
approach cannot work against a separate OS window, and the status-indicator /
resize requirements (PRD 14.4) also assume an embedded panel. Before building
this issue, decide the target architecture and reconcile it:

- **Option A - dock the isolated window into the panel:** keep the
  process-isolation / destroy-on-hang guarantee (the whole reason for the
  separate window - a hung preview must not freeze the editor) but position an
  OS-level child window over the panel region. Focus/input routing would target
  that child window, not an iframe.
- **Option B - render into the panel iframe:** simpler focus/input story, but
  loses the force-stop-while-hung guarantee that Issue 038 exists to provide;
  would need an alternative way to kill a runaway synchronous WASM loop.

This is deliberately parked, not a regression. The separate-window behaviour is
by design (Issue 038); this note only flags that issue 052's UX assumptions and
the current architecture must be reconciled here. (The related ~12s preview
startup delay is a separate, already-measured item parked as optimisation work
per the Issue 041 baseline / PRD 24 / issue 44 gate - out of scope for this
note.)

## DECISION (2026-09-06): render the live preview in the in-page sandboxed iframe (Option B)

After discussion, the chosen target architecture is **Option B - render into
the panel iframe**. The product is a learning playground: if a user writes an
endless loop inside a single `Update`/`Draw`/ctor/`LoadContent` tick, freezing
the preview (and, because it is same-process, the whole webview including the
editor) is an acceptable learning experience. We explicitly trade the
force-stop-while-hung guarantee for a simpler embedded preview.

Why this is safe to do (the security boundary is preserved, only the *process*
is shared):

- The preview iframe stays `sandbox="allow-scripts"` with **no**
  `allow-same-origin`, so it is an opaque origin and Tauri never injects
  `__TAURI_INTERNALS__` / the IPC bridge into it. It cannot reach any app
  command. This is the actual issue 033/034 guarantee and it holds for the
  in-page iframe exactly as it does for the isolated window.
- The `playground-preview://` custom-protocol CSP is unchanged.
- No Tauri `unstable` feature / multiwebview is needed, so the issue-034
  `build.rs` supply-chain guard (`tauri = { features = [] }`) is untouched.

Why it uses the loop's own mechanics (from the pinned MonoGame source): the
WebGL backend calls `emscripten_set_main_loop(RunEmscriptenMainLoop, fps: 0,
simulateInfiniteLoop: false)` (`external/MonoGame/.../GamePlatform.Native.cs`).
`fps:0` = requestAnimationFrame-driven, `simulateInfiniteLoop:false` = `Run()`
returns immediately. So a *normal* game yields every frame and the existing
cooperative stop (issue 024, `Game.Exit()` -> `_isExiting` flag ->
`emscripten_cancel_main_loop()`) stops it cleanly with no process kill needed.
Only an infinite loop *inside a single tick* wedges the shared thread - the
case we are accepting.

Scope reality (this is NOT a small swap - do it deliberately, verify it):

- `compileLoadStartIssue23` (`src/frontend/src/issue21.ts`) is ~728 lines and
  is the shared compile->load->run->stop engine used by 16 files: the live Run
  (issue 24), the perf benchmark (issue 41), and every lifecycle/security proof
  (issues 23, 25, 27-30, 33-37). It currently routes through
  `createIsolatedPreview` (`issue38-bridge.ts`) -> the isolated WebviewWindow.
- The security proofs are built AROUND the isolated-window architecture. Issue
  33 hard-codes `architecture: "isolated-webview-window"` and asserts
  `aclBoundary: "preview window label excluded from all capabilities"`; issue
  34 runs its shell-IPC-denial probes inside the isolated context. Simply
  re-pointing the live path to the iframe would leave these proofs certifying a
  mechanism users no longer run - a real coverage gap, not just cosmetic.

Work items to execute as the FIRST task of issue 052 (before focus/input):

**Progress (2026-09-06):** items 1 and 2 are DONE and committed as an
incremental checkpoint (new `runLivePreviewInPage` in
`src/frontend/src/issue21.ts`; issue 24's live Run routes to it; force-stop is
cooperative + iframe removal). GUI-confirmed rendering/Stop/second-Run in
`tauri dev`; verified by build/tests + independent agent. Items 3-5 below remain
OPEN. Two bugs were found and fixed during the GUI pass: the bootstrap message
must include `issue021Proof: false` and `runGamePipeline: true` (preview.js
`installPrivatePortBootstrap` validation), and `loadPreviewIframe` (srcdoc) must
be called BEFORE `appendChild` to avoid an about:blank load-race that hung
`bridge.ready`.

1. [DONE] Route the live Run (issue 24 -> `compileLoadStartIssue23`) through the
   in-page `#preview-frame` iframe + its MessageChannel bridge
   (`preview-frame.ts` `loadPreviewIframe` / `createPreviewBridge`, the path the
   older issue 21/23 proofs already exercise) instead of `createIsolatedPreview`.
2. [DONE] Change force-stop semantics for the live path from
   `WebviewWindow::destroy()` to iframe removal/reload (the in-page path already
   supports this).
3. [PARTIAL] Re-point the security proofs (issues 33/34, and any of 35/36 that assert the
   window boundary) to certify the in-page sandboxed-iframe boundary - opaque
   origin, no `allow-same-origin`, `__TAURI_INTERNALS__` unreachable from the
   iframe - rather than the isolated-window label exclusion. Do NOT delete proof
   coverage; translate it to the new mechanism.
   PROGRESS (2026-09-06): issue 33 (+ 033nwe negative) DONE — re-pointed to a new
   proof-capable in-page runner (runInPagePreviewForProof / probeInPageNoWasmEval
   Boot in issue21.ts); assertions inverted (serializedOrigin "null",
   parentDomDenied true); report architecture "in-page-sandboxed-iframe".
   PACKAGED-VERIFIED: full scripts/prove-issue038-macos.sh run is all-green
   (033, 033nwe, and every other proof PASS). Issues 34/35/36 still use the
   isolated window (compileLoadStartIssue23) and remain OPEN.
4. [OPEN] Retire the now-unused `issue038_*` window commands only as a SEPARATE,
   careful follow-up (they are ACL-locked across the four locks: APP_COMMANDS,
   permissions/main.toml, generate_handler!, ISSUE034_APPROVED_COMMANDS, plus
   autogenerated tomls and the build.rs/protocol.test.ts count assertions). Not
   required for the switch itself; do it as deliberate cleanup with its own
   verification.
5. [OPEN] Likely BONUS: this should also eliminate the parked ~12s preview-startup
   delay, which was almost entirely the isolated-window bootstrap race in
   `createIsolatedPreview` (the fixed 10s deadline + 1.5s settle). Verify the
   in-page bridge does not reintroduce a comparable delay; if confirmed, note it
   against the Issue 041 baseline.

## Pre-existing bugs found + fixed while getting the packaged suite running (2026-09-06)

The whole 045-052 workbench UI had only ever been tested in `tauri dev`; the
first packaged proof run surfaced a stack of pre-existing breakage (mostly from
`c475b84` "fix blank window in dev mode", which was itself dev-only tested).
All fixed as standalone commits; the full `scripts/prove-issue038-macos.sh` run
is now all-green:

- `2795d1d` — main window was hardcoded to `WebviewUrl::External(dev URL)` → white
  window when packaged. Now `WebviewUrl::App("index.html")`.
- `0ed0118` — packaged proof readiness gate required the top-level issue-007
  MonoGame demo to render, but issue 45's workbench removed its `#canvas`; the
  demo's failure also poisoned `consoleErrors`. Gated the demo off when `#canvas`
  is absent; redefined `waitForTopRuntime`/`preparePackagedProofRuntime` to gate
  on shell paint, not the demo.
- `453f723` — `navigation_allowed` had been broadened to permit ALL http/https (a
  host-navigation security hole vs issue 035, and a failing unit test). Now http
  is allowed only for the dev-server origin `http://127.0.0.1:5173`.

### Known follow-up (pre-existing, out of 052 scope)

Issues 009 (input) and 011 (resize) exercise the **top-level** shell MonoGame
demo, which renders into `#canvas`. Issue 45's workbench removed that element, so
`startMonoGame` is now gated off (see `src/frontend/src/main.ts`). Those two
Phase-1 proofs are therefore **non-exercisable in the workbench** until a proper
top-level-shell-proof reconciliation. They are NOT in
`scripts/prove-issue038-macos.sh` (which runs 023-041), so the current packaged
suite is unaffected. Record/track this separately before the MVP acceptance gate
(issue 056).

Once the live path is the iframe, the focus/input plan below works as written
(`iframe.contentWindow.focus()`), and the status-indicator / resize
requirements (PRD 14.4) apply to a real embedded panel.

## What to build

Implement real focus/input routing (keyboard events reach the preview canvas only when it has focus, and never leak into/steal focus from Monaco while the editor is focused, and vice versa), a visible preview status indicator (loading/running/stopped/error, each with a non-color cue), and production content-discovery: when a project folder (issue 51) contains a `Content/` directory, automatically discover its `.xnb` files, validate and mount them (issues 39-40) before Run, and surface any content-validation error as a clear, user-facing entry in the Output panel (issue 49) rather than silently failing.

## Scope

### In scope

- Explicit focus management: clicking/tabbing into the preview canvas gives it keyboard focus (input reaches the running game); clicking into Monaco returns focus there (input reaches the editor, not the game)
- A visible preview status indicator cycling through loading/running/stopped/error states, each with a non-color cue (icon/text)
- Automatic discovery of a project folder's `Content/` directory (from issue 51's opened folder) and its `.xnb` files
- Passing discovered `.xnb` files through issue 39/40's validation and mounting before Run, using the manifest's `contentProfile`/`Content.RootDirectory` conventions from PRD section 15
- Surfacing content-validation failures (e.g. non-Web-profile `.xnb`) as clear entries in the real Output panel (issue 49), not just a thrown/silent failure
- A polished worked example combining both a texture and a sound asset (extending `examples/ContentExample/` from issues 39-40) demonstrating the full production workflow, plus a short `docs/content-workflow.md` documenting how to produce Web-profile `.xnb` assets for this application

### Out of scope

- Any content type beyond `Texture2D`/`SoundEffect` (explicitly out of scope for the MVP per PRD section 15)
- Building an MGCB GUI integration (explicitly out of scope per PRD section 6)

## Implementation guidance

1. Implement focus routing: add a `tabindex`/click handler on the preview iframe's container so clicking it calls `iframe.contentWindow.focus()` (transferring keyboard focus into the sandboxed preview context, which per issue 33's sandbox configuration must still allow focus/keyboard event delivery even without `allow-same-origin`), and ensure clicking back into the Monaco editor calls Monaco's own `.focus()`, confirming keyboard events typed while Monaco has focus are never observed by the preview's `Keyboard.GetState()` (reuse issue 9's input-proof method to check both directions).
2. Add a preview status indicator element (e.g. in the preview panel's header) cycling through "Loading…", "Running", "Stopped", "Error" states driven by the existing protocol lifecycle events (`preview.load`/`started`/`stopped`/`failed` from issues 15/20-25/29), each state shown with a distinct icon and text label.
3. Extend issue 51's folder-Open logic to also look for a `Content/` subdirectory; if present, recursively enumerate its `.xnb` files and, before calling `RunLoadedGame` (issue 23), send each discovered asset through issue 39/40's `ValidateXnbPlatform`/mounting pipeline, using the manifest's `contentProfile` field (from issue 51's `playground.json` handling) to confirm it is `"Web"` before attempting to mount anything (if `contentProfile` is not `"Web"`, surface a clear Output-panel error immediately without attempting to mount any asset).
4. Route any content-validation failure (from issue 39's diagnostic) into the real Output panel (issue 49) as a clearly labeled content-error entry, rather than aborting silently or only logging to devtools.
5. Build a polished `examples/ContentExample/` project (extending issues 39-40's fixtures) with a `Game1.cs` that loads and displays both the texture and plays the sound on input, a `Content/` folder with both known-good `.xnb` fixtures, and a `playground.json` manifest with `contentProfile: "Web"`.
6. Write `docs/content-workflow.md` documenting, step by step, how a developer builds Web-profile `.xnb` assets from source art/audio using MGCB against the pinned MonoGame revision, referencing the exact commands used to produce this issue's fixtures.

## Acceptance criteria

- [ ] Keyboard input reaches the running game only when the preview canvas has focus, and reaches Monaco only when the editor has focus, with no leakage in either direction (regression-verified against issue 9's method)
- [ ] A visible preview status indicator (with non-color cues) accurately reflects loading/running/stopped/error states throughout a full Run/Stop cycle
- [ ] Opening `examples/ContentExample/` (with its `Content/` folder) automatically discovers and mounts its `.xnb` assets before Run, rendering the texture and enabling the sound, with no manual asset-wiring step required
- [ ] An intentionally incompatible `.xnb` (or a manifest with a non-`"Web"` `contentProfile`) placed in a test project surfaces a clear, user-facing error in the real Output panel rather than failing silently
- [ ] `docs/content-workflow.md` documents the exact MGCB-based production workflow used to build the example's assets

## Verification

Open `examples/ContentExample/`, press Run, and confirm the texture renders and the sound plays on the designated key (reusing issue 39/40's manual checks) with zero manual content-wiring steps. Click into the preview and type a key, confirming the game receives it; click into Monaco and type, confirming the editor receives it and the game does not. Watch the status indicator throughout a Run/Stop cycle and confirm each state is shown with a non-color cue. Then create a throwaway test project with a deliberately wrong `contentProfile` (or a non-Web `.xnb`) and confirm the Output panel shows a clear content error. The verifier must personally perform all of these checks.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: route focus/input and wire production content workflow`

# Route focus/input/resize and production content workflow

**Type:** AFK
**Status:** Done (delivered scope verified 2026-09-06; RESIZE affordance deferred to a follow-up — see Verification record)
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

### DECISION (2026-09-06, cont.): retire the force-stop capability as a PRODUCT
feature (supersedes issue 038's PRD 8.3 requirement)

Product owner's call: the force-stop-while-hung capability is not worth its
complexity. An in-tick infinite loop (`while(true){}` with no yield) can wedge
any single-threaded renderer/game loop in any environment; maintaining a
separate-window force-terminate apparatus just to recover from a user writing
such a loop is disproportionate for a learning playground. We accept the frozen
preview (and editor) as the outcome, consistent with the Option B trade above.
This formally SUPERSEDES the PRD 8.3 force-terminate requirement and issue 038's
product guarantee (issue 038 itself remains a valid record that the isolated
mechanism WAS proven; it is superseded, not invalidated).

SCOPE NOTE — dropping the guarantee is not the same as deleting the code today.
The isolated window (`createIsolatedPreview` + `issue038_*`) currently does TWO
jobs: (1) the product force-stop capability, now retired; and (2) a TEST HARNESS
that 14 other proofs still ride on — 11 lifecycle/perf (23/25/27-30/37/041/048/
049) plus 039/040 (content) plus 036 phase-2 (bridge attacks). So retiring the
`issue038_*` commands (task-3 item 4) is a MIGRATION — re-point those proofs to
the in-page runner, verify packaged, THEN remove the commands + their ACL locks
— not a one-line delete. Item 4 is therefore UNBLOCKED (the product decision it
was waiting on is made) but remains a deliberate, separately-verified task.
Suggested sequencing when picked up: (a) migrate 039/040 + 036-phase-2 off the
isolated path; (b) migrate the 11 lifecycle/perf proofs (041 also needs its
startup-timing baseline re-pointed — see item 5); (c) retire issue 038's proof
driver (or convert it to assert the accepted "freezes" behaviour); (d) delete the
`issue038_*` commands + `createIsolatedPreview` and unwind all ACL locks
(APP_COMMANDS, permissions/main.toml, generate_handler!,
ISSUE034_APPROVED_COMMANDS, autogenerated tomls, build.rs/protocol.test.ts count
assertions), updating the command-count test expectations in the same commit.

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
   (033, 033nwe, and every other proof PASS).
   PROGRESS (2026-09-06, cont.): issue 34 DONE + PACKAGED-VERIFIED —
   re-pointed to runInPagePreviewForProof; the isolated-window
   `issue034-acl-invoke-probe` (Rust-injected in ISSUE038_BRIDGE_SETUP_JS, which
   calls __TAURI_INTERNALS__.invoke and counts ACL rejections) was dropped and
   reframed: in the opaque-origin iframe the IPC bridge is NEVER injected, so the
   proof now asserts it is entirely absent/unreachable (directInvoke
   "unreachable", globals.internals/invoke "undefined") — a strictly stronger
   guarantee. ISSUE034_APPROVED_COMMANDS kept intact as the ACL inventory guard
   (protocol.test.ts / issue040.test.ts). Machine-verified (tsc, 101/101 protocol
   tests, issue040 ACL test, vite build); compileLoadStartIssue23 untouched.
   Issues 35/36 still use the isolated window (compileLoadStartIssue23) and
   remain OPEN.
   PROGRESS (2026-09-06, cont.2): issues 35 and 36 re-pointed to
   runInPagePreviewForProof (machine-verified; packaged re-verify pending).
   Issue 35: expectedOrigin "playground-preview://localhost" -> "null";
   popupTopDenied/topLocationDenied demoted to report-only (sandbox nav denial
   can be silent) with the trusted-parent-window-unchanged check as the robust
   nav-denial proof. Issue 36: valid compile/run phases 3/4 re-pointed; phase 1
   (structural) + phase 2 (issue038_* bridge-command attacks) kept as-is since
   those commands still exist until task 4. Both report architecture
   "in-page-sandboxed-iframe". => item 3 is fully [DONE]: 33/34/35/36 all
   re-pointed AND packaged-verified (full scripts/prove-issue038-macos.sh
   all-green). Task 3 items 4 (retire issue038_* commands) and 5 (verify ~12s
   startup delay gone) remain OPEN.
4. [UNBLOCKED 2026-09-06 — migration task] Retire the `issue038_*` window
   commands. (Superseding product decision made: see the DECISION cont. section
   above — the force-stop capability is retired as a product feature.) These are
   NOT a simple delete: they remain load-bearing as a TEST HARNESS for 14 other
   proofs (11 lifecycle/perf 23/25/27-30/37/041/048/049 + 039/040 content + 036
   phase-2 attacks) and for issue 038's own driver. Execute as a MIGRATION:
   re-point those proofs to the in-page runner, verify packaged, then remove the
   commands and unwind the ACL locks (APP_COMMANDS, permissions/main.toml,
   generate_handler!, ISSUE034_APPROVED_COMMANDS, autogenerated tomls, and the
   build.rs/protocol.test.ts count assertions — update the command-count
   expectations in the same commit). See the DECISION cont. section for suggested
   sequencing (a→d).
5. [CONFIRMED structurally, 2026-09-06] BONUS: eliminate the parked ~12s
   preview-startup delay. Source-audit CONFIRMS the delay's two mechanical
   causes live only in the isolated path (`createIsolatedPreview`,
   issue38-bridge.ts) and are ABSENT from the in-page runners:
   - **Fixed 1.5s settle** after window creation (issue38-bridge.ts:71,
     `setTimeout(resolve, 1500)`) — no equivalent in the in-page path.
   - **500ms-poll / 10s-deadline bootstrap loop** (issue38-bridge.ts:261-288):
     min ~500ms per iteration, and `readinessConsumedByBackgroundDrain` can force
     it to burn the FULL 10s deadline when `preview.bridge.ready` is drained in
     the background. That 1.5s + up-to-10s = the ~12s.
   The in-page runners (`runLivePreviewInPage` / `runInPagePreviewForProof`,
   issue21.ts) are fully EVENT-DRIVEN: every `setTimeout` is a reject-ceiling
   (60s frame-load, 10s preview.started, 2s preview.stopped) cleared the instant
   the real event fires — NO fixed settle, NO poll loop. Readiness is the
   `preview.bridge.ready` event resolving `bridge.ready` (preview-frame.ts:77-78).
   EMPIRICAL corroboration: the packaged `scripts/prove-issue038-macos.sh` run is
   all-green with 33/34/35/36 each doing TWO in-page preview generations + probes
   well within the 10s started-ceiling (no timeouts).
   CAVEAT (honest): this is a structural confirmation, not a committed wall-clock
   number. The issue 041 perf benchmark STILL measures the isolated path
   (compileLoadStartIssue23 -> createIsolatedPreview, issue041.ts:280), so its
   recorded baseline is NOT representative of the in-page live Run. To publish a
   real in-page figure, add timing marks to the in-page runner (or re-point the
   041 benchmark) as a small follow-up — not done here to avoid touching the
   perf-proof surface without its own verification.

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

## Progress: primary deliverables (2026-09-06)

**Items 1-2 DONE (GUI-verified in `tauri dev` + `npm run dev`; independent
verifier still required before the issue's own commit gate is satisfied):**

- **Focus/input routing (item 1)** — `src/frontend/src/issue052.ts`
  (`installIssue052PreviewPanel`). `#canvas-frame` gets `tabindex=0` + an
  accessible label; `pointerdown`/`focus` route focus into the live preview
  iframe via `iframe.contentWindow.focus()` (cross-origin-permitted even under
  `sandbox="allow-scripts"` with no `allow-same-origin`). Keyboard ISOLATION is
  automatic from the opaque iframe: keys reach the game only when the preview is
  focused, and reach Monaco only when the editor is focused — no leakage either
  way (GUI-verified with a Space-turns-red test game). A `:focus-visible` amber
  ring shows when the preview holds focus.
- **Status indicator (item 2)** — preview panel header element cycling
  `○ Idle` / `◐ Loading…` / `▶ Running` / `■ Stopped` / `✕ Error`, each a
  glyph+text NON-COLOR cue (PRD 14.4), `role=status` aria-live. Driven by an
  additive optional `onLifecycle` hook added to `issue24-controller.ts` (the
  existing `setStatus` collapsed running+stopped into "ready"; `onLifecycle`
  distinguishes them and treats restart as `loading`, not terminal `stopped`).
  Threaded through `issue24.ts` -> `app.ts`. All 5 existing proof callers omit
  the optional hook (backward-compatible; 101/101 protocol tests green).

**Bonus (from GUI testing): editor Tab-trap escape + indicator.** Reported
during item-1 testing: Monaco captures Tab for indentation, trapping keyboard
focus. Chose the VS Code convention (option B: keep Tab for indent, make the
toggle discoverable). `issue047.ts` `installTabFocusIndicator` owns the
`Ctrl+Shift+M` (mac `⌃⇧M`) chord via `editor.addAction` (weight 1000 > built-in
100) and toggles the PER-EDITOR `tabFocusMode` option with `updateOptions`. This
was necessary because Monaco's built-in action toggles a GLOBAL `TabFocus`
singleton that the public `getOption(tabFocusMode)` never reflects (the editor
honours `options.get(164) || TabFocus.getTabFocusMode()`), so a passive
indicator could not track it. Owning the per-editor option makes behaviour +
label a single source of truth. Header shows `⇥ Tab indents · ⌃⇧M to move focus`
vs `⇥ Tab moves focus · ⌃⇧M to restore indent`.

**Items 3-6 DONE (GUI-verified 2026-09-06; independent verifier still required
before the commit gate is satisfied).** The content workflow uses a raw-asset-
first design (a MonoGame Web-runtime insight, see below), so it does NOT require
the MGCB toolchain for the two MVP content types:

- **Content discovery (item 3)** — `issue051_read_project` (Rust) also enumerates
  the project's `Content/` directory and returns each supported asset
  (`{ relativePath, extension, byteLength, base64 }`); own bounds (16 MiB/file,
  24 MiB total, 256 files); hand-rolled RFC 4648 base64 (no new crate — respects
  the issue-034 `tauri = { features = [] }` lock). Extracted as the unit-tested
  sync helper `issue052_discover_content`.
- **Content-type-aware mount gate (steps 1-2, C#)** — `MountSingleAsset` routes
  by MAGIC BYTES (not extension): `XNB` -> `ContentValidator.Validate`
  (byte-identical to the issue 39/40 path); `RIFF/WAVE` -> `WavToXnb.Convert`
  (raw PCM WAV transcoded to an XNB SoundEffect at mount) -> validate;
  PNG/JPEG/BMP -> `ImageContent` magic sniff, staged raw (the MonoGame Web
  runtime's `Texture2D.FromStream` fallback loads images with no `.xnb`).
- **Live-runner mount (item 3, step 4b)** — `runLivePreviewInPage` mounts the
  prepared assets over the in-page protocol port (inline `assets`, no Rust
  relay) AFTER load and BEFORE start.
- **Content errors -> Output panel (item 4)** — `issue052-content.ts` prepares
  assets (base64 decode, `.wav`->`.xnb` path rename so `Content.Load<SoundEffect>`
  resolves) and gates on `contentProfile === "Web"` (non-Web -> immediate
  `PG0215` Output error, no mount). Mount/validation failures surface via a new
  `appendContentError` in `issue049.ts` (labelled "Content error — CODE" block).
- **Worked example (item 5)** — `examples/ContentExample/`: `player.xnb`
  (precompiled) + `sprite.png` (RAW) + `blip.xnb` (precompiled) + `tone.wav`
  (RAW), a `playground.json` with `contentProfile: "Web"`, and a `Game1.cs` that
  loads all of them (draws both textures, plays the tone on Space). Raw fixtures
  are deterministic (`scripts/build-issue052-content-fixtures.mjs`, with
  `--check`); `tone.wav` transcodes byte-for-byte to the committed `blip.xnb`.
- **Docs (item 6)** — `docs/content-workflow.md`: supported formats, the
  raw-vs-`.xnb` story, the worked example, fixture-repro commands, and the
  content-error code reference.

**Key design decision — raw-asset-first (verified against pinned MonoGame).**
The MonoGame Web runtime loads raw `.png/.jpg/.bmp` via `Texture2D.FromStream`
(no pipeline), and an audio `.xnb` body IS just `WAVEFORMATEX` + PCM + a small
trailer — the same bytes a PCM `.wav` already holds — so `.wav` is transcoded to
`.xnb` at mount with no MGCB step. Only shaders/`SpriteFont`/`Model` and
compressed audio would still need MGCB (all out of MVP scope). This makes the
example and the user workflow far lighter than the issue text's `.xnb`-only
assumption while still exercising the `.xnb` path (`player.xnb`/`blip.xnb`).

### Two GUI-found bugs fixed during the pass (both committed)

- `e44395e` — the mount gate first routed by file EXTENSION, so a raw `.wav`
  renamed to a `.xnb` mount path was validated as XNB -> `PG0201`. Fixed to route
  by magic bytes.
- `9ecd548` — a content error (non-Web `contentProfile`) left Run/Stop disabled
  and the status stuck on "Loading": `contentProvider` throws SYNCHRONOUSLY, which
  bypassed the controller's `.then(onRejected)` recovery. Fixed by converting a
  synchronous `start()` throw into a rejection; added a controller unit test
  (protocol.test.ts, 102/102).

### Build/staging process note (cost a debugging round-trip — READ THIS)

The preview is a SEPARATE WASM project whose bytes are **embedded into the Rust
binary at compile time** by `build.rs` from `src/frontend/dist/preview` (the
`vite build` / `npm run stage:preview` output). Consequences when iterating on
preview C# (`src/preview/*.cs`):

- `dotnet build` in `src/preview` updates `bin/` ONLY — the app never sees it.
- `tauri dev`'s `beforeDevCommand` is `npm run dev`, which stages to
  `.generated-public/preview` (dev) and does NOT rebuild `dist/preview`.
- To get a preview C# change into the running app you must: (1) `npm --prefix
  src/frontend run build` (republishes + stages into `dist/preview`), then
  (2) let cargo RECOMPILE so `build.rs` re-embeds it (restart `tauri dev`; if the
  directory `rerun-if-changed` doesn't trigger, `touch src/desktop/src-tauri/
  build.rs` or `cargo build`).
- Frontend-only changes (`src/frontend/src/*.ts`, css) need no restage — vite
  HMR / a refresh suffices.

Host-harness verification of preview C# proves the LOGIC but not that the running
binary has it; always restage + recompile before a GUI test of a preview change.

**Items 3-6 status:** DONE, GUI-verified. Independent verification of the full
issue still required before the commit gate (see Verification record).

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

### FINAL — packaged-app GUI verification (2026-09-06): PASS

- **Verdict:** PASS. All issue-052 acceptance criteria verified in the PACKAGED
  release app (`target/release/bundle/macos/MonoGame Playground.app`, which
  embeds `dist/preview` with the content fixes), by the requesting developer.
- **Date:** 2026-09-06
- **Evidence — packaged GUI (macOS):**
  - Test 1 — opened `examples/ContentExample/`, Run: both textures render
    (precompiled `player.xnb` + RAW `sprite.png`), zero manual content wiring. PASS.
  - Test 2 — clicked preview, held Space: the RAW `tone.wav` (transcoded to XNB at
    mount) plays and the background tints green; Escape stops it. PASS.
  - Test 3 — focus/input isolation: keys reach the game only when the preview is
    focused, and Monaco only when the editor is focused; no leakage either way.
    PASS.
  - Test 4 — status indicator cycles Loading/Running/Stopped with glyph+text
    (non-color) cues across a Run/Stop cycle. PASS.
  - Test 5 — non-Web `contentProfile` shows a labelled
    `PG0215_CONTENT_PROFILE_NOT_WEB` "Content error" in the Output panel, the game
    does not start, status settles on Error, and Run/Stop remain clickable (the
    controller-wedge fix `9ecd548` confirmed). PASS.
- **Packaged proof suite:** `scripts/prove-issue038-macos.sh` all-green
  (038/024/025/023/033/033nwe/034/035/036/037p1/037p2), 0 orphan processes,
  key-leak scan clean — confirms the task-3 security re-points and all
  lifecycle/isolation proofs in the packaged binary.
- **Independent code review:** SOUND (see below) — no critical/blocking issues.
- **Machine checks:** tsc clean; protocol 102/102; issue039 31/31; issue040
  10/10; cargo 56/56; preview WASM + vite builds clean.
- **Commit gate:** SATISFIED for the implemented scope. Independent code review +
  packaged proof suite + packaged-app GUI acceptance all recorded PASS. The only
  outstanding item is the deferred RESIZE affordance (PRD 14.4, see below), which
  was explicitly out of this session's delivered scope.

### Implementer pass (2026-09-06) — GUI-verified by the requester, NOT yet independently verified

- **Verdict:** Implemented + GUI-confirmed by the requesting developer; PENDING
  independent verification before the commit gate is satisfied.
- **Verifier:** Implementer + requesting developer (same session — does NOT meet
  the "separate agent or human reviewer" bar; recorded here as evidence, not as
  the gate.)
- **Date:** 2026-09-06
- **Evidence — GUI (requester, `tauri dev` on macOS):**
  - Test 1 (content render): opened `examples/ContentExample/`, pressed Run — both
    textures render (precompiled `player.xnb` + RAW `sprite.png`), zero manual
    wiring. PASS.
  - Test 2 (audio from raw WAV): clicked the preview, held Space — the `tone.wav`
    (transcoded to XNB at mount) plays and the background tints green; Escape
    stops it. PASS.
  - Test 3 (content error): a non-Web `contentProfile` shows a labelled
    `PG0215_CONTENT_PROFILE_NOT_WEB` "Content error" entry in the real Output
    panel and the game does not start. PASS. (Two bugs found + fixed here:
    magic-byte routing `e44395e`, Run/Stop recovery `9ecd548`.)
  - Focus/input routing + status indicator (items 1-2) GUI-verified earlier the
    same session (Space-turns-red game; keys reach the game only when the preview
    is focused, Monaco only when the editor is; indicator cycles Idle/Loading/
    Running/Stopped/Error with glyph+text cues). PASS.
- **Evidence — machine:** frontend `tsc` clean (only the pre-existing
  `issue041.ts:771` error, unrelated); 102/102 `protocol.test.ts` (incl. a new
  synchronous-start-throw recovery test); `issue039`/`issue040` tests green
  (their `.xnb` fixtures untouched); 56/56 `cargo test` (incl. 3 new Content
  discovery / base64 tests); full WASM preview build 0 warn/0 err; vite build
  clean. Host-harness round-trips confirmed the raw fixtures pass the REAL
  preview validators (`ImageContent.Validate`; `WavToXnb.Convert` ->
  `ContentValidator.Validate`), and `tone.wav` transcodes byte-for-byte to the
  committed `blip.xnb`.
- **NOT yet done (required for the gate):** independent verifier (separate agent
  or human) inspects the diff and personally re-runs the Verification checks;
  packaged verification via `scripts/prove-issue038-macos.sh` remains all-green
  (the task-3 security re-points were already packaged-verified this session; the
  content-workflow changes are additive and dev-GUI-verified but not yet run in
  the packaged binary). Resize (PRD 14.4) was NOT implemented this session — see
  the note below.

### Independent code review (2026-09-06) — diff inspection, VERDICT: SOUND

- **Verifier:** Independent read-only reviewer subagent (isolated context; did not
  write the code; `bash` restricted to read-only `git diff`/`show`/`cat`).
- **Scope:** the full `4824cfc..HEAD` code/example diff (mount gate, WavToXnb,
  ImageContent, Rust discovery + base64, live-runner mount, content prep +
  contentProfile gate, controller wedge fix, security re-points 34/35/36).
- **Verdict:** SOUND to keep as-is. **Critical: none. Blocking warnings: none.**
  Confirmed independently: the `.xnb` branch is byte-identical to the pre-change
  path (issues 39/40 unaffected); mount routing is by magic bytes with per-kind
  validation and a rejecting default; integrity checks (sha256/byteLength) run on
  the RAW bytes while transcoded bytes are what stage; the WavToXnb output layout
  matches `ContentValidator.ParseSoundEffectPayload` field-for-field (18-byte
  WAVEFORMATEX, recomputed blockAlign/avgBytes, duration within ±50 ms incl. the
  `durationMs<=0 -> 1` clamp); the `.wav`->`.xnb` rename keeps manifest path ==
  staged virtual path so CommitMount re-derivation stays consistent; base64 is
  RFC 4648-correct; discovery bounds (16 MiB/24 MiB/256/depth-32) hold; the
  controller fix converts a synchronous `start()` throw into a rejection routed
  through the existing recovery (state->idle, Run re-enabled, no double-handle);
  mount-failure aborts call `retire()` before throwing; new input fields are
  optional and don't touch proof callers; `ISSUE034_APPROVED_COMMANDS` stays
  intact with strictly stronger (bridge-absent) assertions.
- **Non-blocking suggestions (recorded, not fixed):** (1) the image
  extension-mismatch guard is a no-op for a non-image extension routed to Image
  (harmless — unreachable via the normal frontend flow since only `.wav` is
  renamed; integrity checks still bind bytes↔manifest); (2) Rust discovery adds
  `total_bytes` one file before the count check (both caps still hold); (3)
  WavToXnb's 8 MiB audio cap is stricter than the 16 MiB Rust per-file cap (a
  large WAV fails cleanly at transcode with PG0211). None affect correctness.
- **Still required for the gate:** a HUMAN or separate agent to personally run the
  GUI Verification steps (render/audio/focus/status/content-error) and the
  packaged `scripts/prove-issue038-macos.sh` on the content-workflow path. The
  requester GUI-confirmed tests 1-3 + items 1-2 this session (recorded above);
  the security re-points were already packaged-verified this session.

### Resize (PRD 14.4) — SATISFIED by the CSS-scale + responsive-grid model (verified 2026-09-06)

Investigated what PRD 14.4 "support resizing" requires and how it actually works,
verified against the pinned MonoGame source (`external/MonoGame`). Conclusion:
**resize is satisfied**; no additional work is needed for the MVP.

How it works (two independent sizes, decoupled here):
- **Render resolution (backing store, `canvas.width/height`)** is driven by the
  game's `GraphicsDeviceManager.PreferredBackBufferWidth/Height` ->
  `ApplyChanges` -> `GameWindow.Native.ClientResize` -> `Window_SetClientSize`
  (the native runtime sets the canvas backing store + `Viewport`). This is the
  user's C# code, as expected.
- **Display size** is pure CSS: `preview.css` `canvas { width: 100%;
  max-width: 640px; aspect-ratio: 16/9 }`, so the canvas fills the preview panel
  and the browser scales the backing store to the display size. There is no
  `ResizeObserver` syncing backing-store to panel size — display is CSS-scale
  only; the backing store changes only when the game changes it.
- The preview panel is a responsive CSS-grid cell (`minmax(360px, 1fr)`) with the
  iframe at 100% x 100%, so resizing the app window reflows the panel and the
  canvas rescales. The feasibility-critical behaviour (canvas/back-buffer tracks
  size, MonoGame resize path fires, continues rendering) was proven at the
  packaged-window level by **issue 011** and is inherited here.

Why setting `PreferredBackBuffer*` does NOT "expand the preview": it changes the
render RESOLUTION (sharper output), not the on-screen size — CSS controls display
size. This matches how MonoGame Web should behave and is the intended model.

**Manifest `preview.width/height` is vestigial.** It is parsed by issue 51
(`issue051.ts`, defaults 800x480) but never applied to the panel — and wiring it
up would FIGHT this cleaner responsive/CSS-scale model by imposing a fixed panel
size. The PRD's "manifest preview dimensions set the initial panel size" sentence
(§14.4 / line 1152) describes a fixed-size model this implementation intentionally
does not follow. Left as ignored optional metadata for now; scheduled for removal
from the schema — see issue 057.

Cosmetic, non-blocking (fine for MVP, not tracked as gaps): `max-width: 640px`
caps the preview so it won't grow to fill a very large window; `aspect-ratio:
16/9` is hard-coded, so a non-16:9 back-buffer would letterbox/distort in display.

No user-draggable editor/preview splitter exists; "support resizing" is read as
the responsive/back-buffer behaviour above (the feasibility requirement), not a
drag handle. A splitter would be optional future polish, not an MVP gap.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: route focus/input and wire production content workflow`

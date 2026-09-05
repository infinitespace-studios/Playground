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

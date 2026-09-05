# Edit default Game1.cs and Run/Stop

**Type:** AFK
**Status:** Implementation complete — awaiting independent verification
**Blocked by:** [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md), [025-restart-preview-with-clean-static-state.md](025-restart-preview-with-clean-static-state.md), [046-add-persistent-theme-and-accessibility.md](046-add-persistent-theme-and-accessibility.md)
**PRD references:** 8.1, 8.2, 24 (Phase 2)
**User stories:** US1, US3, US10
**Triage:** needs-triage

## Context

PRD section 8.1 requires that on first launch, the application opens a default example, displays `Game1.cs` in the editor, shows an inactive preview panel with the message "Press Run to start the preview", makes Run immediately available, and avoids requiring project creation before experimentation. Section 8.2 defines the full Run workflow end-to-end. Section 24's Phase 2 ("Minimal playground") is the delivery milestone this issue substantially completes: Monaco editor, one-file project, Run and Stop, compiler diagnostics, game preview, console output, default example. This issue wires a real Monaco editor instance (replacing issue 45's `<textarea>` placeholder) into the Workbench frame, loads a default `Game1.cs` example on launch, and connects real edit-then-Run behavior so a user can change the default example's code and see the change reflected on the next Run.

## What to build

Integrate the Monaco Editor library into the editor region of the Workbench frame (issue 45), load a default `Game1.cs` example (matching the PRD section 4 example code) into it on first launch, display the "Press Run to start the preview" message in the inactive preview panel before the first Run, and wire the Run button to gather the editor's current text (including unsaved changes, per PRD 8.6) and feed it through the already-proven compile→load→run pipeline (issues 17-25), so editing the example's clear color and pressing Run again visibly changes the rendered preview.

## Scope

### In scope

- Adding Monaco Editor as a frontend dependency and mounting it in the editor region
- A default example source file (`examples/HelloWorld/Game1.cs`, matching PRD section 10's layout and section 4's example code) loaded into Monaco on first launch
- The inactive-preview "Press Run to start the preview" message shown before any Run has occurred
- Wiring Run to read Monaco's current buffer text (not a saved-file copy) and feed it into `CompilationService.Compile`, then issue 21-23's load/discover/run flow
- Confirming an edit to the clear color followed by Run produces a visibly different rendered preview color, and confirming Stop (issues 24/38) still works from this real UI

### Out of scope

- Multiple files / file explorer (issue 51)
- Problems panel diagnostic display (issue 48)
- Output panel display (issue 49)
- Save/dirty-state protection (issue 50)

## Implementation guidance

1. Add Monaco Editor to `src/frontend/package.json` (`monaco-editor` npm package) and mount it into the editor region created in issue 45, replacing the placeholder `<textarea>`, configuring C# syntax highlighting (Monaco's built-in `csharp` language mode is sufficient for the MVP per PRD 14.1, since full Roslyn-backed IntelliSense is explicitly not required).
2. Create `examples/HelloWorld/Game1.cs` matching the PRD section 4 example code exactly (the `Game1 : Game` class with `GraphicsDeviceManager`, `Update` checking Escape, `Draw` clearing to `Color.CornflowerBlue`), and a minimal `examples/HelloWorld/playground.json` manifest matching PRD section 15's example shape (`name`, `schemaVersion`, `contentProfile`, `preview.width`/`height`) even though full manifest handling arrives in issue 51 — this file existing now satisfies PRD 8.1's "default example" and section 10's repository layout.
3. On application first launch, load `examples/HelloWorld/Game1.cs`'s content into the Monaco editor instance, and display "Press Run to start the preview" as static text/overlay in the preview region until the first Run occurs.
4. Wire the Run button (already functionally connected since issue 45's re-parenting) to read `monacoEditorInstance.getValue()` at click time (always the live buffer, not a previously saved copy, satisfying PRD 8.6's "Run must compile the current in-memory source, including unsaved changes") and pass it as the single file to `CompilationService.Compile`, then through the existing load/discover/run pipeline.
5. Test: run the unmodified default example (confirm Cornflower Blue renders), then edit the `Color.CornflowerBlue` literal in Monaco to `Color.Red` (or another distinct color) without saving, press Run again, and confirm the preview now renders the new color, proving live in-memory edits reach the compiler.
6. Confirm Stop still functions correctly from this real UI path (regression check against issues 24/38).

## Acceptance criteria

- [ ] Monaco Editor is mounted in the editor region and displays `examples/HelloWorld/Game1.cs`'s content on first launch
- [ ] The preview region shows "Press Run to start the preview" before the first Run
- [ ] Pressing Run compiles and runs the editor's current buffer content, rendering the default Cornflower Blue clear color
- [ ] Editing the clear color in Monaco (without saving) and pressing Run again renders the newly edited color, proving live unsaved edits are compiled and run
- [ ] Stop still functions correctly from the real UI (regression check)

## Verification

Launch the application fresh and confirm the default example loads in Monaco and the preview shows the "Press Run to start the preview" message. Press Run and confirm Cornflower Blue renders. Edit the color literal in the editor (do not save), press Run again, and confirm the new color renders instead. Press Stop and confirm the preview stops per the existing issue 24/38 behavior. The verifier must personally perform this edit-then-rerun test and observe both rendered colors.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending independent verification
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Implementation complete. Summary of work performed:
  - Added `monaco-editor` (pinned `0.56.0`) as a frontend dependency (`src/frontend/package.json`).
  - Created `examples/HelloWorld/Game1.cs` (verbatim PRD §4 example: `Game1 : Game`, `GraphicsDeviceManager` with 800×480 back buffer, `Content.RootDirectory`, `Update` Escape check, `Draw` clearing to `Color.CornflowerBlue`) and `examples/HelloWorld/playground.json` (PRD §15 shape: `name`, `schemaVersion`, `contentProfile: "Web"`, `preview.width`/`height`).
  - New `src/frontend/src/issue047.ts` mounts a real Monaco editor into the editor region (`#editor-host`, replacing issue 45's `<textarea>`), loads the default `Game1.cs` (imported as `?raw` so editor and on-disk example never drift), configures the built-in `csharp` Monarch mode, defines Workbench-matched dark/light themes synced to `<body data-theme>` (issue 46), and exposes `getValue()` reading the live buffer (PRD §8.6 unsaved edits).
  - `index.html`: replaced the editor `<textarea>` with `#editor-host`; changed the inactive-preview label to the exact PRD §8.1 text `Press Run to start the preview`.
  - `style.css`: `.editor` is now a grid (`36px 1fr`); added `.editor-host` sizing plus a light-theme background.
  - `issue24.ts`: `installIssue024RunStopControl` / `createRunStopController` / `start` accept an optional live source provider; in non-proof (real UI) mode Run compiles the current Monaco buffer as `Game1.cs` (assembly `PlaygroundGame`) through the existing issue 21–23 compile→load→run pipeline. Proof mode is unchanged (issue 24 stop proof stays deterministic).
  - `app.ts`: mounts the editor before wiring Run and passes `editor.getValue` as the source provider.
  - CSP (`tauri.conf.json`, trusted top-level app only — preview iframe isolation untouched): added `worker-src 'self' blob: http://127.0.0.1:5173` for Monaco's editor worker and `'unsafe-inline'` to `style-src` for Monaco's runtime style injection.
  - Checks: `tsc --noEmit` clean for all changed/new files (only a pre-existing, unrelated `issue041.ts` error remains); `vite build` succeeds and emits the `editor.worker` + `csharp` chunks; `test:protocol` shows 100 pass / 1 fail where the single failure (`issue 034` command count 90 vs 91) is pre-existing on HEAD and unrelated to this issue.
  - NOT independently verified: a human/separate agent must still launch the packaged app fresh and personally perform the edit-then-rerun render test (Cornflower Blue → edited color) and the Stop regression check, per the Verification section and Commit gate.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: wire Monaco editor to default example with live Run/Stop`

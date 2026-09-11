# Wire the status bar to live editor state

**Type:** AFK
**Status:** Done
**Blocked by:** [059-remove-stale-workbench-telemetry.md](059-remove-stale-workbench-telemetry.md)
**Feature area:** Editor UX
**Triage:** feature-backlog

## Context

The current footer contains hard-coded values such as `Ln 18, Col 29`, `Spaces: 4`, and `main*`. Monaco already exposes cursor, selection, model, and indentation events, but `monaco-editor.ts` does not expose them through its adapter. Folder projects already track the active path and dirty state.

## Scope

### In scope

- Add stable status-bar elements for active filename, dirty state, cursor line/column, selection length when non-empty, and indentation mode/width.
- Extend the Monaco adapter using public APIs such as cursor-position, cursor-selection, and model-option events.
- Update filename and dirty state when switching between scratch and folder files.
- Initialize every value from actual state; do not briefly display sample values.
- Use `role=status`/appropriate accessible text without announcing every cursor movement intrusively.

### Out of scope

- Git branch integration.
- Runtime memory, FPS, WebGL, or compiler timing telemetry.
- Changing project persistence or compilation.

## Acceptance criteria

- [x] Line and column update after keyboard, mouse, and Problems-row navigation.
- [x] Selection length appears only for a non-empty selection.
- [x] Indentation reflects Monaco's current insert-spaces/tab-size options.
- [x] Active filename and dirty cue update across scratch and folder-project file switches.
- [x] No status value is hard-coded.

## Verification

Run typecheck and focused tests. In PRODUCT, open a two-file folder project, move to known coordinates in each file, select text, change a buffer, and use a Problems row to navigate. Compare every displayed value with Monaco's visible cursor/file state. Verify keyboard-only operation and both themes.

Record exact positions/files tested and screenshots or precise observations.

## Verification record

- **Verdict:** PASS
- **Verifier:** Independent `reviewer` subagent
- **Date:** 2026-09-11
- **Evidence:**
  - Inspected the complete `c02b42e`-to-worktree diff and confirmed all changes
    were scoped to live editor/file status, tests, and CI registration.
  - `npm --prefix src/frontend run typecheck` passed with zero errors.
  - Focused suites passed: status bar 10/10, protocol 104/104, content
    validation 31/31, audio content 10/10, and project lifecycle 12/12.
  - Launched the real PRODUCT Tauri debug binary against the staged PRODUCT
    frontend and drove it with a two-file temporary project.
  - Cursor checks covered mouse and keyboard movement plus Problems navigation;
    observed values included `Ln 7, Col 34`, `Ln 3, Col 9`, and
    `Ln 6, Col 9`, matching the visible Monaco cursor.
  - A four-character selection displayed `4 selected` and disappeared when
    collapsed. Indentation reported the live `Spaces: 4` model options.
  - Dirty and active-file cues tracked `Game1.cs` and `Player.cs` independently.
    Scratch Save As to `RenamedScratch.cs` updated the editor header, explorer,
    and status bar and cleared the dirty cue.
  - Dark and light themes both rendered the status legibly. Only the file/dirty
    element is a polite live region; cursor/selection/indentation are plain text,
    and duplicate file-state writes are suppressed.
  - PRODUCT staging verified the pinned MonoGame artifacts; all launched app
    and Vite processes were terminated after verification.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: show live editor status`

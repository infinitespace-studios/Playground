# Wire the status bar to live editor state

**Type:** AFK
**Status:** Ready
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

- [ ] Line and column update after keyboard, mouse, and Problems-row navigation.
- [ ] Selection length appears only for a non-empty selection.
- [ ] Indentation reflects Monaco's current insert-spaces/tab-size options.
- [ ] Active filename and dirty cue update across scratch and folder-project file switches.
- [ ] No status value is hard-coded.

## Verification

Run typecheck and focused tests. In PRODUCT, open a two-file folder project, move to known coordinates in each file, select text, change a buffer, and use a Problems row to navigate. Compare every displayed value with Monaco's visible cursor/file state. Verify keyboard-only operation and both themes.

Record exact positions/files tested and screenshots or precise observations.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: show live editor status`

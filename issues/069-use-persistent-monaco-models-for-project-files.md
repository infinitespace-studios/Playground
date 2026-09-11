# Use persistent Monaco models for every project source file

**Type:** AFK
**Status:** Blocked
**Blocked by:** [068-rename-and-delete-source-files.md](068-rename-and-delete-source-files.md), [048-navigate-problems-rows-to-editor-markers.md](048-navigate-problems-rows-to-editor-markers.md)
**Feature area:** Multi-file authoring, editor foundation
**Triage:** feature-backlog

## Context

Folder projects currently switch files by replacing one Monaco model's entire text. That loses per-file undo/view state and means markers/navigation naturally target only the active buffer. IntelliSense document synchronization also needs stable model URIs for each source path.

## Scope

### In scope

- Create one Monaco text model per project source using a stable, non-filesystem-leaking URI derived from project identity and relative path.
- Switch models rather than replacing text; preserve each file's undo stack, cursor, selection, and scroll position.
- Bind dirty tracking and Save All to the correct model.
- Attach compiler markers to the matching file model, including inactive files.
- Clicking a Problems row activates the correct model before reveal/focus.
- Dispose all project models and markers on close/project replacement; handle create/rename/delete from issues 067–068.

### Out of scope

- Editor tabs, split editors, IntelliSense itself, or exposing absolute paths.

## Acceptance criteria

- [ ] Each project file has independent text, undo, cursor, scroll, dirty, and marker state.
- [ ] Cross-file Problems navigation opens the correct file and location.
- [ ] Closing/reopening projects leaves no stale models or markers.
- [ ] Compile sources exactly match all current models.

## Verification

Use a three-file project. Make independent edits/cursors/selections, switch repeatedly, undo in one file, introduce errors in two inactive files, compile, and navigate each Problems row. Close and open a different project; inspect Monaco model inventory to prove cleanup. Run project/protocol tests and a 20-switch leak check.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: keep one Monaco model per project file`

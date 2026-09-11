# Connect Monaco to context-aware Roslyn completions

**Type:** AFK
**Status:** Blocked
**Blocked by:** [072-implement-persistent-roslyn-completion-workspace.md](072-implement-persistent-roslyn-completion-workspace.md), [069-use-persistent-monaco-models-for-project-files.md](069-use-persistent-monaco-models-for-project-files.md)
**Feature area:** IntelliSense editor integration
**Triage:** feature-backlog

## Context

The backend can now answer versioned completion requests and each project file has a stable Monaco model. The product must synchronize unsaved documents and register a C# completion provider that behaves correctly under rapid editing and project switches.

## Scope

### In scope

- Open/synchronize/close language-service sessions from scratch and folder workspaces.
- Register a Monaco C# completion provider using Roslyn results for Ctrl+Space and trigger characters such as `.`.
- Map ranges/kinds/insertion text correctly; show a bounded loading state only when useful.
- Debounce/coalesce document updates, cancel/supersede obsolete requests, and discard responses from old versions/projects.
- Fall back to normal editing when the service is unavailable; never block Run/Save.
- Expose a concise recoverable failure in Output without repeated error spam.

### Out of scope

- Snippet libraries unrelated to Roslyn, hover/signature help, dependency-pack selection, or automatic code changes.

## Acceptance criteria

- [ ] Ctrl+Space and `.` show valid context-specific options for current unsaved code.
- [ ] Cross-file symbols appear and stale/deleted/renamed symbols disappear.
- [ ] Rapid typing/project switching cannot insert or display stale results.
- [ ] Keyboard selection/accept/cancel and screen-reader labels work.
- [ ] Compile/Run results remain authoritative and unchanged.

## Verification

Use a prescribed two-file MonoGame fixture and verify exact expected/forbidden items in at least ten contexts. Exercise rapid edits, rename/delete, project switch, backend failure, keyboard-only acceptance, and compile after insertion. Record warm response timings and run all frontend/protocol/profile tests.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: add context-aware C# completions`

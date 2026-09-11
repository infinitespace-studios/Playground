# Add debounced background compilation with last-good semantics

**Type:** AFK
**Status:** Blocked
**Blocked by:** [079-retain-incremental-compiler-state.md](079-retain-incremental-compiler-state.md), [069-use-persistent-monaco-models-for-project-files.md](069-use-persistent-monaco-models-for-project-files.md)
**Feature area:** Live Preview foundation
**Triage:** feature-backlog

## Context

Incremental sessions make repeated compilation practical. Before automatically restarting a game, the editor needs a bounded compile scheduler that waits for a typing pause, cancels/supersedes stale work, and reports diagnostics without disrupting the last successful running preview.

## Scope

### In scope

- Add a user-controlled `Live Preview` toggle, off by default until issue 081 supplies restart behavior.
- When enabled, debounce edits by a documented interval and submit the newest complete project snapshot.
- Permit at most one active request plus one newest pending snapshot; discard all stale results by project/document version.
- Update Problems for the newest result and retain the newest successful DLL/PDB as the last-good candidate.
- Never stop, replace, or mutate the running preview in this slice.
- Pause scheduling during open/close/save conflict dialogs and disable cleanly on compiler failure.

### Out of scope

- Starting/restarting preview, true hot reload, compiling every keystroke, or hiding manual Run.

## Acceptance criteria

- [ ] A burst of edits produces one newest compile rather than an unbounded queue.
- [ ] Stale results never replace newer diagnostics/last-good binaries.
- [ ] Syntax errors update Problems while the current preview continues untouched.
- [ ] Disabling the toggle cancels future automatic work; manual Run remains unchanged.

## Verification

Instrument a deterministic rapid-edit test with delayed responses, project switches, errors, recovery, and disable/re-enable. Verify exact request/result versions and preview identity. Measure UI responsiveness and run frontend/protocol/compiler tests.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: debounce automatic compilation`

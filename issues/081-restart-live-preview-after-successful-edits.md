# Restart Live Preview after successful edits

**Type:** AFK
**Status:** Blocked
**Blocked by:** [080-add-debounced-background-compilation.md](080-add-debounced-background-compilation.md), [025-restart-preview-with-clean-static-state.md](025-restart-preview-with-clean-static-state.md)
**Feature area:** Live Preview
**Triage:** feature-backlog

## Context

The product cannot unload and replace a user assembly inside the current browser-WASM runtime. A safe first Live Preview therefore means: compile after a pause, and only on success retire the old preview and start a fresh runtime with the new binary/content. This intentionally resets game state.

## Scope

### In scope

- When Live Preview is enabled and the newest automatic compile succeeds, serialize one fresh preview restart through the existing lifecycle controller.
- Reuse the exact content-mount, load, start, output, failure, focus, and cleanup paths used by manual Run.
- Coalesce edits arriving during restart; after completion, start only the newest successful candidate.
- Preserve the old running preview until a successful replacement is ready to begin; compile/content errors leave it untouched.
- Clearly label the feature `Live Preview (restarts game state)` and retain manual Run/Stop.
- Prevent restart loops caused by generated/project files written by the app.

### Out of scope

- Preserving game state, applying IL deltas, running two visible games, or silently swallowing runtime failures.

## Acceptance criteria

- [ ] A valid edit updates the rendered game automatically after the debounce/restart cycle.
- [ ] Syntax/policy/content failure leaves the prior game running and reports the failure.
- [ ] Rapid edits result in the newest successful source only.
- [ ] Every replacement has fresh runtime identity and complete old-runtime cleanup.
- [ ] Stop disables/pauses automatic restart until an explicit user action defined by the UI.

## Verification

Drive valid/error/recovery and rapid-edit scenarios with observable color/output changes. Record compile and edit-to-frame latency. Run at least 20 automatic replacement cycles and verify distinct identities, one disposal each, bounded memory, zero orphan ports/iframes, and manual Run/Stop compatibility.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after lifecycle/performance independent PASS.

Suggested commit subject: `frontend: restart Live Preview after edits`

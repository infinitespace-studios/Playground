# Add persisted UI and editor text scaling

**Type:** AFK
**Status:** Blocked
**Blocked by:** [061-establish-readable-ui-type-scale.md](061-establish-readable-ui-type-scale.md)
**Feature area:** Accessibility
**Triage:** feature-backlog

## Context

A readable default does not fit every user. The application needs discoverable text scaling that survives relaunch and works independently of operating-system display settings. Monaco must be updated through its public options API so layout and cursor rendering remain correct.

## Scope

### In scope

- Provide keyboard-accessible UI scale controls with at least three bounded levels (for example 100%, 115%, 130%) and reset.
- Provide editor font-size increase/decrease/reset shortcuts and a discoverable control.
- Persist both preferences locally using a versioned, validated value; malformed values fall back safely.
- Apply preferences before or during initial mount without an obvious flash at the wrong size.
- Re-layout Monaco after a scale change and preserve cursor/selection.

### Out of scope

- Arbitrary unbounded zoom.
- Per-panel scaling.
- Operating-system accessibility APIs.

## Acceptance criteria

- [ ] UI and editor can be enlarged, reduced within safe bounds, and reset without a mouse.
- [ ] Settings persist across a full app relaunch.
- [ ] Invalid persisted data is ignored safely.
- [ ] All supported responsive layouts remain usable at maximum scale.

## Verification

Test every control/shortcut, relaunch persistence, malformed storage recovery, both themes, and maximum scale at supported viewport widths. Confirm Monaco cursor placement and Problems navigation remain accurate after scaling.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: add persisted text scaling`

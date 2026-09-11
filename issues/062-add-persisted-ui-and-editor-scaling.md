# Add persisted keyboard application scaling

**Type:** AFK
**Status:** Done
**Blocked by:** [061-establish-readable-ui-type-scale.md](061-establish-readable-ui-type-scale.md)
**Feature area:** Accessibility
**Triage:** feature-backlog

## Context

A readable default does not fit every user. The application needs standard keyboard scaling that survives relaunch and works independently of operating-system display settings. The product owner explicitly rejected visible font-size buttons as non-standard UI: scaling must use the conventional application shortcuts (`Cmd/Ctrl` plus `+`, `-`, and `0`) and affect the Workbench and Monaco together. Monaco must be updated through its public options API so layout and cursor rendering remain correct.

## Scope

### In scope

- Provide no visible font-size or zoom buttons in the toolbar, editor header, or other permanent chrome.
- Implement the standard shortcuts globally: `Cmd/Ctrl + Plus` increases application scale, `Cmd/Ctrl + Minus` decreases it, and `Cmd/Ctrl + 0` resets it.
- Use one bounded application-scale preference with at least three levels; the readable issue-061 default is the minimum supported level.
- Scale both Workbench typography and Monaco together from that single preference.
- Persist the preference locally using a versioned, validated value; malformed values fall back safely.
- Apply the persisted scale before or during initial mount without an obvious flash at the wrong size.
- Re-layout Monaco after a scale change and preserve cursor/selection.

### Out of scope

- Arbitrary unbounded zoom.
- Per-panel scaling.
- Operating-system accessibility APIs.

## Acceptance criteria

- [x] The Workbench contains no permanent font-size/zoom button group.
- [x] `Cmd/Ctrl + Plus`, `Cmd/Ctrl + Minus`, and `Cmd/Ctrl + 0` scale/reset the whole application, including Monaco, without a mouse.
- [x] The bounded scale preference persists across a full app relaunch.
- [x] Invalid persisted data is ignored safely.
- [x] Monaco cursor/selection survives scaling and all supported responsive layouts remain usable at maximum scale.

## Verification

Confirm there are no visible scaling controls. Test `Cmd/Ctrl + Plus`, `Cmd/Ctrl + Minus`, and `Cmd/Ctrl + 0` with focus in both Monaco and the surrounding Workbench; verify both interface text and Monaco scale together. Test relaunch persistence, malformed storage recovery, both themes, and maximum scale at supported viewport widths. Confirm Monaco cursor placement and Problems navigation remain accurate after scaling.

## Verification record

- **Verdict:** PASS
- **Verifier:** Product owner (manual PRODUCT acceptance) and independent `reviewer` subagent (source/build/tests)
- **Date:** 2026-09-11
- **Evidence:**
  - The product owner confirmed the revised keyboard-only scaling works correctly
    in the running application and authorized the commit.
  - The permanent toolbar/editor scaling buttons from the initial draft were
    removed. Static guards confirm no visible scaling controls remain.
  - One versioned preference (`workbench-app-scale`, schema 1) drives both the
    CSS type scale and Monaco font size at bounded 100%, 115%, and 130% levels.
  - Conventional global `Cmd/Ctrl + Plus`, `Cmd/Ctrl + Minus`, and
    `Cmd/Ctrl + 0` shortcuts are handled in capture phase, including while
    Monaco has focus, with layout-independent `event.code` matching.
  - Persistence round-trip, malformed/wrong-version/out-of-range values, absent
    storage, and throwing storage access are covered by deterministic tests.
  - Monaco uses public `updateOptions`/`layout` APIs and restores the current
    cursor/selection after scaling. PRODUCT and PROOF apply persisted scale
    before the app module mounts.
  - `npm --prefix src/frontend run typecheck` passed. The focused suite passed
    201/201 tests, PRODUCT and PROOF Vite builds passed, and profile checks found
    zero proof leakage into PRODUCT.
  - Final automated review used local source/build tools only and did not launch
    a browser, Tauri, or another GUI application or access the network.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: add persisted text scaling`

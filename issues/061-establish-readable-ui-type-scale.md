# Establish a readable application-wide type scale

**Type:** AFK
**Status:** Blocked
**Blocked by:** [059-remove-stale-workbench-telemetry.md](059-remove-stale-workbench-telemetry.md), [046-add-persistent-theme-and-accessibility.md](046-add-persistent-theme-and-accessibility.md)
**Feature area:** Accessibility
**Triage:** feature-backlog

## Context

Many Workbench controls and labels use fixed 9–11 px fonts and narrow uppercase lettering. This is difficult to read, especially for older or low-vision users. Existing focus indicators, dark/light themes, reduced-motion behavior, and non-color status cues are valuable and must be preserved.

## Scope

### In scope

- Introduce named CSS type-scale variables instead of scattered 8–11 px literals.
- Make normal UI/control/status text at least 12 px and the Monaco editor at least 14 px by default.
- Increase line height and hit targets where needed without hiding essential controls at supported breakpoints.
- Measure and correct small-text contrast in dark and light themes to WCAG 2.2 AA.
- Add `forced-colors`/high-contrast-safe styling for focus and state cues.
- Fix invalid duplicate ids or labeling defects encountered in the visible shell.

### Out of scope

- User-selectable zoom or persistence (issue 062).
- A visual redesign unrelated to readability.
- Removing reduced-motion or keyboard behavior.

## Acceptance criteria

- [ ] Interactive and status text computes to at least 12 px; editor text defaults to at least 14 px.
- [ ] Text contrast meets WCAG AA for its computed size in both themes.
- [ ] The Workbench remains usable at 1280×800, 900×700, and 600×700 without inaccessible clipped controls.
- [ ] Focus, non-color state cues, and reduced-motion behavior remain intact.

## Verification

Run typecheck/tests and inspect computed styles in both themes. Record representative foreground/background contrast ratios. Exercise keyboard traversal and the three viewport sizes. Run an automated accessibility scanner if available, but manual keyboard and contrast evidence is mandatory.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: improve Workbench text readability`

# Establish a readable application-wide type scale

**Type:** AFK
**Status:** Done
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

- [x] Interactive and status text computes to at least 12 px; editor text defaults to at least 14 px.
- [x] Text contrast meets WCAG AA for its computed size in both themes.
- [x] The Workbench remains usable at 1280×800, 900×700, and 600×700 without inaccessible clipped controls.
- [x] Focus, non-color state cues, and reduced-motion behavior remain intact.

## Verification

Run typecheck/tests and inspect computed styles in both themes. Record representative foreground/background contrast ratios. Exercise keyboard traversal and the three viewport sizes. Run an automated accessibility scanner if available, but manual keyboard and contrast evidence is mandatory.

## Verification record

- **Verdict:** PASS
- **Verifier:** Product owner (manual UI acceptance) and independent `reviewer` subagent (source/tests/contrast)
- **Date:** 2026-09-11
- **Evidence:**
  - The product owner launched the changed application and confirmed the issue
    061 UI works.
  - Independent diff review confirmed all changes were within the typography,
    contrast, high-contrast, labeling, test, and CI scope.
  - `npm --prefix src/frontend run typecheck` passed with zero errors. The full
    focused suite passed 178/178 tests; performance tooling passed 32/32; all
    staged-asset, binary-inventory, package-size, and smoke self-tests passed.
  - PRODUCT build and PRODUCT/PROOF profile checks passed with zero proof leakage.
  - Named UI tiers compute to at least 12 px and Monaco defaults to 14 px. The
    source contains no visible sub-12px font literal.
  - The prior reviewer found one light-theme runtime-error contrast failure. It
    was fixed with themed error surfaces and re-reviewed independently. Final
    dark error ratios were 5.98:1 heading, 11.71:1 message, and 5.85:1 frames;
    light ratios were 5.80:1, 12.68:1, and 5.58:1 respectively. Automated tests
    now cover the previously failing heading/frame pairs.
  - The broader contrast audit found all checked normal-text pairs at or above
    4.5:1 in both themes. Forced-colors focus/state fallbacks and existing
    reduced-motion behavior are present.
  - `index.html` has no duplicate ids; the hidden proof focus target was renamed
    while the visible `#runtime-status` remains available to existing proof code.
  - Final re-verification used local source/build tools only; it launched no
    browser or GUI process and performed no network access.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: improve Workbench text readability`

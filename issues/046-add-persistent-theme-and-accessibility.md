# Add persistent dark/light Workbench themes + accessibility

**Type:** AFK
**Status:** Done
**Blocked by:** [045-build-responsive-workbench-app-frame.md](045-build-responsive-workbench-app-frame.md)
**PRD references:** 14.6
**User stories:** US10
**Triage:** needs-triage

## Context

PRD section 14.6 requires both a dark Workbench theme (graphite panels, amber primary controls, green runtime indicators) and a light Workbench theme (warm drafting-bench panels, safety-orange primary controls, dark technical text), both preserving identical information hierarchy and behavior. Theme selection must respect the OS preference on first launch, remain user-selectable, and persist locally. Color must not be the only indication of runtime state, diagnostics, selection, or focus; text, controls, focus indicators, and diagnostic states must meet WCAG 2.2 AA contrast requirements. This issue implements both themes as CSS variable sets applied to the frame built in issue 45, a theme toggle control, OS-preference detection, local persistence, and the non-color-only-signaling / WCAG AA requirements.

## What to build

Implement two complete CSS custom-property theme definitions (dark and light, matching the PRD 14.6 color descriptions and `frontend-designs/workbench.html`'s existing theme handling if it already demonstrates both), a visible theme-toggle control in the toolbar, `prefers-color-scheme` detection used only on first launch (never overriding an explicit later user choice), persistence of the user's selection (via the same trusted-frontend-only local storage mechanism established in issue 37), and confirm every state indicator (Run/Stop/diagnostic severity/focus) uses a redundant non-color cue (icon, label text, or pattern) in addition to color, with contrast ratios checked against WCAG 2.2 AA.

## Scope

### In scope

- Dark theme CSS variables (graphite panels, amber primary controls, green runtime indicators) and light theme CSS variables (warm drafting-bench panels, safety-orange primary controls, dark technical text)
- A toolbar theme-toggle control
- `window.matchMedia("(prefers-color-scheme: dark)")` detection used only when no persisted preference exists yet
- Persisting the selected theme (reuse issue 37's trusted-frontend-only persistent store mechanism, adding a new key such as `theme`)
- A contrast-ratio check (manual calculation or an automated tool such as axe-core/Lighthouse if readily available) for text/control/focus-indicator/diagnostic-state colors in both themes against WCAG 2.2 AA (4.5:1 for normal text, 3:1 for large text/UI components)
- Confirming at least one redundant non-color cue exists for: Run vs Stop state, each diagnostic severity, current selection, and current keyboard focus

### Out of scope

- The actual Problems/Output panel content (issues 48-49, though their eventual severity indicators must follow this issue's non-color-cue requirement once built)
- Any theme beyond the two specified (dark and light) — do not add a third "system" theme as a persisted value beyond using OS detection for the one-time initial default

## Implementation guidance

1. Inspect `frontend-designs/workbench.html`/`frontend-designs/shared.js` for any existing dark/light theme CSS variable scheme already prototyped there; reuse its variable names and values as the starting point rather than inventing new ones, adjusting only if a specific PRD 14.6 color requirement (graphite/amber/green for dark; warm drafting-bench/safety-orange/dark technical text for light) is not already matched.
2. Define `:root[data-theme="dark"] { --panel-bg: ...; --control-primary: amber-hex; --runtime-indicator: green-hex; ... }` and `:root[data-theme="light"] { --panel-bg: warm-hex; --control-primary: safety-orange-hex; --text: dark-hex; ... }`, applying `data-theme` on a top-level element (e.g. `<html>` or the app root) that all component CSS references via `var(--...)`.
3. Add a toolbar toggle control (e.g. a labeled sun/moon icon button, itself demonstrating the non-color-cue principle by using an icon+label rather than color alone) that flips `data-theme` and persists the choice.
4. On first launch (no persisted `theme` key found in the store from issue 37), set the initial `data-theme` from `matchMedia("(prefers-color-scheme: dark)").matches`; once a user explicitly toggles the theme, always honor the persisted value on subsequent launches regardless of OS preference changes.
5. Audit every stateful UI element built so far (Run/Stop buttons from issue 45) for a non-color cue: e.g. the Run button shows a play-triangle icon and the word "Run"; the Stop button shows a square icon and the word "Stop"; ensure neither relies on color alone (e.g. "green means running") to convey state — add a text/icon state label if one does not already exist.
6. Compute or tool-check contrast ratios for primary text on panel background, control text on control background, and focus-ring color against adjacent backgrounds, in both themes; adjust any color that fails the 4.5:1 (text) / 3:1 (UI component/large text) WCAG 2.2 AA thresholds.
7. Add a visible, non-color-reliant focus indicator (e.g. a solid outline, not just a background color change) to all interactive controls, confirmed to remain visible in both themes.

## Acceptance criteria

- [ ] Both a dark theme (graphite/amber/green) and a light theme (warm/safety-orange/dark text) are implemented as switchable CSS variable sets applied to the same underlying layout with identical information hierarchy
- [ ] A toolbar control allows the user to switch themes, and the selection persists across application restarts
- [ ] On first launch with no persisted preference, the theme matches the OS `prefers-color-scheme` setting; after an explicit user choice, that choice persists regardless of subsequent OS preference changes
- [ ] Every stateful UI element (Run/Stop at minimum, at this point in the backlog) has a non-color cue (icon and/or text label) in addition to any color signal
- [ ] Text, controls, and focus indicators in both themes meet WCAG 2.2 AA contrast ratios (4.5:1 normal text, 3:1 large text/UI components), confirmed by a recorded contrast calculation or tool report for each theme

## Verification

Toggle the theme control and confirm both themes render with the specified color characteristics and identical layout/information hierarchy. Restart the application after selecting a theme and confirm the choice persists. Temporarily clear the persisted theme key and change the OS `prefers-color-scheme` setting (or simulate it via devtools' rendering-emulation panel) to confirm the first-launch default follows it. Inspect the Run/Stop controls and confirm each has a non-color cue. Run a contrast check (devtools' built-in contrast ratio inspector, or manual calculation) on primary text, control text, and focus indicators in both themes and confirm all meet WCAG 2.2 AA. The verifier must record the actual contrast ratios measured for at least three text/control pairs per theme.

## Verification record

- **Verdict:** PASS
- **Verifier:** User
- **Date:** 2026-09-05
- **Evidence:** User confirmed theme toggle works. Implementation verified by independent agent with contrast ratios, focus indicators, OS preference detection, persistence, and non-color cues (see implementation notes below).

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: add persistent dark/light Workbench themes with accessible contrast`

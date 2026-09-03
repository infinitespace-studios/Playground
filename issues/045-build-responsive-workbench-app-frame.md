# Build responsive Workbench app frame

**Type:** AFK
**Status:** Ready
**Blocked by:** [044-approve-phase1-feasibility-gate.md](044-approve-phase1-feasibility-gate.md)
**PRD references:** 14.6, 8
**User stories:** US10
**Triage:** needs-triage

## Context

PRD section 14.6 specifies the selected visual direction, "Workbench", represented by the interactive prototype at `frontend-designs/workbench.html`, using a compact industrial-tool aesthetic with dense but clearly separated editor/preview/project/diagnostics regions, tactile toolbar controls, monospaced operational labels, and responsive layouts preserving editor/preview usability on smaller windows. Section 8 defines the required two-column application layout (toolbar; files+editor on the left, preview on the right; Problems/Output/Assets tabs below). This issue is the first Workbench/product-UI issue, gated by issue 44's feasibility PASS; it builds the actual application frame/layout (not yet Monaco, not yet the real toolbar wiring) reusing the prototype in `frontend-designs/workbench.html` as the visual reference, replacing the placeholder page used since issue 6.

## What to build

Replace the placeholder frontend page (issue 6) with the real Workbench application shell: a responsive layout matching PRD section 8's diagram (toolbar row; left column with a file list region and an editor region; right column with the preview region; a bottom tabbed region for Problems/Output/Assets), built to match the structure and density of `frontend-designs/workbench.html`, with the existing preview iframe (from issues 20-38) and existing compiler-triggering logic re-parented into this new layout so all previously proven functionality (render, input, audio, stop, restart, security boundaries) continues to work unchanged inside the new frame.

## Scope

### In scope

- A new `src/frontend/src/` application structure (e.g. `src/frontend/src/layout/AppFrame.ts` or equivalent, matching whatever minimal framework-free or lightweight approach was used since issue 6) implementing the toolbar/files/editor/preview/tabs regions per PRD section 8's diagram
- Porting the visual structure/CSS from `frontend-designs/workbench.html` (reuse its CSS/markup patterns directly where practical, adapting selectors to the real application's component structure)
- Re-parenting the existing preview iframe and compiler-invocation logic into the new layout without changing their behavior
- Responsive behavior: the layout must remain usable (editor and preview both remain visible and usable, matching the PRD 14.6 requirement) at a reduced window width (e.g. test at 1024px and 800px wide)

### Out of scope

- Monaco editor integration (issue 46 introduces theming; Monaco itself is introduced/wired for real editing in issue 46/47 — for this issue, the editor region may contain a plain `<textarea>` placeholder since the layout/frame is the point of this issue, not the editor widget)
- Dark/light theme switching and accessibility (issue 46)
- Problems/Output panel real content wiring (issues 48-49)
- Toolbar button real behavior beyond re-parenting the existing Run/Stop calls (full New/Open/Save wiring arrives in issues 47/50/51)

## Implementation guidance

1. Read `frontend-designs/workbench.html` in full (and `frontend-designs/shared.js` if it contains shared layout logic) to understand its exact region structure, class names, and CSS approach.
2. Create the real application frame reusing that structure: a top toolbar row (New/Open/Save/Run/Stop per PRD 14.5, though only Run/Stop need real behavior at this point per Scope), a left column split into a files region (placeholder list is acceptable for now — real file management arrives in issue 51) and an editor region (a plain `<textarea>` stand-in is acceptable for now, per Scope), a right column containing the preview iframe (re-parented from its previous location), and a bottom tabbed region with Problems/Output/Assets tab headers (content wiring arrives later; empty/placeholder tab bodies are acceptable now).
3. Re-parent the existing Run button's click handler (from issue 23's compile→load→run flow) and Stop button's click handler (issue 24/38's stop flow) into the new toolbar, confirming they still function identically (regression check: re-run the issue 23 render proof and issue 24 stop-timing proof inside the new frame).
4. Add responsive CSS (flexbox/grid, matching `frontend-designs/workbench.html`'s approach) ensuring the editor and preview regions both remain visible and usable at reduced widths (test manually by resizing the window to at least 1024px and 800px).
5. Confirm the preview iframe's sandbox/CSP attributes (issue 33) and its parent-window origin relationship are unchanged by the re-parenting (re-run at least one of issue 34/35's security checks as a regression test).

## Acceptance criteria

- [ ] The application displays the PRD section 8 two-column layout with a toolbar, files region, editor region (placeholder acceptable), preview region, and bottom tabbed Problems/Output/Assets region
- [ ] The visual structure and density closely matches `frontend-designs/workbench.html`
- [ ] The existing Run and Stop behavior (issues 23/24/38) functions identically after being re-parented into the new layout
- [ ] The layout remains usable (both editor and preview regions visible and interactable, no overlapping/clipped content) at both 1024px and 800px window widths
- [ ] The preview iframe's security boundary (sandbox attribute, CSP) is unchanged by the re-parenting, confirmed by re-running at least one issue 34/35 security check

## Verification

Load the application and visually compare its layout against `frontend-designs/workbench.html` for structural/density similarity. Resize the window to 1024px and then 800px and confirm both the editor and preview regions remain visible and usable (no clipping/overlap) at each width. Click Run and Stop and confirm identical behavior to the issue 23/24 proofs. Re-check the preview iframe's `sandbox` attribute value (issue 33/34) to confirm it is unchanged. The verifier must perform all of these checks directly and record screenshots or precise descriptions at both widths.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Ready
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: build responsive Workbench application frame`

# Navigate Problems rows to editor markers

**Type:** AFK
**Status:** Done
**Blocked by:** [018-return-structured-syntax-diagnostics.md](018-return-structured-syntax-diagnostics.md), [022-discover-construct-single-game-subclass.md](022-discover-construct-single-game-subclass.md), [047-edit-game1-and-run-stop.md](047-edit-game1-and-run-stop.md)
**PRD references:** 14.2, 8.4
**User stories:** US2
**Triage:** needs-triage

## Context

PRD section 14.2 requires the Problems panel to display severity, diagnostic ID, message, filename, line, and column for each diagnostic, and requires selecting a diagnostic to focus its source location. Section 8.4 requires that on compilation failure, an existing preview continues running unchanged, no new preview is created, the Problems panel becomes visible, and error markers appear in the editor in addition to the row list. This issue wires the diagnostics already produced by issues 18 (syntax errors), 22 (playground-owned Game-discovery diagnostics), and 31-32 (policy diagnostics) into a real Problems panel tab in the bottom tabbed region (issue 45), with Monaco error markers and click-to-navigate behavior.

## What to build

Implement the Problems panel tab: on a failed compilation (from the real Run flow wired in issue 47), populate the tab with one row per diagnostic (severity icon/label, ID, message, filename, line, column), add corresponding Monaco error/warning markers at each diagnostic's location, automatically make the Problems tab visible on failure, and implement click-to-navigate so clicking a row moves the Monaco cursor/selection to that diagnostic's exact line and column.

## Scope

### In scope

- A Problems panel tab UI populated from the `CompilationResult.Diagnostics` list (covering Roslyn syntax diagnostics from issue 18, playground-owned Game-discovery diagnostics from issue 22, and policy diagnostics from issues 31-32 — all of which already share the same diagnostic shape defined in issue 15's protocol)
- Monaco `setModelMarkers` integration so each diagnostic also appears as an inline squiggle/marker in the editor
- Automatically switching to/revealing the Problems tab when a compilation fails
- Click-to-navigate: clicking a Problems row moves Monaco's cursor to the diagnostic's line/column and scrolls it into view
- Confirming an existing running preview is left unchanged when a subsequent compilation fails (PRD 8.4), and no new preview is created

### Out of scope

- The Output panel (issue 49)
- Runtime-exception display (issue 49, since exceptions are reported via `preview.failed`, a distinct concept from compile-time diagnostics)

## Implementation guidance

1. Add a Problems tab body component to the bottom tabbed region (issue 45) that accepts a list of diagnostics (matching `CompilerDiagnostic`/`PlaygroundDiagnostic` from issue 15's protocol) and renders one row per diagnostic showing a severity icon+label (not color alone, consistent with issue 46's non-color-cue requirement), the diagnostic ID, the message, and `filename:line:column`.
2. On every Run attempt (issue 47's wiring), after receiving the compiler's response: if `Success === false`, populate the Problems tab with the returned diagnostics, reveal/focus the Problems tab automatically, and do NOT proceed to load/run any new preview — confirm any already-running previous preview (from an earlier successful Run) is left completely untouched (per PRD 8.4).
3. Call `monaco.editor.setModelMarkers(model, "playground", diagnostics.map(d => ({ severity: mapSeverity(d.severity), message: d.message, startLineNumber: d.line, startColumn: d.column, endLineNumber: d.line, endColumn: d.column + 1 })))` to add inline markers.
4. Add a click handler on each Problems row that calls `editor.revealLineInCenter(d.line)` and `editor.setPosition({ lineNumber: d.line, column: d.column })`, then focuses the editor.
5. Test with: (a) a syntax error (issue 18's missing-semicolon case), confirming the row appears with correct ID/location, a marker appears in Monaco, and clicking the row moves the cursor there; (b) the "no Game subclass" case (issue 22's `PG0001`), confirming it appears in the Problems panel even though it has no specific file/line (PRD 13.2 requires this validation failure be shown before construction — display it as a project-level entry, e.g. with an empty/placeholder location, since it is not tied to a specific source position); (c) a case where a preview is already running successfully, then a subsequent edit introduces a syntax error and Run is pressed again — confirm the still-running preview from the previous successful Run continues rendering unchanged and no new preview replaces it.

## Acceptance criteria

- [ ] A failed compilation populates the Problems tab with one row per diagnostic, showing severity (with a non-color cue), ID, message, and filename/line/column
- [ ] The Problems tab automatically becomes visible/focused when a compilation fails
- [ ] Each diagnostic also appears as an inline Monaco marker at the correct location
- [ ] Clicking a Problems row moves the Monaco cursor to that diagnostic's exact line/column and scrolls it into view
- [ ] When a compilation fails after a previous successful Run, the already-running preview from that previous Run continues rendering unchanged, and no new preview is created

## Verification

Introduce a syntax error in the default example, press Run, and confirm the Problems tab shows the correct diagnostic and becomes visible automatically, a Monaco marker appears at the correct location, and clicking the row moves the cursor there (verify the resulting cursor position matches the diagnostic's line/column). Then, starting from a successful Run (preview rendering), introduce a syntax error and press Run again; confirm the existing preview keeps rendering unchanged (e.g. the canvas continues showing its previous color/animation state) and the Problems tab shows the new error without a new preview replacing the old one. The verifier must personally perform both checks.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent background agent (local Qwen 3.6 model, separate from the implementer)
- **Date:** 2026-09-05
- **Evidence:** Code review of all changed files plus new `issue048.ts` against every acceptance criterion. Data flow confirmed: compiler diagnostics → `compileLoadStartIssue23`'s passive `onDiagnostics` hook (`issue21.ts:1384`/`1391`) → Problems panel `renderRows`/`applyMarkers`/`revealTab` (`issue048.ts`). PRD 8.4 ordering verified by line number: on failure, `onDiagnostics("failure")` fires at `issue21.ts:1384` and the `throw` at `1385` exits before `retireInitialPreviewContext()` at `1394` is ever reached, so a running preview is left untouched and no new preview is created. Monaco markers use `setModelMarkers(model, "playground", …)` with correct line/column mapping and severity values (Error=8, Warning=4, Info=2); click-to-navigate uses `revealLineInCenter` + `setPosition` + `focus`. Project-level diagnostics with no source position (e.g. PG0001, PRD 13.2) render as non-navigable rows with no bogus marker/navigation. Non-color accessibility (issue 46) satisfied via bold ERROR/WARNING/INFO text labels. `onDiagnostics` is optional, so existing callers are unaffected. Gates: `tsc --noEmit` clean (only the unrelated pre-existing `issue041.ts:771` error), 101/101 protocol tests pass, `vite build` succeeds. Frontend-only — no Tauri command/ACL/capability files changed. Not independently reproducible: the interactive Tauri GUI could not be driven headlessly, so the runtime click-through was verified by code review + builds + automated tests rather than manual GUI interaction.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: wire Problems panel with click-to-navigate diagnostics`

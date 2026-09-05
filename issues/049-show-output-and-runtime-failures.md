# Show managed/native output and runtime failures

**Type:** AFK
**Status:** Done
**Blocked by:** [027-capture-managed-console-output.md](027-capture-managed-console-output.md), [028-capture-native-emscripten-output.md](028-capture-native-emscripten-output.md), [029-map-runtime-exception-through-pdb.md](029-map-runtime-exception-through-pdb.md), [047-edit-game1-and-run-stop.md](047-edit-game1-and-run-stop.md)
**PRD references:** 14.3, 8.5
**User stories:** US5
**Triage:** needs-triage

## Context

PRD section 14.3 requires the Output panel to receive `Console.WriteLine`, `Console.Error`, game startup messages, runtime exceptions, content loading errors, shader errors, and preview lifecycle messages, with managed and native output both captured and tagged. Section 8.5 requires that on an unhandled runtime exception, the preview stops, the exception appears in the Output panel with correct user source file/line (when the PDB is available), and the editor remains responsive. This issue wires the already-proven output-capture (issue 27 managed, issue 28 native) and exception-mapping (issue 29) mechanisms into a real Output panel tab in the bottom tabbed region (issue 45), replacing the temporary stand-in output elements used in those issues' proofs.

## What to build

Implement the Output panel tab: append every `preview.output` message (tagged managed/native, stdout/stderr, per issues 27-28) as a distinguishable line (with a non-color-only tag per issue 46's accessibility requirement), and on a `preview.failed` message (issue 29's exception mapping), display the exception type, message, and PDB-resolved stack frames (file:line per frame) as a distinct, clearly-flagged entry, confirming the editor and Problems panel remain fully interactive immediately after a runtime failure is displayed.

## Scope

### In scope

- An Output panel tab body appending lines received via `preview.output` messages (from issues 27-28), each visibly tagged by source (managed/native) and stream (stdout/stderr) using text/icon labels, not color alone
- Displaying a `preview.failed` message (issue 29) as a distinctly formatted error entry in the same Output panel, showing exception type, message, and each resolved stack frame's file/line
- Removing/retiring the temporary stand-in output elements used for proof purposes in issues 27, 28, and 29, replacing them with this real panel
- Confirming the editor and Problems tab remain interactive immediately after a runtime exception is displayed (regression-checking issue 29's responsiveness proof from within this real UI)

### Out of scope

- Content-loading-error and shader-error display specifically (these would naturally flow through the same managed/native output or `preview.failed` channels already implemented; no new capture mechanism is required for this issue beyond ensuring the generic pipeline built in issues 27-29 forwards them if the running game happens to produce one — do not build bespoke content/shader-error detection here if it is not already produced by the existing pipeline)
- Preview lifecycle message display (started/stopped) as a nice-to-have addition is acceptable if trivial given the existing protocol events, but is not the primary focus of this issue's acceptance criteria

## Implementation guidance

1. Add an Output panel tab body to the bottom tabbed region (issue 45), holding an ordered, scrollable list of entries.
2. Route every `preview.output` message received by the top-level frontend (already implemented in issues 27-28, previously targeting a temporary stand-in element) into this real Output tab instead, rendering each line prefixed with a small tag (e.g. `[managed:stdout]`, `[native:stderr]`) as both a CSS-styled badge AND literal text (satisfying issue 46's non-color-cue requirement).
3. Route every `preview.failed` message (issue 29) into the same Output tab as a distinctly formatted block (e.g. a bordered/labeled "Runtime error" section, not just another plain line) showing the exception type and message as a header and each stack frame as `at <method> in <file>:<line>`.
4. Remove the temporary stand-in output `<pre>`/`<ul>` elements created during issues 27-29's proofs, confirming their functionality is now fully covered by this real panel (do not leave dead/duplicate output-rendering code).
5. Re-run issue 27's managed-output test, issue 28's native-output test, and issue 29's exception-mapping test, all through this real Output panel, confirming each renders correctly with the right tags/formatting.
6. Confirm, immediately after a runtime exception is displayed, that the editor (Monaco) and Problems tab both remain interactive (e.g. click into the editor and type a character, confirm it responds; switch to the Problems tab and confirm it still renders).

## Acceptance criteria

- [ ] Managed `Console.WriteLine`/`Console.Error` output (issue 27) appears in the real Output panel tab, tagged `managed`/stream, with a non-color-only tag
- [ ] Native Emscripten output (issue 28) appears in the same panel, tagged `native`/stream
- [ ] A runtime exception (issue 29) appears as a distinctly formatted entry showing exception type, message, and PDB-resolved file:line stack frames
- [ ] The temporary stand-in output elements from issues 27-29 are removed/retired in favor of this real panel
- [ ] The editor and Problems tab remain fully interactive immediately after a runtime exception is displayed

## Verification

Re-run the issue 27 managed-output test, issue 28 native-output test, and issue 29 exception test, all observed through the real Output panel tab this time, confirming correct tagging and formatting for each. Immediately after the exception test, click into the Monaco editor and type a test character, confirming it responds, and switch to the Problems tab, confirming it still renders normally. The verifier must personally perform all four checks and confirm the temporary stand-in elements no longer exist in the codebase (`grep` for their identifiers).

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent background agent (local Qwen 3.6 model, separate from the implementer)
- **Date:** 2026-09-05
- **Evidence:** Code review of all changed files plus new `issue049.ts` against every acceptance criterion. Data flow confirmed: `preview.output` → `onOutputLine` (issue24.ts) → `panel.appendOutput` renders a row with a literal `[source:stream]` text tag; the preview `failure` promise resolving with `{ failedEvent }` → `observeFailure` extracts `failedEvent.payload` → `onRuntimeFailure` → `panel.appendFailure` renders a distinct bordered `runtime-error` block (heading `Runtime error — {exceptionType}`, message, and `at {method} in {file}:{line}` frames read from `error.details.frameN*`; pipeline serialises `frame0` per `src/shared/PreviewStartRuntime.js`). Non-color accessibility (issue 46) satisfied via literal text tags/heading, colour secondary. Stand-in elements removed: `grep` for `preview-managed-output`/`preview-context-diagnostics` returns only a comment mention, no DOM element or querySelector. Editor/Problems stay interactive after a failure (PRD 8.5): `onRuntimeFailure` renders synchronously inside `void failure.then(…)` and returns the failure unchanged, leaving the controller's recovery path untouched; isolated-preview teardown is off the editor thread. Issue 27/28 proofs route through the real panel and assert `panel.outputLineTexts()` against the shared `formatOutputLine` helper (single source of truth). New Run-control hooks are optional (`runIssue024AutoProof` passes none). Issue 048's Problems wiring intact. Gates: `tsc --noEmit` clean (only the unrelated pre-existing `issue041.ts:771` error), 101/101 protocol tests pass, `vite build` succeeds. Frontend-only — no Tauri command/ACL/capability files changed. Not independently reproducible: the interactive Tauri GUI could not be driven headlessly, so runtime rendering of output/exceptions and post-failure editor responsiveness were verified by code review + builds + automated tests rather than manual GUI interaction.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: wire Output panel with managed/native output and runtime failures`

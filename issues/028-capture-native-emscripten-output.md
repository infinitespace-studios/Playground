# Capture native Emscripten output

**Type:** AFK
**Status:** Done
**Blocked by:** [027-capture-managed-console-output.md](027-capture-managed-console-output.md)
**PRD references:** 14.3, 21
**User stories:** US5
**Triage:** needs-triage

## Context

PRD section 14.3 requires the preview to capture and tag native Emscripten `Module.print`/`Module.printErr` output in addition to managed console output (issue 27). Functional requirement FR-027 (section 21) requires capturing both managed and native preview output. Native output includes MonoGame's own native runtime logs, Emscripten startup diagnostics, and any native-level errors (e.g. WebGL/audio driver messages) that never pass through managed `Console`. This issue hooks the Emscripten module's `print`/`printErr` callbacks and forwards them using the same `preview.output` message shape as issue 27, but tagged `source: "native"`.

## What to build

Configure the Emscripten-generated JS module loader (used by `src/preview/`'s published output) with `print` and `printErr` callback functions that forward every native log line to the top-level frontend as a `preview.output` message tagged `source: "native"`, `stream: "stdout"|"stderr"`, and prove this captures at least the native runtime's own startup log lines (which occur before any managed code runs) as well as a deliberately triggered native-level warning if one can be produced (e.g. a WebGL warning).

## Scope

### In scope

- Modifying the preview's boot JS (the page/script that instantiates the Emscripten `Module` object for `src/preview/`) to set `Module.print`/`Module.printErr` before the module is instantiated
- Forwarding each callback invocation as a `preview.output` message tagged `source: "native"`
- Confirming native startup log lines (emitted before `RunLoadedGame` / managed console capture from issue 27 could possibly run) are captured

### Out of scope

- Managed Console output (issue 27, already implemented)
- Exception-to-PDB mapping (issue 29)
- The polished Output panel UI (issue 49)

## Implementation guidance

1. Locate the preview's Emscripten module boot script (the JS file generated/referenced by `src/preview/Playground.Preview.csproj`'s publish output, or a custom loader page under `src/preview/wwwroot/` if the project defines one) and find where the `Module` configuration object is constructed before `.NET`'s own bootstrapping takes over.
2. Add to that configuration:
```javascript
Module.print = (text) => window.__playgroundForwardOutput("native", "stdout", text);
Module.printErr = (text) => window.__playgroundForwardOutput("native", "stderr", text);
```
   ensuring `window.__playgroundForwardOutput` (the same forwarding function wired up in issue 27, generalized to accept a `source` argument rather than being hard-coded to `"managed"`) is defined before the Emscripten module begins loading.
3. If issue 27's `ForwardOutput`/JS callback was hard-coded to always tag `source: "managed"`, generalize it now to accept the source as a parameter from both the managed `ForwardingTextWriter` (issue 27, passing `"managed"`) and this native hook (passing `"native"`), so both paths funnel through one JS-side function without duplicating message-construction logic.
4. Reload the preview and confirm native startup log lines (e.g. Emscripten's own runtime initialization messages, or MonoGame native runtime startup logs) appear in the frontend's stand-in output element tagged `source: "native"`, appearing before or independently of any managed `Console.WriteLine` output from issue 27's test class.
5. If possible, trigger a native-level warning (e.g. by requesting an unsupported WebGL feature, or checking if the native runtime logs anything on `Game.Run()` startup) and confirm it is captured with `stream: "stderr"` if `printErr` is used for it, or `stdout` if the native runtime uses `print` for warnings.

## Acceptance criteria

- [x] Native Emscripten `print`/`printErr` output is forwarded to the top-level frontend as `preview.output` messages tagged `source: "native"`
- [x] At least one native startup log line (emitted independently of managed code) is confirmed captured
- [x] The message-forwarding JS function is shared between the managed (issue 27) and native (this issue) capture paths, distinguished only by the `source` field, rather than duplicated
- [x] Both `stdout`-equivalent (`print`) and `stderr`-equivalent (`printErr`) native streams are correctly tagged

## Verification

Reload the preview with the test `Game1` class from issue 23/27 and observe the frontend's stand-in output element for native-tagged lines appearing (ideally before or interleaved with the managed-tagged lines from issue 27), confirming the `source` field on at least one native line via devtools console inspection of the raw received envelope. The verifier must distinguish and separately confirm at least one `source: "native"` line and one `source: "managed"` line are both present and correctly tagged.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-028 verifier
- **Date:** 2026-08-28
- **Evidence:** Protocol/native suite 57/57 passed. Three packaged launches
  exercised nine fresh runtimes with pre-managed native startup output,
  managed constructor output, native stdout/stderr, and real OpenGL teardown.
  Buffer limits, flush-once behavior, Unicode repair, stale rejection, and
  prior lifecycle regressions passed. Committed as `34c6b14`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: capture and forward native Emscripten output`

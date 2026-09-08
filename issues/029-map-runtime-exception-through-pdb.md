# Map runtime exception through PDB

**Type:** AFK
**Status:** Done
**Blocked by:** [021-transfer-load-dll-and-portable-pdb.md](021-transfer-load-dll-and-portable-pdb.md), [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md)
**PRD references:** 8.5, 19, 21
**User stories:** US5
**Triage:** needs-triage

## Context

PRD section 8.5 requires that when a game throws an unhandled exception, the preview stops, the exception appears in the Output panel, user-code stack frames must include source filenames and line numbers when the PDB from the current compilation is available, and the editor must remain responsive. Critical feasibility question 19 (section 19) asks whether portable PDBs can map a runtime exception to the correct source file and line. Functional requirement FR-020 (section 21) requires mapping user runtime exceptions to the current source file and line. This issue builds on the PDB-loading proof from issue 21 and the output-capture mechanisms from issues 27-28 to catch an unhandled exception thrown by user code and report its stack trace with accurate source file/line information resolved from the portable PDB.

## What to build

Wrap the user's game execution (construction, `Run()`, and — as much as is feasible for the WebGL asynchronous loop — its `Update`/`Draw` callbacks) in exception handling that catches an unhandled exception, resolves each user-code stack frame's source file and line number using the loaded portable PDB (via `System.Diagnostics.StackTrace(ex, true)` or `System.Reflection.Metadata` PDB APIs), and forwards a `preview.failed` protocol message containing the exception message, type, and the resolved file/line-annotated stack frames to the frontend, using a deliberately-throwing test class as proof.

## Scope

### In scope

- Exception handling around game construction and `Run()` inside `RunLoadedGame` (issue 23)
- Best-effort handling of exceptions thrown from within `Update`/`Draw` callbacks on the asynchronous Emscripten loop (using whatever global unhandled-exception hook is available in this .NET WebAssembly runtime, e.g. `AppDomain.CurrentDomain.UnhandledException` or a JS-side `window.onerror`/`Module.onAbort` fallback if managed hooks cannot intercept loop-scheduled callback exceptions)
- Resolving stack frame file/line using the PDB loaded in issue 21
- Forwarding a `preview.failed` message with the resolved information
- Confirming the preview stops after the exception (reusing the cleanup logic from issue 24) and that the frontend/editor remains responsive (no page freeze)

### Out of scope

- The polished Output-panel exception display UI (issue 49)
- Forced termination of a hung (non-throwing, infinite-looping) `Update` (issue 38 — this issue is specifically about an exception being thrown, not a hang)

## Implementation guidance

1. Compile a deliberately-throwing test class:
```csharp
public sealed class Game1 : Microsoft.Xna.Framework.Game
{
    protected override void Update(Microsoft.Xna.Framework.GameTime gameTime)
    {
        throw new System.InvalidOperationException("deliberate test failure");
    }
    protected override void Draw(Microsoft.Xna.Framework.GameTime gameTime) { base.Draw(gameTime); }
}
```
2. Wrap the call sites in `RunLoadedGame`/`GameRunner.ConstructGame` with `try/catch (Exception ex)`, and additionally investigate whether this .NET WebAssembly runtime surfaces asynchronous-loop-callback exceptions via `AppDomain.CurrentDomain.UnhandledException` (subscribe to this event early in preview boot, before `RunLoadedGame` is ever called) since `Update`/`Draw` run on the Emscripten-scheduled loop rather than directly inside the `RunLoadedGame` call stack.
3. On catching an exception, build a resolved stack trace: use `new System.Diagnostics.StackTrace(ex, true)` and check whether `.GetFileName()`/`.GetFileLineNumber()` on each frame returns the correct original source path/line (this requires the PDB loaded alongside the assembly in issue 21 to be correctly associated — confirm `Assembly.Load(dllBytes, pdbBytes)` correctly wires the PDB for stack trace symbolication in this runtime; if `StackTrace` does not resolve file/line automatically in this WASM runtime, fall back to manually reading the portable PDB's sequence points via `System.Reflection.Metadata.MetadataReaderProvider` keyed by the exception's IL offset, which can be obtained via `System.Diagnostics.StackFrame.GetILOffset()`).
4. Forward a `preview.failed` message: `{ exceptionType, message, frames: [{ method, file, line }] }`.
5. After forwarding, ensure the same cleanup as Stop (issue 24) runs so the preview fully stops rather than remaining in a broken half-running state.
6. Confirm the frontend (or a temporary devtools check) shows the resolved file/line pointing at the exact line of the `throw` statement in the test class's source.

## Acceptance criteria

- [x] Throwing an exception from the test class's `Update` method results in a `preview.failed` message being forwarded to the frontend
- [x] The resolved stack trace includes the correct source file name and line number of the `throw` statement, taken from the portable PDB loaded in issue 21, not merely the compiled method name with no location
- [x] The preview fully stops (same cleanup as issue 24) after the exception is reported, rather than continuing to run in a broken state
- [x] The frontend/editor context remains responsive immediately after the exception is reported (no page freeze), confirmed by interacting with any UI element right after the failure

## Verification

Run the deliberately-throwing test class and confirm a `preview.failed` message is received with a stack frame whose `file`/`line` exactly match the source location of the `throw` statement (count the line number by hand in the test source to confirm). Confirm the preview stops (canvas no longer renders) and that the top-level page remains interactive (e.g. can still click a button) immediately after. The verifier must independently verify the reported line number against the actual test source file.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-029 verifier
- **Date:** 2026-08-28
- **Evidence:** Constructor, LoadContent, Update, and Draw exceptions mapped to
  independently counted portable-PDB locations. Exactly one failed/stopped
  lifecycle, disposal, quiescence, controller recovery, and fresh restart were
  proven in packaged browser-WASM. Protocol 59/59 and issues 023-028
  regressions passed. Committed as `afd8cb7`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: map unhandled runtime exceptions through portable PDB`

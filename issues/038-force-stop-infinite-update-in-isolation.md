# Force-stop infinite Update in isolated process/WebView

**Type:** AFK
**Status:** Superseded (2026-09-06)
**Blocked by:** [024-cooperatively-stop-loop-and-release-resources.md](024-cooperatively-stop-loop-and-release-resources.md), [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md)
**PRD references:** 8.3, 12.4, 19
**User stories:** US3, US9
**Triage:** needs-triage

## SUPERSEDED by issue 052 (2026-09-06)

The force-stop-while-hung capability this issue proved is **retired as a product
feature** per the product owner's decision recorded in issue 052 (DECISION cont.
section). Rationale: an in-tick infinite loop (`while(true){}`) can wedge any
single-threaded renderer/game loop; maintaining a separate-window
force-terminate apparatus solely to recover from that is disproportionate for a
learning playground. Issue 052 Option B renders the live preview in the in-page
sandboxed iframe and explicitly accepts a frozen preview/editor as the outcome,
formally superseding the PRD 8.3 force-terminate requirement.

This record remains VALID as evidence that the isolated-window force-stop
mechanism WAS proven (it passed); it is superseded, not invalidated. The
`issue038_*` commands + `createIsolatedPreview` are still used as a TEST HARNESS
by other proofs and will be removed via the deliberate migration tracked as
issue 052 task-3 item 4 (not a simple delete).

## Context

PRD section 8.3 requires that if cooperative termination does not respond, the application must force-terminate the isolated preview, and states that if user code monopolizes the WebView thread and the editor cannot meet the 2-second Stop budget, the architecture must use a separately terminable WebView or process before Phase 2. Section 12.4 requires compilation/editor responsiveness even under adverse conditions. Critical feasibility question 18 (section 19) asks whether a hung game can be terminated while keeping the editor responsive. This issue proves the forced-stop path using a deliberately hostile test class whose `Update` method never returns (an infinite `while(true){}` loop with no yield), which defeats issue 24's cooperative `Game.Exit()`-based stop entirely, requiring the top-level frontend to forcibly destroy the preview's underlying WebView/process rather than waiting for cooperative cleanup.

## What to build

Detect that a cooperative Stop request (issue 24) has not completed within a bounded timeout (e.g. 500 ms, well under the 2-second budget) for a hung preview, and in that case forcibly terminate the preview's isolated execution context — for Tauri, this likely means closing/destroying the dedicated child window or webview hosting the preview (which requires the preview to run in its own OS-level window or webview instance, not merely an in-page iframe, since an iframe running an infinite synchronous loop typically blocks the entire renderer process/thread it shares with the top-level page) — and confirm the top-level editor UI remains interactive throughout, using a deliberately hostile `while(true){}` test class as proof.

## Scope

### In scope

- A bounded-timeout cooperative-stop-then-force-terminate flow in the frontend's Stop handling
- If the current architecture uses an in-page `<iframe>` for the preview (as established in issues 20-25) and this issue's testing proves an infinite synchronous loop in `Update` blocks the shared renderer thread (making the top-level editor UI unresponsive too), this issue must implement the architectural change required by PRD 8.3: moving the preview into a separately terminable OS-level WebView window (Tauri: a second `WebviewWindow`) or a separate process, and updating the Run/Stop frontend code accordingly
- Proving the editor UI remains interactive (e.g. a visible clock/counter element keeps updating, or a text input remains typable) while a hung preview is being force-terminated

### Out of scope

- Cooperative stop for well-behaved games (issue 24, already implemented; this issue is specifically about the case where cooperative stop fails)
- Any change to the compiler context's isolation (that is a separate, already-satisfied requirement from issue 16's persistent worker context)

## Implementation guidance

1. Compile and run a deliberately hostile test class:
```csharp
public sealed class Game1 : Microsoft.Xna.Framework.Game
{
    protected override void Update(Microsoft.Xna.Framework.GameTime gameTime)
    {
        while (true) { } // deliberately hangs forever, never yields
    }
}
```
2. Run it through the existing pipeline (issues 21-23) and attempt a normal cooperative Stop (issue 24); observe empirically whether the top-level editor UI (e.g. a live-updating clock element, or the ability to type into a text field) remains responsive while this game runs, and whether the cooperative Stop request completes within 2 seconds.
3. If the top-level UI becomes unresponsive (the expected outcome for an in-page iframe sharing the renderer thread with a busy-looping WebAssembly module), this confirms the PRD 8.3 architectural trigger: implement a separately terminable preview host. For Tauri, this means creating the preview inside its own `WebviewWindow` (a genuinely separate OS-level webview/window, closable independently via `WebviewWindow.close()`/destroy from the trusted top-level process without depending on the hung webview's own JS event loop) instead of (or in addition to) the in-page iframe used previously; migrate the `preview.load`/`preview.stopped`/`preview.failed` message-passing (issue 15's protocol) to work across this separate window boundary (e.g. via Tauri's inter-window `emit`/`listen` events, keeping the same message envelope shape).
4. Implement the forced-stop path: the frontend issues a cooperative stop request, starts a timeout (e.g. 500 ms), and if no `preview.stopped` acknowledgement is received in time, calls the shell-level forced-destroy API for the preview's window/webview (e.g. Tauri `WebviewWindow.close()` called from the trusted top-level process, which does not depend on the hung window's own JS thread responding).
5. After forced termination, confirm via OS-level process/window inspection (or Tauri's window-list API) that the preview's window/webview no longer exists, and confirm the top-level editor UI's live-updating element continued updating throughout the entire hung-game episode and the forced-stop sequence.
6. Re-run issues 23, 24, and 25's proofs against the new separately-terminable-window architecture (if it was introduced) to confirm no regression for well-behaved games.

## Acceptance criteria

- [x] A deliberately hostile `while(true){}` `Update` method is confirmed to hang the preview's execution indefinitely
- [x] The top-level editor UI (proven via a live-updating element or interactive control) remains responsive throughout the hung game's execution and the forced-stop sequence, regardless of whether an architectural change to a separate window/process was required to achieve this
- [x] The forced-stop path terminates the hung preview within a bounded time (documented, and well within the overall 2-second Stop budget from PRD 8.3) when cooperative stop does not respond
- [x] If a separate-window/process architecture change was required, issues 23-25's proofs are re-verified to still pass under the new architecture with no regression

## Verification

Run the hostile `while(true){}` test class, attempt Stop, and measure (a) whether the top-level editor's live-updating element continued updating throughout (screen-record or repeatedly poll its displayed value during the hang), and (b) the total time from Stop request to confirmed preview termination. Confirm the preview's window/process/webview no longer exists afterward (via OS process list or the shell's own window-list API). Then re-run issue 23 (render), issue 24 (cooperative stop timing), and issue 25 (three-cycle clean restart) end-to-end to confirm no regression. The verifier must personally observe UI responsiveness during the hang and record the measured forced-stop duration.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue038-commit-verifier agent, after iterative implementation and security remediation
- **Date:** 2026-08-31
- **Evidence:** The packaged proof compiled and transferred a real hostile C# MonoGame assembly whose `Update()` never returns. During the hang, the trusted main WebView recorded 17 heartbeat samples and 17 input mutations with a 130 ms maximum gap. Cooperative Stop expired at 500 ms, then exact-generation native destruction removed the isolated preview WebView in 31 ms, with no orphan process/window. Protocol tests passed 101/101, Rust tests passed 40/40, and TypeScript type-check passed. Packaged regressions 023, 024, 025, 033 (including the negative no-WASM-eval case), 034, 035, 036, and both 037 restart phases all passed. Issue 034 exercised all 72 commands through the correct-key Tauri invoke path and observed 72 ACL rejections, zero resolutions, no privileged effects, and no invoke-key leakage.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: force-terminate hung preview while keeping editor responsive`

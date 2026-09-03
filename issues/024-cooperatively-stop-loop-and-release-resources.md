# Cooperatively stop loop and release resources

**Type:** AFK
**Status:** Done
**Blocked by:** None; the human-authored MonoGame cancellation fix is available locally as `ecf06ee240dcc5524e82b656b4682e22b4c91175`
**PRD references:** 8.3, 13.3
**User stories:** US3
**Triage:** needs-triage

## Context

PRD section 8.3 defines the cooperative stop path: cancel the Emscripten main loop, explicitly release WebGL and audio, close message ports, revoke generated object URLs, and then remove the preview. Stop must return the editor to an interactive state within 2 seconds on the reference machine. Section 13.3 defines the lifecycle state machine including a `stopping` state. This issue implements the cooperative stop path on top of the running game from issue 23 for a well-behaved game (one whose `Update`/`Draw` do not hang) — the forced/unresponsive path is issue 38.

**Resolved blocker:** MonoGame `eb687a0ec226b56f0b2b2a1a01ad811a841fc116` did not cancel the Native WebGL Emscripten loop. The human-authored commit `ecf06ee240dcc5524e82b656b4682e22b4c91175` adds once-only cancellation for both `Game.Exit()` and platform disposal, clears stale callback ownership, and raises `AsyncRunLoopEnded`. MonoGame Web-platform tests were intentionally omitted because no existing harness is available, so this issue must prove the behavior in the packaged browser-WASM runtime. Phased order remains **026A human loop cancellation → 024 manual cleanup → 026B exit-notification integration**; see `docs/monogame-changes/game-exit-webgl.md`.

## What to build

Implement a `StopGame()` preview export that requests cooperative shutdown of the currently running game: cancel its Emscripten main loop, dispose its `GraphicsDevice`/audio resources, and signal the top-level frontend to remove the preview iframe, then confirm the whole sequence completes and control returns to the (simulated) editor within 2 seconds for the well-behaved `Game1` test class from issue 23.

## Scope

### In scope

- `[JSExport] public static string StopGame()` in `PreviewExports.cs` that cancels the running game's loop and releases its resources
- Frontend logic that, upon receiving a `preview.stopped` protocol event (per `src/shared/Protocol.md`), removes/destroys the preview iframe element
- Timing the full stop sequence (loop cancellation + resource release + iframe removal) and confirming it completes within 2 seconds for the well-behaved test game

### Out of scope

- Forced termination of an unresponsive/hung game (issue 25 covers restart with clean state; issue 38 covers forced termination of a hung `Update`)
- `Game.Exit()`-triggered stop specifically (issue 26 implements the MonoGame-side `Game.Exit()` host event; this issue's stop is initiated by the user pressing Stop, not by the game calling `Exit()`)

## Implementation guidance

1. In `PreviewExports.cs`, implement:
```csharp
[JSExport]
public static string StopGame()
{
    if (_activeGame is null) return "already-stopped";
    // NativeGamePlatform.Dispose cancels the active Emscripten loop before
    // destroying its Native resources. Do not call Exit for a manual Stop.
    _activeGame.Dispose();
    _activeGame = null;
    return "stopped";
}
```
   Consume the human-authored cancellation behavior through `Game.Dispose()`.
   Manual Stop must not call `Game.Exit()` or emit the game-originated exit
   notification; do not duplicate Emscripten scheduling/cancellation in
   playground code.
2. On the frontend, listen for the `preview.stopped` event and remove the `<iframe>` DOM node, revoking any `URL.createObjectURL` references created for the preview's assets (per PRD 8.3's "revoke generated object URLs").
3. Close any `MessageChannel`/message ports opened for compiler↔preview or top-level↔preview communication for this preview instance.
4. Instrument timing: record `performance.now()` immediately before requesting stop and immediately after the iframe is confirmed removed from the DOM; confirm the elapsed time is under 2000 ms for the well-behaved `Game1` test class from issue 23.

## Acceptance criteria

- [ ] `StopGame()` cancels the running game's loop and releases its `GraphicsDevice`/audio resources for a well-behaved test game
- [ ] The top-level frontend removes the preview iframe upon receiving `preview.stopped` and revokes any object URLs created for that preview instance
- [ ] The full stop sequence (request → loop cancelled → resources released → iframe removed) completes within 2 seconds for the well-behaved `Game1` test class, measured with `performance.now()`
- [ ] After stop, the canvas/iframe no longer renders any frames (confirmed by observing no further visual updates)

## Verification

Run the `Game1` test class from issue 23, let it render for a few seconds, then trigger Stop and measure elapsed time with the `performance.now()` instrumentation described above; confirm it is under 2000 ms and print the exact measured value. Visually confirm the canvas stops updating and the iframe element is removed from the DOM (check via devtools Elements panel). The verifier must record the exact measured stop duration and confirm DOM removal directly.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-024 verifier
- **Date:** 2026-08-28
- **Evidence:** Protocol 47/47; Rust 5/5; four issue-023 packaged
  regression runs and four issue-024 packaged runs passed. Stop completed in
  109-111 ms with stable frames, one disposal, zero post-disposal callbacks,
  audio create/play/dispose/close 1/1/1/1, three WebGL deletes, response before
  one `preview.stopped`, and confirmed port/iframe/URL cleanup. Committed as
  `fe62cd0`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: implement cooperative stop with resource cleanup`

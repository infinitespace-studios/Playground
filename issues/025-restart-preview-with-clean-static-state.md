# Restart preview with clean static state

**Type:** AFK
**Status:** Done
**Blocked by:** None; issue 024 completed in `fe62cd0`
**PRD references:** 8.3, 13.3, 17
**User stories:** US3
**Triage:** needs-triage

## Context

PRD section 13.3 requires a fresh preview context to be created on every successful run, with the iframe destroy/recreate cycle as the required reset mechanism, and explicitly states not to attempt unloading/replacing user assemblies inside one runtime for the MVP. Section 8.3 covers the stop workflow this builds on. Section 17 ("Memory and lifecycle") requires twenty consecutive Run/Stop cycles to not increase stabilized process RSS by more than 20%, and requires a stopped preview to have no continuing audio, animation frames, WebGL context, message ports, or retained user static state. This issue proves that after Stop (issue 24), pressing Run again creates a genuinely fresh preview iframe/runtime with no leftover static state from the previous run, by recreating the iframe rather than reusing the existing .NET runtime instance.

## What to build

Implement the Run-again flow: on a second Run request after Stop, destroy any remnants of the previous preview iframe (if not already fully removed by issue 24) and create a brand-new `<iframe>` element pointing at the same published preview build, which boots a completely new .NET WebAssembly runtime instance (fresh static fields, fresh `GraphicsDevice`, fresh everything), then load and run the user assembly again in this new instance. Prove static state does not leak by using a test class with a `static int RunCount` field and confirming it reads `0`/starts fresh on the second run rather than continuing to increment across preview instances.

## Scope

### In scope

- Frontend logic that creates a brand-new `<iframe src=...>` element (with a fresh unique element/identity, e.g. by setting a cache-busting query param or simply creating a new DOM node rather than reusing an old one) for every successful Run, never reusing a previous iframe's `contentWindow`
- A test compiled class with a `static int RunCount` field incremented in its constructor, used to prove static state resets
- Confirming the twenty-cycle stability expectation qualitatively for this issue (a full quantitative twenty-cycle memory measurement is issue 42; this issue only needs to prove correctness of state reset across at least 3 manual cycles)

### Out of scope

- Quantitative 20-cycle memory/RSS measurement (issue 42)
- Forced termination of hung previews (issue 38)
- The MonoGame-side `Game.Exit()` host event (issue 26)

## Implementation guidance

1. On the frontend, change the Run-button handler so that every Run request (a) if a preview iframe already exists from a previous run, ensures it has been stopped and removed (reusing issue 24's stop logic, awaiting its completion) and only then (b) creates a brand-new `<iframe>` DOM element (not reusing the old element reference) with a fresh `src` pointing at the preview's published `index.html`, and waits for its `load` event before sending the `preview.load` message with the newly compiled (or previously compiled, for a plain re-run) assembly bytes.
2. Compile a test class:
```csharp
public sealed class Game1 : Microsoft.Xna.Framework.Game
{
    private static int _runCount;
    public Game1() { _runCount++; System.Console.WriteLine($"RunCount={_runCount}"); }
    protected override void Draw(Microsoft.Xna.Framework.GameTime gameTime)
    {
        GraphicsDevice.Clear(Microsoft.Xna.Framework.Color.CornflowerBlue);
        base.Draw(gameTime);
    }
}
```
3. Run this class three times in a row (Run → Stop → Run → Stop → Run), capturing the `Console.WriteLine` output each time (reuse issue 27's console-capture mechanism if already available, otherwise temporarily read it via devtools console pass-through for this proof).
4. Confirm each of the three runs logs `RunCount=1` (not `RunCount=2`, `RunCount=3`), proving the static field truly resets because a brand-new .NET runtime instance (inside a brand-new iframe) is used each time, not the same runtime with reloaded assemblies.
5. Confirm via devtools that each Run creates a distinct iframe DOM node (different object identity) rather than mutating the `src` of a persisted node.

## Acceptance criteria

- [ ] Every successful Run creates a brand-new `<iframe>` DOM element rather than reusing a previous one
- [ ] A test class with a `static int` field incremented in its constructor logs the same starting value (e.g. `RunCount=1`) on three consecutive Run cycles, proving no static state leaks between runs
- [ ] The previous preview iframe is confirmed fully stopped/removed before the new one is created
- [ ] No JS console errors appear across three consecutive Run/Stop cycles

## Verification

Perform three manual Run→Stop cycles with the `RunCount` test class described above, capturing the printed `RunCount` value each time via devtools/console output. Confirm all three show `RunCount=1`. Also inspect the DOM (Elements panel) across the three cycles to confirm a new iframe element is created each time (e.g. by noting a distinct internal object reference or by adding a temporary unique `data-run-id` attribute set from JS at creation time and confirming it differs each cycle). The verifier must personally observe all three console outputs.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-025 verifier
- **Date:** 2026-08-28
- **Evidence:** Three independent packaged launches completed nine Run/Stop
  cycles. Every cycle reported `RunCount=1`, static constructor count 1,
  distinct iframe/contentWindow/runtime/generation/port/preview identities,
  one disposal, zero post-disposal callbacks, and complete WebGL/audio/URL/
  port cleanup. Issue-023 and issue-024 packaged regressions passed. Committed
  as `3fdd8b8`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: recreate iframe for clean-state restart on every Run`

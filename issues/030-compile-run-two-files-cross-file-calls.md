# Compile/run two source files with cross-file calls

**Type:** AFK
**Status:** Done
**Blocked by:** [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md)
**PRD references:** 12.1, 20.2
**User stories:** US1, US4
**Triage:** needs-triage

## Context

PRD section 12.1 requires the compiler to accept one or more source files with their logical paths. Section 20.2 requires the feasibility spike to prove that multiple generated assemblies can call across source files and use representative MonoGame APIs, reflection, LINQ, numerics, exceptions, and supported content. This issue is the first proof of true multi-file compilation and execution: two `.cs` files where one calls into a type defined in the other, compiled together into a single assembly and run inside the preview, confirming the whole pipeline (compile → load → discover → run, issues 17-23) works unchanged for a multi-file project, which is a prerequisite for the later local-projects feature (issue 51).

## What to build

Compile two source files together — a `Game1.cs` that references and calls a method on a class defined in a second file `Player.cs` — through `CompilationService.Compile` (issue 17, already multi-file capable since it accepts `IReadOnlyList<(string Path, string Text)>`), load and run the resulting single assembly in the preview (issues 21-23), and confirm the cross-file call executes correctly (e.g. by rendering a color returned by the second file's class, or logging a value from it via the console-capture mechanism from issue 27).

## Scope

### In scope

- A two-file test project: `Game1.cs` (the `Game` subclass) and `Player.cs` (a plain class with a method `Game1` calls)
- Confirming the compiler accepts both files with correct logical paths and produces one assembly
- Confirming a diagnostic error in the second file is correctly attributed to that file (regression check against issue 18's multi-file diagnostic test)
- Confirming the cross-file call executes correctly at runtime inside the preview

### Out of scope

- Actual file-explorer/multi-file editing UI (issue 51)
- Manifest/project persistence (issue 51)
- Reflection/LINQ/numerics-specific compatibility fixtures (those are covered more broadly as part of issue 43's Release trimming survival proof, though this issue may reuse the same test files)

## Implementation guidance

1. Author two test source strings:
```csharp
// Player.cs
public class Player
{
    public Microsoft.Xna.Framework.Color GetColor() => Microsoft.Xna.Framework.Color.LimeGreen;
}
```
```csharp
// Game1.cs
using Microsoft.Xna.Framework;
public sealed class Game1 : Game
{
    private readonly Player _player = new Player();
    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(_player.GetColor());
        base.Draw(gameTime);
        System.Console.WriteLine("cross-file call rendered: " + _player.GetColor());
    }
}
```
2. Call `CompilationService.Compile` with both files as `[("Game1.cs", game1Text), ("Player.cs", playerText)]` and confirm `Success == true` with zero diagnostics.
3. Load and run the resulting assembly through the full preview pipeline (issues 21-23) and confirm the canvas renders `Color.LimeGreen` and the console-forwarding mechanism (issue 27) shows the expected log line.
4. As a regression check for issue 18's multi-file diagnostic attribution, introduce a deliberate syntax error only in `Player.cs` (e.g. remove a closing brace) and confirm the returned diagnostic's `File` field says `Player.cs`.
5. Revert the deliberate error before finishing this issue's proof (keep only the working two-file test as the recorded evidence, e.g. saved under `tests/compiler/fixtures/cross-file/` for future automated test reuse — create this fixtures directory now since `tests/` does not yet exist).

## Acceptance criteria

- [x] Compiling `Game1.cs` and `Player.cs` together succeeds with zero diagnostics and produces a single assembly
- [x] Running the resulting assembly renders `Color.LimeGreen` (proving `Game1` correctly calls into `Player`) and logs the expected console line via issue 27's output capture
- [x] A deliberate syntax error placed only in `Player.cs` is reported with `File` correctly set to `Player.cs`, confirmed as a regression check
- [x] The two-file fixture is saved under `tests/compiler/fixtures/cross-file/` for reuse by later automated tests

## Verification

Run the two-file compile → load → run pipeline and visually confirm the canvas renders lime green, and check the forwarded console output for the expected log line. Then run the deliberate-error regression check and confirm the diagnostic names `Player.cs`. Confirm `tests/compiler/fixtures/cross-file/Game1.cs` and `tests/compiler/fixtures/cross-file/Player.cs` exist and match the working (non-error) versions. The verifier must observe the rendered color and the console/diagnostic output directly.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-030 verifier
- **Date:** 2026-08-28
- **Evidence:** Two packaged launches proved deterministic canonical/reversed
  compilation, one DLL/PDB with two documents, exact Player.cs diagnostics,
  one cross-file managed output, genuine LimeGreen framebuffer pixels, and
  complete cleanup. Protocol 60/60 and relevant regressions passed. Committed
  as `2811faa`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `compiler: prove multi-file compilation with cross-file calls`

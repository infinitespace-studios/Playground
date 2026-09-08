# Capture managed Console output

**Type:** AFK
**Status:** Done
**Blocked by:** [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md)
**PRD references:** 14.3, 21
**User stories:** US5
**Triage:** needs-triage

## Context

PRD section 14.3 requires the Output panel to receive `Console.WriteLine`, `Console.Error`, game startup messages, runtime exceptions, content loading errors, shader errors, and preview lifecycle messages, and requires the preview to capture and tag managed `Console.Out`/`Console.Error` output. Functional requirement FR-010 (section 21) requires capturing console output. This issue implements the managed side of that capture: redirecting `Console.Out`/`Console.Error` inside the preview's .NET runtime to forward each line to the top-level frontend as a tagged `preview.output` protocol message (per `src/shared/Protocol.md` from issue 15), using the running `Game1` test class from issue 23 as the proof vehicle.

## What to build

Install a custom `TextWriter` on `Console.Out` and `Console.Error` inside the preview's .NET runtime (before the user's `Game` is constructed) that forwards every write to the top-level frontend as a `preview.output` message tagged `source: "managed"` and `stream: "stdout"|"stderr"`, and prove this works using a test class that calls `Console.WriteLine` and `Console.Error.WriteLine` from `Update`/`Draw`/its constructor.

## Scope

### In scope

- A custom `TextWriter` subclass in `src/preview/` (e.g. `ForwardingTextWriter.cs`) that forwards each write to a `[JSImport]`-bound JS callback
- Installing this writer via `Console.SetOut`/`Console.SetError` before constructing the user's `Game` (i.e. inside the `RunLoadedGame` flow from issue 23, prior to `ConstructGame`)
- Forwarding forwarded lines to the frontend as `preview.output` messages with `source: "managed"`
- A minimal Output-panel stand-in in the frontend (a `<pre>`/`<ul>` element appending each received line) sufficient to prove the pipeline end-to-end; the polished Output panel UI is implemented later (issue 49)

### Out of scope

- Native Emscripten `Module.print`/`Module.printErr` capture (issue 28)
- Runtime exception-to-PDB mapping (issue 29)
- The polished Output panel UI with panel switching, filters, etc. (issue 49)

## Implementation guidance

1. Create `src/preview/ForwardingTextWriter.cs`:
```csharp
using System.Text;

public sealed class ForwardingTextWriter : System.IO.TextWriter
{
    private readonly string _stream; // "stdout" or "stderr"
    public ForwardingTextWriter(string stream) { _stream = stream; }
    public override Encoding Encoding => Encoding.UTF8;
    public override void Write(char value) => Write(value.ToString());
    public override void Write(string? value)
    {
        if (string.IsNullOrEmpty(value)) return;
        PreviewExports.ForwardOutput("managed", _stream, value);
    }
    public override void WriteLine(string? value) => Write((value ?? "") + "\n");
}
```
2. In `PreviewExports.cs`, add a `ForwardOutput(string source, string stream, string text)` helper that calls a `[JSImport]`-bound JS function (declared per the current SDK's JS interop pattern, e.g. `[JSImport("globalThis.__playgroundForwardOutput")]`) which the frontend registers to construct and post a `preview.output` envelope to the top-level frontend.
3. Before constructing the user's game in `RunLoadedGame` (issue 23), call `Console.SetOut(new ForwardingTextWriter("stdout"))` and `Console.SetError(new ForwardingTextWriter("stderr"))`.
4. Compile and run a test class:
```csharp
public sealed class Game1 : Microsoft.Xna.Framework.Game
{
    public Game1() { System.Console.WriteLine("Game1 constructed"); System.Console.Error.WriteLine("a test error line"); }
    protected override void Draw(Microsoft.Xna.Framework.GameTime gameTime) { GraphicsDevice.Clear(Microsoft.Xna.Framework.Color.CornflowerBlue); base.Draw(gameTime); }
}
```
5. Confirm both lines are received by the frontend's stand-in output element, correctly tagged with `source: "managed"` and the correct `stream`.

## Acceptance criteria

- [x] `Console.WriteLine` calls inside the running user game are forwarded to the top-level frontend as `preview.output` messages tagged `source: "managed"`, `stream: "stdout"`
- [x] `Console.Error.WriteLine` calls are forwarded tagged `stream: "stderr"`
- [x] The forwarding is installed before the user's `Game` constructor runs, so constructor-time console output is captured
- [x] A minimal frontend stand-in displays every received line in order

## Verification

Run the test `Game1` class above through the full pipeline and observe the frontend's stand-in output element; confirm it shows both "Game1 constructed" (tagged stdout) and "a test error line" (tagged stderr) in the correct order. The verifier must check the actual tag/stream field on each received message (e.g. via a devtools console log of the raw received envelope), not just the visible text.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-027 verifier
- **Date:** 2026-08-28
- **Evidence:** Protocol 51/51 and writer boundary probes passed. Three
  packaged launches captured constructor, blank, CR/LF, Unicode split,
  Draw/Update, partial stderr, and disposal output across six fresh runtimes
  with exact source/stream/order, no stale output, and complete cleanup.
  Committed as `b0220fb`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: capture and forward managed Console output`

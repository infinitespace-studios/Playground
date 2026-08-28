import {
  compileLoadStartIssue23,
  preparePackagedProofRuntime,
  type Issue23RunningPreview,
} from "./issue21";
import type { PreviewOutput } from "../../shared/MessageContracts";

const sourceText = `
using Microsoft.Xna.Framework;
using System;
using System.Linq;
using System.Threading;

public sealed class ManagedOutputGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _updated;
    private static int _drawn;

    public ManagedOutputGame()
    {
        Console.Write('c');
        Console.Write("tor");
        Console.WriteLine("-out");
        Console.Error.Write("ctor");
        Console.Error.WriteLine("-err");
        Console.WriteLine("");
        Console.Write("cr");
        Console.Write('\\r');
        Console.Write('\\n');
        Console.WriteLine(string.Concat(Enumerable.Repeat("🙂", 5000)));
        _graphics = new GraphicsDeviceManager(this);
    }

    protected override void Update(GameTime gameTime)
    {
        if (Interlocked.Exchange(ref _updated, 1) == 0)
        {
            Console.Write("update");
            Console.WriteLine("-line");
        }
        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        if (Interlocked.Exchange(ref _drawn, 1) == 0)
        {
            Console.Write('d');
            Console.WriteLine("raw-line");
            Console.Error.Write("partial-error");
            Console.Error.Flush();
        }
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            Console.Error.WriteLine("dispose-err");
        base.Dispose(disposing);
    }
}`;

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

const expectedBeforeStop = [
  ["stdout", "ctor-out"],
  ["stderr", "ctor-err"],
  ["stdout", ""],
  ["stdout", "cr"],
  ["stdout", "🙂".repeat(4096)],
  ["stdout", "🙂".repeat(904)],
  ["stdout", "draw-line"],
  ["stderr", "partial-error"],
  ["stdout", "update-line"],
] as const;

function simplified(events: readonly PreviewOutput[]) {
  return events.map(event => [
    event.payload.stream,
    event.payload.text,
  ]);
}

function assertPrefix(events: readonly PreviewOutput[]) {
  const actual = simplified(events.filter(event => event.payload.source === "managed"));
  if (JSON.stringify(actual) !== JSON.stringify(expectedBeforeStop))
    throw new Error(`Managed output sequence mismatched: ${JSON.stringify(actual)}`);
  if (!events.filter(event => event.payload.source === "managed").every(event =>
    event.payload.source === "managed" && event.payload.category === "console"))
    throw new Error("Managed output tags mismatched.");
}

async function runCycle(index: number) {
  const standIn = document.querySelector<HTMLElement>("#preview-managed-output");
  if (!standIn)
    throw new Error("Managed output stand-in is unavailable.");
  standIn.textContent = "";
  const displayed: string[] = [];
  const preview = await compileLoadStartIssue23({
    assemblyName: `Issue027ManagedOutput${index}`,
    sourcePath: "src/ManagedOutputGame.cs",
    sourceText,
    proofMode: true,
    issue024Proof: true,
    onOutput(event) {
      const line = `[${event.payload.source} ${event.payload.stream}] ${event.payload.text}`;
      displayed.push(line);
      standIn.append(document.createTextNode(`${line}\n`));
    },
  });
  const deadline = performance.now() + 10_000;
  while (preview.outputEvents.filter(
    event => event.payload.source === "managed").length < expectedBeforeStop.length &&
         performance.now() < deadline) {
    await wait(25);
  }
  assertPrefix(preview.outputEvents);
  const writerSelfTest = await preview.proof<{
    success?: boolean;
    eventCount?: number;
    utf8ByteLengths?: number[];
  }>("issue027-writer-test");
  if (writerSelfTest?.success !== true || writerSelfTest.eventCount !== 7 ||
      JSON.stringify(writerSelfTest.utf8ByteLengths) !==
        JSON.stringify([2, 0, 7, 7, 6, 16_384, 3_616]))
    throw new Error(`Managed writer self-test failed: ${JSON.stringify(writerSelfTest)}`);
  const startedIndex = preview.wireOrder.indexOf("preview.started");
  const startedSequence = (preview.startedEvent as PreviewOutput).payload.sequence;
  if (startedIndex < 0 || preview.outputEvents.filter(event =>
    event.payload.source === "managed" && event.payload.sequence < startedSequence).length !== 6)
    throw new Error(`Constructor output was not ordered before started: ${preview.wireOrder}`);
  const sequences = preview.outputEvents.map(event => event.payload.sequence);
  if (!sequences.every((sequence, position) => position === 0 || sequence > sequences[position - 1]))
    throw new Error(`Output event sequence regressed: ${sequences}`);
  const stop = await preview.stop() as Record<string, unknown>;
  const expectedAfterStop = [...expectedBeforeStop, ["stderr", "dispose-err"]];
  const actualAfterStop = simplified(
    preview.outputEvents.filter(event => event.payload.source === "managed"));
  if (JSON.stringify(actualAfterStop) !== JSON.stringify(expectedAfterStop))
    throw new Error(`Disposal output sequence mismatched: ${JSON.stringify(actualAfterStop)}`);
  const countAfterStop = preview.outputEvents.length;
  await wait(100);
  if (preview.outputEvents.length !== countAfterStop)
    throw new Error("Output was accepted after preview retirement.");
  if (standIn.textContent !== `${displayed.join("\n")}\n`)
    throw new Error("The frontend output stand-in did not preserve received order.");
  return {
    previewId: preview.previewId,
    contextGeneration: preview.contextGeneration,
    portIdentity: preview.portIdentity,
    frameDomIdentity: preview.frameDomIdentity,
    contentWindowIdentity: preview.contentWindowIdentity,
    sequence: preview.outputEvents.map(event => ({
      sequence: event.payload.sequence,
      source: event.payload.source,
      stream: event.payload.stream,
      text: event.payload.text.length > 100 ? `<${event.payload.text.length} chars>` : event.payload.text,
    })),
    displayedCount: displayed.length,
    staleOutputAfterStop: false,
    iframeRemoved: !preview.frame.isConnected,
    portClosed: preview.client.isClosed,
    stopMilliseconds: stop.elapsedMilliseconds,
    wireOrder: preview.wireOrder,
    writerSelfTest,
  };
}

export async function runIssue027AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue027_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  const cycles = [await runCycle(1), await runCycle(2)];
  const noConsoleErrors = window.__MONOGAME_DIAGNOSTICS__.consoleErrors.length === 0;
  const distinct = (key: keyof typeof cycles[number]) =>
    new Set(cycles.map(cycle => cycle[key])).size === cycles.length;
  if (!distinct("previewId") || !distinct("contextGeneration") ||
      !distinct("portIdentity") || !distinct("frameDomIdentity") ||
      !distinct("contentWindowIdentity") ||
      !noConsoleErrors ||
      cycles.some(cycle => !cycle.iframeRemoved || !cycle.portClosed ||
        Number(cycle.stopMilliseconds) >= 2_000)) {
    throw new Error(`Fresh output runtime assertions failed: ${JSON.stringify(cycles)}`);
  }
  await invoke("issue027_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE027_PROOF=1",
      proofRuntimeReadiness,
      cycles,
      noConsoleErrors,
      assertions: {
        constructorStdoutAndStderrCaptured: true,
        partialCharCrLfBlankAndFlushCaptured: true,
        unicodeScalarSafeSplitting: true,
        updateAndDrawCaptured: true,
        disposalOutputCapturedBeforeRetirement: true,
        frontendStandInPreservedOrder: true,
        noStaleOutputAfterStop: true,
        freshRuntimeReset: true,
      },
    }),
  });
}

// Scenario proof suite — Managed / native output capture (durable).
//
// Durable scenario 4: capture managed console output (former issue27) and
// native Emscripten output (former issue28) into the real Output panel. The two
// sub-proofs are orchestrated by the single `runOutputCaptureScenario`
// entrypoint below; the per-issue env gates (`issue027/028_is_proof_enabled`)
// and report commands (`issue027/028_emit_report`) are preserved verbatim for
// Stage-6 compatibility. Shared helpers are deduplicated at module scope.
// PRODUCT never imports this module.
import {
  compileLoadStartIssue23,
  preparePackagedProofRuntime,
} from "./issue21";
import type { PreviewOutput } from "../../shared/MessageContracts";
import { getIssue049OutputPanel, formatOutputLine } from "./issue049";
import { runScenario, type SubProof } from "./scenario-runner";

// Shared across both output sub-proofs (deduplicated from the former per-issue
// namespaces).
const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

// ── Managed console output (former issue27) ──
const managedOutputSource = `
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

async function runManagedOutputCycle(index: number) {
  const panel = getIssue049OutputPanel();
  panel.clear();
  const displayed: string[] = [];
  const preview = await compileLoadStartIssue23({
    assemblyName: `Issue027ManagedOutput${index}`,
    sourcePath: "src/ManagedOutputGame.cs",
    sourceText: managedOutputSource,
    proofMode: true,
    issue024Proof: true,
    onOutput(event) {
      displayed.push(formatOutputLine(event));
      panel.appendOutput(event);
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
  if (JSON.stringify(panel.outputLineTexts()) !== JSON.stringify(displayed))
    throw new Error("The Output panel did not preserve received order.");
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
  const cycles = [await runManagedOutputCycle(1), await runManagedOutputCycle(2)];
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

// ── Native Emscripten output (former issue28) ──
const nativeOutputSource = `
using Microsoft.Xna.Framework;
using System;

public sealed class NativeOutputGame : Game
{
    private readonly GraphicsDeviceManager _graphics;

    public NativeOutputGame()
    {
        Console.WriteLine("managed-constructor-stdout");
        Console.Error.WriteLine("managed-constructor-stderr");
        _graphics = new GraphicsDeviceManager(this);
    }

    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(gameTime);
    }
}`;

function count(events: readonly PreviewOutput[], source: string, stream: string, text: string) {
  return events.filter(event =>
    event.payload.source === source &&
    event.payload.stream === stream &&
    event.payload.text === text).length;
}

async function runNativeOutputCycle(index: number) {
  const panel = getIssue049OutputPanel();
  panel.clear();
  const displayed: string[] = [];
  const preview = await compileLoadStartIssue23({
    assemblyName: `Issue028NativeOutput${index}`,
    sourcePath: "src/NativeOutputGame.cs",
    sourceText: nativeOutputSource,
    proofMode: true,
    issue024Proof: true,
    issue028Proof: true,
    onOutput(event) {
      displayed.push(formatOutputLine(event));
      panel.appendOutput(event);
    },
  });
  await preview.proof("issue028-emit");
  const deadline = performance.now() + 5_000;
  while ((count(
    preview.outputEvents, "native", "stdout", "Playground native runtime stdout proof.") !== 1 ||
    count(
      preview.outputEvents, "native", "stderr", "Playground native runtime stderr proof.") !== 1) &&
      performance.now() < deadline)
    await wait(20);

  const events = preview.outputEvents;
  const bootstrapText = "Playground native runtime bootstrap.";
  const nativeStdoutText = "Playground native runtime stdout proof.";
  const nativeStderrText = "Playground native runtime stderr proof.";
  const bootstrap = events.find(event => event.payload.source === "native" &&
    event.payload.stream === "stdout" && event.payload.category === "startup" &&
    event.payload.text === bootstrapText);
  const managedOut = events.find(event =>
    event.payload.source === "managed" && event.payload.text === "managed-constructor-stdout");
  const managedErr = events.find(event =>
    event.payload.source === "managed" && event.payload.text === "managed-constructor-stderr");
  if (!bootstrap || !managedOut || !managedErr ||
      bootstrap.payload.sequence >= managedOut.payload.sequence ||
      count(events, "native", "stdout", nativeStdoutText) !== 1 ||
      count(events, "native", "stderr", nativeStderrText) !== 1 ||
      count(events, "managed", "stdout", "managed-constructor-stdout") !== 1 ||
      count(events, "managed", "stderr", "managed-constructor-stderr") !== 1) {
    throw new Error(`Native/managed output evidence mismatched: ${JSON.stringify(events)}`);
  }
  const runtimeNative = events.filter(event =>
    event.payload.source === "native" &&
    [nativeStdoutText, nativeStderrText].includes(event.payload.text));
  if (!runtimeNative.every(event => event.payload.category === "runtime"))
    throw new Error("Post-start native output was not categorized as runtime.");
  const snapshot = await preview.proof<{
    authenticated?: boolean;
    flushed?: boolean;
    flushCalls?: number;
    bufferedMessages?: number;
    acceptedPrePortMessages?: number;
    droppedOverflowMessages?: number;
    teeErrors?: number;
  }>("snapshot", { name: "native" });
  if (snapshot?.authenticated !== true || snapshot.flushed !== true ||
      snapshot.flushCalls !== 1 || snapshot.bufferedMessages !== 0 ||
      Number(snapshot.acceptedPrePortMessages) < 1 ||
      snapshot.droppedOverflowMessages !== 0 || snapshot.teeErrors !== 0) {
    throw new Error(`Native buffer proof mismatched: ${JSON.stringify(snapshot)}`);
  }
  if (JSON.stringify(panel.outputLineTexts()) !== JSON.stringify(displayed))
    throw new Error("Output panel order mismatched.");
  const sequences = events.map(event => event.payload.sequence);
  if (!sequences.every((sequence, position) => position === 0 || sequence > sequences[position - 1]))
    throw new Error(`Output sequence regressed: ${sequences}`);
  const stop = await preview.stop() as Record<string, unknown>;
  const retiredBuffer = (stop.runtime as {
    nativeOutput?: { retired?: boolean; rejectedAfterRetirement?: number };
  })?.nativeOutput;
  if (retiredBuffer?.retired !== true || retiredBuffer.rejectedAfterRetirement !== 2)
    throw new Error(`Post-retirement native output was not rejected: ${JSON.stringify(stop)}`);
  const acceptedCount = events.length;
  await wait(100);
  if (events.length !== acceptedCount)
    throw new Error("Native output was accepted after retirement.");
  return {
    previewId: preview.previewId,
    contextGeneration: preview.contextGeneration,
    portIdentity: preview.portIdentity,
    output: events.map(event => ({
      sequence: event.payload.sequence,
      source: event.payload.source,
      stream: event.payload.stream,
      category: event.payload.category,
      text: event.payload.text,
    })),
    buffer: snapshot,
    retiredBuffer,
    displayedCount: displayed.length,
    stopMilliseconds: stop.elapsedMilliseconds,
    iframeRemoved: !preview.frame.isConnected,
    portClosed: preview.client.isClosed,
  };
}

export async function runIssue028AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue028_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  const cycles = [await runNativeOutputCycle(1), await runNativeOutputCycle(2), await runNativeOutputCycle(3)];
  for (const key of ["previewId", "contextGeneration", "portIdentity"] as const) {
    if (new Set(cycles.map(cycle => cycle[key])).size !== cycles.length)
      throw new Error(`Fresh runtime identity repeated: ${key}`);
  }
  if (cycles.some(cycle =>
    !cycle.iframeRemoved || !cycle.portClosed || Number(cycle.stopMilliseconds) >= 2_000))
    throw new Error(`Native output cleanup failed: ${JSON.stringify(cycles)}`);
  await invoke("issue028_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE028_PROOF=1",
      proofRuntimeReadiness,
      cycles,
      assertions: {
        deterministicNativeStartupBeforeManagedConstructor: true,
        nativeStdoutAndStderrCallbacks: true,
        managedAndNativeCoexistInOrder: true,
        boundedBufferFlushedExactlyOnce: true,
        freshRuntimeIsolation: true,
        noDuplicateOrPostRetirementDelivery: true,
        defaultOutputTeePreserved: true,
      },
    }),
  });
}

// Single durable-scenario entrypoint. Orchestrates the managed- and
// native-output sub-proofs; each self-gates on its own env flag and emits its
// own success report, while this driver owns failure reporting.
export async function runOutputCaptureScenario(): Promise<void> {
  const subProofs: SubProof[] = [
    { label: "managed console output", reportCommand: "issue027_emit_report", run: runIssue027AutoProof },
    { label: "native Emscripten output", reportCommand: "issue028_emit_report", run: runIssue028AutoProof },
  ];
  await runScenario(subProofs);
}

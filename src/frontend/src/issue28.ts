import {
  compileLoadStartIssue23,
  preparePackagedProofRuntime,
} from "./issue21";
import type { PreviewOutput } from "../../shared/MessageContracts";

const sourceText = `
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

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

function count(events: readonly PreviewOutput[], source: string, stream: string, text: string) {
  return events.filter(event =>
    event.payload.source === source &&
    event.payload.stream === stream &&
    event.payload.text === text).length;
}

async function runCycle(index: number) {
  const standIn = document.querySelector<HTMLElement>("#preview-managed-output");
  if (!standIn) throw new Error("Preview output stand-in is unavailable.");
  standIn.textContent = "";
  const displayed: string[] = [];
  const preview = await compileLoadStartIssue23({
    assemblyName: `Issue028NativeOutput${index}`,
    sourcePath: "src/NativeOutputGame.cs",
    sourceText,
    proofMode: true,
    issue024Proof: true,
    issue028Proof: true,
    onOutput(event) {
      const line =
        `[${event.payload.source} ${event.payload.stream} ${event.payload.category}] ` +
        event.payload.text;
      displayed.push(line);
      standIn.append(document.createTextNode(`${line}\n`));
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
  if (standIn.textContent !== `${displayed.join("\n")}\n`)
    throw new Error("Output stand-in order mismatched.");
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
  const cycles = [await runCycle(1), await runCycle(2), await runCycle(3)];
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

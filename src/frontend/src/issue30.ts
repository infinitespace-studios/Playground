import game1Text from "../../../tests/compiler/fixtures/cross-file/Game1.cs?raw";
import playerText from "../../../tests/compiler/fixtures/cross-file/Player.cs?raw";
import {
  compileLoadStartIssue23,
  compileSourcesThroughPersistentCompiler,
} from "./issue21";
import { preparePackagedProofRuntime } from "./issue21";
import { createIssue024RunStopController } from "./issue24-controller";

const gamePath = "tests/compiler/fixtures/cross-file/Game1.cs";
const playerPath = "tests/compiler/fixtures/cross-file/Player.cs";
const outputText = "issue030-cross-file:value=42;color=LimeGreen";
const limeGreenRgba = [50, 205, 50, 255];
const sources = [
  { path: gamePath, text: game1Text },
  { path: playerPath, text: playerText },
];

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

export async function runIssue030AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue030_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  if (!game1Text.includes("_player.CrossFileValue()") ||
      !playerText.includes("CrossFileValue() => 42"))
    throw new Error("Packaged cross-file fixtures do not match the repository sources.");

  const assemblyName = "Issue030CrossFileDeterministic";
  const first = await compileSourcesThroughPersistentCompiler({
    assemblyName, sources, primarySourcePath: gamePath,
  });
  const repeated = await compileSourcesThroughPersistentCompiler({
    assemblyName, sources, primarySourcePath: gamePath,
  });
  const reversed = await compileSourcesThroughPersistentCompiler({
    assemblyName, sources: [...sources].reverse(), primarySourcePath: gamePath,
  });
  const deterministic = [first, repeated, reversed];
  if (deterministic.some(result => result.success !== true) ||
      deterministic.some(result =>
        (result.diagnostics as unknown[])?.length !== 0) ||
      new Set(deterministic.map(result => result.compileId)).size !== 3 ||
      new Set(deterministic.map(result => result.assemblySha256)).size !== 1 ||
      new Set(deterministic.map(result => result.pdbSha256)).size !== 1)
    throw new Error(`Two-file deterministic compilation failed: ${JSON.stringify(deterministic)}`);

  const brokenPlayer = playerText.replace(
    "public int CrossFileValue() => 42;",
    "public MissingType CrossFileValue() => null;",
  );
  if (brokenPlayer === playerText) throw new Error("Player error fixture generation failed.");
  const deliberateError = await compileSourcesThroughPersistentCompiler({
    assemblyName: "Issue030PlayerDiagnostic",
    sources: [
      { path: gamePath, text: game1Text },
      { path: playerPath, text: brokenPlayer },
    ],
    primarySourcePath: gamePath,
  });
  const error = deliberateError.error as {
    code?: string;
    diagnostics?: Array<{
      id?: string;
      file?: string;
      line?: number;
      column?: number;
      severity?: string;
    }>;
  };
  const target = error?.diagnostics?.find(diagnostic => diagnostic.id === "CS0246");
  if (deliberateError.success !== false || error?.code !== "COMPILE_FAILED" ||
      target?.file !== playerPath || target.line !== 5 || target.column !== 12 ||
      target.severity !== "error" ||
      error.diagnostics?.some(diagnostic => diagnostic.file === gamePath))
    throw new Error(`Player diagnostic attribution failed: ${JSON.stringify(deliberateError)}`);

  const duplicatePath = await compileSourcesThroughPersistentCompiler({
    assemblyName: "Issue030DuplicatePath",
    sources: [
      { path: gamePath, text: game1Text },
      { path: gamePath, text: playerText },
    ],
    primarySourcePath: gamePath,
  });
  if (duplicatePath.success !== false ||
      (duplicatePath.error as { code?: string })?.code !== "MALFORMED_PAYLOAD")
    throw new Error(`Duplicate logical path was accepted: ${JSON.stringify(duplicatePath)}`);

  const runButton = document.querySelector<HTMLButtonElement>("#run-clear-color");
  const stopButton = document.querySelector<HTMLButtonElement>("#stop-clear-color");
  const status = document.querySelector<HTMLElement>("#run-clear-color-status");
  if (!runButton || !stopButton || !status)
    throw new Error("Production Run/Stop controls are unavailable.");
  const controller = createIssue024RunStopController({
    start: () => compileLoadStartIssue23({
      assemblyName,
      sourcePath: gamePath,
      sourceText: game1Text,
      sources,
      primarySourcePath: gamePath,
      proofMode: true,
      issue024Proof: true,
      issue030Proof: true,
    }),
    stop: (preview, reason) => preview.stop(reason),
    observeFailure: preview => preview.failure,
    setRunDisabled: disabled => { runButton.disabled = disabled; },
    setStopDisabled: disabled => { stopButton.disabled = disabled; },
    setStatus: (state, text) => {
      status.dataset.state = state;
      status.textContent = text;
    },
    reportError: failure => { console.error("Issue 030 lifecycle failed", failure); },
  });
  const preview = await controller.run();
  const deadline = performance.now() + 10_000;
  let state = await preview.query();
  let pixels = await preview.proof<Record<string, unknown>>(
    "snapshot", { name: "pixels" });
  while ((Number(state.frameCount) < 3 ||
      !(pixels?.samples as number[][] | undefined)?.some(sample =>
        sample.every((value, index) => value === limeGreenRgba[index]))) &&
      performance.now() < deadline) {
    await wait(50);
    state = await preview.query();
    pixels = await preview.proof<Record<string, unknown>>(
      "snapshot", { name: "pixels" });
  }
  const managedLines = preview.outputEvents.filter(event =>
    event.payload.source === "managed" &&
    event.payload.stream === "stdout" &&
    event.payload.category === "console" &&
    event.payload.text === outputText);
  const acceptanceErrors = {
    console: [...window.__MONOGAME_DIAGNOSTICS__.consoleErrors],
    unhandled: [...window.__MONOGAME_DIAGNOSTICS__.unhandledErrors],
    preview: [...((await preview.proof<{ errors?: string[] }>(
      "snapshot", { name: "issue21" })).errors ?? [])],
  };
  const sourcePaths = preview.binaryProof.sourcePaths;
  if (preview.compileDiagnostics.length !== 0 ||
      preview.binaryProof.assemblySha256 !== first.assemblySha256 ||
      preview.binaryProof.pdbSha256 !== first.pdbSha256 ||
      sourcePaths.length !== 2 ||
      sourcePaths[0] !== gamePath || sourcePaths[1] !== playerPath ||
      preview.managedLoad?.documentCount !== 2 ||
      preview.managedLoad.expectedSourcePaths?.join(",") !== `${gamePath},${playerPath}` ||
      preview.compilerRuntimeStarts !== 1 ||
      managedLines.length !== 1 ||
      !(pixels?.samples as number[][] | undefined)?.some(sample =>
        sample.every((value, index) => value === limeGreenRgba[index])) ||
      (pixels?.errors as unknown[] | undefined)?.length !== 0)
    throw new Error(`Packaged cross-file runtime evidence failed: ${JSON.stringify({
      preview, state, pixels, managedLines,
    })}`);
  if (Object.values(acceptanceErrors).some(errors => errors.length !== 0))
    throw new Error(`Unexpected issue-030 error channels: ${JSON.stringify(acceptanceErrors)}`);

  const stop = await controller.stop() as {
    elapsedMilliseconds?: number;
    iframeConnected?: boolean;
    portClosed?: boolean;
    runtime?: {
      stop?: {
        disposeAttempts?: number;
        proofDisposeCount?: number;
        frameCount?: number;
        quiescent?: {
          frameCount?: number;
          disposeCount?: number;
          callbackAfterDisposedCount?: number;
        };
      };
    };
  };
  const stopped = stop.runtime?.stop;
  if (stopped?.disposeAttempts !== 1 || stopped.proofDisposeCount !== 1 ||
      stopped.quiescent?.disposeCount !== 1 ||
      stopped.quiescent.callbackAfterDisposedCount !== 0 ||
      stopped.frameCount !== stopped.quiescent.frameCount ||
      stop.iframeConnected !== false || stop.portClosed !== true ||
      Number(stop.elapsedMilliseconds) >= 2_000 ||
      controller.state !== "idle" || runButton.disabled || !stopButton.disabled)
    throw new Error(`Cross-file cleanup/recovery failed: ${JSON.stringify(stop)}`);

  await invoke("issue030_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE030_PROOF=1",
      proofRuntimeReadiness,
      fixtures: {
        paths: [gamePath, playerPath],
        sourceCount: 2,
        playerDiagnostic: target,
      },
      deterministic,
      duplicatePath,
      runtime: {
        compileId: preview.compileId,
        previewId: preview.previewId,
        compilerRuntimeStarts: preview.compilerRuntimeStarts,
        frameReadiness: preview.frameReadiness,
        binaryProof: preview.binaryProof,
        managedLoad: preview.managedLoad,
        state,
        managedOutput: managedLines[0],
        pixelProof: pixels,
        acceptanceErrors,
        stop,
      },
      assertions: {
        oneAssemblyForTwoSources: true,
        distinctCompileCorrelationsNoStaleReuse: true,
        reversedOrderDeterministic: true,
        portablePdbContainsBothPaths: true,
        playerDiagnosticExact: true,
        duplicatePathRejected: true,
        runtimeCrossFileCallObserved: true,
        actualLimeGreenFramebufferPixel: true,
        oneTimeManagedOutput: true,
        cleanupExactlyOnce: true,
        editorControlsRecovered: true,
      },
    }),
  });
}

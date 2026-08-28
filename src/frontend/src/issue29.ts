import {
  compileLoadStartIssue23,
  preparePackagedProofRuntime,
} from "./issue21";
import { createIssue024RunStopController } from "./issue24-controller";

export const issue029PartialEvidence: Record<string, unknown> = {};

const sourcePath = "src/ThrowingGame.cs";
const throwLine = 30;
const sourceText = `using Microsoft.Xna.Framework;
using System;
using System.Threading;

public sealed class ThrowingGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _frameCount;
    private static int _updateCount;
    private static int _disposeCount;
    private static int _disposed;
    private static int _callbackAfterDisposedCount;

    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int UpdateCount => Volatile.Read(ref _updateCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);
    public static int CallbackAfterDisposedCount =>
        Volatile.Read(ref _callbackAfterDisposedCount);

    public ThrowingGame()
    {
        _graphics = new GraphicsDeviceManager(this);
    }

    protected override void Update(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        if (Interlocked.Increment(ref _updateCount) == 3)
            throw new InvalidOperationException("issue-029 deliberate Update failure");
        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        GraphicsDevice.Clear(Color.CornflowerBlue);
        Interlocked.Increment(ref _frameCount);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Interlocked.Exchange(ref _disposed, 1);
            Interlocked.Increment(ref _disposeCount);
        }
        base.Dispose(disposing);
    }
}`;

const recoverySource = `using Microsoft.Xna.Framework;
public sealed class RecoveryGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    public RecoveryGame() { _graphics = new GraphicsDeviceManager(this); }
    protected override void Draw(GameTime time)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(time);
    }
}`;

const constructorThrowLine = 8;
const constructorFailureSource = `using Microsoft.Xna.Framework;
using System;

public sealed class ConstructorFailureGame : Game
{
    public ConstructorFailureGame()
    {
        throw new InvalidOperationException("issue-029 deliberate constructor failure");
    }
}`;

const runThrowLine = 13;
const runFailureSource = `using Microsoft.Xna.Framework;
using System;

public sealed class RunFailureGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    public static int DisposeCount { get; private set; }
    public RunFailureGame() { _graphics = new GraphicsDeviceManager(this); }

    protected override void LoadContent()
    {
        base.LoadContent();
        throw new InvalidOperationException("issue-029 deliberate Run failure");
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) DisposeCount++;
        base.Dispose(disposing);
    }
}`;

const drawThrowLine = 38;
const drawFailureSource = `using Microsoft.Xna.Framework;
using System;
using System.Threading;

public sealed class DrawFailureGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _frameCount;
    private static int _updateCount;
    private static int _disposeCount;
    private static int _disposed;
    private static int _callbackAfterDisposedCount;

    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int UpdateCount => Volatile.Read(ref _updateCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);
    public static int CallbackAfterDisposedCount =>
        Volatile.Read(ref _callbackAfterDisposedCount);

    public DrawFailureGame()
    {
        _graphics = new GraphicsDeviceManager(this);
    }

    protected override void Update(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        Interlocked.Increment(ref _updateCount);
        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        if (Interlocked.Increment(ref _frameCount) == 3)
            throw new ApplicationException("issue-029 deliberate Draw failure");
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Interlocked.Exchange(ref _disposed, 1);
            Interlocked.Increment(ref _disposeCount);
        }
        base.Dispose(disposing);
    }
}`;

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

async function runStartFailure(
  assemblyName: string,
  sourcePath: string,
  sourceText: string,
  expectedMessage: string,
  expectedMethod: string,
  expectedLine: number,
  expectedDisposeAttempts: number,
) {
  try {
    await compileLoadStartIssue23({
      assemblyName,
      sourcePath,
      sourceText,
      proofMode: true,
      issue024Proof: true,
    });
    throw new Error("The deliberately failing preview unexpectedly started.");
  } catch (error) {
    const proof = (error as {
      failureProof?: {
        failedEvent?: {
          payload?: {
            phase?: string;
            error?: { code?: string; message?: string; details?: Record<string, unknown> };
          };
        };
        stoppedEvent?: { payload?: { reason?: string } };
        wireOrder?: string[];
        afterRetirement?: { iframeConnected?: boolean; portClosed?: boolean };
      };
    }).failureProof;
    const failure = proof?.failedEvent?.payload;
    const details = failure?.error?.details;
    if (failure?.phase !== "start" ||
        failure.error?.code !== "PREVIEW_RUNTIME_FAILED" ||
        failure.error.message !== expectedMessage ||
        details?.exceptionType !== "System.InvalidOperationException" ||
        details.frame0File !== sourcePath ||
        details.frame0Line !== expectedLine ||
        !String(details.frame0Method).endsWith(`.${expectedMethod}`) ||
        details.cleanupSucceeded !== true ||
        details.disposeAttempts !== expectedDisposeAttempts ||
        proof?.stoppedEvent?.payload?.reason !== "failed" ||
        proof?.wireOrder?.filter(type => type !== "preview.output").join(",") !==
          "preview.start.response,preview.failed,preview.stopped" ||
        proof?.afterRetirement?.iframeConnected !== false ||
        proof?.afterRetirement?.portClosed !== true)
      throw new Error(`Start failure evidence mismatched: ${JSON.stringify(proof)}`);
    return proof;
  }
}

async function runFailureCycle(index: number) {
  const preview = await compileLoadStartIssue23({
    assemblyName: `Issue029ThrowingGame${index}`,
    sourcePath,
    sourceText,
    proofMode: true,
    issue024Proof: true,
  });
  const failure = await Promise.race([
    preview.failure,
    wait(10_000).then(() => { throw new Error("Runtime failure was not reported."); }),
  ]) as {
    failedEvent: {
      correlationId: string;
      payload: {
        sequence: number;
        phase: string;
        error: { code: string; message: string; details: Record<string, unknown> };
      };
    };
    stoppedEvent: {
      correlationId: string;
      payload: { sequence: number; reason: string };
    };
    runtime: {
      state?: string;
      nativeOutput?: { retired?: boolean };
      runtimeFailureCleanup?: {
        cleanupSucceeded?: boolean;
        disposeAttempts?: number;
        frameCount?: number;
        updateCount?: number;
        proofDisposeCount?: number;
        callbackAfterDisposedCount?: number;
      };
    };
    iframeConnected: boolean;
    portClosed: boolean;
  };
  const details = failure.failedEvent.payload.error.details;
  if (failure.failedEvent.payload.error.code !== "PREVIEW_RUNTIME_FAILED" ||
      failure.failedEvent.payload.phase !== "running" ||
      details.exceptionType !== "System.InvalidOperationException" ||
      failure.failedEvent.payload.error.message !== "issue-029 deliberate Update failure" ||
      details.frame0File !== sourcePath ||
      details.frame0Line !== throwLine ||
      !String(details.frame0Method).endsWith(".Update") ||
      failure.runtime?.runtimeFailureCleanup?.cleanupSucceeded !== true ||
      failure.runtime?.runtimeFailureCleanup?.disposeAttempts !== 1 ||
      failure.runtime?.runtimeFailureCleanup?.proofDisposeCount !== 1 ||
      failure.runtime?.runtimeFailureCleanup?.callbackAfterDisposedCount !== 0 ||
      failure.stoppedEvent.correlationId !== failure.failedEvent.correlationId ||
      failure.stoppedEvent.payload.reason !== "failed" ||
      failure.stoppedEvent.payload.sequence <= failure.failedEvent.payload.sequence ||
      failure.runtime?.state !== "disposed" ||
      failure.runtime?.nativeOutput?.retired !== true ||
      failure.iframeConnected !== false ||
      failure.portClosed !== true) {
    throw new Error(`Runtime failure evidence mismatched: ${JSON.stringify(failure)}`);
  }

  const acceptedOutputCount = preview.outputEvents.length;
  await wait(100);
  if (preview.outputEvents.length !== acceptedOutputCount)
    throw new Error("Output was accepted after failed preview retirement.");
  return {
    previewId: preview.previewId,
    contextGeneration: preview.contextGeneration,
    portIdentity: preview.portIdentity,
    failed: failure.failedEvent,
    stopped: failure.stoppedEvent,
    runtime: failure.runtime,
    output: preview.outputEvents.map(event => ({
      sequence: event.payload.sequence,
      source: event.payload.source,
      stream: event.payload.stream,
      category: event.payload.category,
      text: event.payload.text,
    })),
    iframeRemoved: !preview.frame.isConnected,
    portClosed: preview.client.isClosed,
  };
}

async function runDrawFailureThroughController() {
  const runButton = document.querySelector<HTMLButtonElement>("#run-clear-color");
  const stopButton = document.querySelector<HTMLButtonElement>("#stop-clear-color");
  const status = document.querySelector<HTMLElement>("#run-clear-color-status");
  if (!runButton || !stopButton || !status)
    throw new Error("Production Run/Stop controls are unavailable.");
  let starts = 0;
  let explicitStops = 0;
  const controller = createIssue024RunStopController({
    start: () => {
      starts++;
      return compileLoadStartIssue23(starts === 1
        ? {
            assemblyName: "Issue029DrawFailure",
            sourcePath: "src/DrawFailureGame.cs",
            sourceText: drawFailureSource,
            proofMode: true,
            issue024Proof: true,
          }
        : {
            assemblyName: `Issue029DrawRecovery${starts}`,
            sourcePath: "src/RecoveryGame.cs",
            sourceText: recoverySource,
            proofMode: true,
            issue024Proof: true,
          });
    },
    stop: (preview, reason) => {
      explicitStops++;
      return preview.stop(reason);
    },
    observeFailure: preview => preview.failure,
    setRunDisabled: disabled => { runButton.disabled = disabled; },
    setStopDisabled: disabled => { stopButton.disabled = disabled; },
    setStatus: (state, text) => {
      status.dataset.state = state;
      status.textContent = text;
    },
    reportError: error => { console.error("Issue 029 Draw lifecycle failed", error); },
  });
  const failedPreview = await controller.run();
  const failure = await Promise.race([
    failedPreview.failure,
    wait(10_000).then(() => { throw new Error("Draw failure was not reported."); }),
  ]) as {
    failedEvent: {
      correlationId: string;
      payload: {
        sequence: number;
        phase: string;
        error: { code: string; message: string; details: Record<string, unknown> };
      };
    };
    stoppedEvent: {
      correlationId: string;
      payload: { sequence: number; reason: string };
    };
    runtime: {
      runtimeFailureCleanup?: {
        cleanupSucceeded?: boolean;
        disposeAttempts?: number;
        frameCount?: number;
        updateCount?: number;
        proofDisposeCount?: number;
        callbackAfterDisposedCount?: number;
      };
    };
    quiescent?: {
      before?: {
        frameCount?: number;
        updateCount?: number;
        callbackAfterDisposedCount?: number;
        disposeCount?: number;
      };
      after?: {
        frameCount?: number;
        updateCount?: number;
        callbackAfterDisposedCount?: number;
        disposeCount?: number;
      };
    };
    quiescentError?: string | null;
  };
  await wait(0);
  const details = failure.failedEvent.payload.error.details;
  const before = failure.quiescent?.before;
  const after = failure.quiescent?.after;
  const failureTypes = failedPreview.wireOrder.filter(type => type === "preview.failed");
  const stoppedTypes = failedPreview.wireOrder.filter(type => type === "preview.stopped");
  if (failure.failedEvent.payload.phase !== "running" ||
      failure.failedEvent.payload.error.code !== "PREVIEW_RUNTIME_FAILED" ||
      failure.failedEvent.payload.error.message !== "issue-029 deliberate Draw failure" ||
      details.exceptionType !== "System.ApplicationException" ||
      details.frame0File !== "src/DrawFailureGame.cs" ||
      details.frame0Line !== drawThrowLine ||
      !String(details.frame0Method).endsWith(".Draw") ||
      String(details.frame0Method).endsWith(".Update") ||
      failureTypes.length !== 1 ||
      stoppedTypes.length !== 1 ||
      failure.stoppedEvent.correlationId !== failure.failedEvent.correlationId ||
      failure.stoppedEvent.payload.reason !== "failed" ||
      failure.stoppedEvent.payload.sequence <= failure.failedEvent.payload.sequence ||
      failure.runtime.runtimeFailureCleanup?.cleanupSucceeded !== true ||
      failure.runtime.runtimeFailureCleanup?.disposeAttempts !== 1 ||
      failure.runtime.runtimeFailureCleanup?.frameCount !== 3 ||
      Number(failure.runtime.runtimeFailureCleanup?.updateCount) < 1 ||
      failure.runtime.runtimeFailureCleanup?.proofDisposeCount !== 1 ||
      failure.runtime.runtimeFailureCleanup?.callbackAfterDisposedCount !== 0 ||
      failure.quiescentError !== null ||
      before?.disposeCount !== 1 || after?.disposeCount !== 1 ||
      before?.callbackAfterDisposedCount !== 0 ||
      after?.callbackAfterDisposedCount !== 0 ||
      !Number.isInteger(before?.frameCount) ||
      before?.frameCount !== 3 ||
      before?.frameCount !== after?.frameCount ||
      !Number.isInteger(before?.updateCount) ||
      Number(before?.updateCount) < 1 ||
      before?.updateCount !== after?.updateCount ||
      controller.state !== "idle" ||
      runButton.disabled || !stopButton.disabled ||
      explicitStops !== 0) {
    throw new Error(`Draw failure/controller evidence mismatched: ${JSON.stringify({
      failure, wireOrder: failedPreview.wireOrder, controllerState: controller.state,
      runDisabled: runButton.disabled, stopDisabled: stopButton.disabled, explicitStops,
    })}`);
  }
  const recovery = await controller.run();
  const recoveryState = await recovery.query();
  if (recovery.previewId === failedPreview.previewId ||
      recovery.contextGeneration === failedPreview.contextGeneration ||
      recovery.portIdentity === failedPreview.portIdentity ||
      recoveryState.state !== "running")
    throw new Error("Draw failure did not recover into a fresh running preview.");
  const recoveryStop = await controller.stop();
  if (controller.state !== "idle" || runButton.disabled || !stopButton.disabled ||
      Number(explicitStops) !== 1)
    throw new Error("Production controls did not recover after the fresh restart stopped.");
  return {
    failedPreview: {
      previewId: failedPreview.previewId,
      contextGeneration: failedPreview.contextGeneration,
      portIdentity: failedPreview.portIdentity,
      wireOrder: failedPreview.wireOrder,
    },
    failure,
    recovery: {
      previewId: recovery.previewId,
      contextGeneration: recovery.contextGeneration,
      portIdentity: recovery.portIdentity,
      state: recoveryState,
      stop: recoveryStop,
    },
    controls: {
      controllerState: controller.state,
      runDisabled: runButton.disabled,
      stopDisabled: stopButton.disabled,
      explicitStops,
    },
  };
}

export async function runIssue029AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue029_is_proof_enabled"))) return;
  if (sourceText.split("\n").findIndex(line => line.includes("throw new")) + 1 !== throwLine)
    throw new Error("The hand-counted issue-029 throw line changed.");
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  if (constructorFailureSource.split("\n")
      .findIndex(line => line.includes("throw new")) + 1 !== constructorThrowLine ||
      runFailureSource.split("\n")
        .findIndex(line => line.includes("throw new")) + 1 !== runThrowLine ||
      drawFailureSource.split("\n")
        .findIndex(line => line.includes("throw new")) + 1 !== drawThrowLine)
    throw new Error("A hand-counted start-failure throw line changed.");
  const constructorFailure = await runStartFailure(
    "Issue029ConstructorFailure",
    "src/ConstructorFailureGame.cs",
    constructorFailureSource,
    "issue-029 deliberate constructor failure",
    "ctor",
    constructorThrowLine,
    0,
  );
  issue029PartialEvidence.constructorFailure = constructorFailure;
  const runFailure = await runStartFailure(
    "Issue029RunFailure",
    "src/RunFailureGame.cs",
    runFailureSource,
    "issue-029 deliberate Run failure",
    "LoadContent",
    runThrowLine,
    1,
  );
  issue029PartialEvidence.runFailure = runFailure;
  const cycles: Awaited<ReturnType<typeof runFailureCycle>>[] = [];
  for (let index = 1; index <= 3; index++) {
    cycles.push(await runFailureCycle(index));
    issue029PartialEvidence.updateCycles = [...cycles];
  }
  const drawFailure = await runDrawFailureThroughController();
  issue029PartialEvidence.drawFailure = drawFailure;
  for (const key of ["previewId", "contextGeneration", "portIdentity"] as const) {
    if (new Set(cycles.map(cycle => cycle[key])).size !== cycles.length)
      throw new Error(`Fresh failure runtime identity repeated: ${key}`);
  }
  const recovery = await compileLoadStartIssue23({
    assemblyName: "Issue029RecoveryGame",
    sourcePath: "src/RecoveryGame.cs",
    sourceText: recoverySource,
    proofMode: true,
    issue024Proof: true,
  });
  const recoveryState = await recovery.query();
  const recoveryStop = await recovery.stop();
  issue029PartialEvidence.finalRecovery = { state: recoveryState, stop: recoveryStop };
  await invoke("issue029_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE029_PROOF=1",
      proofRuntimeReadiness,
      canonicalSource: { path: sourcePath, handCountedThrowLine: throwLine },
      constructorFailure,
      runFailure,
      drawFailure,
      cycles,
      recovery: { state: recoveryState, stop: recoveryStop },
      assertions: {
        asynchronousUpdateFailureReportedExactlyOnce: true,
        asynchronousDrawFailureMappedAndArbitratedExactlyOnce: true,
        drawFailureProductionControllerRecovered: true,
        constructorAndSynchronousRunFailuresMapped: true,
        portablePdbMappedExactCanonicalSource: true,
        failedThenStoppedWithSharedCorrelation: true,
        disposalExactlyOnceAndNoDisposedCallback: true,
        staleOutputRejectedAfterRetirement: true,
        freshRuntimeRestartSucceeded: true,
      },
    }),
  });
}

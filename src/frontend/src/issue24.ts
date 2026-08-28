import {
  compileLoadStartIssue23,
  preparePackagedProofRuntime,
  type Issue23RunningPreview,
} from "./issue21";
import { createIssue024RunStopController } from "./issue24-controller";

const sourceText = `
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Audio;
using System.Threading;

public sealed class CooperativeStopGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _frameCount;
    private static int _updateCount;
    private static int _disposeCount;
    private static int _disposed;
    private static int _callbackAfterDisposedCount;
    private static int _audioCreateCount;
    private static int _audioPlayCount;
    private static int _audioDisposeCount;
    private SoundEffect _sound;

    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int UpdateCount => Volatile.Read(ref _updateCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);
    public static int CallbackAfterDisposedCount => Volatile.Read(ref _callbackAfterDisposedCount);
    public static int AudioCreateCount => Volatile.Read(ref _audioCreateCount);
    public static int AudioPlayCount => Volatile.Read(ref _audioPlayCount);
    public static int AudioDisposeCount => Volatile.Read(ref _audioDisposeCount);

    public CooperativeStopGame()
    {
        _graphics = new GraphicsDeviceManager(this);
        Content.RootDirectory = "Content";
    }

    protected override void LoadContent()
    {
        _sound = new SoundEffect(new byte[1600], 8000, AudioChannels.Mono);
        Interlocked.Increment(ref _audioCreateCount);
        if (_sound.Play()) Interlocked.Increment(ref _audioPlayCount);
        base.LoadContent();
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
            if (_sound != null)
            {
                _sound.Dispose();
                Interlocked.Increment(ref _audioDisposeCount);
                _sound = null;
            }
        }
        base.Dispose(disposing);
    }
}`;

const start = (proofMode: boolean) => compileLoadStartIssue23({
  assemblyName: proofMode ? "Issue024ProofGame" : "Issue024Game",
  sourcePath: "src/CooperativeStopGame.cs",
  sourceText,
  proofMode,
  issue024Proof: proofMode,
});

function createRunStopController(proofMode: boolean) {
  const runButton = document.querySelector<HTMLButtonElement>("#run-clear-color");
  const stopButton = document.querySelector<HTMLButtonElement>("#stop-clear-color");
  const status = document.querySelector<HTMLElement>("#run-clear-color-status");
  if (!runButton || !stopButton || !status) throw new Error("Issue 024 Run/Stop control is missing.");
  const controller = createIssue024RunStopController({
    start: () => start(proofMode),
    stop: (preview, reason) => preview.stop(reason),
    setRunDisabled: disabled => { runButton.disabled = disabled; },
    setStopDisabled: disabled => { stopButton.disabled = disabled; },
    setStatus: (state, text) => {
      status.dataset.state = state;
      status.textContent = text;
    },
    reportError: error => { console.error("Clear-color Game lifecycle failed", error); },
  });
  return { controller, runButton, stopButton, status };
}

export function installIssue024RunStopControl(): void {
  const { controller, runButton, stopButton } = createRunStopController(false);
  runButton.addEventListener("click", () => { void controller.run().catch(() => {}); });
  stopButton.addEventListener("click", () => { void controller.stop().catch(() => {}); });
}

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

export async function runIssue024AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue024_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  const { controller, runButton, stopButton, status } = createRunStopController(true);
  const preview = await controller.run() as Issue23RunningPreview;
  const deadline = performance.now() + 10_000;
  let running = await preview.query();
  while (Number(running.frameCount) < 3 && performance.now() < deadline) {
    await wait(50);
    running = await preview.query();
  }
  if (Number(running.frameCount) < 3) throw new Error("Issue 024 game did not begin drawing.");

  const firstStop = controller.stop();
  const duplicateStop = controller.stop();
  const duplicateResolvedToSameOperation = firstStop === duplicateStop;
  const stopped = await firstStop as {
    elapsedMilliseconds: number;
    iframeConnected: boolean;
    portClosed: boolean;
    wasConnectedAtStopped: boolean;
    revokedObjectUrls: number;
    objectUrlsUnavailable: boolean;
    wireOrder: string[];
    stoppedEvent?: { payload?: { reason?: string } };
    runtime?: Record<string, unknown>;
  };
  const runtime = stopped.runtime as {
    stop?: {
      frameCount?: number;
      disposeAttempts?: number;
      proofDisposeCount?: number;
      quiescent?: {
        frameCount?: number;
        updateCount?: number;
        disposeCount?: number;
        callbackAfterDisposedCount?: number;
        audioCreateCount?: number;
        audioPlayCount?: number;
        audioDisposeCount?: number;
      };
    };
    animationFrameCancellations?: number;
    webglDeleteCalls?: number;
    audioCloseCalls?: number;
  } | null;
  const managed = runtime?.stop;
  const quiescent = managed?.quiescent;
  if (!duplicateResolvedToSameOperation ||
      stopped.elapsedMilliseconds >= 2_000 ||
      stopped.iframeConnected !== false ||
      stopped.portClosed !== true ||
      stopped.wasConnectedAtStopped !== true ||
      stopped.revokedObjectUrls !== 1 ||
      stopped.objectUrlsUnavailable !== true ||
      stopped.wireOrder.join(",") !== "preview.stop.response,preview.stopped" ||
      stopped.stoppedEvent?.payload?.reason !== "requested" ||
      managed?.proofDisposeCount !== 1 ||
      quiescent?.disposeCount !== 1 ||
      quiescent?.callbackAfterDisposedCount !== 0 ||
      quiescent?.audioCreateCount !== 1 ||
      quiescent?.audioPlayCount !== 1 ||
      quiescent?.audioDisposeCount !== 1 ||
      quiescent?.frameCount !== managed.frameCount ||
      managed?.disposeAttempts !== 1) {
    throw new Error(`Issue 024 cooperative stop proof failed: ${JSON.stringify(stopped)}`);
  }

  await invoke("issue024_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE024_PROOF=1",
      proofRuntimeReadiness,
      running,
      stop: stopped,
      assertions: {
        cancellationOwnershipInvariants:
          managed.disposeAttempts === 1 && quiescent.frameCount === managed.frameCount,
        cancellationEvidenceKind:
          "external invariants: one Dispose-owned cancellation transition, stable managed callbacks, and one stopped event; Emscripten internal call is not directly exported",
        noDrawAfterStop: quiescent.frameCount === managed.frameCount,
        disposalExactlyOnce: quiescent.disposeCount === 1,
        noCallbackIntoDisposedState: quiescent.callbackAfterDisposedCount === 0,
        webglCleanupCallsObserved: runtime?.webglDeleteCalls ?? 0,
        audioCloseCallsObserved: runtime?.audioCloseCalls ?? 0,
        managedAudioResourceCreated: quiescent.audioCreateCount,
        managedAudioPlayAccepted: quiescent.audioPlayCount,
        managedAudioResourceDisposed: quiescent.audioDisposeCount,
        eventOrdering: stopped.wireOrder.join(","),
        frontendRecovered:
          controller.state === "idle" &&
          !runButton.disabled &&
          stopButton.disabled &&
          status.textContent === "Preview stopped; editor controls recovered.",
        duplicateResolvedToSameOperation,
        iframeRemoved: stopped.iframeConnected === false,
        portClosed: stopped.portClosed === true,
        objectUrlRevokedCount: stopped.revokedObjectUrls,
        objectUrlsUnavailable: stopped.objectUrlsUnavailable,
        underTwoSeconds: stopped.elapsedMilliseconds < 2_000,
      },
    }),
  });
}

// PROOF-only preview lifecycle & runtime-counter module.
//
// Deployed ONLY by the PROOF staging profile (see Playground.Preview.csproj /
// stage-preview.mjs). Owns the deferred proof self-test/snapshot globals
// (identical to the former inline preview.js surface), the pagehide teardown
// hook, the stop-phase instrumentation (cancelAnimationFrame / WebGL delete /
// WebGL clear pixel proof / AudioContext.close counters), the trusted-click
// ping button handler, and the `observe` lifecycle hooks preview.js consults at
// its runtime sites. The PRODUCT preview never loads this module, so the shipped
// preview carries none of these proof globals, instrumentation, or hooks.
//
// Loaded by preview-proof-extension.js (the one proof entry module) after the
// state module so the proof globals and `render` exist first. Behavior is
// preserved byte-for-byte from the former monolithic preview-proof-extension.js.

export function createPreviewProofLifecycle(ctx) {
  const { controls } = ctx;
  const realmToken = ctx.realmToken;
  const proofState = ctx.proofState;
  const render = ctx.render;
  const pingButton = ctx.pingButton;
  const status = ctx.status;

  const getExports = () => controls.exportsPromise;
  const getState = () => controls.loadState;
  const getEndpoint = () => controls.previewEndpoint;

  // ── Deferred proof self-test / snapshot globals (identical to the former
  //    inline preview.js surface) ─────────────────────────────────────────────
  globalThis.previewIssue023Query = async () => {
    if (!ctx.issue023ProofEnabled) throw new Error("INVALID_STATE");
    const exports = await getExports();
    if (typeof exports.QueryRunStateProof !== "function") throw new Error("INTERNAL_ERROR");
    const result = JSON.parse(exports.QueryRunStateProof());
    globalThis.previewIssue023Proof.queries.push(result);
    return result;
  };
  globalThis.previewIssue023RunnerSelfTest = async () => {
    if (!ctx.issue023ProofEnabled) throw new Error("INVALID_STATE");
    const exports = await getExports();
    if (typeof exports.RunGameRunnerBehavioralSelfTest !== "function") {
      throw new Error("INTERNAL_ERROR");
    }
    return JSON.parse(exports.RunGameRunnerBehavioralSelfTest());
  };
  globalThis.previewIssue027WriterSelfTest = async () => {
    const exports = await getExports();
    if (typeof exports.RunForwardingTextWriterSelfTest !== "function")
      throw new Error("INTERNAL_ERROR");
    return JSON.parse(exports.RunForwardingTextWriterSelfTest());
  };
  globalThis.previewIssue028Snapshot = () => controls.nativeOutput.snapshot();
  globalThis.previewIssue028EmitNativePaths = () => {
    if (!globalThis.previewIssue028Proof.enabled) throw new Error("INVALID_STATE");
    controls.nativeOutput.print("Playground native runtime stdout proof.");
    controls.nativeOutput.printErr("Playground native runtime stderr proof.");
  };
  globalThis.previewIssue023EndpointSnapshot = () => {
    if (!ctx.issue023ProofEnabled) throw new Error("INVALID_STATE");
    return Object.freeze({
      closed: getEndpoint()?.closed === true,
      closeReasons: Object.freeze([
        ...globalThis.previewIssue21Proof.endpoint.closes,
      ]),
      terminals: Object.freeze([
        ...globalThis.previewIssue21Proof.endpoint.terminals,
      ]),
      lifecycleEvents: Object.freeze([
        ...globalThis.previewIssue023Proof.events,
      ]),
      expectedRejections: Object.freeze([
        ...globalThis.previewIssue21Proof.expectedProbeRejections,
      ]),
      unexpectedErrors: Object.freeze([
        ...globalThis.previewIssue21Proof.errors,
      ]),
    });
  };
  globalThis.previewIssue024Snapshot = () => Object.freeze({
    ...globalThis.previewIssue024Proof,
    state: getState(),
    endpointClosed: getEndpoint()?.closed === true,
    nativeOutput: controls.nativeOutput.snapshot(),
  });
  globalThis.previewIssue029QuiescentProof = async () => {
    const exports = await getExports();
    if (typeof exports.QueryStoppedGameProof !== "function") throw new Error("INTERNAL_ERROR");
    const before = JSON.parse(exports.QueryStoppedGameProof());
    await new Promise(resolve => globalThis.setTimeout(resolve, 100));
    const after = JSON.parse(exports.QueryStoppedGameProof());
    return Object.freeze({ before, after });
  };
  globalThis.previewIssue22Teardown = async () => {
    const exports = await getExports();
    if (typeof exports.TeardownGame !== "function") throw new Error("INTERNAL_ERROR");
    const result = JSON.parse(exports.TeardownGame());
    globalThis.previewIssue22Proof.teardown.push(result);
    globalThis.previewIssue21Proof.state = "disposed";
    return result;
  };
  window.addEventListener("pagehide", () => {
    if (getState() !== "disposed") void globalThis.previewIssue22Teardown();
  }, { once: true });

  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame.bind(globalThis);
  globalThis.cancelAnimationFrame = handle => {
    if (globalThis.previewIssue024Proof.enabled && getState() === "stopping") {
      globalThis.previewIssue024Proof.animationFrameCancellations++;
    }
    return originalCancelAnimationFrame(handle);
  };

  for (const name of [
    "deleteBuffer", "deleteFramebuffer", "deleteProgram", "deleteQuery",
    "deleteRenderbuffer", "deleteSampler", "deleteShader", "deleteTexture",
    "deleteTransformFeedback", "deleteVertexArray",
  ]) {
    const original = WebGL2RenderingContext.prototype[name];
    if (typeof original !== "function") continue;
    WebGL2RenderingContext.prototype[name] = function (...args) {
      if (globalThis.previewIssue024Proof.enabled && getState() === "stopping") {
        globalThis.previewIssue024Proof.webglDeleteCalls++;
      }
      return original.apply(this, args);
    };
  }

  const originalWebGlClear = WebGL2RenderingContext.prototype.clear;
  WebGL2RenderingContext.prototype.clear = function (mask) {
    const result = originalWebGlClear.call(this, mask);
    if (globalThis.previewIssue030Proof.enabled &&
        (mask & this.COLOR_BUFFER_BIT) !== 0 &&
        globalThis.previewIssue030Proof.samples.length < 8) {
      try {
        const pixel = new Uint8Array(4);
        this.readPixels(
          Math.floor(this.drawingBufferWidth / 2),
          Math.floor(this.drawingBufferHeight / 2),
          1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
        globalThis.previewIssue030Proof.samples.push([...pixel]);
      } catch (error) {
        globalThis.previewIssue030Proof.errors.push(
          error instanceof Error ? error.message : String(error));
      }
    }
    return result;
  };
  globalThis.previewIssue030PixelProof = () => Object.freeze({
    samples: globalThis.previewIssue030Proof.samples.map(sample => [...sample]),
    errors: [...globalThis.previewIssue030Proof.errors],
  });

  for (const AudioContextType of [globalThis.AudioContext, globalThis.webkitAudioContext]) {
    if (!AudioContextType?.prototype || AudioContextType.prototype.__playgroundStopInstrumented) continue;
    const originalClose = AudioContextType.prototype.close;
    if (typeof originalClose !== "function") continue;
    Object.defineProperty(AudioContextType.prototype, "__playgroundStopInstrumented", { value: true });
    AudioContextType.prototype.close = function (...args) {
      if (globalThis.previewIssue024Proof.enabled && getState() === "stopping") {
        globalThis.previewIssue024Proof.audioCloseCalls++;
      }
      return originalClose.apply(this, args);
    };
  }

  if (pingButton) {
    pingButton.addEventListener("click", async event => {
      pingButton.disabled = true;
      try {
        const exports = await getExports();
        const managed = JSON.parse(exports.Ping());
        if (event.isTrusted) {
          proofState.trustedClickCount += 1;
        }
        proofState.ping = {
          trusted: event.isTrusted,
          executingGlobalIsIframeGlobal: globalThis === window && window !== parent,
          realmToken,
          ...managed,
        };
        if (status)
          status.textContent = `${managed.message}; managed call ${managed.callCount}; trusted=${event.isTrusted}`;
        render();
      } catch (error) {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        proofState.errors.push(message);
        if (status) {
          status.dataset.state = "error";
          status.textContent = message;
        }
        render();
        console.error(error);
      } finally {
        pingButton.disabled = false;
      }
    });
  }

  return {
    observe: {
      onStartupAttempt() {
        proofState.startupAttempts += 1;
        render();
      },
      onRuntimeAssetVerified(asset) {
        proofState.runtimeAsset = asset;
      },
      onRuntimeReady({ metadata, exports }) {
        proofState.successfulRuntimeStarts += 1;
        globalThis.previewIssue21Proof.runtimeStarts += 1;
        proofState.ready = true;
        proofState.configuration = metadata.configuration;
        proofState.runtimeSettings = metadata.runtimeSettings;
        proofState.autoReadyPing = {
          trusted: false,
          executingGlobalIsIframeGlobal: globalThis === window && window !== parent,
          realmToken,
          ...JSON.parse(exports.Ping()),
        };
        if (pingButton) pingButton.disabled = false;
        render();
      },
      onError(message) {
        proofState.errors.push(message);
        render();
      },
      runtimeStartCount() {
        return globalThis.previewIssue21Proof.runtimeStarts;
      },
      onLoadState(state) {
        globalThis.previewIssue21Proof.state = state;
      },
      onManagedLoadFailure(failure) {
        globalThis.previewIssue21Proof.lastManagedFailure = failure;
      },
      onLoadSuccess(load) {
        globalThis.previewIssue21Proof.load = load;
      },
      onLoadRequest(request) {
        globalThis.previewIssue21Proof.requests.push(request);
      },
      onLoadRejection(code) {
        globalThis.previewIssue21Proof.rejections.push(code);
      },
      onLoadError(code) {
        globalThis.previewIssue21Proof.errors.push(code);
      },
      onBeforeLoadPipeline(pipeline) {
        globalThis.previewIssue22Proof.beforeLoad = pipeline;
      },
      onLoadPipeline({ pipeline, repeatedPipeline, repeatMatched }) {
        globalThis.previewIssue22Proof.pipeline = pipeline;
        globalThis.previewIssue22Proof.repeatedPipeline = repeatedPipeline;
        globalThis.previewIssue22Proof.repeatMatched = repeatMatched;
      },
      onMount(mount) {
        globalThis.previewIssue039Proof.mounts.push(mount);
      },
      onMountFailure(failure) {
        globalThis.previewIssue039Proof.mountFailures.push(failure);
      },
      onStart(start) {
        globalThis.previewIssue023Proof.start = start;
      },
      onStartFailureTeardown(teardown) {
        globalThis.previewIssue023Proof.failureTeardown = teardown;
      },
      onStartUnexpected(error) {
        globalThis.previewIssue023Proof.expectedUnexpectedBoundary = error;
      },
      onStop(stop) {
        globalThis.previewIssue024Proof.stop = stop;
      },
      // Proof-only stopped-game quiescence observation, relocated here from the
      // shared product stop runtime. Awaits the settle delay and reads the
      // stopped game's static proof counters via the proof-only JSExport. In the
      // product profile this hook does not exist, so the shared stop runtime
      // records no quiescence.
      async onStopObservation(exports) {
        await new Promise(resolve => globalThis.setTimeout(resolve, 100));
        return typeof exports.QueryStoppedGameProof === "function"
          ? JSON.parse(exports.QueryStoppedGameProof())
          : null;
      },
      onRuntimeFailureCleanup(failure) {
        globalThis.previewIssue024Proof.runtimeFailureCleanup = {
          cleanupSucceeded: failure.cleanupSucceeded,
          disposeAttempts: failure.disposeAttempts,
          frameCount: failure.frameCount,
          updateCount: failure.updateCount,
          proofDisposeCount: failure.proofDisposeCount,
          callbackAfterDisposedCount: failure.callbackAfterDisposedCount,
        };
      },
    },
  };
}

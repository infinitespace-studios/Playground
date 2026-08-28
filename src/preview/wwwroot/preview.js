import { dotnet } from "./_framework/dotnet.js";
import {
  installPrivatePortBootstrap,
  isUuidV4,
  sha256 as sha256Buffer,
  validatePreviewLoadRequest,
} from "./ProtocolRuntime.js";
import {
  createPreviewEndpoint,
  createProofExpectationRegistry,
} from "./Issue21Endpoints.js";
import { createPreviewStartExecutor } from "./PreviewStartRuntime.js";
import { createPreviewStopExecutor } from "./PreviewStopRuntime.js";
import { createNativeOutputCapture } from "./NativeOutputRuntime.js";

const status = document.querySelector("#status");
const pingButton = document.querySelector("#ping");
const output = document.querySelector("#proof-state");
const realmToken = crypto.randomUUID();

const proofState = {
  protocolVersion: 1,
  ready: false,
  startupAttempts: 0,
  successfulRuntimeStarts: 0,
  trustedClickCount: 0,
  realmToken,
  parentWindowDistinct: window !== parent,
  runtimeAsset: null,
  autoReadyPing: null,
  ping: null,
  errors: [],
};

globalThis.previewProof = proofState;
globalThis.previewIssue21Proof = {
  runtimeStarts: 0,
  load: null,
  bootstrap: null,
  requests: [],
  state: "stopped",
  rejections: [],
  errors: [],
  expectedProbeRejections: [],
  expiredProbeExpectations: [],
  endpoint: { terminals: [], closes: [] },
  lastManagedFailure: null,
};
globalThis.previewIssue22Proof = {
  enabled: false,
  pipeline: null,
  repeatedPipeline: null,
  beforeLoad: null,
  repeatMatched: null,
  teardown: [],
  errors: [],
};
globalThis.previewIssue023Proof = {
  enabled: false,
  start: null,
  events: [],
  queries: [],
  errors: [],
};
globalThis.previewIssue024Proof = {
  enabled: false,
  stop: null,
  animationFrameCancellations: 0,
  webglDeleteCalls: 0,
  audioCloseCalls: 0,
  errors: [],
};
globalThis.previewIssue028Proof = { enabled: false };

let protocolPort = null;
let expectedPreviewId = null;
let protocolGeneration = null;
let loadState = "stopped";
let previewEndpoint = null;
let constructAfterLoad = false;
let issue023ProofEnabled = false;
let runGamePipeline = false;
let lifecycleSequence = 0;
let issue023Case = "normal";
let startExecutor = null;
let stopExecutor = null;
let outputCorrelationId = null;
let outputLive = false;
let pendingOutputEvents = [];
let terminationCause = null;
let runtimeFailureCorrelationId = null;
const nativeOutput = createNativeOutputCapture();
dotnet.withModuleConfig({
  print: nativeOutput.print,
  printErr: nativeOutput.printErr,
});
// The stock runtime is normally silent before managed startup. Route one
// product-neutral diagnostic through the configured native callback.
const nativeBootstrapDiagnostic = "Playground native runtime bootstrap.";
nativeOutput.print(nativeBootstrapDiagnostic);

globalThis.__playgroundForwardOutput = (source, stream, category, text) => {
  if (!outputCorrelationId || !["managed", "native"].includes(source) ||
      !["stdout", "stderr"].includes(stream) ||
      !["console", "startup", "runtime", "content", "shader"].includes(category) ||
      typeof text !== "string") return;
  const event = lifecycleEvent("preview.output", outputCorrelationId, {
    source,
    stream,
    category,
    text,
  });
  if (outputLive && previewEndpoint && !previewEndpoint.closed) {
    previewEndpoint.emitEvent(event);
  } else {
    pendingOutputEvents.push(event);
  }
};
function runtimeFailureError(failure, fallbackMessage) {
  if (!failure || typeof failure !== "object") {
    return { code: "PREVIEW_RUNTIME_FAILED", message: fallbackMessage };
  }
  const details = {
    exceptionType: failure.exceptionType,
    innerCount: failure.innerCount,
    cleanupSucceeded: failure.cleanupSucceeded,
    disposeAttempts: failure.disposeAttempts,
    frameCount: failure.frameCount,
    updateCount: failure.updateCount,
    proofDisposeCount: failure.proofDisposeCount,
    callbackAfterDisposedCount: failure.callbackAfterDisposedCount,
  };
  if (failure.innerExceptionType) details.innerExceptionType = failure.innerExceptionType;
  if (failure.innerMessage) details.innerMessage = failure.innerMessage;
  for (const [index, frame] of (failure.frames ?? []).slice(0, 5).entries()) {
    details[`frame${index}Method`] = frame.method;
    details[`frame${index}File`] = frame.file;
    details[`frame${index}Line`] = frame.line;
    details[`frame${index}Column`] = frame.column;
  }
  return {
    code: "PREVIEW_RUNTIME_FAILED",
    message: failure.message || fallbackMessage,
    details,
  };
}
globalThis.__playgroundBeginManagedRuntimeFailure = reportJson => {
  if (terminationCause !== null || loadState !== "running" ||
      !outputCorrelationId || !previewEndpoint || previewEndpoint.closed) return false;
  const failure = JSON.parse(reportJson);
  terminationCause = "failed";
  globalThis.__playgroundForwardOutput(
    "managed", "stderr", "runtime",
    `${failure.exceptionType}: ${failure.message}`);
  const correlationId = crypto.randomUUID();
  runtimeFailureCorrelationId = correlationId;
  const error = runtimeFailureError(failure, "The running game failed.");
  previewEndpoint.emitEvent(lifecycleEvent("preview.failed", correlationId, {
    phase: "running",
    error,
  }));
  return true;
};
globalThis.__playgroundCompleteManagedRuntimeFailure = reportJson => {
  if (terminationCause !== "failed" || runtimeFailureCorrelationId === null ||
      loadState !== "running" || !previewEndpoint || previewEndpoint.closed) return;
  const failure = JSON.parse(reportJson);
  const correlationId = runtimeFailureCorrelationId;
  // Cleanup evidence is intentionally carried by the terminal failure details
  // generated before disposal only in the packaged proof snapshot.
  globalThis.previewIssue024Proof.runtimeFailureCleanup = {
    cleanupSucceeded: failure.cleanupSucceeded,
    disposeAttempts: failure.disposeAttempts,
    frameCount: failure.frameCount,
    updateCount: failure.updateCount,
    proofDisposeCount: failure.proofDisposeCount,
    callbackAfterDisposedCount: failure.callbackAfterDisposedCount,
  };
  loadState = "disposed";
  globalThis.previewIssue21Proof.state = loadState;
  previewEndpoint.emitEvent(lifecycleEvent("preview.stopped", correlationId, {
    reason: "failed",
  }));
  outputLive = false;
  outputCorrelationId = null;
  pendingOutputEvents = [];
  nativeOutput.retire(protocolGeneration);
};
const bootstrapObservations = installPrivatePortBootstrap({
  expectedSource: parent,
  expectedOrigin: window.location.origin,
  validateData: data => isUuidV4(data.previewId) &&
    Object.hasOwn(data, "issue021Proof") && typeof data.issue021Proof === "boolean" &&
    (!Object.hasOwn(data, "issue022Proof") || typeof data.issue022Proof === "boolean") &&
    (!Object.hasOwn(data, "issue023Proof") || typeof data.issue023Proof === "boolean") &&
    (!Object.hasOwn(data, "issue024Proof") || typeof data.issue024Proof === "boolean") &&
    (!Object.hasOwn(data, "issue028Proof") || typeof data.issue028Proof === "boolean") &&
    (!Object.hasOwn(data, "runGamePipeline") || typeof data.runGamePipeline === "boolean") &&
    (!Object.hasOwn(data, "issue023Case") ||
      typeof data.issue023Case === "string" &&
      ["normal", "delay-run", "delay-run-late", "delay-run-long", "delay-event", "unexpected"]
        .includes(data.issue023Case)),
  onPort: (port, data) => {
    if (protocolPort) return;
    protocolGeneration = data.contextGeneration;
    expectedPreviewId = data.previewId;
    issue023ProofEnabled = data.issue023Proof === true;
    issue023Case = issue023ProofEnabled ? data.issue023Case ?? "normal" : "normal";
    runGamePipeline = data.runGamePipeline === true;
    constructAfterLoad = data.issue022Proof === true;
    globalThis.previewIssue22Proof.enabled = data.issue022Proof === true;
    globalThis.previewIssue023Proof.enabled = issue023ProofEnabled;
    globalThis.previewIssue024Proof.enabled = data.issue024Proof === true;
    globalThis.previewIssue028Proof.enabled = data.issue028Proof === true;
    if (!nativeOutput.authenticate(data.contextGeneration))
      throw new Error("Native output generation authentication failed.");
    protocolPort = port;
    const expectationRegistry = createProofExpectationRegistry({
      authorized: data.issue021Proof,
      contextGeneration: data.contextGeneration,
      portIdentity: bootstrapObservations.portIdentity,
      expectedRejections: globalThis.previewIssue21Proof.expectedProbeRejections,
      unexpectedErrors: globalThis.previewIssue21Proof.errors,
      expiredExpectations: globalThis.previewIssue21Proof.expiredProbeExpectations,
    });
    globalThis.previewIssue21RegisterExpectation = data.issue021Proof
      ? expectation => expectationRegistry.register(expectation)
      : undefined;
    globalThis.previewIssue21RemoveExpectation = data.issue021Proof
      ? correlationId => expectationRegistry.remove(correlationId)
      : undefined;
    const endpointProof = {
      errors: globalThis.previewIssue21Proof.errors,
      terminals: globalThis.previewIssue21Proof.endpoint.terminals,
      closes: globalThis.previewIssue21Proof.endpoint.closes,
      events: globalThis.previewIssue023Proof.events,
      duplicateControls: [],
    };
    previewEndpoint = createPreviewEndpoint({
      port,
      previewId: expectedPreviewId,
      execute: executeLoadRequest,
      executeStart: executeStartRequest,
      executeStop: executeStopRequest,
      expectations: data.issue021Proof ? expectationRegistry : undefined,
      contextGeneration: data.contextGeneration,
      portIdentity: bootstrapObservations.portIdentity,
      proof: endpointProof,
    });
    protocolPort.addEventListener("message", previewEndpoint.handle);
    protocolPort.start();
  },
});
globalThis.previewIssue21Proof.bootstrap = bootstrapObservations;

function render() {
  output.textContent = JSON.stringify(proofState, null, 2);
}

async function sha256Response(response) {
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function verifyRuntimeAsset() {
  const metadataResponse = await fetch("./preview-build.json");
  if (!metadataResponse.ok) {
    throw new Error(`Preview build metadata returned HTTP ${metadataResponse.status}.`);
  }
  const metadata = await metadataResponse.json();
  const assetResponse = await fetch(metadata.monoGame.runtimeAssetPath);
  if (!assetResponse.ok) {
    throw new Error(`MonoGame runtime asset returned HTTP ${assetResponse.status}.`);
  }
  const runtimeAssetSha256 = await sha256Response(assetResponse);
  if (runtimeAssetSha256 !== metadata.monoGame.runtimeAssetSha256) {
    throw new Error("Staged MonoGame runtime asset hash does not match preview-build.json.");
  }
  proofState.runtimeAsset = {
    path: metadata.monoGame.runtimeAssetPath,
    sha256: runtimeAssetSha256,
    sourceAssemblySha256: metadata.monoGame.sourceAssemblySha256,
    verified: true,
  };
  return metadata;
}

async function startRuntime() {
  proofState.startupAttempts += 1;
  render();
  const metadata = await verifyRuntimeAsset();
  const runtime = await dotnet.create();
  const config = runtime.getConfig();
  const assemblyExports = await runtime.getAssemblyExports(config.mainAssemblyName);
  const exports = assemblyExports.Playground.Preview.PreviewExports;
  if (typeof exports?.Ping !== "function") {
    throw new Error("PreviewExports.Ping was not exported.");
  }
  if (typeof exports.InitializeRuntimeFailureBoundary !== "function") {
    throw new Error("PreviewExports.InitializeRuntimeFailureBoundary was not exported.");
  }
  exports.InitializeRuntimeFailureBoundary();
  await runtime.runMain();
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
  status.dataset.state = "ready";
  status.textContent = "Ready: click for trusted in-realm Ping.";
  pingButton.disabled = false;
  render();
  return exports;
}

async function executeLoadRequest(message, observation) {
  if (loadState !== "stopped") throw new Error("INVALID_STATE");
  try {
    const assembly = message.payload?.assembly;
    const pdb = message.payload?.pdb;
    const assemblySha256 = await sha256Buffer(assembly);
    const pdbSha256 = await sha256Buffer(pdb);
    if (assemblySha256 !== message.payload.binaryProof.assemblySha256 ||
        pdbSha256 !== message.payload.binaryProof.pdbSha256) {
      throw new Error("MALFORMED_PAYLOAD");
    }
    const exports = await exportsPromise;
    if (typeof exports.LoadUserAssembly !== "function") throw new Error("INTERNAL_ERROR");
    if (constructAfterLoad) {
      if (typeof exports.DiscoverAndConstructGame !== "function") throw new Error("INTERNAL_ERROR");
      globalThis.previewIssue22Proof.beforeLoad =
        JSON.parse(exports.DiscoverAndConstructGame());
    }
    loadState = "validating";
    const managed = JSON.parse(await exports.LoadUserAssembly(
      new Uint8Array(assembly),
      new Uint8Array(pdb),
      assemblySha256,
      pdbSha256,
      message.payload.binaryProof.assemblyName,
      JSON.stringify(message.payload.binaryProof.sourcePaths),
      message.payload.binaryProof.primarySourcePath,
    ));
    if (!managed.success) {
      globalThis.previewIssue21Proof.lastManagedFailure = {
        mutationStarted: managed.mutationStarted === true,
        code: managed.error?.code ?? "PREVIEW_LOAD_FAILED",
      };
      loadState = managed.mutationStarted ? "tainted" : "stopped";
      globalThis.previewIssue21Proof.state = loadState;
      return {
        result: { success: false, error: {
          code: managed.error?.code ?? "PREVIEW_LOAD_FAILED",
          message: managed.error?.message ?? "Managed load validation failed.",
        } },
        closeAfterResponse: managed.mutationStarted,
      };
    }
    const load = managed.proof;
    if (load.assemblySha256 !== assemblySha256 || load.pdbSha256 !== pdbSha256 ||
        load.assemblyByteLength !== assembly.byteLength || load.pdbByteLength !== pdb.byteLength) {
      loadState = "tainted";
      globalThis.previewIssue21Proof.state = loadState;
      return {
        result: { success: false, error: { code: "PREVIEW_LOAD_FAILED", message: "Managed byte proof mismatched." } },
        closeAfterResponse: true,
      };
    }
    globalThis.previewIssue21Proof.load = {
      ...load,
      compileId: message.payload.compileId,
      correlationId: message.correlationId,
      receiptAssemblySha256: assemblySha256,
      receiptPdbSha256: pdbSha256,
    };
    globalThis.previewIssue21Proof.requests.push({
      compileId: message.payload.compileId,
      correlationId: message.correlationId,
      measuredRequestBytes: observation.measuredBytes,
      terminalResponses: 1,
    });
    if (constructAfterLoad) {
      if (typeof exports.DiscoverAndConstructGame !== "function") throw new Error("INTERNAL_ERROR");
      loadState = "loaded";
      globalThis.previewIssue21Proof.state = loadState;
      const [pipeline, repeatedPipeline] = await Promise.all([
        Promise.resolve().then(() => JSON.parse(exports.DiscoverAndConstructGame())),
        Promise.resolve().then(() => JSON.parse(exports.DiscoverAndConstructGame())),
      ]);
      globalThis.previewIssue22Proof.pipeline = pipeline;
      globalThis.previewIssue22Proof.repeatedPipeline = repeatedPipeline;
      globalThis.previewIssue22Proof.repeatMatched =
        JSON.stringify(pipeline) === JSON.stringify(repeatedPipeline);
      if (!globalThis.previewIssue22Proof.repeatMatched) throw new Error("INTERNAL_ERROR");
      if (!pipeline.success) {
        loadState = "tainted";
        globalThis.previewIssue21Proof.state = loadState;
        const diagnostic = pipeline.diagnostic;
        return {
          result: { success: false, error: {
            code: pipeline.error?.code ?? "PREVIEW_LOAD_FAILED",
            message: pipeline.error?.message ?? "Game discovery or construction failed.",
            ...(diagnostic ? { diagnostics: [diagnostic] } : {}),
          } },
          closeAfterResponse: true,
        };
      }
    }
    loadState = "loaded";
    globalThis.previewIssue21Proof.state = loadState;
    return {
      result: { success: true, data: {
        previewId: expectedPreviewId,
        compileId: message.payload.compileId,
      } },
    };
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : "PREVIEW_LOAD_FAILED";
    if (["INVALID_STATE", "DUPLICATE_CORRELATION_ID", "MALFORMED_PAYLOAD"].includes(code)) {
      globalThis.previewIssue21Proof.rejections.push(code);
    } else if (loadState !== "loaded" && loadState !== "tainted") {
      globalThis.previewIssue21Proof.errors.push(code);
    }
    if (loadState === "validating") {
      loadState = "tainted";
      globalThis.previewIssue21Proof.state = loadState;
      return {
        result: { success: false, error: { code: "PREVIEW_LOAD_FAILED", message: "Managed load failed after mutation may have begun." } },
        closeAfterResponse: true,
      };
    }
    if (loadState === "loaded" || loadState === "tainted") {
      loadState = "tainted";
      globalThis.previewIssue21Proof.state = loadState;
      globalThis.previewIssue21Proof.errors.push("INTERNAL_ERROR");
      return {
        result: {
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Unexpected post-load preview runtime failure." },
        },
        closeAfterResponse: true,
      };
    }
    throw new Error(code);
  }
}

async function executeStartRequest(message) {
  if (loadState !== "loaded") throw new Error("INVALID_STATE");
  outputCorrelationId = message.correlationId;
  outputLive = false;
  pendingOutputEvents = [];
  if (!nativeOutput.flush(protocolGeneration, ({ stream, category, text }) =>
    globalThis.__playgroundForwardOutput("native", stream, category, text))) {
    throw new Error("INVALID_STATE");
  }
  startExecutor ??= createPreviewStartExecutor({
    getState: () => loadState,
    setState: state => {
      loadState = state;
      globalThis.previewIssue21Proof.state = state;
    },
    getExports: () => exportsPromise,
    createLifecycleEvent: lifecycleEvent,
    recordStart: start => { globalThis.previewIssue023Proof.start = start; },
    recordFailureTeardown: teardown => {
      globalThis.previewIssue023Proof.failureTeardown = teardown;
    },
    recordUnexpected: error => {
      globalThis.previewIssue023Proof.expectedUnexpectedBoundary = error;
    },
    beforeRunDelayMs: issue023Case === "delay-run"
      ? 150
      : issue023Case === "delay-run-late"
        ? 800
        : issue023Case === "delay-run-long" ? 2_500 : 0,
    startedEventDelayMs: issue023Case === "delay-event" ? 150 : 0,
    throwUnexpectedBeforeExport: issue023Case === "unexpected",
  });
  const outcome = await startExecutor(message);
  const outputEvents = pendingOutputEvents;
  pendingOutputEvents = [];
  const activateOutput = () => {
    outputLive = true;
    const queued = pendingOutputEvents;
    pendingOutputEvents = [];
    for (const event of queued)
      previewEndpoint.emitEvent(event);
  };
  const delayedEvents = outcome.delayedEvents?.map(delayed => ({
    ...delayed,
    afterPost: () => {
      delayed.afterPost?.();
      activateOutput();
    },
  }));
  const afterPost = () => {
    outcome.afterPost?.();
    if (!delayedEvents?.length && outcome.result?.success === true)
      activateOutput();
    if (outcome.result?.success !== true)
      nativeOutput.retire(protocolGeneration);
  };
  return {
    ...outcome,
    events: [...outputEvents, ...(outcome.events ?? [])],
    ...(delayedEvents ? { delayedEvents } : {}),
    afterPost,
  };
}

async function executeStopRequest(message) {
  stopExecutor ??= createPreviewStopExecutor({
    getState: () => loadState,
    setState: state => {
      loadState = state;
      globalThis.previewIssue21Proof.state = state;
    },
    getExports: () => exportsPromise,
    createLifecycleEvent: lifecycleEvent,
    recordStop: stop => { globalThis.previewIssue024Proof.stop = stop; },
  });
  const outcome = await stopExecutor(message);
  return {
    ...outcome,
    afterPost: () => {
      outcome.afterPost?.();
      outputLive = false;
      outputCorrelationId = null;
      pendingOutputEvents = [];
      nativeOutput.retire(protocolGeneration);
    },
  };
}

function lifecycleEvent(type, correlationId, extra = {}) {
  return {
    protocolVersion: 1,
    correlationId,
    type,
    payload: {
      previewId: expectedPreviewId,
      sequence: ++lifecycleSequence,
      ...extra,
    },
  };
}

const exportsPromise = startRuntime();
globalThis.previewIssue023Query = async () => {
  if (!issue023ProofEnabled) throw new Error("INVALID_STATE");
  const exports = await exportsPromise;
  if (typeof exports.QueryRunState !== "function") throw new Error("INTERNAL_ERROR");
  const result = JSON.parse(exports.QueryRunState(true));
  globalThis.previewIssue023Proof.queries.push(result);
  return result;
};
globalThis.previewIssue023RunnerSelfTest = async () => {
  if (!issue023ProofEnabled) throw new Error("INVALID_STATE");
  const exports = await exportsPromise;
  if (typeof exports.RunGameRunnerBehavioralSelfTest !== "function") {
    throw new Error("INTERNAL_ERROR");
  }
  return JSON.parse(exports.RunGameRunnerBehavioralSelfTest());
};
globalThis.previewIssue027WriterSelfTest = async () => {
  const exports = await exportsPromise;
  if (typeof exports.RunForwardingTextWriterSelfTest !== "function")
    throw new Error("INTERNAL_ERROR");
  return JSON.parse(exports.RunForwardingTextWriterSelfTest());
};
globalThis.previewIssue028Snapshot = () => nativeOutput.snapshot();
globalThis.previewIssue028EmitNativePaths = () => {
  if (!globalThis.previewIssue028Proof.enabled) throw new Error("INVALID_STATE");
  nativeOutput.print("Playground native runtime stdout proof.");
  nativeOutput.printErr("Playground native runtime stderr proof.");
};
globalThis.previewIssue023EndpointSnapshot = () => {
  if (!issue023ProofEnabled) throw new Error("INVALID_STATE");
  return Object.freeze({
    closed: previewEndpoint?.closed === true,
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
  state: loadState,
  endpointClosed: previewEndpoint?.closed === true,
  nativeOutput: nativeOutput.snapshot(),
});
globalThis.previewIssue029QuiescentProof = async () => {
  const exports = await exportsPromise;
  if (typeof exports.QueryStoppedGameProof !== "function") throw new Error("INTERNAL_ERROR");
  const before = JSON.parse(exports.QueryStoppedGameProof());
  await new Promise(resolve => globalThis.setTimeout(resolve, 100));
  const after = JSON.parse(exports.QueryStoppedGameProof());
  return Object.freeze({ before, after });
};
globalThis.previewIssue22Teardown = async () => {
  const exports = await exportsPromise;
  if (typeof exports.TeardownGame !== "function") throw new Error("INTERNAL_ERROR");
  const result = JSON.parse(exports.TeardownGame());
  globalThis.previewIssue22Proof.teardown.push(result);
  loadState = "disposed";
  globalThis.previewIssue21Proof.state = loadState;
  return result;
};
window.addEventListener("pagehide", () => {
  if (loadState !== "disposed") void globalThis.previewIssue22Teardown();
}, { once: true });

const originalCancelAnimationFrame = globalThis.cancelAnimationFrame.bind(globalThis);
globalThis.cancelAnimationFrame = handle => {
  if (globalThis.previewIssue024Proof.enabled && loadState === "stopping") {
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
    if (globalThis.previewIssue024Proof.enabled && loadState === "stopping") {
      globalThis.previewIssue024Proof.webglDeleteCalls++;
    }
    return original.apply(this, args);
  };
}

for (const AudioContextType of [globalThis.AudioContext, globalThis.webkitAudioContext]) {
  if (!AudioContextType?.prototype || AudioContextType.prototype.__playgroundStopInstrumented) continue;
  const originalClose = AudioContextType.prototype.close;
  if (typeof originalClose !== "function") continue;
  Object.defineProperty(AudioContextType.prototype, "__playgroundStopInstrumented", { value: true });
  AudioContextType.prototype.close = function (...args) {
    if (globalThis.previewIssue024Proof.enabled && loadState === "stopping") {
      globalThis.previewIssue024Proof.audioCloseCalls++;
    }
    return originalClose.apply(this, args);
  };
}

pingButton.addEventListener("click", async event => {
  pingButton.disabled = true;
  try {
    const exports = await exportsPromise;
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
    status.textContent = `${managed.message}; managed call ${managed.callCount}; trusted=${event.isTrusted}`;
    render();
  } catch (error) {
    showError(error);
  } finally {
    pingButton.disabled = false;
  }
});

function showError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  proofState.errors.push(message);
  status.dataset.state = "error";
  status.textContent = message;
  render();
  console.error(error);
}

try {
  await exportsPromise;
} catch (error) {
  showError(error);
}

import { dotnet } from "./_framework/dotnet.js";
import {
  installPrivatePortBootstrap,
  isUuidV4,
  sha256 as sha256Buffer,
} from "./ProtocolRuntime.js";
import { createPreviewEndpoint } from "./Issue21Endpoints.js";
import { createPreviewStartExecutor } from "./PreviewStartRuntime.js";
import { createPreviewStopExecutor } from "./PreviewStopRuntime.js";
import { createAssetMountExecutor } from "./AssetMountRuntime.js";
import { createPreStartAdmission } from "./PreStartAdmission.js";
import { createNativeOutputCapture } from "./NativeOutputRuntime.js";

// PRODUCT preview runtime boot.
//
// This module owns the durable, shipping preview protocol only: verify the
// staged runtime asset, boot one Release .NET runtime, adopt the private
// opaque-origin protocol port, and drive the mount → configure → load → run →
// stop → cleanup lifecycle over that port with binary-integrity validation,
// CSP, and sandbox intact. It carries NO proof instrumentation: no per-scenario
// proof globals, no audio probe, no issue-numbered action dispatch, no proof
// expectation registry, no proof DOM/state, no self-test exports, and no
// fixtures/observer.
//
// A narrow, product-neutral extension seam lets an optional, separately-loaded
// module observe lifecycle events and supply proof-only bootstrap wiring. The
// seam has no proof markers or issue names; when no extension is present (the
// PRODUCT profile), every hook is an inert no-op and the preview behaves as the
// plain shipping runtime. The PROOF staging profile deploys the extension,
// which restores exact scenario behavior.

const status = document.querySelector("#status");
const realmToken = crypto.randomUUID();

// Optional extension attachment point. The PRODUCT build never defines this;
// the PROOF staging profile deploys a module that assigns it BEFORE this module
// evaluates. `attach(controls)` returns { observe, bootstrap } which the core
// consults at the neutral hook sites below.
const extensionFactory = globalThis.__playgroundPreviewExtension ?? null;
let extension = null;
const observe = new Proxy({}, {
  get(_target, key) {
    return (...args) => extension?.observe?.[key]?.(...args);
  },
});

let protocolPort = null;
let expectedPreviewId = null;
let protocolGeneration = null;
let loadState = "stopped";
let previewEndpoint = null;
let constructAfterLoad = false;
let runGamePipeline = false;
let lifecycleSequence = 0;
let startExecutor = null;
let stopExecutor = null;
let mountExecutor = null;
const preStartAdmission = createPreStartAdmission();
let outputCorrelationId = null;
let outputLive = false;
let pendingOutputEvents = [];
let terminationCause = null;
let runtimeFailureCorrelationId = null;
let bridgePort = null;
let bridgeReadySent = false;
let runtimeReady = false;
const nativeOutput = createNativeOutputCapture();

function setLoadState(state) {
  loadState = state;
  observe.onLoadState(state);
}

dotnet.withConfig({ cacheBootResources: false });
dotnet.withResourceLoader((type, _name, defaultUri, integrity) => {
  if (type === "dotnetjs") return defaultUri;
  return fetch(defaultUri, {
    cache: "no-cache",
    credentials: "omit",
    ...(integrity ? { integrity } : {}),
  });
});
dotnet.withModuleConfig({
  print: nativeOutput.print,
  printErr: nativeOutput.printErr,
});
// The stock runtime is normally silent before managed startup. Route one
// product-neutral diagnostic through the configured native callback.
const nativeBootstrapDiagnostic = "Playground native runtime bootstrap.";
nativeOutput.print(nativeBootstrapDiagnostic);
const trustedParentOrigin =
  document.querySelector('meta[name="playground-parent-origin"]')?.content;
if (!trustedParentOrigin)
  throw new Error("Preview parent origin configuration is missing.");

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
  observe.onRuntimeFailureCleanup(failure);
  setLoadState("disposed");
  previewEndpoint.emitEvent(lifecycleEvent("preview.stopped", correlationId, {
    reason: "failed",
  }));
  outputLive = false;
  outputCorrelationId = null;
  pendingOutputEvents = [];
  nativeOutput.retire(protocolGeneration);
};

function sendBridgeReady() {
  if (!bridgePort || !runtimeReady || bridgeReadySent) return;
  bridgeReadySent = true;
  bridgePort.postMessage({
    type: "preview.bridge.ready",
    payload: {
      runtimeStarts: observe.runtimeStartCount?.() ?? 0,
      realmToken,
      opaqueOrigin: location.origin === "null",
    },
  });
}

function installPreviewBridge(port, bootstrapData) {
  bridgePort = port;
  port.addEventListener("message", async event => {
    const message = event.data;
    if (!message || typeof message !== "object" ||
        message.type !== "preview.bridge.request" ||
        typeof message.id !== "string" ||
        typeof message.action !== "string") return;
    try {
      // Bridge actions are a proof-only surface. The PRODUCT build has no
      // extension, so any request is unauthorized and rejected; the PROOF
      // extension supplies the real action dispatcher.
      const handler = extension?.bootstrap?.bridgeAction;
      if (typeof handler !== "function")
        throw new Error("Preview bridge action is not authorized.");
      const result = await handler(message.action, message.payload, bootstrapData);
      port.postMessage({
        type: "preview.bridge.response",
        id: message.id,
        success: true,
        result,
      });
    } catch (error) {
      port.postMessage({
        type: "preview.bridge.response",
        id: message.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  port.start();
  sendBridgeReady();
}

const bootstrapObservations = installPrivatePortBootstrap({
  expectedSource: parent,
  expectedOrigin: trustedParentOrigin,
  additionalPortCount: 1,
  validateData: data => isUuidV4(data.previewId) &&
    (!Object.hasOwn(data, "runGamePipeline") || typeof data.runGamePipeline === "boolean") &&
    (extension?.bootstrap?.validateData?.(data) ?? true),
  onPort: (port, data, additionalPorts) => {
    if (protocolPort) return;
    protocolGeneration = data.contextGeneration;
    expectedPreviewId = data.previewId;
    runGamePipeline = data.runGamePipeline === true;
    const bootstrapConfig = extension?.bootstrap?.onBootstrap?.(data) ?? {};
    constructAfterLoad = bootstrapConfig.constructAfterLoad === true;
    installPreviewBridge(additionalPorts[0], data);
    if (!nativeOutput.authenticate(data.contextGeneration))
      throw new Error("Native output generation authentication failed.");
    protocolPort = port;
    const endpointParams = extension?.bootstrap?.endpointParams?.({
      port,
      previewId: expectedPreviewId,
      contextGeneration: data.contextGeneration,
      portIdentity: bootstrapObservations.portIdentity,
      data,
    }) ?? {};
    previewEndpoint = createPreviewEndpoint({
      port,
      previewId: expectedPreviewId,
      execute: executeLoadRequest,
      executeMount: executeMountRequest,
      executeStart: executeStartRequest,
      executeStop: executeStopRequest,
      contextGeneration: data.contextGeneration,
      portIdentity: bootstrapObservations.portIdentity,
      ...endpointParams,
    });
    protocolPort.addEventListener("message", previewEndpoint.handle);
    protocolPort.start();
  },
});

async function sha256Response(response) {
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function verifyRuntimeAsset() {
  const metadataResponse = await fetch("playground-preview://localhost/preview-build.json");
  if (!metadataResponse.ok) {
    throw new Error(`Preview build metadata returned HTTP ${metadataResponse.status}.`);
  }
  const metadata = await metadataResponse.json();
  const assetResponse = await fetch(new URL(
    metadata.monoGame.runtimeAssetPath,
    "playground-preview://localhost/",
  ));
  if (!assetResponse.ok) {
    throw new Error(`MonoGame runtime asset returned HTTP ${assetResponse.status}.`);
  }
  const runtimeAssetSha256 = await sha256Response(assetResponse);
  if (runtimeAssetSha256 !== metadata.monoGame.runtimeAssetSha256) {
    throw new Error("Staged MonoGame runtime asset hash does not match preview-build.json.");
  }
  observe.onRuntimeAssetVerified({
    path: metadata.monoGame.runtimeAssetPath,
    sha256: runtimeAssetSha256,
    sourceAssemblySha256: metadata.monoGame.sourceAssemblySha256,
    verified: true,
  });
  return metadata;
}

async function startRuntime() {
  observe.onStartupAttempt();
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
  runtimeReady = true;
  observe.onRuntimeReady({ metadata, exports, realmToken });
  status.dataset.state = "ready";
  status.textContent = "Preview runtime ready.";
  sendBridgeReady();
  return exports;
}

async function executeMountRequest(message, observation) {
  mountExecutor ??= createAssetMountExecutor({
    getState: () => loadState,
    getExports: () => exportsPromise,
    sha256: sha256Buffer,
    previewId: expectedPreviewId,
    recordMount: mount => observe.onMount(mount),
    recordMountFailure: failure => observe.onMountFailure(failure),
  });
  return preStartAdmission.runMount(
    message.correlationId,
    ["stopped", "loaded"],
    loadState,
    () => mountExecutor(message, observation),
  );
}

async function executeLoadRequest(message, observation) {
  return preStartAdmission.runLoad(
    message.correlationId,
    loadState,
    async () => {
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
      observe.onBeforeLoadPipeline(JSON.parse(exports.DiscoverAndConstructGame()));
    }
    setLoadState("validating");
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
      observe.onManagedLoadFailure({
        mutationStarted: managed.mutationStarted === true,
        code: managed.error?.code ?? "PREVIEW_LOAD_FAILED",
      });
      setLoadState(managed.mutationStarted ? "tainted" : "stopped");
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
      setLoadState("tainted");
      return {
        result: { success: false, error: { code: "PREVIEW_LOAD_FAILED", message: "Managed byte proof mismatched." } },
        closeAfterResponse: true,
      };
    }
    observe.onLoadSuccess({
      ...load,
      compileId: message.payload.compileId,
      correlationId: message.correlationId,
      receiptAssemblySha256: assemblySha256,
      receiptPdbSha256: pdbSha256,
    });
    observe.onLoadRequest({
      compileId: message.payload.compileId,
      correlationId: message.correlationId,
      measuredRequestBytes: observation.measuredBytes,
      terminalResponses: 1,
    });
    if (constructAfterLoad) {
      if (typeof exports.DiscoverAndConstructGame !== "function") throw new Error("INTERNAL_ERROR");
      setLoadState("loaded");
      const [pipeline, repeatedPipeline] = await Promise.all([
        Promise.resolve().then(() => JSON.parse(exports.DiscoverAndConstructGame())),
        Promise.resolve().then(() => JSON.parse(exports.DiscoverAndConstructGame())),
      ]);
      const repeatMatched = JSON.stringify(pipeline) === JSON.stringify(repeatedPipeline);
      observe.onLoadPipeline({ pipeline, repeatedPipeline, repeatMatched });
      if (!repeatMatched) throw new Error("INTERNAL_ERROR");
      if (!pipeline.success) {
        setLoadState("tainted");
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
    setLoadState("loaded");
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
      observe.onLoadRejection(code);
    } else if (loadState !== "loaded" && loadState !== "tainted") {
      observe.onLoadError(code);
    }
    if (loadState === "validating") {
      setLoadState("tainted");
      return {
        result: { success: false, error: { code: "PREVIEW_LOAD_FAILED", message: "Managed load failed after mutation may have begun." } },
        closeAfterResponse: true,
      };
    }
    if (loadState === "loaded" || loadState === "tainted") {
      setLoadState("tainted");
      observe.onLoadError("INTERNAL_ERROR");
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
  }); // end runLoad operation lambda
}

async function executeStartRequest(message) {
  return preStartAdmission.runStart(
    message.correlationId,
    loadState,
    async () => {
  outputCorrelationId = message.correlationId;
  outputLive = false;
  pendingOutputEvents = [];
  if (!nativeOutput.flush(protocolGeneration, ({ stream, category, text }) =>
    globalThis.__playgroundForwardOutput("native", stream, category, text))) {
    throw new Error("INVALID_STATE");
  }
  const startConfig = extension?.bootstrap?.startConfig?.() ?? {};
  startExecutor ??= createPreviewStartExecutor({
    getState: () => loadState,
    setState: state => setLoadState(state),
    getExports: () => exportsPromise,
    createLifecycleEvent: lifecycleEvent,
    recordStart: start => observe.onStart(start),
    recordFailureTeardown: teardown => observe.onStartFailureTeardown(teardown),
    recordUnexpected: error => observe.onStartUnexpected(error),
    beforeRunDelayMs: startConfig.beforeRunDelayMs ?? 0,
    startedEventDelayMs: startConfig.startedEventDelayMs ?? 0,
    throwUnexpectedBeforeExport: startConfig.throwUnexpectedBeforeExport === true,
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
  }); // end runStart operation
}

async function executeStopRequest(message) {
  stopExecutor ??= createPreviewStopExecutor({
    getState: () => loadState,
    setState: state => setLoadState(state),
    getExports: () => exportsPromise,
    createLifecycleEvent: lifecycleEvent,
    recordStop: stop => observe.onStop(stop),
    // Neutral post-stop observation seam. Product supplies no extension, so
    // `observe.onStopObservation` returns undefined and no proof reflection
    // runs; the proof extension implements it to observe stopped quiescence.
    observeStopped: exports => observe.onStopObservation(exports),
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

// Neutral control surface handed to an optional extension. Exposes only what a
// separately-staged module needs to observe the product lifecycle; it grants no
// ability to alter the shipping protocol. Product builds never define the
// extension factory, so `extension` stays null and every hook is inert.
let exportsPromise = null;
const previewControls = {
  realmToken,
  get loadState() { return loadState; },
  get exportsPromise() { return exportsPromise; },
  get previewEndpoint() { return previewEndpoint; },
  get expectedPreviewId() { return expectedPreviewId; },
  get protocolGeneration() { return protocolGeneration; },
  get bootstrapObservations() { return bootstrapObservations; },
  get nativeOutput() { return nativeOutput; },
  get preStartAdmission() { return preStartAdmission; },
};
if (typeof extensionFactory === "function") {
  extension = extensionFactory(previewControls) ?? null;
}

exportsPromise = startRuntime();

try {
  await exportsPromise;
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  observe.onError(message);
  status.dataset.state = "error";
  status.textContent = message;
  console.error(error);
}

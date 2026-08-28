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
globalThis.previewIssue030Proof = { enabled: false, samples: [], errors: [] };
globalThis.previewIssue033Proof = { enabled: false };
globalThis.previewIssue034Proof = { enabled: false };
globalThis.previewIssue035Proof = { enabled: false };

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
let bridgePort = null;
let bridgeReadySent = false;
let bridgeProofAuthorized = false;
const nativeOutput = createNativeOutputCapture();
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

function sendBridgeReady() {
  if (!bridgePort || !proofState.ready || bridgeReadySent) return;
  bridgeReadySent = true;
  bridgePort.postMessage({
    type: "preview.bridge.ready",
    payload: {
      runtimeStarts: globalThis.previewIssue21Proof.runtimeStarts,
      realmToken,
      opaqueOrigin: location.origin === "null",
    },
  });
}

async function executeBridgeAction(action, payload) {
  if (action === "snapshot") {
    const name = payload?.name;
    if (name === "proof") return globalThis.previewProof;
    if (name === "issue21") return globalThis.previewIssue21Proof;
    if (name === "issue22") return globalThis.previewIssue22Proof;
    if (name === "issue023") return globalThis.previewIssue023Proof;
    if (name === "issue024") return globalThis.previewIssue024Snapshot?.() ?? null;
    if (name === "endpoint") return globalThis.previewIssue023EndpointSnapshot?.() ?? null;
    if (name === "native") return globalThis.previewIssue028Snapshot?.() ?? null;
    if (name === "pixels") return globalThis.previewIssue030PixelProof?.() ?? null;
    if (name === "errors") {
      return [
        ...(globalThis.previewProof?.errors ?? []),
        ...(globalThis.previewIssue21Proof?.errors ?? []),
        ...(globalThis.previewIssue023Proof?.errors ?? []),
      ];
    }
    throw new Error("Unknown preview snapshot.");
  }
  if (action === "issue023-query") return globalThis.previewIssue023Query();
  if (action === "issue023-self-test") return globalThis.previewIssue023RunnerSelfTest();
  if (action === "issue027-writer-test") return globalThis.previewIssue027WriterSelfTest();
  if (action === "issue029-quiescent") return globalThis.previewIssue029QuiescentProof();
  if (action === "issue028-emit") {
    globalThis.previewIssue028EmitNativePaths();
    return true;
  }
  if (action === "issue22-teardown") return globalThis.previewIssue22Teardown();
  if (action === "issue033-security" && globalThis.previewIssue033Proof.enabled) {
    const violations = [];
    const onViolation = event => violations.push({
      effectiveDirective: event.effectiveDirective,
      blockedUri: event.blockedURI,
    });
    addEventListener("securitypolicyviolation", onViolation);
    let parentDomDenied = false;
    try { void parent.document.body; } catch { parentDomDenied = true; }
    let evalDenied = false;
    try { globalThis.eval("1 + 1"); } catch { evalDenied = true; }
    const inlineScript = document.createElement("script");
    inlineScript.textContent = "globalThis.__issue033InlineRan = true";
    document.body.append(inlineScript);
    const inlineStyle = document.createElement("style");
    inlineStyle.textContent = "body { outline: 1px solid red; }";
    document.head.append(inlineStyle);
    const frame = document.createElement("iframe");
    frame.src = "data:text/html,blocked";
    document.body.append(frame);
    const object = document.createElement("object");
    object.data = "data:text/html,blocked";
    document.body.append(object);
    const base = document.createElement("base");
    base.href = "https://example.invalid/issue033-base/";
    document.head.append(base);
    const popupDenied = window.open("https://example.invalid/issue033-navigation") === null;
    const form = document.createElement("form");
    form.action = "https://example.invalid/issue033-form";
    form.target = "_self";
    let formSubmitEventObserved = false;
    form.addEventListener("submit", () => { formSubmitEventObserved = true; });
    document.body.append(form);
    form.requestSubmit();
    let fetchDenied = false;
    try { await fetch("https://example.invalid/issue033"); } catch { fetchDenied = true; }
    await new Promise(resolve => setTimeout(resolve, 50));
    removeEventListener("securitypolicyviolation", onViolation);
    const baseUriDenied =
      !document.baseURI.startsWith("https://example.invalid/issue033-base");
    const formRemainedInDocument = document.contains(form);
    const formCspViolationObserved = violations.some(item =>
      item.effectiveDirective === "form-action" &&
      item.blockedUri === "https://example.invalid/issue033-form");
    frame.remove();
    object.remove();
    base.remove();
    form.remove();
    inlineScript.remove();
    inlineStyle.remove();
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    oscillator.connect(audio.destination);
    oscillator.start();
    oscillator.stop();
    await audio.close();
    return {
      serializedOrigin: location.origin,
      parentDomDenied,
      evalDenied,
      inlineScriptDenied: globalThis.__issue033InlineRan !== true,
      fetchDenied,
      audioClosed: audio.state === "closed",
      baseUriDenied,
      popupSandboxDenied: popupDenied,
      formSubmitEventObserved,
      formRemainedInDocument,
      formCspViolationObserved,
      formSandboxBlockedBeforeCsp:
        formSubmitEventObserved && formRemainedInDocument && !formCspViolationObserved,
      evalViolationObserved: violations.some(item =>
        item.effectiveDirective.startsWith("script-src") && item.blockedUri === "eval"),
      violations,
    };
  }
  if (action === "issue034-security" && globalThis.previewIssue034Proof.enabled) {
    const internals = globalThis.__TAURI_INTERNALS__;
    const webkitHandlers = globalThis.webkit?.messageHandlers;
    const handlerNames = webkitHandlers && typeof webkitHandlers === "object"
      ? Object.getOwnPropertyNames(webkitHandlers)
      : [];
    let directInvoke = "unreachable";
    if (typeof internals?.invoke === "function") {
      try {
        await internals.invoke("issue034_trusted_marker");
        directInvoke = "unexpected-success";
      } catch {
        directInvoke = "rejected";
      }
    }
    const rawIpc = {
      windowIpc: typeof globalThis.ipc,
      windowIpcPostMessage: typeof globalThis.ipc?.postMessage,
      webkitIpcPostMessage: typeof webkitHandlers?.ipc?.postMessage,
      submitted: 0,
      rejected: 0,
      malformedProbeCount: 0,
    };
    const ipcHandler = webkitHandlers?.ipc;
    const probes = Array.isArray(payload?.ipcProbes) ? payload.ipcProbes : [];
    if (probes.length > 256)
      throw new Error("Issue 034 raw IPC probe count exceeds its bound.");
    for (const probe of probes) {
      if (!probe || typeof probe.envelope !== "string" ||
          probe.envelope.length > 4_096 ||
          !Number.isInteger(probe.repetitions) ||
          probe.repetitions < 1 || probe.repetitions > 2) {
        rawIpc.malformedProbeCount += 1;
        continue;
      }
      for (let attempt = 0; attempt < probe.repetitions; attempt += 1) {
        try {
          if (typeof ipcHandler?.postMessage !== "function")
            throw new Error("WebKit IPC handler is unavailable.");
          ipcHandler.postMessage(probe.envelope);
          rawIpc.submitted += 1;
        } catch {
          rawIpc.rejected += 1;
        }
      }
    }
    const urls = [
      "file:///issue034-controlled-canary.txt",
      "tauri://localhost/tests/security/fixtures/issue034-canary.txt",
      "asset://localhost/tests/security/fixtures/issue034-canary.txt",
      "http://ipc.localhost/issue034_trusted_marker",
      "ipc://localhost/issue034_trusted_marker",
      "playground-preview://localhost/%2e%2e/tests/security/fixtures/issue034-canary.txt",
    ];
    const customProtocolProbe = probes.find(probe =>
      probe && typeof probe === "object" &&
      probe.command === "issue034_trusted_marker" &&
      probe.variant === "wrong-key");
    const customProtocolHeaders = customProtocolProbe
      ? {
          "Content-Type": "application/json",
          "Tauri-Callback": String(customProtocolProbe.callback),
          "Tauri-Error": String(customProtocolProbe.error),
          "Tauri-Invoke-Key": "issue034-deliberately-invalid-invoke-key",
        }
      : {};
    const fetchResults = await Promise.all(urls.map(async (url, probe) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      try {
        const ipc = url.startsWith("ipc:") || url.startsWith("http://ipc.");
        const response = await fetch(url, {
          method: ipc ? "POST" : "GET",
          body: ipc ? "{}" : undefined,
          headers: ipc ? customProtocolHeaders : undefined,
          credentials: "omit",
          signal: controller.signal,
        });
        const text = (await response.text()).slice(0, 256);
        const bodyBytes = new TextEncoder().encode(text);
        return {
          probe,
          resolved: true,
          status: response.status,
          bodySha256: await sha256Buffer(bodyBytes.buffer),
          bodyBytes: bodyBytes.byteLength,
        };
      } catch (error) {
        return {
          probe,
          resolved: false,
          error: error instanceof Error ? error.name : "Error",
          bodySha256: null,
          bodyBytes: 0,
        };
      } finally {
        clearTimeout(timer);
      }
    }));
    const xhrResults = await Promise.all(urls.map((url, probe) =>
      new Promise(resolve => {
        const request = new XMLHttpRequest();
        let settled = false;
        const finish = async (resolved, error) => {
          if (settled) return;
          settled = true;
          let text = "";
          try {
            text = typeof request.responseText === "string"
              ? request.responseText.slice(0, 256)
              : "";
          } catch {
            text = "";
          }
          const bodyBytes = new TextEncoder().encode(text);
          try {
            resolve({
              probe,
              resolved,
              status: request.status,
              error,
              bodySha256: await sha256Buffer(bodyBytes.buffer),
              bodyBytes: bodyBytes.byteLength,
            });
          } catch {
            resolve({
              probe,
              resolved: false,
              status: request.status,
              error: "digest-error",
              bodySha256: null,
              bodyBytes: bodyBytes.byteLength,
            });
          }
        };
        request.timeout = 2_000;
        request.onload = () => finish(true, null);
        request.onerror = () => finish(false, "error");
        request.ontimeout = () => finish(false, "timeout");
        try {
          request.open(
            url.startsWith("ipc:") || url.startsWith("http://ipc.") ? "POST" : "GET",
            url,
          );
          request.withCredentials = false;
          if (url.startsWith("ipc:") || url.startsWith("http://ipc.")) {
            for (const [name, value] of Object.entries(customProtocolHeaders))
              request.setRequestHeader(name, value);
          }
          request.send(
            url.startsWith("ipc:") || url.startsWith("http://ipc.") ? "{}" : null);
        } catch {
          finish(false, "exception");
        }
      })));
    const exports = await exportsPromise;
    if (typeof exports.Issue034FileSystemProbe !== "function")
      throw new Error("Issue 034 managed filesystem probe is unavailable.");
    return {
      globals: {
        tauri: typeof globalThis.__TAURI__,
        internals: typeof internals,
        isTauri: typeof globalThis.isTauri,
        invoke: typeof internals?.invoke,
        transformCallback: typeof internals?.transformCallback,
        convertFileSrc: typeof internals?.convertFileSrc,
        internalsKeys: internals && typeof internals === "object"
          ? Object.keys(internals).sort()
          : [],
        webkit: typeof globalThis.webkit,
        webkitMessageHandlers: typeof webkitHandlers,
        webkitHandlerNames: handlerNames.sort(),
      },
      directInvoke,
      rawIpc,
      fetchResults,
      xhrResults,
      managedFileSystem: JSON.parse(exports.Issue034FileSystemProbe()),
    };
  }
  if (action === "issue035-security" && globalThis.previewIssue035Proof.enabled) {
    const violations = [];
    const onViolation = event => violations.push({
      effectiveDirective: event.effectiveDirective,
      blockedUri: event.blockedURI,
      disposition: event.disposition,
    });
    addEventListener("securitypolicyviolation", onViolation);

    // Probe 1: External fetch — must trigger CSP connect-src violation
    let fetchBlocked = false;
    let fetchError = null;
    try {
      await fetch("https://example.com/issue035-probe");
    } catch (error) {
      fetchBlocked = true;
      fetchError = error instanceof Error ? error.message : String(error);
    }

    // Probe 2: Top navigation — sandbox blocks this
    let topLocationBefore = null;
    let topLocationDenied = false;
    try { topLocationBefore = parent.location.href; } catch { topLocationBefore = "cross-origin-denied"; }
    try {
      parent.location.href = "https://example.com/issue035-top-nav";
      topLocationDenied = false;
    } catch {
      topLocationDenied = true;
    }
    let topLocationAfter = null;
    try { topLocationAfter = parent.location.href; } catch { topLocationAfter = "cross-origin-denied"; }

    // Probe 3: window.open — sandbox blocks popups
    let windowOpenResult = null;
    try {
      windowOpenResult = window.open("https://example.com/issue035-popup", "_blank");
    } catch {
      windowOpenResult = "exception";
    }
    const popupDenied = windowOpenResult === null || windowOpenResult === "exception";

    // Probe 4: window.open with _top target
    let windowOpenTopResult = null;
    try {
      windowOpenTopResult = window.open("https://example.com/issue035-popup-top", "_top");
    } catch {
      windowOpenTopResult = "exception";
    }
    const popupTopDenied = windowOpenTopResult === null || windowOpenTopResult === "exception";

    await new Promise(resolve => setTimeout(resolve, 100));
    removeEventListener("securitypolicyviolation", onViolation);

    const connectViolation = violations.find(item =>
      item.effectiveDirective.startsWith("connect-src") &&
      item.blockedUri === "https://example.com/issue035-probe");

    return {
      fetchBlocked,
      fetchError,
      connectSrcViolationObserved: !!connectViolation,
      topLocationBefore,
      topLocationAfter,
      topLocationDenied,
      topLocationUnchanged: topLocationBefore === topLocationAfter,
      popupDenied,
      popupTopDenied,
      violations,
      serializedOrigin: location.origin,
    };
  }
  if (action === "wait-animation-frame") {
    return await boundedAnimationFrame("wait-animation-frame");
  }
  if (action === "frame-readiness") {
    const first = await boundedAnimationFrame("frame-readiness:first");
    const second = await boundedAnimationFrame("frame-readiness:second");
    const canvas = document.querySelector("#canvas");
    const rect = canvas?.getBoundingClientRect();
    return {
      first,
      second,
      progressed: second > first,
      visibilityState: document.visibilityState,
      innerWidth,
      innerHeight,
      canvasWidth: rect?.width ?? 0,
      canvasHeight: rect?.height ?? 0,
    };
  }
  if (action === "sample-webgl") {
    const canvas = document.querySelector("#canvas");
    const gl = canvas?.getContext("webgl2");
    if (!canvas || !gl) throw new Error("Preview canvas WebGL2 context is unavailable.");
    await boundedAnimationFrame("sample-webgl");
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.finish();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const points = [
      [Math.floor(width / 2), Math.floor(height / 2)],
      [1, 1],
      [Math.max(0, width - 2), 1],
      [1, Math.max(0, height - 2)],
      [Math.max(0, width - 2), Math.max(0, height - 2)],
    ];
    const pixels = points.map(([x, y]) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    });
    const glError = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    return {
      sampledAt: performance.now(),
      canvasBacking: { width: canvas.width, height: canvas.height },
      drawingBuffer: { width, height },
      pixels,
      glError,
      contextLost: gl.isContextLost(),
    };
  }

  function boundedAnimationFrame(label, timeoutMilliseconds = 5_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(
        `ANIMATION_FRAME_TIMEOUT:${JSON.stringify({
          label,
          timeoutMilliseconds,
          visibilityState: document.visibilityState,
          innerWidth,
          innerHeight,
          hasFocus: document.hasFocus(),
          canvasConnected: document.querySelector("#canvas")?.isConnected === true,
        })}`)), timeoutMilliseconds);
      requestAnimationFrame(timestamp => {
        clearTimeout(timer);
        resolve(timestamp);
      });
    });
  }
  if (action === "register-expectation" && bridgeProofAuthorized)
    return globalThis.previewIssue21RegisterExpectation?.(payload);
  if (action === "remove-expectation" && bridgeProofAuthorized)
    return globalThis.previewIssue21RemoveExpectation?.(payload?.correlationId);
  throw new Error("Preview bridge action is not authorized.");
}

function installPreviewBridge(port, proofAuthorized) {
  bridgePort = port;
  bridgeProofAuthorized = proofAuthorized;
  port.addEventListener("message", async event => {
    const message = event.data;
    if (!message || typeof message !== "object" ||
        message.type !== "preview.bridge.request" ||
        typeof message.id !== "string" ||
        typeof message.action !== "string") return;
    try {
      const result = await executeBridgeAction(message.action, message.payload);
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
    Object.hasOwn(data, "issue021Proof") && typeof data.issue021Proof === "boolean" &&
    (!Object.hasOwn(data, "issue022Proof") || typeof data.issue022Proof === "boolean") &&
    (!Object.hasOwn(data, "issue023Proof") || typeof data.issue023Proof === "boolean") &&
    (!Object.hasOwn(data, "issue024Proof") || typeof data.issue024Proof === "boolean") &&
    (!Object.hasOwn(data, "issue028Proof") || typeof data.issue028Proof === "boolean") &&
    (!Object.hasOwn(data, "issue030Proof") || typeof data.issue030Proof === "boolean") &&
    (!Object.hasOwn(data, "issue033Proof") || typeof data.issue033Proof === "boolean") &&
    (!Object.hasOwn(data, "issue034Proof") || typeof data.issue034Proof === "boolean") &&
    (!Object.hasOwn(data, "issue035Proof") || typeof data.issue035Proof === "boolean") &&
    (!Object.hasOwn(data, "runGamePipeline") || typeof data.runGamePipeline === "boolean") &&
    (!Object.hasOwn(data, "issue023Case") ||
      typeof data.issue023Case === "string" &&
      ["normal", "delay-run", "delay-run-late", "delay-run-long", "delay-event", "unexpected"]
        .includes(data.issue023Case)),
  onPort: (port, data, additionalPorts) => {
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
    globalThis.previewIssue030Proof.enabled = data.issue030Proof === true;
    globalThis.previewIssue033Proof.enabled = data.issue033Proof === true;
    globalThis.previewIssue034Proof.enabled = data.issue034Proof === true;
    globalThis.previewIssue035Proof.enabled = data.issue035Proof === true;
    installPreviewBridge(additionalPorts[0], data.issue021Proof === true);
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
  sendBridgeReady();
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

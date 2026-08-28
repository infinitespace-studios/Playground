import "./style.css";
import { runIssue021AutoProof } from "./issue21";
import { runIssue022AutoProof } from "./issue22";
import { runIssue023AutoProof } from "./issue23";
import { installIssue024RunStopControl, runIssue024AutoProof } from "./issue24";
import { runIssue025AutoProof } from "./issue25";
import { runIssue027AutoProof } from "./issue27";

interface RuntimeBuild {
  buildConfiguration: string;
  monogameCommitSha: string;
  fileCount: number;
}

interface RuntimeDiagnostics {
  consoleErrors: string[];
  mimeWarnings: string[];
  unhandledErrors: string[];
  renderedFramesObserved: number;
  wasm: WasmDiagnostics;
}

interface WasmDiagnostics {
  requestedUrl: string | null;
  scheme: string | null;
  contentType: string | null;
  compileStreamingCalled: boolean;
  instantiateStreamingCalled: boolean;
  instantiateStreamingSucceeded: boolean;
  bufferFallbackUsed: boolean;
  streamingError: string | null;
}

interface Issue011OuterBounds {
  physical: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  logical: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
}

interface Issue011FrameSample {
  hash: string;
  nonBlackPixels: number;
  totalPixels: number;
  glError: number;
  pixels: Uint8Array;
}

interface Issue009SpriteSample {
  hash: string;
  changedPixelCount: number;
  top: number | null;
  bottom: number | null;
}

interface PreviewFrameProof {
  protocolVersion: number;
  ready: boolean;
  startupAttempts: number;
  successfulRuntimeStarts: number;
  trustedClickCount: number;
  realmToken: string;
  parentWindowDistinct: boolean;
  configuration?: string;
  runtimeSettings?: {
    publishTrimmed: boolean;
    nativeAot: boolean;
    runAOTCompilation: boolean;
    wasmEnableThreads: boolean;
    wasmBuildNative: boolean;
    executionMode: string;
  };
  runtimeAsset: {
    path: string;
    sha256: string;
    sourceAssemblySha256: string;
    verified: boolean;
  } | null;
  autoReadyPing: Record<string, unknown> | null;
  ping: Record<string, unknown> | null;
  errors: string[];
}

declare global {
  interface Window {
    __MONOGAME_DIAGNOSTICS__: RuntimeDiagnostics;
    __TAURI_INTERNALS__?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
  }
}

const status = document.querySelector<HTMLElement>("#runtime-status");
const build = document.querySelector<HTMLElement>("#runtime-build");
const wasmStatus = document.querySelector<HTMLElement>("#wasm-diagnostic");
const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
const previewFrame = document.querySelector<HTMLIFrameElement>("#preview-frame");
const previewStatus = document.querySelector<HTMLElement>("#preview-context-status");
const previewDiagnostics = document.querySelector<HTMLElement>("#preview-context-diagnostics");

if (
  !status ||
  !build ||
  !wasmStatus ||
  !canvas ||
  !previewFrame ||
  !previewStatus ||
  !previewDiagnostics
) {
  throw new Error("MonoGame runtime shell elements are missing");
}

const parentRealmToken = crypto.randomUUID();
let issue020ReportSent = false;
let issue020ReadyCheckpointSent = false;
let issue020RenderingCheckpointSent = false;

const readPreviewProof = (): PreviewFrameProof | null => {
  const child = previewFrame.contentWindow as (Window & { previewProof?: PreviewFrameProof }) | null;
  return child?.previewProof ?? null;
};

const previewDiagnosticsSnapshot = () => {
  const child = previewFrame.contentWindow;
  const childProof = readPreviewProof();
  const assetUrl = child ? new URL("/preview/index.html", child.location.href) : null;
  return {
    protocolVersion: 1,
    iframeWindowDistinct: child !== null && child !== window,
    parentRealmToken,
    childRealmToken: childProof?.realmToken ?? null,
    realmTokensDistinct: Boolean(childProof?.realmToken && childProof.realmToken !== parentRealmToken),
    nestedRuntimeStarts: childProof?.successfulRuntimeStarts ?? 0,
    iframeAssetScheme: assetUrl?.protocol.replace(/:$/, "") ?? null,
    iframeAssetUrl: assetUrl?.href ?? null,
    childProof,
  };
};

const updatePreviewDiagnostics = () => {
  try {
    const snapshot = previewDiagnosticsSnapshot();
    previewDiagnostics.textContent = JSON.stringify(snapshot, null, 2);
    if (snapshot.childProof?.errors.length) {
      previewStatus.textContent = `Preview startup error: ${snapshot.childProof.errors.at(-1)}`;
    } else if (snapshot.childProof?.ping) {
      previewStatus.textContent =
        `Ping=${String(snapshot.childProof.ping.message)}; one nested runtime; ` +
        `trusted=${String(snapshot.childProof.ping.trusted)}`;
    } else if (snapshot.childProof?.ready) {
      previewStatus.textContent = "Nested Release runtime ready; use its proof button.";
    }
  } catch (error: unknown) {
    previewStatus.textContent =
      `Preview context diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
};

previewFrame.addEventListener("load", updatePreviewDiagnostics);
window.setInterval(updatePreviewDiagnostics, 250);

const diagnostics: RuntimeDiagnostics = {
  consoleErrors: [],
  mimeWarnings: [],
  unhandledErrors: [],
  renderedFramesObserved: 0,
  wasm: {
    requestedUrl: null,
    scheme: null,
    contentType: null,
    compileStreamingCalled: false,
    instantiateStreamingCalled: false,
    instantiateStreamingSucceeded: false,
    bufferFallbackUsed: false,
    streamingError: null,
  },
};

window.__MONOGAME_DIAGNOSTICS__ = diagnostics;

const publishWasmDiagnostics = () => {
  const wasm = diagnostics.wasm;
  const streaming = wasm.instantiateStreamingSucceeded
    ? "succeeded"
    : wasm.streamingError
      ? "failed"
      : wasm.instantiateStreamingCalled
        ? "called"
        : "waiting";

  wasmStatus.textContent =
    `WASM ${wasm.requestedUrl ?? "URL pending"} · ${wasm.contentType ?? "content-type pending"} · ` +
    `instantiateStreaming ${streaming} · buffer fallback ${wasm.bufferFallbackUsed ? "used" : "not used"} · ` +
    `MIME warnings ${diagnostics.mimeWarnings.length}`;
  console.log("[wasm-diagnostic]", JSON.stringify(wasm));
};

const originalInstantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
const originalCompileStreaming = WebAssembly.compileStreaming.bind(WebAssembly);
const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly);
let nativeResponse: Response | null = null;
let nativeImports: WebAssembly.Imports | null = null;
let nativeSuccessCallback:
  | ((instance: WebAssembly.Instance, module: WebAssembly.Module) => void)
  | null = null;
let resolveCompiledModule: ((module: WebAssembly.Module) => void) | null = null;
let rejectCompiledModule: ((reason: unknown) => void) | null = null;
let nativeInstantiationStarted = false;

const instantiateNativeRuntime = async () => {
  if (
    nativeInstantiationStarted ||
    !nativeResponse ||
    !nativeImports ||
    !nativeSuccessCallback ||
    !resolveCompiledModule ||
    !rejectCompiledModule
  ) {
    return;
  }

  nativeInstantiationStarted = true;
  diagnostics.wasm.instantiateStreamingCalled = true;
  publishWasmDiagnostics();

  try {
    const result = await originalInstantiateStreaming(nativeResponse, nativeImports);
    diagnostics.wasm.instantiateStreamingSucceeded = true;
    nativeSuccessCallback(result.instance, result.module);
    resolveCompiledModule(result.module);
    publishWasmDiagnostics();
  } catch (error: unknown) {
    diagnostics.wasm.streamingError = error instanceof Error ? error.message : String(error);
    diagnostics.wasm.bufferFallbackUsed = true;
    publishWasmDiagnostics();

    try {
      const fallbackResponse = await fetch(diagnostics.wasm.requestedUrl!);
      const result = await originalInstantiate(await fallbackResponse.arrayBuffer(), nativeImports);
      nativeSuccessCallback(result.instance, result.module);
      resolveCompiledModule(result.module);
    } catch (fallbackError: unknown) {
      rejectCompiledModule(fallbackError);
    }
  }
};

WebAssembly.compileStreaming = (async (source) => {
  const response = await source;
  if (!/\/dotnet\.native\..*\.wasm(?:[?#]|$)/.test(response.url)) {
    return originalCompileStreaming(response);
  }

  diagnostics.wasm.requestedUrl = response.url;
  diagnostics.wasm.scheme = new URL(response.url).protocol.replace(/:$/, "");
  diagnostics.wasm.contentType = response.headers.get("content-type");
  diagnostics.wasm.compileStreamingCalled = true;
  nativeResponse = response;
  publishWasmDiagnostics();

  const compiledModule = new Promise<WebAssembly.Module>((resolve, reject) => {
    resolveCompiledModule = resolve;
    rejectCompiledModule = reject;
  });
  void instantiateNativeRuntime();
  return compiledModule;
}) as typeof WebAssembly.compileStreaming;

const setFailure = (message: string) => {
  document.documentElement.dataset.runtime = "error";
  status.textContent = message;
};

window.addEventListener("error", (event) => {
  const message = event.error instanceof Error ? event.error.stack ?? event.error.message : event.message;
  diagnostics.unhandledErrors.push(message);
  setFailure("Runtime exception — inspect WebView console");
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  diagnostics.unhandledErrors.push(message);
  setFailure("Unhandled runtime rejection — inspect WebView console");
});

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  diagnostics.consoleErrors.push(args.map(String).join(" "));
  setFailure("WebView console error — inspect packaged runtime diagnostics");
  originalConsoleError(...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const message = args.map(String).join(" ");
  if (/mime|content[- ]type|streaming compile|arraybuffer instantiation/i.test(message)) {
    diagnostics.mimeWarnings.push(message);
    publishWasmDiagnostics();
    setFailure("WASM MIME warning — inspect packaged runtime diagnostics");
  }
  originalConsoleWarn(...args);
};

const originalConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const message = args.map(String).join(" ");

  if (message.includes("Content loading complete, starting game")) {
    document.documentElement.dataset.runtime = "starting";
    status.textContent = "Starting MonoGame Example.Web…";
  }

  if (/Draw #\d+: complete/.test(message)) {
    diagnostics.renderedFramesObserved += 1;
    if (diagnostics.consoleErrors.length === 0 && diagnostics.unhandledErrors.length === 0) {
      document.documentElement.dataset.runtime = "rendering";
      status.textContent = "Rendering animated Example.Web scene · 0 console errors";
    }
  }

  originalConsoleLog(...args);
};

fetch("/monogame-build.json")
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Build metadata returned HTTP ${response.status}`);
    }
    return response.json() as Promise<RuntimeBuild>;
  })
  .then((metadata) => {
    build.textContent =
      `MonoGame ${metadata.buildConfiguration} · ${metadata.fileCount} verified files · ` +
      metadata.monogameCommitSha.slice(0, 12);
  })
  .catch((error: unknown) => {
    console.error("Unable to read packaged MonoGame build metadata", error);
  });

interface DotnetHostBuilder {
  withModuleConfig(config: {
    instantiateWasm: (
      imports: WebAssembly.Imports,
      successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) => unknown[];
  }): DotnetHostBuilder;
}

const startMonoGame = async () => {
  const dotnetModulePath = "/_framework/dotnet.js";
  const { dotnet } = (await import(/* @vite-ignore */ dotnetModulePath)) as {
    dotnet: DotnetHostBuilder;
  };

  dotnet.withModuleConfig({
    instantiateWasm: (imports, successCallback) => {
      nativeImports = imports;
      nativeSuccessCallback = successCallback;
      void instantiateNativeRuntime();
      return [];
    },
  });

  const mainModulePath = "/main.js";
  await import(/* @vite-ignore */ mainModulePath);
};

void startMonoGame().catch((error: unknown) => {
  console.error("Unable to start packaged MonoGame runtime", error);
});

const runIssue009Proof = async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue009_is_proof_enabled"))) {
    return;
  }

  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
  const waitForRendering = async () => {
    const deadline = performance.now() + 30_000;
    while (document.documentElement.dataset.runtime !== "rendering") {
      if (performance.now() >= deadline) {
        throw new Error("Issue 009 proof timed out waiting for active rendering");
      }
      await wait(100);
    }
  };

  const eventTargetName = (target: EventTarget | null) => {
    if (target === window) return "window";
    if (target === document) return "document";
    if (!(target instanceof Element)) return target?.constructor.name ?? "null";
    return target.id ? `${target.tagName.toLowerCase()}#${target.id}` : target.tagName.toLowerCase();
  };

  const focusState = () => ({
    documentHasFocus: document.hasFocus(),
    activeElement: eventTargetName(document.activeElement),
    canvasFocused: document.activeElement === canvas,
  });

  const keyboardEvents: Array<Record<string, unknown>> = [];
  const mouseEvents: Array<Record<string, unknown>> = [];
  const focusRouteDecisions: Array<Record<string, unknown>> = [];
  let sequence = 0;
  const recordKeyboard = (event: KeyboardEvent) => {
    keyboardEvents.push({
      sequence: ++sequence,
      type: event.type,
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      target: eventTargetName(event.target),
      currentTarget: eventTargetName(event.currentTarget),
      trusted: event.isTrusted,
      focus: focusState(),
    });
  };
  const routeKeyboardToFocusedCanvas = (event: KeyboardEvent) => {
    recordKeyboard(event);
    const deliveredToCanvas = document.activeElement === canvas && event.target === canvas;
    focusRouteDecisions.push({
      sequence: keyboardEvents.at(-1)?.sequence,
      type: event.type,
      key: event.key,
      deliveredToCanvas,
      activeElement: eventTargetName(document.activeElement),
    });
    if (!deliveredToCanvas) {
      event.stopPropagation();
    }
  };
  const recordMouse = (handler: string) => (event: MouseEvent) => {
    mouseEvents.push({
      sequence: ++sequence,
      handler,
      type: event.type,
      client: { x: event.clientX, y: event.clientY },
      offset: { x: event.offsetX, y: event.offsetY },
      movement: { x: event.movementX, y: event.movementY },
      button: event.button,
      buttons: event.buttons,
      target: eventTargetName(event.target),
      currentTarget: eventTargetName(event.currentTarget),
      trusted: event.isTrusted,
      focus: focusState(),
    });
  };

  document.addEventListener("keydown", routeKeyboardToFocusedCanvas, true);
  document.addEventListener("keyup", routeKeyboardToFocusedCanvas, true);
  for (const type of ["mousemove", "mousedown", "mouseup", "click"] as const) {
    canvas.addEventListener(type, recordMouse("canvas"));
    document.addEventListener(type, recordMouse("document"));
  }

  const readSprite = (gl: WebGL2RenderingContext): Issue009SpriteSample => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let hash = 0x811c9dc5;
    let changedPixelCount = 0;
    const rows = new Map<number, number>();
    for (let topY = 10; topY < height - 10; topY += 1) {
      const glY = height - 1 - topY;
      for (let x = Math.floor(width * 0.72); x < width; x += 1) {
        const index = (glY * width + x) * 4;
        const redBackground =
          pixels[index] > 180 && pixels[index + 1] < 70 && pixels[index + 2] < 70;
        if (!redBackground) {
          changedPixelCount += 1;
          rows.set(topY, (rows.get(topY) ?? 0) + 1);
        }
        hash ^= pixels[index];
        hash = Math.imul(hash, 0x01000193);
        hash ^= pixels[index + 1];
        hash = Math.imul(hash, 0x01000193);
        hash ^= pixels[index + 2];
        hash = Math.imul(hash, 0x01000193);
      }
    }
    const occupiedRows = [...rows.entries()]
      .filter(([, count]) => count >= 3)
      .map(([row]) => row);
    return {
      hash: (hash >>> 0).toString(16).padStart(8, "0"),
      changedPixelCount,
      top: occupiedRows.length > 0 ? Math.min(...occupiedRows) : null,
      bottom: occupiedRows.length > 0 ? Math.max(...occupiedRows) : null,
    };
  };

  const dispatchKey = (target: Element, type: "keydown" | "keyup", key: string, code: string, keyCode: number) => {
    const event = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      keyCode: { get: () => keyCode },
      which: { get: () => keyCode },
    });
    target.dispatchEvent(event);
  };

  const readAfterFrame = async (gl: WebGL2RenderingContext) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return readSprite(gl);
  };

  await waitForRendering();
  const gl = canvas.getContext("webgl2");
  if (!gl) {
    throw new Error("Issue 009 proof could not access the active WebGL 2 context");
  }

  canvas.focus();
  await wait(100);
  const focusedBefore = await readAfterFrame(gl);
  dispatchKey(canvas, "keydown", "s", "KeyS", 83);
  await wait(220);
  const focusedKeyDown = await readAfterFrame(gl);
  dispatchKey(canvas, "keyup", "s", "KeyS", 83);
  await wait(120);
  const focusedKeyUp = await readAfterFrame(gl);
  await wait(350);
  const focusedStopped = await readAfterFrame(gl);

  const outside = status;
  outside.tabIndex = -1;
  outside.focus();
  await wait(100);
  const unfocusedBefore = await readAfterFrame(gl);
  dispatchKey(outside, "keydown", "w", "KeyW", 87);
  await wait(220);
  const unfocusedKeyDown = await readAfterFrame(gl);
  dispatchKey(outside, "keyup", "w", "KeyW", 87);
  await wait(120);
  const unfocusedKeyUp = await readAfterFrame(gl);
  outside.removeAttribute("tabindex");

  canvas.focus();
  const rect = canvas.getBoundingClientRect();
  const point = {
    x: Math.round(rect.left + rect.width * 0.42),
    y: Math.round(rect.top + rect.height * 0.38),
  };
  const mouseInit = (button: number, buttons: number) => ({
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: point.x,
    clientY: point.y,
    button,
    buttons,
    movementX: 7,
    movementY: -4,
  });
  canvas.dispatchEvent(new MouseEvent("mousemove", mouseInit(0, 0)));
  canvas.dispatchEvent(new MouseEvent("mousedown", mouseInit(0, 1)));
  canvas.dispatchEvent(new MouseEvent("mouseup", mouseInit(0, 0)));
  canvas.dispatchEvent(new MouseEvent("click", mouseInit(0, 0)));
  await wait(100);

  outside.tabIndex = -1;
  outside.focus();
  const outsideRect = outside.getBoundingClientRect();
  outside.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(outsideRect.left + 2),
      clientY: Math.round(outsideRect.top + 2),
      button: 0,
      buttons: 0,
    }),
  );
  outside.removeAttribute("tabindex");

  const movedWhileFocused =
    focusedBefore.top !== null &&
    focusedKeyDown.top !== null &&
    focusedKeyDown.top < focusedBefore.top;
  const stoppedAfterKeyUp =
    focusedKeyUp.top === focusedStopped.top && focusedKeyUp.bottom === focusedStopped.bottom;
  const movedWhileCanvasUnfocused =
    unfocusedBefore.top !== unfocusedKeyDown.top || unfocusedBefore.bottom !== unfocusedKeyDown.bottom;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    proofMode: "MONOGAME_ISSUE009_PROOF=1",
    inputMethod: "product-owned synthetic DOM events with explicit legacy keyCode values",
    keyboard: {
      managedObservation: "live Game1 rendered geometry driven by Keyboard.GetState()",
      focusRouting:
        "Proof-only document capture gate forwards keyboard events to the existing runtime only when the canvas is the focused event target.",
      focused: {
        key: "S",
        before: focusedBefore,
        keyDown: focusedKeyDown,
        keyUp: focusedKeyUp,
        stopped: focusedStopped,
        movedWhileKeyDown: movedWhileFocused,
        stoppedAfterKeyUp,
      },
      unfocused: {
        key: "W",
        before: unfocusedBefore,
        keyDown: unfocusedKeyDown,
        keyUp: unfocusedKeyUp,
        movedWhileCanvasUnfocused,
      },
      events: keyboardEvents,
      routeDecisions: focusRouteDecisions,
    },
    mouse: {
      deliveryClaim: "WebView/canvas event delivery only",
      managedMouseState: {
        observed: false,
        reason:
          "The existing Game1 does not read or render Mouse.GetState(), and no policy-safe managed observation hook exists outside the MonoGame build.",
        remainingGap: "issue 014",
      },
      requestedCanvasPoint: point,
      events: mouseEvents,
    },
    focusRoutingPass: movedWhileFocused && stoppedAfterKeyUp && !movedWhileCanvasUnfocused,
    runtime: {
      state: document.documentElement.dataset.runtime ?? null,
      errors: {
        console: [...diagnostics.consoleErrors],
        unhandled: [...diagnostics.unhandledErrors],
      },
    },
  };
  await invoke("issue009_emit_report", { report: JSON.stringify(report) });
};

void runIssue009Proof().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  void window.__TAURI_INTERNALS__?.invoke("issue009_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: message,
      diagnostics,
    }),
  });
  console.error("Issue 009 proof instrumentation failed", error);
});

const runIssue011Proof = async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue011_is_proof_enabled"))) {
    return;
  }

  let contextLostEvents = 0;
  let contextRestoredEvents = 0;
  canvas.addEventListener("webglcontextlost", () => {
    contextLostEvents += 1;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextRestoredEvents += 1;
  });

  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

  const waitForRendering = async () => {
    const deadline = performance.now() + 30_000;
    while (document.documentElement.dataset.runtime !== "rendering") {
      if (performance.now() >= deadline) {
        throw new Error("Issue 011 proof timed out waiting for active rendering");
      }
      await wait(100);
    }
  };

  const readOuterBounds = async (): Promise<Issue011OuterBounds> => {
    const [x, y, width, height, scaleFactor] = await invoke<[number, number, number, number, number]>(
      "issue011_outer_bounds",
    );
    return {
      physical: { x, y, width, height },
      logical: {
        x: x / scaleFactor,
        y: y / scaleFactor,
        width: width / scaleFactor,
        height: height / scaleFactor,
      },
      scaleFactor,
    };
  };

  const readFrame = (gl: WebGL2RenderingContext): Issue011FrameSample => {
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );

    let hash = 0x811c9dc5;
    let nonBlackPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 8 || pixels[index + 1] > 8 || pixels[index + 2] > 8) {
        nonBlackPixels += 1;
      }
      for (let channel = 0; channel < 4; channel += 1) {
        hash ^= pixels[index + channel];
        hash = Math.imul(hash, 0x01000193);
      }
    }

    return {
      hash: (hash >>> 0).toString(16).padStart(8, "0"),
      nonBlackPixels,
      totalPixels: gl.drawingBufferWidth * gl.drawingBufferHeight,
      glError: gl.getError(),
      pixels,
    };
  };

  const summarizeChange = (before: Issue011FrameSample, after: Issue011FrameSample) => {
    let materiallyChangedPixels = 0;
    for (let index = 0; index < before.pixels.length; index += 4) {
      const maximumChannelDelta = Math.max(
        Math.abs(before.pixels[index] - after.pixels[index]),
        Math.abs(before.pixels[index + 1] - after.pixels[index + 1]),
        Math.abs(before.pixels[index + 2] - after.pixels[index + 2]),
      );
      if (maximumChannelDelta > 12) {
        materiallyChangedPixels += 1;
      }
    }
    return {
      materiallyChangedPixels,
      materiallyChangedPercent: (materiallyChangedPixels / before.totalPixels) * 100,
    };
  };

  const cases = [
    { name: "baseline", width: 1280, height: 800 },
    { name: "small", width: 800, height: 480 },
    { name: "720p", width: 1280, height: 720 },
  ];
  const measurements = [];

  await waitForRendering();
  for (const testCase of cases) {
    await invoke("issue011_set_outer_size", {
      width: testCase.width,
      height: testCase.height,
    });
    await wait(1_000);

    const gl = canvas.getContext("webgl2");
    if (!gl) {
      throw new Error("Issue 011 proof could not access the active WebGL 2 context");
    }

    const framesBefore = diagnostics.renderedFramesObserved;
    const animationFrameBefore = await new Promise<number>((resolve) =>
      requestAnimationFrame(() => resolve(performance.now())),
    );
    const firstFrame = readFrame(gl);
    await wait(1_000);
    const animationFrameAfter = await new Promise<number>((resolve) =>
      requestAnimationFrame(() => resolve(performance.now())),
    );
    const secondFrame = readFrame(gl);
    const rect = canvas.getBoundingClientRect();

    measurements.push({
      case: testCase,
      outerBounds: await readOuterBounds(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvasCss: { width: canvas.clientWidth, height: canvas.clientHeight, x: rect.x, y: rect.y },
      canvasBacking: { width: canvas.width, height: canvas.height },
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      devicePixelRatio: window.devicePixelRatio,
      runtimeState: document.documentElement.dataset.runtime ?? null,
      renderedFramesObserved: {
        before: framesBefore,
        after: diagnostics.renderedFramesObserved,
      },
      animationFrameProgressMilliseconds: animationFrameAfter - animationFrameBefore,
      frames: [
        {
          hash: firstFrame.hash,
          nonBlackPixels: firstFrame.nonBlackPixels,
          totalPixels: firstFrame.totalPixels,
          glError: firstFrame.glError,
        },
        {
          hash: secondFrame.hash,
          nonBlackPixels: secondFrame.nonBlackPixels,
          totalPixels: secondFrame.totalPixels,
          glError: secondFrame.glError,
        },
      ],
      pixelChange: summarizeChange(firstFrame, secondFrame),
      context: {
        lostEvents: contextLostEvents,
        restoredEvents: contextRestoredEvents,
        currentlyLost: gl.isContextLost(),
      },
      errors: {
        console: [...diagnostics.consoleErrors],
        unhandled: [...diagnostics.unhandledErrors],
      },
    });
  }
  await invoke("issue011_set_outer_size", { width: 1280, height: 800 });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    proofMode: "MONOGAME_ISSUE011_PROOF=1",
    measurements,
  };
  await invoke("issue011_emit_report", { report: JSON.stringify(report) });
};

void runIssue011Proof().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  void window.__TAURI_INTERNALS__?.invoke("issue011_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: message,
      diagnostics,
    }),
  });
  console.error("Issue 011 proof instrumentation failed", error);
});

const runIssue010Proof = async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue010_is_proof_enabled"))) {
    return;
  }

  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Web Audio AudioContext is unavailable");
  }

  const startedAt = performance.now();
  const audioErrors: Array<Record<string, unknown>> = [];
  const audioConsole: Array<Record<string, unknown>> = [];
  const stateTransitions: Array<{ state: AudioContextState; atMilliseconds: number }> = [];
  const recordAudioError = (source: string, error: unknown) => {
    audioErrors.push({
      source,
      atMilliseconds: performance.now() - startedAt,
      message: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  };
  const context = new AudioContextConstructor();
  stateTransitions.push({ state: context.state, atMilliseconds: performance.now() - startedAt });
  context.addEventListener("statechange", () => {
    stateTransitions.push({ state: context.state, atMilliseconds: performance.now() - startedAt });
  });

  const originalLog = console.log.bind(console);
  const originalWarnForProof = console.warn.bind(console);
  const originalErrorForProof = console.error.bind(console);
  const captureAudioConsole =
    (level: string, original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      const message = args.map(String).join(" ");
      if (/audio|faudio|sound|openal|alc|content loading complete/i.test(message)) {
        audioConsole.push({ level, atMilliseconds: performance.now() - startedAt, message });
      }
      original(...args);
    };
  console.log = captureAudioConsole("log", originalLog);
  console.warn = captureAudioConsole("warn", originalWarnForProof);
  console.error = captureAudioConsole("error", originalErrorForProof);

  const prompt = document.createElement("button");
  prompt.id = "issue010-audio-proof";
  prompt.type = "button";
  prompt.textContent = "Activate audio proof (click or press a key)";
  prompt.setAttribute("aria-label", "Activate issue 010 audio proof");
  Object.assign(prompt.style, {
    position: "fixed",
    zIndex: "10000",
    inset: "20px",
    border: "3px solid #c9ff3d",
    background: "#080b0bee",
    color: "#c9ff3d",
    font: "600 22px system-ui",
  });
  document.body.append(prompt);
  prompt.focus();

  await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  await context.suspend();
  const stateBeforeGesture = context.state;
  const gesture = await new Promise<{
    type: string;
    trusted: boolean;
    atMilliseconds: number;
    key: string | null;
    stateAtGesture: AudioContextState;
  }>((resolve, reject) => {
    const accept = async (event: MouseEvent | KeyboardEvent) => {
      if (!event.isTrusted) {
        return;
      }
      window.removeEventListener("keydown", accept, true);
      prompt.removeEventListener("click", accept);
      const observation = {
        type: event.type,
        trusted: event.isTrusted,
        atMilliseconds: performance.now() - startedAt,
        key: event instanceof KeyboardEvent ? event.key : null,
        stateAtGesture: context.state,
      };
      try {
        await context.resume();
        resolve(observation);
      } catch (error: unknown) {
        reject(error);
      }
    };
    window.addEventListener("keydown", accept, true);
    prompt.addEventListener("click", accept);
  });
  prompt.remove();

  const stateAfterGestureResume = context.state;
  const samples: Array<{ atMilliseconds: number; peak: number; rms: number; activeBins: number }> = [];
  let oscillatorEndedAt: number | null = null;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    oscillator.frequency.value = 440;
    gain.gain.value = 0.015;
    oscillator.connect(gain);
    gain.connect(analyser);
    analyser.connect(context.destination);

    const ended = new Promise<void>((resolve) => {
      oscillator.addEventListener(
        "ended",
        () => {
          oscillatorEndedAt = performance.now() - startedAt;
          resolve();
        },
        { once: true },
      );
    });
    const timeDomain = new Float32Array(analyser.fftSize);
    const frequency = new Float32Array(analyser.frequencyBinCount);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    while (oscillatorEndedAt === null) {
      analyser.getFloatTimeDomainData(timeDomain);
      analyser.getFloatFrequencyData(frequency);
      let peak = 0;
      let sumSquares = 0;
      for (const value of timeDomain) {
        peak = Math.max(peak, Math.abs(value));
        sumSquares += value * value;
      }
      samples.push({
        atMilliseconds: performance.now() - startedAt,
        peak,
        rms: Math.sqrt(sumSquares / timeDomain.length),
        activeBins: frequency.filter((value) => Number.isFinite(value) && value > -80).length,
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    await ended;
    oscillator.disconnect();
    gain.disconnect();
    analyser.disconnect();
  } catch (error: unknown) {
    recordAudioError("signal-path", error);
  }

  const resourceEntries = performance
    .getEntriesByType("resource")
    .filter((entry) => /(?:^|\/)testsound\.xnb(?:[?#]|$)/i.test(entry.name))
    .map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return {
        name: resource.name,
        initiatorType: resource.initiatorType,
        startTime: resource.startTime,
        duration: resource.duration,
        transferSize: resource.transferSize,
        decodedBodySize: resource.decodedBodySize,
      };
    });
  const maximumPeak = samples.reduce((maximum, sample) => Math.max(maximum, sample.peak), 0);
  const maximumRms = samples.reduce((maximum, sample) => Math.max(maximum, sample.rms), 0);
  const maximumActiveBins = samples.reduce(
    (maximum, sample) => Math.max(maximum, sample.activeBins),
    0,
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    proofMode: "MONOGAME_ISSUE010_PROOF=1",
    gesture,
    audioContext: {
      createdBeforeGesture: true,
      initialState: stateTransitions[0]?.state ?? null,
      stateBeforeGesture,
      stateAfterGestureResume,
      stateAfterResume: context.state,
      transitions: stateTransitions,
      sampleRate: context.sampleRate,
      baseLatency: context.baseLatency,
    },
    signal: {
      kind: "440 Hz oscillator through low-volume GainNode and AnalyserNode to destination",
      gain: 0.015,
      scheduledDurationMilliseconds: 250,
      oscillatorEndedAt,
      sampleCount: samples.length,
      maximumPeak,
      maximumRms,
      maximumActiveBins,
      measurable: maximumPeak > 0.001 && maximumRms > 0.0001 && maximumActiveBins > 0,
      samples,
    },
    monoGame: {
      testsoundResourceRequests: resourceEntries,
      runtimeState: document.documentElement.dataset.runtime ?? null,
      renderedFramesObserved: diagnostics.renderedFramesObserved,
      loadEvidence:
        audioConsole.some((entry) => /Loaded Content\/testsound\.xnb into VFS/.test(String(entry.message)))
          ? "Runtime log directly observed testsound.xnb loaded into VFS before content-loading completion and rendering."
          : "No completed testsound.xnb load message was observed.",
      backendEvidence: audioConsole,
      faudioInitialization: {
        observed: audioConsole.some((entry) => /faudio|openal|alc/i.test(String(entry.message))),
        status: audioConsole.some((entry) => /faudio|openal|alc/i.test(String(entry.message)))
          ? "observed in runtime console"
          : "unproven: no explicit FAudio initialization message was emitted",
        readOnlySourceInspection:
          "The pinned WEB platform SoundEffect implementation has an empty PlatformInitialize and no-op playback methods; it does not expose FAudio initialization evidence.",
      },
      managedSoundEffectPlay: {
        observed: false,
        status: "unproven",
        reason:
          "No policy-safe product-owned managed activation/observation hook exists outside external/MonoGame.",
        remainingGaps: ["issue 014", "issue 040"],
      },
    },
    errors: {
      audio: audioErrors,
      console: [...diagnostics.consoleErrors],
      unhandled: [...diagnostics.unhandledErrors],
    },
    pass:
      gesture.trusted &&
      stateBeforeGesture === "suspended" &&
      gesture.stateAtGesture === "suspended" &&
      context.state === "running" &&
      oscillatorEndedAt !== null &&
      maximumPeak > 0.001 &&
      maximumRms > 0.0001 &&
      maximumActiveBins > 0,
  };
  await context.close().catch((error: unknown) => recordAudioError("context-close", error));
  await invoke("issue010_emit_report", { report: JSON.stringify(report) });
};

void runIssue010Proof().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  void window.__TAURI_INTERNALS__?.invoke("issue010_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: message,
      diagnostics,
    }),
  });
  console.error("Issue 010 proof instrumentation failed", error);
});

const runIssue020Proof = async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue020_is_proof_enabled"))) {
    return;
  }

  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    const snapshot = previewDiagnosticsSnapshot();
    if (
      snapshot.childProof?.ready &&
      snapshot.childProof.autoReadyPing?.message === "preview-context-alive" &&
      !issue020ReadyCheckpointSent
    ) {
      issue020ReadyCheckpointSent = true;
      await invoke("issue020_emit_checkpoint", {
        report: JSON.stringify({
          schemaVersion: 1,
          stage: "auto-ready",
          parentLocation: window.location.href,
          preview: snapshot,
          topLevelRuntimeState: document.documentElement.dataset.runtime ?? null,
          topLevelRenderedFrames: diagnostics.renderedFramesObserved,
          errors: {
            topLevelConsole: diagnostics.consoleErrors,
            topLevelUnhandled: diagnostics.unhandledErrors,
            preview: snapshot.childProof.errors,
          },
        }),
      });
    }
    if (
      snapshot.childProof?.ready &&
      document.documentElement.dataset.runtime === "rendering" &&
      !issue020RenderingCheckpointSent
    ) {
      issue020RenderingCheckpointSent = true;
      await invoke("issue020_emit_checkpoint", {
        report: JSON.stringify({
          schemaVersion: 1,
          stage: "top-level-rendering-regression",
          parentLocation: window.location.href,
          topLevelRenderedFrames: diagnostics.renderedFramesObserved,
          previewRuntimeStarts: snapshot.nestedRuntimeStarts,
          previewErrors: snapshot.childProof.errors,
          topLevelErrors: {
            console: diagnostics.consoleErrors,
            unhandled: diagnostics.unhandledErrors,
          },
        }),
      });
    }
    const ping = snapshot.childProof?.ping;
    if (ping?.trusted === true && !issue020ReportSent) {
      issue020ReportSent = true;
      const resourceUrls = performance.getEntriesByType("resource")
        .map(entry => entry.name)
        .filter(name => /^https?:/i.test(name));
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        proofMode: "MONOGAME_ISSUE020_PROOF=1",
        parent: {
          location: window.location.href,
          realmToken: parentRealmToken,
          topLevelRuntimeState: document.documentElement.dataset.runtime ?? null,
          topLevelRenderedFrames: diagnostics.renderedFramesObserved,
        },
        preview: snapshot,
        diagnostics: {
          topLevelConsoleErrors: diagnostics.consoleErrors,
          topLevelUnhandledErrors: diagnostics.unhandledErrors,
          previewErrors: snapshot.childProof?.errors ?? [],
          externalNetworkRequests: resourceUrls,
        },
      };
      await invoke("issue020_emit_report", { report: JSON.stringify(report) });
      return;
    }
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  throw new Error("Issue 020 proof timed out waiting for a trusted iframe Ping.");
};

void runIssue020Proof().catch((error: unknown) => {
  console.error("Issue 020 proof instrumentation failed", error);
});

void runIssue021AutoProof().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  void window.__TAURI_INTERNALS__?.invoke("issue021_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
        stack: message,
      },
      diagnostics,
    }),
  });
  console.error("Issue 021 proof instrumentation failed", error);
});

void runIssue022AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue022_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 022 proof instrumentation failed", error);
});

installIssue024RunStopControl();
void runIssue023AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue023_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 023 proof instrumentation failed", error);
});
void runIssue024AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue024_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 024 proof instrumentation failed", error);
});
void runIssue025AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue025_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 025 proof instrumentation failed", error);
});
void runIssue027AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue027_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 027 proof instrumentation failed", error);
});

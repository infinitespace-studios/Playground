// Proof frontend entry (Stage 1 of the production/proof split).
//
// This is the compile-time PROOF entry point, selected only when the Vite
// build is invoked with MONOGAME_FRONTEND_PROFILE=proof (see vite.config.ts and
// the `build:proof` / `dev:proof` npm scripts). It preserves the historical
// `main.ts` behavior: it imports and invokes the full per-issue auto-proof
// graph plus the Workbench app, theme, and benchmark instrumentation.
//
// The default PRODUCT build (`entry.product.ts`) must NEVER import this module,
// so the auto-proof environment markers below (MONOGAME_ISSUE0xx_PROOF) stay
// out of the shipping product dist.
import "./style.css";
import { runIssue021AutoProof } from "./issue21";
import { runIssue022AutoProof } from "./issue22";
import { runIssue023AutoProof } from "./issue23";
import { installIssue024RunStopControl, runIssue024AutoProof } from "./issue24";
import { runIssue025AutoProof } from "./issue25";
import { runIssue027AutoProof } from "./issue27";
import { runIssue028AutoProof } from "./issue28";
import { issue029PartialEvidence, runIssue029AutoProof } from "./issue29";
import { runIssue030AutoProof } from "./issue30";
import { runIssue031AutoProof } from "./issue31";
import { runIssue032AutoProof } from "./issue32";
import { runIssue033AutoProof, runIssue033NoWasmEvalProof } from "./issue33";
import { runIssue034AutoProof } from "./issue34";
import { runIssue035AutoProof } from "./issue35";
import { runIssue036AutoProof } from "./issue36";
import { gateFirstRun, runIssue037AutoProof } from "./issue37";
import { runIssue038ForceStopProof } from "./issue38";
import { runIssue039ContentProof } from "./issue039";
import { runIssue040AudioProof } from "./issue040";
import { reportIssue041ShellReady, runIssue041Benchmark } from "./issue041";
import { initTheme } from "./theme-controller";

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
    __TAURI__?: unknown;
    isTauri?: boolean;
    __ISSUE034_EXPECTED_IPC_ERRORS__?: {
      remaining: number;
      observed: string[];
    };
  }
}

const previewFrame = document.querySelector<HTMLIFrameElement>("#preview-frame");
if (!previewFrame) throw new Error("Preview iframe element is missing");

const parentRealmToken = crypto.randomUUID();
let issue020ReportSent = false;
let issue020ReadyCheckpointSent = false;
let issue020RenderingCheckpointSent = false;

const readPreviewProof = (): PreviewFrameProof | null => {
  try {
    const child = previewFrame.contentWindow as
      (Window & { previewProof?: PreviewFrameProof }) | null;
    return child?.previewProof ?? null;
  } catch {
    return null;
  }
};

const previewDiagnosticsSnapshot = () => {
  const child = previewFrame.contentWindow;
  const childProof = readPreviewProof();
  const assetUrl = child
    ? new URL(previewFrame.dataset.src ?? "playground-preview://localhost/index.html")
    : null;
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

  try {
    const result = await originalInstantiateStreaming(nativeResponse, nativeImports);
    diagnostics.wasm.instantiateStreamingSucceeded = true;
    nativeSuccessCallback(result.instance, result.module);
    resolveCompiledModule(result.module);
  } catch (error: unknown) {
    diagnostics.wasm.streamingError = error instanceof Error ? error.message : String(error);
    diagnostics.wasm.bufferFallbackUsed = true;

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

  const compiledModule = new Promise<WebAssembly.Module>((resolve, reject) => {
    resolveCompiledModule = resolve;
    rejectCompiledModule = reject;
  });
  void instantiateNativeRuntime();
  return compiledModule;
}) as typeof WebAssembly.compileStreaming;

window.addEventListener("error", (event) => {
  const message = event.error instanceof Error ? event.error.stack ?? event.error.message : event.message;
  diagnostics.unhandledErrors.push(message);
  document.documentElement.dataset.runtime = "error";
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  diagnostics.unhandledErrors.push(message);
  document.documentElement.dataset.runtime = "error";
});

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const message = args.map(String).join(" ");
  const expectedIpc = window.__ISSUE034_EXPECTED_IPC_ERRORS__;
  if (expectedIpc && expectedIpc.remaining > 0 &&
      /^JSON error: missing field `__TAURI_INVOKE_KEY__` at line 1 column \d+$/
        .test(message)) {
    expectedIpc.remaining -= 1;
    expectedIpc.observed.push(message.slice(0, 160));
    originalConsoleError(...args);
    return;
  }
  diagnostics.consoleErrors.push(message);
  document.documentElement.dataset.runtime = "error";
  originalConsoleError(...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const message = args.map(String).join(" ");
  if (/mime|content[- ]type|streaming compile|arraybuffer instantiation/i.test(message)) {
    diagnostics.mimeWarnings.push(message);
    document.documentElement.dataset.runtime = "error";
  }
  originalConsoleWarn(...args);
};

const originalConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const message = args.map(String).join(" ");

  if (/Draw #\d+: complete/.test(message)) {
    diagnostics.renderedFramesObserved += 1;
    if (diagnostics.consoleErrors.length === 0 && diagnostics.unhandledErrors.length === 0) {
      document.documentElement.dataset.runtime = "rendering";
    }
  }

  originalConsoleLog(...args);
};

interface DotnetHostBuilder {
  withModuleConfig(config: {
    instantiateWasm: (
      imports: WebAssembly.Imports,
      successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) => unknown[];
  }): DotnetHostBuilder;
}

const startMonoGame = async () => {
  const fetchModule = async (path: string) => {
    const response = await fetch(path);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const result = await import(url);
    URL.revokeObjectURL(url);
    return result;
  };

  const { dotnet } = (await fetchModule("/_framework/dotnet.js")) as {
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

  await fetchModule("/main.js");
};

// Issue 052 task-A: the top-level MonoGame demo (issues 007/009/011) renders
// into a `#canvas` element. Issue 45's workbench UI replaced that page and has
// no `#canvas`, so this demo is obsolete there. Auto-run it ONLY when its
// render target exists — otherwise its blob-import loader fails and poisons
// `diagnostics.consoleErrors`/`runtime="error"`, which the packaged proof
// readiness gate and issues 025/027/030's clean-console assertions depend on.
// (Gated off, not removed: the demo code stays for a future reconciliation of
// the top-level-shell proofs. Issues 009/011 are non-exercisable in the
// workbench as a known, pre-existing follow-up.)
if (document.querySelector("#canvas")) {
  void startMonoGame().catch((error: unknown) => {
    console.error("Unable to start packaged MonoGame runtime", error);
  });
}

const runIssue009Proof = async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue009_is_proof_enabled"))) {
    return;
  }

  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  if (!canvas) throw new Error("Issue 009 proof could not find #canvas");
  const status = document.querySelector<HTMLElement>("#runtime-status");
  if (!status) throw new Error("Issue 009 proof could not find #runtime-status");

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

  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  if (!canvas) throw new Error("Issue 011 proof could not find #canvas");

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
void runIssue028AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue028_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 028 proof instrumentation failed", error);
});
void runIssue029AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue029_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      partialEvidence: issue029PartialEvidence,
      diagnostics,
    }),
  });
  console.error("Issue 029 proof instrumentation failed", error);
});
void runIssue030AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue030_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 030 proof instrumentation failed", error);
});
void runIssue031AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue031_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 031 proof instrumentation failed", error);
});
void runIssue032AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue032_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 032 proof instrumentation failed", error);
});
void runIssue033AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue033_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 033 proof instrumentation failed", error);
});
void runIssue033NoWasmEvalProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue033_emit_no_wasm_eval_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 033 no-wasm proof instrumentation failed", error);
});
void runIssue034AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue034_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 034 proof instrumentation failed", error);
});
void runIssue035AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue035_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 035 proof instrumentation failed", error);
});

void runIssue036AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue036_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 036 proof instrumentation failed", error);
});

void runIssue037AutoProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue037_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 037 proof instrumentation failed", error);
});

void runIssue038ForceStopProof().catch((error: unknown) => {
  void window.__TAURI_INTERNALS__?.invoke("issue038_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      diagnostics,
    }),
  });
  console.error("Issue 038 proof instrumentation failed", error);
});

void runIssue039ContentProof().catch((error: unknown) => {
  void (window as any).__TAURI_INTERNALS__?.invoke("issue039_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
    }),
  });
  console.error("Issue 039 proof instrumentation failed", error);
});

void runIssue040AudioProof().catch((error: unknown) => {
  void (window as any).__TAURI_INTERNALS__?.invoke("issue040_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
    }),
  });
  console.error("Issue 040 proof instrumentation failed", error);
});

// Workbench application controller wiring (imported after main module)
import "./app";

// Issue 046: persistent theme + accessibility
initTheme();

// Issue 041: benchmark instrumentation. Shell readiness is reported first so the
// startup sample is never delayed by the later measurement phases.
void reportIssue041ShellReady()
  .then(() => runIssue041Benchmark())
  .catch((error: unknown) => {
    void window.__TAURI_INTERNALS__?.invoke("issue041_emit_report", {
      report: JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        failure: error instanceof Error ? error.message : String(error),
        diagnostics,
      }),
    });
    console.error("Issue 041 benchmark instrumentation failed", error);
  });

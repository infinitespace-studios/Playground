import "./style.css";

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

if (!status || !build || !wasmStatus || !canvas) {
  throw new Error("MonoGame runtime shell elements are missing");
}

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

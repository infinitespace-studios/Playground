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

declare global {
  interface Window {
    __MONOGAME_DIAGNOSTICS__: RuntimeDiagnostics;
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

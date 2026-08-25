import "./style.css";

interface RuntimeBuild {
  buildConfiguration: string;
  monogameCommitSha: string;
  fileCount: number;
}

interface RuntimeDiagnostics {
  consoleErrors: string[];
  unhandledErrors: string[];
  renderedFramesObserved: number;
}

declare global {
  interface Window {
    __MONOGAME_DIAGNOSTICS__: RuntimeDiagnostics;
  }
}

const status = document.querySelector<HTMLElement>("#runtime-status");
const build = document.querySelector<HTMLElement>("#runtime-build");
const canvas = document.querySelector<HTMLCanvasElement>("#canvas");

if (!status || !build || !canvas) {
  throw new Error("MonoGame runtime shell elements are missing");
}

const diagnostics: RuntimeDiagnostics = {
  consoleErrors: [],
  unhandledErrors: [],
  renderedFramesObserved: 0,
};

window.__MONOGAME_DIAGNOSTICS__ = diagnostics;

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

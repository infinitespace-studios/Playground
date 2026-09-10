import { dotnet } from "./_framework/dotnet.js";
import { installPrivatePortBootstrap, sha256 } from "./ProtocolRuntime.js";
import { createCompilerEndpoint } from "./ProtocolEndpoints.js";

// PRODUCT compiler runtime boot.
//
// This module owns the durable, shipping compiler protocol only: boot one
// Release .NET WebAssembly runtime, adopt the private opaque-origin protocol
// port, and drive the retained binary-transfer compile pipeline
// (`CompileAndRetain` → `ConsumeAssembly`/`ConsumePdb` → `AbortRetained`) with
// the binary-integrity envelope (`binaryProof`) intact. It carries NO proof
// instrumentation: no proof-scenario globals, no proof DOM/state, no
// ping/reference/diagnostic buttons, no retention-behavior proof, and no
// proof-mode handshake.
//
// A narrow, product-neutral extension seam lets an optional, separately-loaded
// module observe lifecycle events and supply proof-only bootstrap wiring. The
// seam has no proof markers or issue names; when no extension is present (the
// PRODUCT profile) every hook is an inert no-op and the compiler behaves as the
// plain shipping runtime. The PROOF staging profile deploys the extension,
// which restores exact scenario behavior.

const status = document.querySelector("#status");

// Optional extension attachment point. The PRODUCT build never defines this;
// the PROOF staging profile deploys a module (loaded BEFORE this one) that
// assigns it. `attach(controls)` returns { observe, bootstrap } which the core
// consults at the neutral hook sites below.
const extensionFactory = globalThis.__playgroundCompilerExtension ?? null;
let extension = null;
const observe = new Proxy({}, {
  get(_target, key) {
    return (...args) => extension?.observe?.[key]?.(...args);
  },
});

// Product-neutral readiness signal. The shell's compiler-context reads this to
// confirm exactly one runtime start; it replaces the former proof global.
globalThis.__playgroundCompilerRuntimeStarts = 0;

let protocolPort = null;
let protocolGeneration = null;
let compilerEndpoint = null;

const bootstrapObservations = installPrivatePortBootstrap({
  expectedSource: parent,
  expectedOrigin: window.location.origin,
  // Neutral envelope validation; any proof-specific validation is supplied by
  // the optional extension (product has none).
  validateData: data => extension?.bootstrap?.validateData?.(data) ?? true,
  onPort: (port, data) => {
    if (protocolPort) return;
    protocolGeneration = data.contextGeneration;
    extension?.bootstrap?.onBootstrap?.(data);
    const endpointParams = extension?.bootstrap?.endpointParams?.({
      port,
      contextGeneration: data.contextGeneration,
      portIdentity: bootstrapObservations.portIdentity,
      data,
    }) ?? {};
    protocolPort = port;
    compilerEndpoint = createCompilerEndpoint({
      port,
      execute: executeCompileRequest,
      ...endpointParams,
    });
    protocolPort.addEventListener("message", compilerEndpoint.handle);
    protocolPort.start();
  },
});

async function startRuntime() {
  observe.onStartupAttempt();
  const runtime = await dotnet.create();
  const config = runtime.getConfig();
  const assemblyExports = await runtime.getAssemblyExports(config.mainAssemblyName);
  const exports = assemblyExports.Playground.Compiler.CompilerExports;

  for (const name of ["CompileAndRetain", "ConsumeAssembly", "ConsumePdb", "AbortRetained"]) {
    if (typeof exports[name] !== "function") {
      throw new Error(`Required CompilerExports.${name} JSExport method was not found.`);
    }
  }

  await runtime.runMain();
  globalThis.__playgroundCompilerRuntimeStarts += 1;
  // The optional extension may run an async proof (e.g. the retention-behavior
  // proof) here; awaiting it preserves the exact ordering the proof scenarios
  // rely on (no compile is served until it completes). Product supplies none.
  await extension?.bootstrap?.onRuntimeReady?.({ exports });
  status.dataset.state = "ready";
  status.textContent = "Ready: one .NET WebAssembly compiler runtime is running.";
  observe.onReady({ exports });
  return exports;
}

async function executeCompileRequest(message, observation) {
  const leaseOwner = { compileId: message.payload.compileId, correlationId: message.correlationId };
  try {
    const exports = await exportsPromise;
    const metadata = JSON.parse(exports.CompileAndRetain(
      message.payload.compileId,
      message.correlationId,
      message.payload.assemblyName,
      JSON.stringify({
        protocolVersion: 1,
        sources: message.payload.sources,
        settings: Object.hasOwn(message.payload, "settings")
          ? message.payload.settings
          : undefined,
      }),
    ));
    if (!metadata.success) {
      return {
        result: {
          success: false,
          error: {
            code: metadata.error?.code ?? "COMPILE_FAILED",
            message: metadata.error?.message ?? "Compilation failed.",
            ...(metadata.diagnostics?.length
              ? { diagnostics: metadata.diagnostics }
              : {}),
          },
        },
      };
    }
    const assemblyBytes = await exports.ConsumeAssembly(message.payload.compileId, message.correlationId);
    const pdbBytes = await exports.ConsumePdb(message.payload.compileId, message.correlationId);
    if (!(assemblyBytes instanceof Uint8Array) || !(pdbBytes instanceof Uint8Array)) {
      throw new Error("INTERNAL_ERROR");
    }
    const assembly = new Uint8Array(assemblyBytes).buffer;
    const pdb = new Uint8Array(pdbBytes).buffer;
    if (assembly.byteLength !== metadata.assemblyByteLength ||
        pdb.byteLength !== metadata.pdbByteLength ||
        assembly === pdb) {
      throw new Error("INTERNAL_ERROR");
    }
    const assemblyPre = assembly.byteLength;
    const pdbPre = pdb.byteLength;
    const assemblySha256 = await sha256(assembly);
    const pdbSha256 = await sha256(pdb);
    return {
      result: {
        success: true,
        data: {
          compileId: message.payload.compileId,
          assembly,
          pdb,
          diagnostics: metadata.diagnostics,
          binaryProof: {
            assemblySha256,
            pdbSha256,
            assemblyByteLength: metadata.assemblyByteLength,
            pdbByteLength: metadata.pdbByteLength,
            assemblyName: message.payload.assemblyName,
            sourcePaths: message.payload.sources.map(source => source.path),
            primarySourcePath: message.payload.primarySourcePath,
          },
        },
      },
      transfer: [assembly, pdb],
      afterPost: () => {
        observe.onCompileTransfer({
          compileId: message.payload.compileId,
          correlationId: message.correlationId,
          assemblyPre,
          pdbPre,
          assemblyPost: assembly.byteLength,
          pdbPost: pdb.byteLength,
          assemblySha256,
          pdbSha256,
        });
        observe.onCompileRequest({
          compileId: message.payload.compileId,
          correlationId: message.correlationId,
          measuredRequestBytes: observation.measuredBytes,
          terminalResponses: 1,
        });
      },
    };
  } finally {
    const exports = await exportsPromise;
    const cleared = exports.AbortRetained(leaseOwner.compileId, leaseOwner.correlationId);
    observe.onCompileAbort({ ...leaseOwner, cleared });
  }
}

// Neutral control surface handed to an optional extension. Exposes only what a
// separately-staged module needs to observe the product lifecycle and reach the
// managed exports; it grants no ability to alter the shipping protocol. Product
// builds never define the extension factory, so `extension` stays null and
// every hook is inert.
let exportsPromise = null;
const compilerControls = {
  status,
  get exportsPromise() { return exportsPromise; },
  get compilerEndpoint() { return compilerEndpoint; },
  get bootstrapObservations() { return bootstrapObservations; },
  get protocolGeneration() { return protocolGeneration; },
};
if (typeof extensionFactory === "function") {
  extension = extensionFactory(compilerControls) ?? null;
}

exportsPromise = startRuntime();

try {
  await exportsPromise;
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  observe.onError(message);
  status.dataset.state = "error";
  status.textContent = `Compiler context error: ${message}`;
  console.error(error);
  throw error;
}

import { dotnet } from "./_framework/dotnet.js";

const status = document.querySelector("#status");
const pingButton = document.querySelector("#ping");
const compileButton = document.querySelector("#compile");
const results = document.querySelector("#results");
const proofOutput = document.querySelector("#proof-state");

const proofState = {
  protocolVersion: 1,
  ready: false,
  startupAttempts: 0,
  successfulRuntimeStarts: 0,
  callInProgress: false,
  trustedClickCount: 0,
  pingCalls: [],
  compilations: [],
  error: null,
};

globalThis.compilerProof = proofState;

function renderState() {
  proofOutput.textContent = JSON.stringify(proofState, null, 2);
}

async function startRuntime() {
  proofState.startupAttempts += 1;
  renderState();

  const runtime = await dotnet.create();
  const config = runtime.getConfig();
  const assemblyExports = await runtime.getAssemblyExports(config.mainAssemblyName);
  const exports = assemblyExports.Playground.Compiler.CompilerExports;

  if (typeof exports.Ping !== "function" || typeof exports.Compile !== "function") {
    throw new Error("Required CompilerExports JSExport methods were not found.");
  }

  await runtime.runMain();
  globalThis.compilerProofCompile = requestJson => JSON.parse(exports.Compile(requestJson));
  proofState.successfulRuntimeStarts += 1;
  proofState.ready = true;
  status.dataset.state = "ready";
  status.textContent = "Ready: one .NET WebAssembly runtime is running.";
  pingButton.disabled = false;
  compileButton.disabled = false;
  renderState();

  return exports;
}

const exportsPromise = startRuntime();

pingButton.addEventListener("click", async (event) => {
  if (!beginCall(event)) {
    return;
  }

  status.textContent = "Calling managed compiler context...";
  try {
    const exports = await exportsPromise;
    const proof = JSON.parse(exports.Ping());
    proofState.pingCalls.push({ trusted: event.isTrusted, ...proof });
    appendResult(
      `ping call=${proof.call}; runtime=${proof.runtimeIdentity}; ` +
      `Roslyn=${proof.roslynAssembly} ${proof.roslynAssemblyVersion}; trusted=${event.isTrusted}`);
    status.textContent = "Ping complete: persistent compiler context responded.";
  } catch (error) {
    showError(error);
  } finally {
    endCall();
  }
});

compileButton.addEventListener("click", async (event) => {
  if (!beginCall(event) || proofState.compilations.length >= 2) {
    return;
  }

  status.textContent = "Compiling deterministic valid source in browser WebAssembly...";
  try {
    const exports = await exportsPromise;
    const request = {
      protocolVersion: 1,
      sources: [{ path: "Foo.cs", text: "public class Foo { public int Bar() => 42; }" }],
      settings: {
        languageVersion: "13.0",
        nullable: "disable",
        optimization: "debug",
        allowUnsafe: false,
        warningsAsErrors: false,
      },
    };
    const response = JSON.parse(exports.Compile(JSON.stringify(request)));
    const assemblyBytes = response.assemblyBase64
      ? Uint8Array.from(atob(response.assemblyBase64), character => character.charCodeAt(0))
      : new Uint8Array();
    const pdbBytes = response.pdbBase64
      ? Uint8Array.from(atob(response.pdbBase64), character => character.charCodeAt(0))
      : new Uint8Array();
    const proof = {
      trusted: event.isTrusted,
      ...response,
      assemblyBase64: response.assemblyBase64 ? "[nonempty]" : null,
      pdbBase64: response.pdbBase64 ? "[nonempty]" : null,
      decodedAssemblyByteLength: assemblyBytes.byteLength,
      decodedPdbByteLength: pdbBytes.byteLength,
    };
    proofState.compilations.push(proof);

    if (!response.success) {
      throw new Error(`${response.error?.code ?? "COMPILE_FAILED"}: ${response.error?.message ?? "unknown error"}`);
    }

    appendResult(
      `compile assembly=${response.assemblyName}; DLL=${assemblyBytes.byteLength}; ` +
      `PDB=${pdbBytes.byteLength}; PE/CLI=${response.validity.hasCliHeader}; ` +
      `Foo.Bar=${response.validity.containsExpectedType && response.validity.containsExpectedMethod}; ` +
      `trusted=${event.isTrusted}`);
    status.textContent = proofState.compilations.length < 2
      ? "Compile complete. Activate compile again to prove a unique assembly name."
      : "Compile proof complete: two unique assemblies emitted from one runtime.";
  } catch (error) {
    showError(error);
  } finally {
    endCall();
  }
});

function beginCall(event) {
  if (!proofState.ready || proofState.callInProgress) {
    return false;
  }

  proofState.callInProgress = true;
  pingButton.disabled = true;
  compileButton.disabled = true;
  if (event.isTrusted) {
    proofState.trustedClickCount += 1;
  }
  return true;
}

function endCall() {
  proofState.callInProgress = false;
  if (proofState.ready) {
    pingButton.disabled = false;
    compileButton.disabled = proofState.compilations.length >= 2;
  }
  renderState();
}

function appendResult(text) {
  const item = document.createElement("li");
  item.textContent = text;
  results.append(item);
}

function showError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  proofState.error = message;
  status.dataset.state = "error";
  status.textContent = `Compiler context error: ${message}`;
  console.error(error);
  renderState();
}

try {
  await exportsPromise;
} catch (error) {
  showError(error);
  throw error;
}

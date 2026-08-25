import { dotnet } from "./_framework/dotnet.js";

const status = document.querySelector("#status");
const button = document.querySelector("#ping");
const results = document.querySelector("#results");

const proofState = {
  protocolVersion: 1,
  ready: false,
  startupAttempts: 0,
  successfulRuntimeStarts: 0,
  callInProgress: false,
  trustedClickCount: 0,
  calls: [],
  error: null,
};

globalThis.compilerProof = proofState;

async function startRuntime() {
  proofState.startupAttempts += 1;

  const runtime = await dotnet.create();
  const config = runtime.getConfig();
  const assemblyExports = await runtime.getAssemblyExports(config.mainAssemblyName);
  const ping = assemblyExports.Playground.Compiler.CompilerExports.Ping;

  if (typeof ping !== "function") {
    throw new Error("CompilerExports.Ping JSExport was not found.");
  }

  await runtime.runMain();
  proofState.successfulRuntimeStarts += 1;
  proofState.ready = true;
  status.dataset.state = "ready";
  status.textContent = "Ready: one .NET WebAssembly runtime is running.";
  button.disabled = false;

  return ping;
}

const pingPromise = startRuntime();

button.addEventListener("click", async (event) => {
  if (!proofState.ready || proofState.callInProgress || proofState.calls.length >= 2) {
    return;
  }

  proofState.callInProgress = true;
  button.disabled = true;
  status.textContent = "Calling managed compiler context...";

  try {
    const ping = await pingPromise;
    const proof = JSON.parse(ping());
    const trusted = event.isTrusted;

    if (trusted) {
      proofState.trustedClickCount += 1;
    }

    proofState.calls.push({ trusted, ...proof });

    const item = document.createElement("li");
    item.textContent =
      `call=${proof.call}; runtime=${proof.runtimeIdentity}; ` +
      `Roslyn=${proof.roslynAssembly} ${proof.roslynAssemblyVersion}; ` +
      `type=${proof.roslynCompilationType}; trusted=${trusted}`;
    results.append(item);

    if (proofState.calls.length === 1) {
      status.textContent = "First call complete. Activate once more.";
      button.textContent = "Run second compiler context proof";
      button.disabled = false;
    } else {
      status.textContent = "Complete: two calls returned from one runtime.";
      button.textContent = "Proof complete";
    }
  } catch (error) {
    showError(error);
  } finally {
    proofState.callInProgress = false;
  }
});

function showError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  proofState.error = message;
  proofState.ready = false;
  status.dataset.state = "error";
  status.textContent = `Compiler context error: ${message}`;
  button.disabled = true;
  console.error(error);
}

try {
  await pingPromise;
} catch (error) {
  showError(error);
  throw error;
}

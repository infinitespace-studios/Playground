import { dotnet } from "./_framework/dotnet.js";

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

function render() {
  output.textContent = JSON.stringify(proofState, null, 2);
}

async function sha256(response) {
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function verifyRuntimeAsset() {
  const metadataResponse = await fetch("./preview-build.json");
  if (!metadataResponse.ok) {
    throw new Error(`Preview build metadata returned HTTP ${metadataResponse.status}.`);
  }
  const metadata = await metadataResponse.json();
  const assetResponse = await fetch(metadata.monoGame.runtimeAssetPath);
  if (!assetResponse.ok) {
    throw new Error(`MonoGame runtime asset returned HTTP ${assetResponse.status}.`);
  }
  const runtimeAssetSha256 = await sha256(assetResponse);
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
  await runtime.runMain();
  proofState.successfulRuntimeStarts += 1;
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
  return exports;
}

const exportsPromise = startRuntime();

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

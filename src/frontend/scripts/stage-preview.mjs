import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoIssueNumberedStagedAssets } from "./staged-asset-guard.mjs";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "../..");
const previewRoot = path.join(repositoryRoot, "src/preview");
const publishRoot = path.join(previewRoot, "bin/Release/net9.0/publish/wwwroot");
const outputRoot = path.join(frontendRoot, ".generated-public/preview");
const allowlistPath = path.join(repositoryRoot, "docs/reference-allowlist.json");
const sourceAssembly = path.join(repositoryRoot, "src/compiler/References/MonoGame.Framework.dll");

// Build profile selection. Default is PRODUCT; MONOGAME_FRONTEND_PROFILE=proof
// selects the PROOF staging, which additionally compiles the proof-only
// PreviewExports unit and deploys the proof-only runtime JS/assets. The product
// staging compiles and stages neither, so the shipped preview carries no proof
// export, self-test, fixture, audio probe, issueNN dispatch, or observer.
const rawProfile = process.env.MONOGAME_FRONTEND_PROFILE ?? "product";
if (rawProfile !== "product" && rawProfile !== "proof") {
  throw new Error(`Invalid MONOGAME_FRONTEND_PROFILE="${rawProfile}"; expected "product" or "proof".`);
}
const profile = rawProfile;
const isProof = profile === "proof";

const readJson = async filePath => JSON.parse(await readFile(filePath, "utf8"));
const digest = data => createHash("sha256").update(data).digest("hex");
const allowlist = await readJson(allowlistPath);
const expected = allowlist.assemblies.find(entry => entry.simpleName === "MonoGame.Framework");
if (!expected) {
  throw new Error("docs/reference-allowlist.json does not contain MonoGame.Framework.");
}

// Identity (name/version/publicKeyToken/profile) is the supply-chain check for
// the committed reference assembly; git already guarantees its bytes, so we do
// not additionally pin an exact sha256 that must be hand-resynced on every
// MonoGame managed change.
if (expected.source?.profile !== "Native") {
  throw new Error("Committed MonoGame.Framework allowlist entry is not the Native profile.");
}

const identityOutput = execFileSync(
  "dotnet",
  [
    "run",
    "--project",
    path.join(repositoryRoot, "scripts/ReferenceIdentity/ReferenceIdentity.csproj"),
    "--configuration",
    "Release",
    "--",
    sourceAssembly,
  ],
  { cwd: previewRoot, encoding: "utf8" },
);
const identityLine = identityOutput.split(/\r?\n/).find(line => line.startsWith("{"));
const identity = identityLine ? JSON.parse(identityLine) : null;
if (
  !identity ||
  identity.simpleName !== expected.simpleName ||
  identity.version !== expected.version ||
  identity.publicKeyToken !== expected.publicKeyToken
) {
  throw new Error("Committed MonoGame.Framework PE identity does not match the allowlist.");
}

await rm(path.join(previewRoot, "bin/Release/net9.0/publish"), { recursive: true, force: true });
// Force a clean object graph so a prior profile's compiled proof unit can never
// bleed into this profile's publish output.
await rm(path.join(previewRoot, "obj"), { recursive: true, force: true });
execFileSync(
  "dotnet",
  [
    "publish",
    "Playground.Preview.csproj",
    "--configuration",
    "Release",
    `-p:MonoGamePreviewProfile=${profile}`,
  ],
  { cwd: previewRoot, stdio: "inherit" },
);
await cp(
  path.join(repositoryRoot, "src/shared/ProtocolRuntime.js"),
  path.join(publishRoot, "ProtocolRuntime.js"),
);
await cp(path.join(repositoryRoot, "src/shared/ProtocolEndpoints.js"), path.join(publishRoot, "ProtocolEndpoints.js"));
if (isProof) {
  await cp(
    path.join(repositoryRoot, "src/shared/ProtocolEndpointsProof.js"),
    path.join(publishRoot, "ProtocolEndpointsProof.js"),
  );
}
await cp(
  path.join(repositoryRoot, "src/shared/PreviewStartRuntime.js"),
  path.join(publishRoot, "PreviewStartRuntime.js"),
);
await cp(
  path.join(repositoryRoot, "src/shared/PreviewStopRuntime.js"),
  path.join(publishRoot, "PreviewStopRuntime.js"),
);
await cp(
  path.join(repositoryRoot, "src/shared/NativeOutputRuntime.js"),
  path.join(publishRoot, "NativeOutputRuntime.js"),
);
await cp(
  path.join(repositoryRoot, "src/shared/AssetMountRuntime.js"),
  path.join(publishRoot, "AssetMountRuntime.js"),
);
await cp(
  path.join(repositoryRoot, "src/shared/PreStartAdmission.js"),
  path.join(publishRoot, "PreStartAdmission.js"),
);

const frameworkRoot = path.join(publishRoot, "_framework");
const frameworkFiles = await readdir(frameworkRoot);
const monoGameAssets = frameworkFiles.filter(name => /^MonoGame\.Framework\..*\.wasm$/.test(name));
const requiredFiles = [
  "index.html",
  "preview.js",
  "ProtocolRuntime.js",
  "ProtocolEndpoints.js",
  "PreviewStartRuntime.js",
  "PreviewStopRuntime.js",
  "NativeOutputRuntime.js",
  "AssetMountRuntime.js",
  "PreStartAdmission.js",
  "_framework/dotnet.js",
  "_framework/blazor.boot.json",
];
for (const relativePath of requiredFiles) {
  await readFile(path.join(publishRoot, relativePath));
}

// Profile-scoped contamination guard on the staged preview runtime JS. The
// product build must never publish the proof extension/observer, and its
// preview.js must contain none of the proof export/dispatch symbols; the proof
// build must publish the extension and its required proof symbols.
const PROOF_ONLY_ASSETS = [
  "preview-proof-extension.js",
  "preview-proof-state.js",
  "preview-proof-audio.js",
  "preview-proof-bridge.js",
  "preview-proof-lifecycle.js",
  "preview-no-wasm-eval-observer.js",
  "ProtocolEndpointsProof.js",
];
const FORBIDDEN_PRODUCT_PREVIEW_SYMBOLS = [
  "previewIssue",
  "installIssue040AudioProbe",
  "createProofExpectationRegistry",
  "initializeCompilerProofMode",
  "QueryIssue039State",
  "QueryIssue040AudioState",
  "QueryStoppedGameProof",
  "RunContentValidatorSelfTest",
  "RunAtomicMountSelfTest",
  "Issue034FileSystemProbe",
  "issue040-audio-arm",
];
const REQUIRED_PRODUCT_PREVIEW_SYMBOLS = [
  "executeMountRequest",
  "createPreviewEndpoint",
  "verifyRuntimeAsset",
];
const stagedPreviewJs = await readFile(path.join(publishRoot, "preview.js"), "utf8");
for (const symbol of REQUIRED_PRODUCT_PREVIEW_SYMBOLS) {
  if (symbol && !stagedPreviewJs.includes(symbol)) {
    throw new Error(`Staged preview.js is missing required product symbol "${symbol}" (scan may be vacuous).`);
  }
}
for (const symbol of FORBIDDEN_PRODUCT_PREVIEW_SYMBOLS) {
  if (stagedPreviewJs.includes(symbol)) {
    throw new Error(`Staged product preview.js leaked proof symbol "${symbol}".`);
  }
}
if (isProof) {
  for (const asset of PROOF_ONLY_ASSETS) {
    await readFile(path.join(publishRoot, asset));
  }
  // Non-vacuous per-module proof-surface floor: the Stage 7 domain split moved
  // each proof responsibility into its own proof-only module, so every module
  // must both be staged (above) AND carry its required proof symbol here.
  const proofModuleSymbols = {
    "preview-proof-state.js": ["createProofExpectationRegistry", "previewIssue040Proof"],
    "preview-proof-audio.js": ["installIssue040AudioProbe"],
    "preview-proof-bridge.js": ["Issue034FileSystemProbe", "ANIMATION_FRAME_TIMEOUT"],
    "preview-proof-lifecycle.js": ["QueryStoppedGameProof", "onStopObservation"],
    "preview-proof-extension.js": ["__playgroundPreviewExtension"],
  };
  for (const [asset, symbols] of Object.entries(proofModuleSymbols)) {
    const moduleText = await readFile(path.join(publishRoot, asset), "utf8");
    for (const symbol of symbols) {
      if (!moduleText.includes(symbol)) {
        throw new Error(`Staged proof module ${asset} is missing required proof symbol "${symbol}".`);
      }
    }
  }
} else {
  for (const asset of PROOF_ONLY_ASSETS) {
    let leaked = false;
    try {
      await readFile(path.join(publishRoot, asset));
      leaked = true;
    } catch {
      /* expected: absent in the product staging */
    }
    if (leaked) throw new Error(`Product staging published proof-only asset "${asset}".`);
  }
}
if (monoGameAssets.length < 1) {
  throw new Error(`Expected at least one published MonoGame runtime asset; found ${monoGameAssets.length}.`);
}
if (frameworkFiles.some(name => /aot|worker/i.test(name))) {
  throw new Error("Unexpected AOT/thread worker asset found in the preview publish output.");
}
execFileSync(
  "node",
  [path.join(repositoryRoot, "scripts/inspect-preview-wasm.mjs"), frameworkRoot],
  { cwd: repositoryRoot, stdio: "inherit" },
);

const runtimeAssetRelative = `_framework/${monoGameAssets[0]}`;
const runtimeAssetData = await readFile(path.join(publishRoot, runtimeAssetRelative));
const buildMetadata = {
  schemaVersion: 1,
  configuration: "Release",
  targetFramework: "net9.0",
  runtimeIdentifier: "browser-wasm",
  sdkVersion: execFileSync("dotnet", ["--version"], { cwd: previewRoot, encoding: "utf8" }).trim(),
  runtimeSettings: {
    publishTrimmed: false,
    nativeAot: false,
    runAOTCompilation: false,
    wasmEnableThreads: false,
    wasmBuildNative: true,
    wasmAllowUndefinedSymbols: false,
    wasmOptValidationFeatures: ["threads"],
    finalMemoryShared: false,
    workerAssets: false,
    executionMode: "interpreter",
  },
  monoGame: {
    assemblyName: identity.simpleName,
    assemblyVersion: identity.version,
    sourceAssemblySha256: identity.sha256,
    sourceProfile: expected.source.profile,
    runtimeAssetPath: `./${runtimeAssetRelative}`,
    runtimeAssetSha256: digest(runtimeAssetData),
  },
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(publishRoot, outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, "preview-build.json"), `${JSON.stringify(buildMetadata, null, 2)}\n`);
// Generic fail-closed guard: no issue-numbered implementation filename may
// re-enter the staged preview asset tree (product OR proof).
assertNoIssueNumberedStagedAssets(outputRoot, `${profile} preview staging`);
console.log(`Staged verified Release preview (${profile} profile) with ${monoGameAssets[0]}.`);

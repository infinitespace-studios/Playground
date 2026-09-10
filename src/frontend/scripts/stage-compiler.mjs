import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoIssueNumberedStagedAssets } from "./staged-asset-guard.mjs";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "../..");
const compilerRoot = path.join(repositoryRoot, "src/compiler");
const publishRoot = path.join(compilerRoot, "bin/Release/net9.0/publish/wwwroot");
const outputRoot = path.join(frontendRoot, ".generated-public/compiler");
const digest = data => createHash("sha256").update(data).digest("hex");

// Build profile selection. Default is PRODUCT; MONOGAME_FRONTEND_PROFILE=proof
// selects the PROOF staging, which additionally compiles the proof-only
// CompilerExports unit and deploys the proof-only runtime JS/assets
// (compiler-proof-extension.js, the proof index.html, and the shared proof
// endpoints). The product staging compiles and stages neither, so the shipped
// compiler carries no proof export, retention-behavior proof, handshake, proof
// DOM/state, or interactive proof buttons.
const rawProfile = process.env.MONOGAME_FRONTEND_PROFILE ?? "product";
if (rawProfile !== "product" && rawProfile !== "proof") {
  throw new Error(`Invalid MONOGAME_FRONTEND_PROFILE="${rawProfile}"; expected "product" or "proof".`);
}
const profile = rawProfile;
const isProof = profile === "proof";

const sdkVersion = execFileSync("dotnet", ["--version"], {
  cwd: compilerRoot,
  encoding: "utf8",
}).trim();
if (!/^9\.0\./.test(sdkVersion)) {
  throw new Error(`Compiler staging requires a .NET 9.0.x SDK; found ${sdkVersion}.`);
}

await rm(path.join(compilerRoot, "bin/Release/net9.0/publish"), { recursive: true, force: true });
// Force a clean object graph so a prior profile's compiled proof unit can never
// bleed into this profile's publish output.
await rm(path.join(compilerRoot, "obj"), { recursive: true, force: true });
execFileSync(
  "dotnet",
  [
    "publish",
    "Playground.Compiler.csproj",
    "--configuration",
    "Release",
    `-p:MonoGameCompilerProfile=${profile}`,
  ],
  { cwd: compilerRoot, stdio: "inherit" },
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
  // The proof publish emits index.proof.html (the product index.html is removed
  // from the proof Content set). Rename it to the canonical index.html the
  // compiler frame loads, so only the proof document — which loads the proof
  // extension before the harness — is served for the proof profile.
  await cp(
    path.join(publishRoot, "index.proof.html"),
    path.join(publishRoot, "index.html"),
  );
  await rm(path.join(publishRoot, "index.proof.html"), { force: true });
  await rm(path.join(publishRoot, "index.proof.html.br"), { force: true });
  await rm(path.join(publishRoot, "index.proof.html.gz"), { force: true });
}

const requiredFiles = [
  "index.html",
  "compiler-harness.js",
  "ProtocolRuntime.js",
  "ProtocolEndpoints.js",
  "_framework/dotnet.js",
  "_framework/blazor.boot.json",
];
for (const relativePath of requiredFiles) {
  await readFile(path.join(publishRoot, relativePath));
}

// Profile-scoped contamination guard on the staged compiler runtime JS. The
// product build must never publish the proof extension/shared proof endpoints,
// and its compiler-harness.js must contain none of the proof export/handshake
// symbols; the proof build must publish the extension and its required proof
// symbols. `initializeCompilerProofMode`/`AuthorizeRetentionProof` etc. are the
// proof handshake; the product harness drives only the retained binary transfer.
const PROOF_ONLY_ASSETS = ["compiler-proof-extension.js", "ProtocolEndpointsProof.js"];
const FORBIDDEN_PRODUCT_COMPILER_SYMBOLS = [
  "compilerProof",
  "compilerIssue21Proof",
  "initializeCompilerProofMode",
  "createProofExpectationRegistry",
  "AuthorizeRetentionProof",
  "CompleteRetentionProof",
  "ConfigureNextRetentionTestLease",
  "GetRetentionState",
  "runRetentionBehaviorProof",
  "proof-state",
];
const REQUIRED_PRODUCT_COMPILER_SYMBOLS = [
  "createCompilerEndpoint",
  "executeCompileRequest",
  "CompileAndRetain",
];
const stagedHarnessJs = await readFile(path.join(publishRoot, "compiler-harness.js"), "utf8");
for (const symbol of REQUIRED_PRODUCT_COMPILER_SYMBOLS) {
  if (!stagedHarnessJs.includes(symbol)) {
    throw new Error(`Staged compiler-harness.js is missing required product symbol "${symbol}" (scan may be vacuous).`);
  }
}
for (const symbol of FORBIDDEN_PRODUCT_COMPILER_SYMBOLS) {
  if (stagedHarnessJs.includes(symbol)) {
    throw new Error(`Staged product compiler-harness.js leaked proof symbol "${symbol}".`);
  }
}
const stagedIndexHtml = await readFile(path.join(publishRoot, "index.html"), "utf8");
if (isProof) {
  for (const asset of PROOF_ONLY_ASSETS) {
    await readFile(path.join(publishRoot, asset));
  }
  const extensionJs = await readFile(path.join(publishRoot, "compiler-proof-extension.js"), "utf8");
  for (const symbol of ["initializeCompilerProofMode", "compilerIssue21Proof", "runRetentionBehaviorProof"]) {
    if (!extensionJs.includes(symbol)) {
      throw new Error(`Staged compiler proof extension is missing required proof symbol "${symbol}".`);
    }
  }
  if (!stagedIndexHtml.includes("compiler-proof-extension.js") || !stagedIndexHtml.includes("proof-state")) {
    throw new Error("Staged proof index.html is missing the proof extension script or proof DOM.");
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
  if (stagedIndexHtml.includes("compiler-proof-extension.js") || stagedIndexHtml.includes("proof-state")) {
    throw new Error("Product staged index.html references a proof-only extension/DOM.");
  }
}
const frameworkFiles = await readdir(path.join(publishRoot, "_framework"));
const compilerAssemblies = frameworkFiles.filter(name => /^Playground\.Compiler\..*\.wasm$/.test(name));
if (compilerAssemblies.length < 1) {
  throw new Error(`Expected at least one Playground.Compiler runtime asset; found ${compilerAssemblies.length}.`);
}
if (frameworkFiles.some(name => /worker/i.test(name))) {
  throw new Error("Unexpected worker asset found in the single-threaded compiler output.");
}

const compilerAsset = `_framework/${compilerAssemblies[0]}`;
const compilerBytes = await readFile(path.join(publishRoot, compilerAsset));
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(publishRoot, outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, "compiler-build.json"), `${JSON.stringify({
  schemaVersion: 1,
  configuration: "Release",
  targetFramework: "net9.0",
  runtimeIdentifier: "browser-wasm",
  sdkVersion,
  compilerAsset: `./${compilerAsset}`,
  compilerAssetSha256: digest(compilerBytes),
}, null, 2)}\n`);
// Generic fail-closed guard: no issue-numbered implementation filename may
// re-enter the staged compiler asset tree (product OR proof).
assertNoIssueNumberedStagedAssets(outputRoot, `${profile} compiler staging`);
console.log(`Staged verified Release compiler (${profile} profile) with ${compilerAssemblies[0]}.`);

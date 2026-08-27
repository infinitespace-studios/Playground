import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "../..");
const previewRoot = path.join(repositoryRoot, "src/preview");
const publishRoot = path.join(previewRoot, "bin/Release/net9.0/publish/wwwroot");
const outputRoot = path.join(frontendRoot, ".generated-public/preview");
const allowlistPath = path.join(repositoryRoot, "docs/reference-allowlist.json");
const sourceAssembly = path.join(repositoryRoot, "src/compiler/References/MonoGame.Framework.dll");

const readJson = async filePath => JSON.parse(await readFile(filePath, "utf8"));
const digest = data => createHash("sha256").update(data).digest("hex");
const allowlist = await readJson(allowlistPath);
const expected = allowlist.assemblies.find(entry => entry.simpleName === "MonoGame.Framework");
if (!expected) {
  throw new Error("docs/reference-allowlist.json does not contain MonoGame.Framework.");
}

const sourceData = await readFile(sourceAssembly);
if (digest(sourceData) !== expected.sha256 || expected.source?.profile !== "Native") {
  throw new Error("Committed MonoGame.Framework runtime source does not match Native allowlist provenance.");
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
  identity.publicKeyToken !== expected.publicKeyToken ||
  identity.sha256 !== expected.sha256
) {
  throw new Error("Committed MonoGame.Framework PE identity does not match the allowlist.");
}

execFileSync(
  "dotnet",
  ["publish", "Playground.Preview.csproj", "--configuration", "Release"],
  { cwd: previewRoot, stdio: "inherit" },
);

const frameworkRoot = path.join(publishRoot, "_framework");
const frameworkFiles = await readdir(frameworkRoot);
const monoGameAssets = frameworkFiles.filter(name => /^MonoGame\.Framework\..*\.wasm$/.test(name));
const requiredFiles = ["index.html", "preview.js", "_framework/dotnet.js", "_framework/blazor.boot.json"];
for (const relativePath of requiredFiles) {
  await readFile(path.join(publishRoot, relativePath));
}
if (monoGameAssets.length !== 1) {
  throw new Error(`Expected exactly one published MonoGame runtime asset; found ${monoGameAssets.length}.`);
}
if (frameworkFiles.some(name => /aot|worker/i.test(name))) {
  throw new Error("Unexpected AOT/thread worker asset found in the preview publish output.");
}

const runtimeAssetRelative = `_framework/${monoGameAssets[0]}`;
const runtimeAssetData = await readFile(path.join(publishRoot, runtimeAssetRelative));
const buildMetadata = {
  schemaVersion: 1,
  configuration: "Release",
  targetFramework: "net9.0",
  runtimeIdentifier: "browser-wasm",
  sdkVersion: "9.0.315",
  runtimeSettings: {
    publishTrimmed: false,
    nativeAot: false,
    runAOTCompilation: false,
    wasmEnableThreads: false,
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
console.log(`Staged verified Release preview with ${monoGameAssets[0]}.`);

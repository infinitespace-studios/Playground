import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "../..");
const compilerRoot = path.join(repositoryRoot, "src/compiler");
const publishRoot = path.join(compilerRoot, "bin/Release/net9.0/publish/wwwroot");
const outputRoot = path.join(frontendRoot, ".generated-public/compiler");
const digest = data => createHash("sha256").update(data).digest("hex");

const sdkVersion = execFileSync("dotnet", ["--version"], {
  cwd: compilerRoot,
  encoding: "utf8",
}).trim();
if (sdkVersion !== "9.0.315") {
  throw new Error(`Compiler staging requires .NET SDK 9.0.315; found ${sdkVersion}.`);
}

await rm(path.join(compilerRoot, "bin/Release/net9.0/publish"), { recursive: true, force: true });
execFileSync(
  "dotnet",
  ["publish", "Playground.Compiler.csproj", "--configuration", "Release"],
  { cwd: compilerRoot, stdio: "inherit" },
);
await cp(
  path.join(repositoryRoot, "src/shared/ProtocolRuntime.js"),
  path.join(publishRoot, "ProtocolRuntime.js"),
);
await cp(path.join(repositoryRoot, "src/shared/Issue21Endpoints.js"), path.join(publishRoot, "Issue21Endpoints.js"));

const requiredFiles = [
  "index.html",
  "compiler-harness.js",
  "ProtocolRuntime.js",
  "Issue21Endpoints.js",
  "_framework/dotnet.js",
  "_framework/blazor.boot.json",
];
for (const relativePath of requiredFiles) {
  await readFile(path.join(publishRoot, relativePath));
}
const frameworkFiles = await readdir(path.join(publishRoot, "_framework"));
const compilerAssemblies = frameworkFiles.filter(name => /^Playground\.Compiler\..*\.wasm$/.test(name));
if (compilerAssemblies.length !== 1) {
  throw new Error(`Expected one Playground.Compiler runtime asset; found ${compilerAssemblies.length}.`);
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
console.log(`Staged verified Release compiler with ${compilerAssemblies[0]}.`);

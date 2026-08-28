import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentIndex = process.argv.indexOf("--artifacts-dir");
if (argumentIndex >= 0 && argumentIndex + 1 >= process.argv.length) {
  throw new Error("Usage: verify-preview-native-artifacts.mjs [--artifacts-dir <path>]");
}
const artifactRoot = argumentIndex < 0
  ? path.join(repositoryRoot, "artifacts/monogame")
  : path.resolve(repositoryRoot, process.argv[argumentIndex + 1]);
const manifest = JSON.parse(
  await readFile(path.join(repositoryRoot, "docs/toolchain-manifest.json"), "utf8"),
);
const inventory = JSON.parse(
  await readFile(path.join(repositoryRoot, "docs/monogame-artifacts.json"), "utf8"),
);
const contract = manifest.preview?.nativeBuild;
if (!contract || contract.wasmBuildNative !== true ||
    contract.wasmAllowUndefinedSymbols !== false ||
    contract.wasmEnableThreads !== false) {
  throw new Error("Preview native-build policy is missing or inconsistent.");
}

const provenance = JSON.parse(await readFile(path.join(artifactRoot, "provenance.json"), "utf8"));
const retainedForCurrentCommit =
  provenance.commitSha === inventory.monogameCommitSha &&
  inventory.retainedFor?.commitSha === manifest.monogame.commitSha &&
  typeof inventory.retainedFor?.reason === "string" &&
  inventory.retainedFor.reason.trim().length > 0;
if ((provenance.commitSha !== manifest.monogame.commitSha && !retainedForCurrentCommit) ||
    provenance.emscriptenVersion !== manifest.emscripten.version ||
    provenance.nativeBuildConfiguration !== contract.configuration) {
  throw new Error("Staged native artifact provenance does not match the pinned toolchain.");
}

const expectedNames = contract.archives.map(entry => path.basename(entry.stagedPath)).sort();
const nativeDirectory = path.join(artifactRoot, "native");
const actualNames = (await readdir(nativeDirectory))
  .filter(name => name.endsWith(".a"))
  .sort();
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  throw new Error(
    `Native archive set mismatch; expected ${expectedNames.join(", ")}, found ${actualNames.join(", ")}.`,
  );
}

for (const entry of contract.archives) {
  const bytes = await readFile(path.join(artifactRoot, entry.stagedPath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== entry.byteLength || sha256 !== entry.sha256) {
    throw new Error(`Pinned native artifact identity mismatch: ${entry.stagedPath}.`);
  }
}

console.log(
  `Verified ${contract.archives.length} pinned ${contract.configuration} MonoGame native archives ` +
  `from ${path.relative(repositoryRoot, artifactRoot)}.`,
);

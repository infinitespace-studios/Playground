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
const contract = manifest.preview?.nativeBuild;
if (!contract || contract.wasmBuildNative !== true ||
    contract.wasmAllowUndefinedSymbols !== false ||
    contract.wasmEnableThreads !== false) {
  throw new Error("Preview native-build policy is missing or inconsistent.");
}

// The built artifacts must come from the pinned MonoGame commit and match the
// pinned emscripten version / native build configuration. This provenance
// check is host-independent (unlike per-file hashes) and is the sole native
// artifact identity guarantee.
const provenance = JSON.parse(await readFile(path.join(artifactRoot, "provenance.json"), "utf8"));
if (provenance.commitSha !== manifest.monogame.commitSha ||
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
  // Native archives are not byte-reproducible across build hosts / emsdk and
  // MonoGame versions (ar metadata, embedded paths), so we intentionally do
  // NOT pin their sha256/byteLength. Just confirm each expected archive is
  // present and non-empty; provenance (commit/emscripten/config, checked
  // above) is the host-independent identity guarantee.
  const bytes = await readFile(path.join(artifactRoot, entry.stagedPath));
  if (bytes.byteLength === 0) {
    throw new Error(`Native archive is empty: ${entry.stagedPath}.`);
  }
}

console.log(
  `Verified ${contract.archives.length} ${contract.configuration} MonoGame native archives ` +
  `(present + provenance) from ${path.relative(repositoryRoot, artifactRoot)}.`,
);

import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "../..");
const artifactRoot = path.join(repositoryRoot, "artifacts/monogame");
const outputRoot = path.join(frontendRoot, ".generated-public");

// Files/dirs in the built MonoGame payload that are NOT frontend runtime assets
// and must not be staged into the served public directory:
//  - native/          : the WASM static archives consumed by the preview build,
//                       not the browser runtime.
//  - provenance.json / artifact-hashes.json / monogame-build.json : build
//                       metadata, not runtime assets.
const excludedTopLevel = new Set([
  "native",
  "provenance.json",
  "artifact-hashes.json",
  "monogame-build.json",
]);

const readProvenanceCommit = async () => {
  try {
    const provenance = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        path.join(artifactRoot, "provenance.json"),
        "utf8",
      ),
    );
    return typeof provenance.commitSha === "string" ? provenance.commitSha : null;
  } catch {
    return null;
  }
};

// Recursively collect the runtime files actually produced by the build, so we
// stage whatever the fresh build emitted rather than a frozen (fingerprinted)
// inventory that changes on every emsdk/MonoGame version bump.
const collect = async (dir, relative = "") => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (!relative && excludedTopLevel.has(entry.name)) continue;
    if (entry.isDirectory()) {
      files.push(...(await collect(path.join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
};

const runtimeFiles = (await collect(artifactRoot)).sort();
if (runtimeFiles.length === 0) {
  throw new Error(`No MonoGame runtime files found in ${artifactRoot}; run the build first.`);
}
// Sanity: the browser boot entry points must be present.
for (const required of ["_framework/dotnet.js", "main.js", "index.html"]) {
  if (!runtimeFiles.includes(required)) {
    throw new Error(`Staged MonoGame payload is missing a required boot file: ${required}`);
  }
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const relativePath of runtimeFiles) {
  const destination = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(artifactRoot, relativePath), destination);
}

const buildMetadata = {
  monogameCommitSha: await readProvenanceCommit(),
  fileCount: runtimeFiles.length,
};

await writeFile(
  path.join(outputRoot, "monogame-build.json"),
  `${JSON.stringify(buildMetadata, null, 2)}\n`,
);

console.log(
  `Staged ${runtimeFiles.length} MonoGame runtime files ` +
    `from ${path.relative(repositoryRoot, artifactRoot)}.`,
);

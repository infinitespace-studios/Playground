import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "../..");
const artifactRoot = path.join(repositoryRoot, "artifacts/monogame");
const inventoryPath = path.join(repositoryRoot, "docs/monogame-artifacts.json");
const hashesPath = path.join(artifactRoot, "artifact-hashes.json");
const outputRoot = path.join(frontendRoot, ".generated-public");
const productOwnedFiles = new Set(["index.html", "provenance.json"]);

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const inventory = await readJson(inventoryPath);
const hashes = await readJson(hashesPath);

if (inventory.buildConfiguration !== "Debug" || hashes.buildConfiguration !== "Debug") {
  throw new Error("Issue 007 requires the verified Debug MonoGame payload");
}

const hashByPath = new Map(hashes.files.map((entry) => [entry.path, entry.sha256]));
const runtimeFiles = inventory.requiredFiles.filter((relativePath) => !productOwnedFiles.has(relativePath));

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const relativePath of runtimeFiles) {
  if (
    typeof relativePath !== "string" ||
    relativePath === "" ||
    path.isAbsolute(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    throw new Error(`Unsafe MonoGame runtime path: ${relativePath}`);
  }

  const expectedHash = hashByPath.get(relativePath);
  if (!expectedHash) {
    throw new Error(`Verified hash is missing for ${relativePath}`);
  }

  const source = path.join(artifactRoot, relativePath);
  const data = await readFile(source);
  const actualHash = createHash("sha256").update(data).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`Verified hash changed before staging: ${relativePath}`);
  }

  const destination = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

const buildMetadata = {
  buildConfiguration: inventory.buildConfiguration,
  monogameCommitSha: inventory.monogameCommitSha,
  fileCount: runtimeFiles.length,
};

await writeFile(
  path.join(outputRoot, "monogame-build.json"),
  `${JSON.stringify(buildMetadata, null, 2)}\n`,
);

console.log(
  `Staged ${runtimeFiles.length} verified ${inventory.buildConfiguration} MonoGame runtime files ` +
    `from ${path.relative(repositoryRoot, artifactRoot)}.`,
);

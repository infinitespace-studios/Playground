import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "../..");
const artifactRoot = path.join(repositoryRoot, "artifacts/monogame");
const outputRoot = path.join(frontendRoot, ".generated-public");

// Stage 7 payload cleanup.
//
// The MonoGame Web build under artifacts/monogame/ contains two disjoint kinds
// of output:
//
//   1. The NATIVE static archives (native/mgruntime.a, native/libSDL2.a,
//      native/libFAudio.a). These are the ONLY MonoGame build inputs the
//      shipping product consumes: the preview csproj links them via
//      <NativeFileReference> (MonoGameNativeArtifactPath) to produce the
//      embedded browser-wasm preview runtime. They are verified here and by
//      scripts/verify-monogame-artifacts.sh; the preview build reads them
//      directly from artifacts/monogame/native/, never from the served public
//      directory.
//
//   2. The obsolete top-level BROWSER DEMO payload (_framework/, main.js,
//      index.html, Content/test*, favicon.ico/png). This was the standalone
//      MonoGame `#canvas` demo runtime. Stage 7 removed the last top-level
//      `#canvas` demo from the live frontend: the workbench index.html carries
//      no `#canvas`, and the live source graph imports ONLY compiler/_framework
//      and preview/_framework (each publish stages its own `_framework`). No
//      live module, boot manifest, protocol handler, favicon <link>, or Tauri
//      asset route references the top-level payload. Staging it added ~54 MiB of
//      dead weight (a duplicate ~50 MiB `_framework`, a ~3.6 MiB demo
//      testsound.xnb, and the demo index/main.js/favicons) to the final PRODUCT
//      and PROOF frontend dist. It is therefore NOT staged.
//
// This script is fail-closed: it refuses to produce a staged public directory
// unless the native archives and provenance metadata that prove a real,
// pinned-commit MonoGame build are present.

const REQUIRED_NATIVE_ARCHIVES = ["mgruntime.a", "libSDL2.a", "libFAudio.a"];

const exists = async filePath => {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
};

// Fail closed: the native archives are the real product build input. Missing or
// unreadable archives must abort staging rather than silently emit an empty
// public directory that would later fail the preview native-artifact build.
const nativeRoot = path.join(artifactRoot, "native");
for (const archive of REQUIRED_NATIVE_ARCHIVES) {
  const archivePath = path.join(nativeRoot, archive);
  if (!(await exists(archivePath))) {
    throw new Error(
      `MonoGame native archive is missing: ${path.relative(repositoryRoot, archivePath)}. ` +
        `Run the MonoGame build (scripts/build-monogame.sh) first.`,
    );
  }
}

// Fail closed on provenance: staging must be traceable to the pinned MonoGame
// commit. verify-monogame-artifacts.sh cross-checks this SHA against the
// toolchain manifest; here we require the file to exist and carry a commit SHA
// so a partial/foreign artifact tree cannot be staged.
const provenancePath = path.join(artifactRoot, "provenance.json");
if (!(await exists(provenancePath))) {
  throw new Error(
    `MonoGame artifact provenance is missing: ${path.relative(repositoryRoot, provenancePath)}. ` +
      `Run the MonoGame build first.`,
  );
}
let provenanceCommit = null;
try {
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  provenanceCommit = typeof provenance.commitSha === "string" ? provenance.commitSha : null;
} catch (error) {
  throw new Error(`MonoGame provenance.json is unreadable/invalid: ${error.message}`);
}
if (!provenanceCommit) {
  throw new Error("MonoGame provenance.json is missing a commitSha; refusing to stage.");
}

// Recreate the served public root. stage-monogame runs FIRST in the `stage`
// pipeline, so it owns clearing `.generated-public`; stage-compiler and
// stage-preview then populate their own `compiler/` and `preview/` subtrees.
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

// A small provenance stamp is the only top-level artifact this step emits; the
// obsolete browser demo payload is deliberately not staged.
const buildMetadata = {
  schemaVersion: 2,
  monogameCommitSha: provenanceCommit,
  nativeArchives: [...REQUIRED_NATIVE_ARCHIVES].sort(),
  browserDemoStaged: false,
};
await writeFile(
  path.join(outputRoot, "monogame-build.json"),
  `${JSON.stringify(buildMetadata, null, 2)}\n`,
);

console.log(
  `Verified MonoGame native archives + provenance (commit ${provenanceCommit}); ` +
    `obsolete top-level browser demo payload not staged.`,
);

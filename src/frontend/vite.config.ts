import { defineConfig, type Plugin } from "vite";
import { relative } from "node:path";

// Stage 1 production/proof split.
//
// The frontend build profile is selected AT BUILD TIME (not with a runtime
// flag) via the MONOGAME_FRONTEND_PROFILE environment variable:
//
//   * unset / "product" -> PRODUCT build. Entry is src/entry.product.ts and the
//     output directory is dist/. The auto-proof entry graph is never imported,
//     so its dead proof modules/chunks are not emitted.
//   * "proof"           -> PROOF build. Entry is src/entry.proof.ts (the former
//     main.ts) and the output directory is dist-proof/, keeping proof-only
//     output out of the product dist.
//
// index.html references the product entry by default. For the proof profile a
// build-time HTML transform rewrites that single <script> to the proof entry,
// so exactly one entry graph is compiled per build and no runtime branch leaves
// proof modules bundled in the product output.
//
// Every build additionally emits a machine-readable build manifest
// (profile-manifest.json) INTO its own output directory. The manifest records
// the profile, the resolved entry source, and the ACTUAL Rollup module graph
// (every source module id that survived tree-shaking into the emitted chunks)
// plus the emitted chunk inventory. scripts/check-profile-artifacts.mjs
// requires and validates this manifest, so profile separation is proven from
// the real module graph, not inferred from minified text.

type FrontendProfile = "product" | "proof";

const rawProfile = process.env.MONOGAME_FRONTEND_PROFILE ?? "product";
if (rawProfile !== "product" && rawProfile !== "proof") {
  throw new Error(
    `Invalid MONOGAME_FRONTEND_PROFILE="${rawProfile}"; expected "product" or "proof".`,
  );
}
const profile: FrontendProfile = rawProfile;

const PRODUCT_ENTRY = "/src/entry.product.ts";
const PROOF_ENTRY = "/src/entry.proof.ts";
const PRODUCT_ENTRY_MODULE = "src/entry.product.ts";
const PROOF_ENTRY_MODULE = "src/entry.proof.ts";
const outDir = profile === "proof" ? "dist-proof" : "dist";

// Build manifest schema version. Bump when the manifest shape changes so the
// checker can reject manifests it does not understand.
const MANIFEST_SCHEMA_VERSION = 1;
const MANIFEST_FILENAME = "profile-manifest.json";

// Build-time entry selection: swap the single product <script> for the proof
// entry when (and only when) the proof profile is active. Runs in dev and build
// so `dev`/`dev:proof` and `build`/`build:proof` all resolve the same way.
function selectEntryPlugin(): Plugin {
  return {
    name: "monogame-select-frontend-entry",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (profile !== "proof") return html;
        return html.replace(PRODUCT_ENTRY, PROOF_ENTRY);
      },
    },
  };
}

// Emit the build/profile manifest into the profile's own output directory.
//
// The manifest is derived from the real Rollup bundle in `generateBundle`:
//   * `modules` is the deduplicated set of first-party source module ids
//     (relative to the frontend root) that were actually linked into an emitted
//     chunk. Tree-shaken modules never appear here.
//   * `chunks` records every emitted JS chunk, whether it is an entry chunk,
//     its facade module id, and how many modules it contains.
//   * `entrySource` is the profile's declared entry module; the checker also
//     independently confirms it is present in `modules`.
function emitManifestPlugin(): Plugin {
  return {
    name: "monogame-emit-profile-manifest",
    generateBundle(_options, bundle) {
      const frontendRoot = process.cwd();
      const sourceModules = new Set<string>();
      const chunks: Array<{
        fileName: string;
        isEntry: boolean;
        facadeModuleId: string | null;
        moduleCount: number;
      }> = [];

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") continue;
        const moduleIds = Object.keys(output.modules ?? {});
        for (const moduleId of moduleIds) {
          // Ignore virtual modules (\0-prefixed), absolute-outside-root, and
          // node_modules. Keep only first-party sources under the repo.
          if (moduleId.startsWith("\0")) continue;
          const rel = relative(frontendRoot, moduleId).split("\\").join("/");
          if (rel.startsWith("..")) {
            // A shared source outside the frontend root (e.g. ../../src/shared);
            // record it with a normalized repo-relative form so the inventory is
            // complete but never accidentally matches a src/ allow/deny rule.
            sourceModules.add(rel);
            continue;
          }
          if (rel.includes("node_modules")) continue;
          sourceModules.add(rel);
        }
        chunks.push({
          fileName,
          isEntry: Boolean(output.isEntry),
          facadeModuleId: output.facadeModuleId
            ? relative(frontendRoot, output.facadeModuleId).split("\\").join("/")
            : null,
          moduleCount: moduleIds.length,
        });
      }

      const manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        profile,
        entrySource: profile === "proof" ? PROOF_ENTRY_MODULE : PRODUCT_ENTRY_MODULE,
        outDir,
        // Sorted for stable diffs and deterministic checker output. Do not add
        // wall-clock data here: this manifest is packaged, so it must remain
        // reproducible for identical inputs.
        modules: [...sourceModules].sort(),
        chunks: chunks.sort((a, b) => a.fileName.localeCompare(b.fileName)),
      };

      this.emitFile({
        type: "asset",
        fileName: MANIFEST_FILENAME,
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  publicDir: ".generated-public",
  // Expose the build profile to first-party modules as a statically-replaced
  // boolean. preview-frame.ts uses it to emit a proof-only preview srcdoc
  // (extension module + proof DOM + negative observer) for the PROOF build
  // only; the PRODUCT build's srcdoc references none of them.
  define: {
    __MONOGAME_PREVIEW_PROOF__: JSON.stringify(profile === "proof"),
  },
  plugins: [selectEntryPlugin(), emitManifestPlugin()],
  build: {
    outDir,
    // Empty the profile's own output directory before each build so a rebuild
    // never inherits stale chunks. Product and proof use distinct directories,
    // so a product build cannot resurrect proof-only output.
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});

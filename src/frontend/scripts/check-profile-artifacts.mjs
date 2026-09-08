#!/usr/bin/env node
// Stage 1 production/proof artifact separation check (hardened).
//
// This checker proves the compile-time frontend split holds in the *built*
// output using the machine-readable build manifest that each Vite build stamps
// into its own output directory (profile-manifest.json, emitted by the
// `monogame-emit-profile-manifest` plugin in vite.config.ts). The manifest
// records the profile, the resolved entry source, and the ACTUAL Rollup module
// graph (every first-party source module that survived tree-shaking into the
// emitted chunks). Module-graph exclusion is therefore proven from Rollup, not
// inferred from minified text.
//
// It validates, per profile:
//
//   PRODUCT (dist/):
//     * manifest present, schema known, profile === "product",
//       entrySource === src/entry.product.ts, non-empty module/chunk inventory.
//     * src/entry.product.ts present in the emitted module graph.
//     * src/entry.proof.ts and every proof-only former-direct-import module
//       (issue22/23/25/27..36/38/039/040/041) ABSENT from the module graph.
//     * ZERO auto-proof markers (MONOGAME_ISSUE0xx_PROOF...) in any emitted
//       .js/.html/.css artifact. ANY marker — including the transitional mixed
//       021/024/037 markers — is a HARD FAILURE (no warnings, no downgrades).
//
//   PROOF (dist-proof/):
//     * manifest present, schema known, profile === "proof",
//       entrySource === src/entry.proof.ts, non-empty module/chunk inventory.
//     * src/entry.proof.ts and every proof-only module present in the graph.
//     * src/entry.product.ts ABSENT from the proof graph.
//     * every expected proof marker present in the emitted output.
//
// Anti-drift guards (so regex/inventory drift can never make a check vacuously
// pass): the source marker inventory is scanned from the WHOLE source text (no
// `//` comment truncation) and must meet a minimum count; the expected proof
// marker set must be non-empty and meet a minimum count; and the manifest
// module inventory must be non-empty.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const srcDir = join(frontendRoot, "src");

const MANIFEST_FILENAME = "profile-manifest.json";
const MANIFEST_SCHEMA_VERSION = 1;

const PRODUCT_ENTRY_MODULE = "src/entry.product.ts";
const PROOF_ENTRY_MODULE = "src/entry.proof.ts";

const MARKER_REGEX = /MONOGAME_ISSUE[0-9]+[A-Z_]*_PROOF[A-Z0-9_]*/g;

// Minimum inventory sizes. If a regex/glob edit shrinks these below the floor,
// the check FAILS instead of silently passing on an empty inventory.
const MIN_SOURCE_MARKERS = 15;
const MIN_EXPECTED_PROOF_MARKERS = 15;
const MIN_MODULES = 10;

// Markers that legitimately live ONLY in `//` comments in the frontend source
// (they name an environment variable consumed by shell proof harnesses, not a
// bundled runtime string), so they never reach any emitted chunk. They are kept
// in the source inventory (we do NOT strip comments), documented here, and
// excluded from the "must appear in the proof output" expectation. They are
// still forbidden in the product output like every other marker.
const COMMENT_ONLY_MARKERS = new Set([
  // issue37.ts references `MONOGAME_ISSUE037_PROOF_PHASE=1/2` only in comments;
  // the phase env var is read by scripts/prove-issue037-macos.sh in Rust/shell,
  // not emitted as a frontend string literal.
  "MONOGAME_ISSUE037_PROOF_PHASE",
]);

// Proof-only source modules: the former `main.ts` (now entry.proof.ts) direct
// imports that carry auto-proof instrumentation and must NEVER be linked into
// the product graph. Present in the proof graph, absent from the product graph.
const PROOF_ONLY_MODULES = [
  "src/entry.proof.ts",
  "src/issue22.ts",
  "src/issue23.ts",
  "src/issue25.ts",
  "src/issue27.ts",
  "src/issue28.ts",
  "src/issue29.ts",
  "src/issue30.ts",
  "src/issue31.ts",
  "src/issue32.ts",
  "src/issue33.ts",
  "src/issue34.ts",
  "src/issue35.ts",
  "src/issue36.ts",
  "src/issue38.ts",
  "src/issue039.ts",
  "src/issue040.ts",
  "src/issue041.ts",
];

// Transitional MIXED modules (Stage-2 extraction work). These are still
// transitively imported by the product app graph because product uses their
// controller/gate exports:
//   * issue21.ts  — export used by issue21-controller / app wiring
//   * issue24.ts  — installIssue024RunStopControl (Run/Stop control)
//   * issue37.ts  — gateFirstRun / SCRATCH_PROJECT_IDENTITY (first-run gate)
// They DEFINE proof markers, but the product app graph imports only the product
// exports, so the `runIssueXXXAutoProof` functions carrying the marker strings
// are tree-shaken out of the emitted product bundle. This checker allows these
// modules to appear in the product MODULE GRAPH, but still HARD-FAILS if their
// proof MARKER STRINGS are emitted into any product artifact (see the zero
// marker assertion). Extracting the product code paths out of these modules is
// Stage-2 work.
const MIXED_TRANSITIONAL_MODULES = new Set([
  "src/issue21.ts",
  "src/issue24.ts",
  "src/issue37.ts",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Scan the WHOLE non-test source text (comments included) for markers. No `//`
// truncation: a marker anywhere in runtime source counts toward the inventory.
// Test files are excluded because they are not part of either Vite entry graph.
function scanSourceMarkers(files) {
  const markers = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(MARKER_REGEX)) markers.add(match[0]);
  }
  return markers;
}

const sourceFiles = walk(srcDir).filter((file) => !file.endsWith(".test.ts"));
const sourceInventory = [...scanSourceMarkers(sourceFiles)].sort();

// Expected proof markers = full source inventory minus documented comment-only
// markers. Any new marker added to source flows in here automatically and must
// then appear in the proof output; a new comment-only marker must be documented
// in COMMENT_ONLY_MARKERS or the proof check fails.
const expectedProofMarkers = sourceInventory.filter((m) => !COMMENT_ONLY_MARKERS.has(m));

const errors = [];
function fail(msg) {
  errors.push(msg);
}

// Anti-drift: the inventories must be non-empty and above a sane floor, and
// every documented comment-only marker must actually exist in source (so the
// exclusion list cannot silently mask a real emitted marker).
if (sourceInventory.length < MIN_SOURCE_MARKERS) {
  fail(
    `Source marker inventory too small (${sourceInventory.length} < ${MIN_SOURCE_MARKERS}); ` +
      `MARKER_REGEX may have drifted.`,
  );
}
if (expectedProofMarkers.length < MIN_EXPECTED_PROOF_MARKERS) {
  fail(
    `Expected proof marker set too small (${expectedProofMarkers.length} < ${MIN_EXPECTED_PROOF_MARKERS}).`,
  );
}
for (const m of COMMENT_ONLY_MARKERS) {
  if (!sourceInventory.includes(m)) {
    fail(`COMMENT_ONLY_MARKERS lists ${m}, but it is not found anywhere in source (stale list).`);
  }
}

function readManifest(distDir, expectedProfile) {
  const manifestPath = join(distDir, MANIFEST_FILENAME);
  if (!existsSync(distDir)) {
    fail(`Build output not found: ${distDir} (build the ${expectedProfile} profile first).`);
    return null;
  }
  if (!existsSync(manifestPath)) {
    fail(`Missing ${MANIFEST_FILENAME} in ${distDir} (stale/foreign build?).`);
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    fail(`Malformed ${MANIFEST_FILENAME} in ${distDir}: ${e.message}`);
    return null;
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail(
      `${distDir}/${MANIFEST_FILENAME} schemaVersion ${manifest.schemaVersion} != ${MANIFEST_SCHEMA_VERSION}.`,
    );
    return null;
  }
  if (manifest.profile !== expectedProfile) {
    fail(
      `${distDir}/${MANIFEST_FILENAME} is stamped profile="${manifest.profile}" but ` +
        `${distDir} must be the "${expectedProfile}" profile (cross-profile contamination).`,
    );
    return null;
  }
  if (!Array.isArray(manifest.modules) || manifest.modules.length < MIN_MODULES) {
    fail(
      `${distDir}/${MANIFEST_FILENAME} has malformed/empty module inventory ` +
        `(${Array.isArray(manifest.modules) ? manifest.modules.length : "not an array"}).`,
    );
    return null;
  }
  if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
    fail(`${distDir}/${MANIFEST_FILENAME} has malformed/empty chunk inventory.`);
    return null;
  }
  return manifest;
}

// Marker occurrences in emitted output (.js/.html/.css). Returns Map<marker, rel[]>.
function markersEmittedIn(distDir) {
  const files = walk(distDir).filter(
    (f) => f.endsWith(".js") || f.endsWith(".html") || f.endsWith(".css"),
  );
  const present = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const exactMarkers = new Set(text.match(MARKER_REGEX) ?? []);
    for (const marker of sourceInventory) {
      if (exactMarkers.has(marker)) {
        const rel = file.slice(distDir.length + 1);
        if (!present.has(marker)) present.set(marker, []);
        present.get(marker).push(rel);
      }
    }
  }
  return present;
}

function checkProduct() {
  const distDir = join(frontendRoot, "dist");
  console.log(`PRODUCT check: dist/`);
  const manifest = readManifest(distDir, "product");
  if (!manifest) return;

  const modules = new Set(manifest.modules);

  // Entry assertions.
  if (manifest.entrySource !== PRODUCT_ENTRY_MODULE) {
    fail(`PRODUCT entrySource is "${manifest.entrySource}", expected "${PRODUCT_ENTRY_MODULE}".`);
  }
  if (!modules.has(PRODUCT_ENTRY_MODULE)) {
    fail(`PRODUCT module graph does not contain the product entry ${PRODUCT_ENTRY_MODULE}.`);
  }
  if (modules.has(PROOF_ENTRY_MODULE)) {
    fail(`PRODUCT module graph LEAKS the proof entry ${PROOF_ENTRY_MODULE}.`);
  }

  // Proof-only module absence.
  const leakedModules = PROOF_ONLY_MODULES.filter((m) => modules.has(m));
  if (leakedModules.length > 0) {
    fail(`PRODUCT module graph LEAKS proof-only modules: ${leakedModules.join(", ")}`);
  }

  // Zero markers in emitted output — ANY marker is a hard failure.
  const emitted = markersEmittedIn(distDir);
  console.log(`  module graph: ${manifest.modules.length} modules, ${manifest.chunks.length} chunks`);
  console.log(`  source marker inventory: ${sourceInventory.length}`);
  console.log(`  proof markers found in product output: ${emitted.size}`);
  const mixedPresent = MIXED_TRANSITIONAL_MODULES.size
    ? [...MIXED_TRANSITIONAL_MODULES].filter((m) => modules.has(m))
    : [];
  if (mixedPresent.length > 0) {
    console.log(
      `  note: transitional mixed modules in product graph (markers must stay tree-shaken): ${mixedPresent.join(", ")}`,
    );
  }
  if (emitted.size > 0) {
    for (const [marker, files] of emitted) {
      fail(`PRODUCT output emits proof marker ${marker} in ${files.join(", ")}`);
    }
  }
  if (leakedModules.length === 0 && emitted.size === 0 && !modules.has(PROOF_ENTRY_MODULE)) {
    console.log("  PASS: product graph clean, no proof-only modules, no proof markers.");
  }
}

function checkProof() {
  const distDir = join(frontendRoot, "dist-proof");
  console.log(`PROOF check: dist-proof/`);
  const manifest = readManifest(distDir, "proof");
  if (!manifest) return;

  const modules = new Set(manifest.modules);

  if (manifest.entrySource !== PROOF_ENTRY_MODULE) {
    fail(`PROOF entrySource is "${manifest.entrySource}", expected "${PROOF_ENTRY_MODULE}".`);
  }
  if (!modules.has(PROOF_ENTRY_MODULE)) {
    fail(`PROOF module graph does not contain the proof entry ${PROOF_ENTRY_MODULE}.`);
  }
  if (modules.has(PRODUCT_ENTRY_MODULE)) {
    fail(`PROOF module graph unexpectedly contains the product entry ${PRODUCT_ENTRY_MODULE}.`);
  }

  const missingModules = PROOF_ONLY_MODULES.filter((m) => !modules.has(m));
  if (missingModules.length > 0) {
    fail(`PROOF module graph is missing expected proof-only modules: ${missingModules.join(", ")}`);
  }

  const emitted = markersEmittedIn(distDir);
  const missingMarkers = expectedProofMarkers.filter((m) => !emitted.has(m));
  console.log(`  module graph: ${manifest.modules.length} modules, ${manifest.chunks.length} chunks`);
  console.log(`  expected proof markers: ${expectedProofMarkers.length}`);
  console.log(`  proof markers found: ${emitted.size}`);
  if (missingMarkers.length > 0) {
    fail(`PROOF output missing expected proof markers: ${missingMarkers.join(", ")}`);
  }
  if (missingModules.length === 0 && missingMarkers.length === 0 && modules.has(PROOF_ENTRY_MODULE)) {
    console.log("  PASS: proof graph contains proof entry + proof modules and all expected markers.");
  }
}

const mode = process.argv[2] ?? "both";
if (mode !== "product" && mode !== "proof" && mode !== "both") {
  console.error(`Usage: check-profile-artifacts.mjs [product|proof|both]`);
  process.exit(2);
}
if (mode === "product" || mode === "both") checkProduct();
if (mode === "proof" || mode === "both") checkProof();

if (errors.length > 0) {
  console.error("\nStage 1 artifact separation check FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\nStage 1 artifact separation check passed.");

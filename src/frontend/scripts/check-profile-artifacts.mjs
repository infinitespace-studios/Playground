#!/usr/bin/env node
// Product/proof frontend artifact separation check.
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
//     * src/entry.proof.ts and every proof-only module (the `scenario-toolkit`
//       shared toolkit and the eight proof-* scenario suites) ABSENT from the
//       module graph. Any issue-numbered source module in the product graph is a HARD
//       FAILURE via ISSUE_NUMBERED_MODULE_REGEX; the scenario proof-* modules
//       are enumerated in PROOF_ONLY_MODULES so they are also a HARD FAILURE if
//       they leak into PRODUCT.
//     * the extracted production domain modules (compiler-context, live-preview,
//       run-stop, lifecycle-controller, first-run-warning, plus the Stage-3
//       responsibility-named UI modules: theme-controller, monaco-editor,
//       problems-panel, output-panel, dirty-state, project-manager,
//       preview-panel, project-content) ARE present in the product graph
//       (proves the extraction/rename is real, not dead re-exports).
//     * NO issue-numbered source module (issueNN*.ts) remains in the product
//       module graph — any is a HARD FAILURE (Stage 3).
//     * ZERO auto-proof markers (MONOGAME_ISSUE0xx_PROOF...) in any emitted
//       .js/.html/.css artifact. ANY marker is a HARD FAILURE.
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
const MIN_SOURCE_MARKERS = 12;
const MIN_EXPECTED_PROOF_MARKERS = 12;
const MIN_MODULES = 10;

// Markers that legitimately live ONLY in `//` comments in the frontend source
// (they name an environment variable consumed by shell proof harnesses, not a
// bundled runtime string), so they never reach any emitted chunk. They are kept
// in the source inventory (we do NOT strip comments), documented here, and
// excluded from the "must appear in the proof output" expectation. They are
// still forbidden in the product output like every other marker.
const COMMENT_ONLY_MARKERS = new Set([
  // proof-project-lifecycle.ts (former issue37.ts) references
  // `MONOGAME_ISSUE037_PROOF_PHASE=1/2` only in comments; the phase env var is
  // read by the canonical packaged scenario runner in Rust/shell, not emitted
  // as a frontend string literal.
  "MONOGAME_ISSUE037_PROOF_PHASE",
]);

// Proof-only source modules: modules that carry auto-proof instrumentation and
// must NEVER be linked into the product graph. Present in the proof graph,
// absent from the product graph.
//
// Stage 4 consolidated the many permanent per-issue frontend proof drivers into
// EXACTLY EIGHT durable, responsibility/scenario-named proof suites, each
// exposing a single scenario entrypoint that `entry.proof.ts` dispatches. The
// old issue-numbered drivers (issue22/23/24/25/27/28/29/30/31/32/33/34/35/36/
// 37/039/040/041) were folded into these eight `proof-*` scenario modules,
// preserving every packaged proof marker and Tauri report command verbatim. The
// shared proof runtime toolkit (`scenario-toolkit.ts`) and the shared scenario
// driver (`scenario-runner.ts`) remain proof-only; both are enumerated in
// PROOF_ONLY_MODULES below. Any src/proof-*.ts module is structurally forbidden in
// PRODUCT by PROOF_MODULE_PREFIX_REGEX below, independently of this list.
//
// Stage 5 retired the isolated-window force-stop harness (former issue38.ts and
// its issue38-bridge helper); those modules no longer exist, so they are no
// longer enumerated or asserted present in PROOF.
//
// SCENARIO_MODULES is the CANONICAL, EXACT set of eight durable scenario
// suites: PROOF must contain all eight, PROOF must contain NO other proof-*
// module, and PRODUCT must contain none of them.
const SCENARIO_MODULES = [
  "src/proof-compile-run-stop.ts",
  "src/proof-compiler-diagnostics.ts",
  "src/proof-runtime-exception.ts",
  "src/proof-output.ts",
  "src/proof-content.ts",
  "src/proof-preview-security.ts",
  "src/proof-project-lifecycle.ts",
  "src/proof-performance.ts",
];
const EXPECTED_SCENARIO_COUNT = 8;

// Stage 7 split the oversized shared proof toolkit (`scenario-toolkit.ts`) into
// coherent responsibility support modules. These are NOT `proof-*` scenario
// suites (they carry no scenario entrypoint and must not match the proof-*
// prefix) — they are the shared proof SUPPORT surface the toolkit re-exports:
//   * packaged-proof-readiness.ts    — packaged (Tauri) proof runtime readiness
//                                      / native window activation gate.
//   * persistent-compile-support.ts  — persistent Roslyn compiler + compile-
//                                      buffer support and benchmark preconditions.
//   * embedded-preview-support.ts     — embedded (in-page) opaque-origin preview
//                                      lifecycle (rich runner, no-wasm-eval probe,
//                                      embedded proof-preview context).
// They are proof-only: PROOF must contain all of them, PRODUCT must contain
// none. Enumerating them here makes the split non-vacuously enforced (a leak
// into PRODUCT or a drop from PROOF is a HARD FAILURE) without matching the
// structural proof-* scenario prefix guard.
const PROOF_SUPPORT_MODULES = [
  "src/packaged-proof-readiness.ts",
  "src/persistent-compile-support.ts",
  "src/embedded-preview-support.ts",
];

const PROOF_ONLY_MODULES = [
  "src/entry.proof.ts",
  "src/scenario-toolkit.ts",
  "src/scenario-runner.ts",
  ...PROOF_SUPPORT_MODULES,
  ...SCENARIO_MODULES,
];

// Structural rule (Stage 4): ANY first-party module whose basename matches
// `proof-*.ts` is proof scenario architecture and must NEVER appear in the
// PRODUCT Rollup graph, even if a future proof-* module is added and someone
// forgets to enumerate it. This is a prefix/regex guard independent of
// SCENARIO_MODULES.
const PROOF_MODULE_PREFIX_REGEX = /(^|\/)proof-[a-z0-9-]*\.ts$/i;

// Stage-2 extracted production domain modules. These carry the REAL production
// compiler context, embedded live preview, run/stop lifecycle + control, and
// first-run security gate that used to live inside the mixed issue21/24/37
// modules. They MUST be present in the product module graph (so the extraction
// is proven real), and they must be free of proof markers (asserted by the zero
// marker check like every other product module).
//
// Stage-3 adds the responsibility-named UI modules extracted from the former
// issue-numbered product modules (issue46/047/048/049/050/051/052/052-content):
// theme controller, Monaco editor adapter, Problems/diagnostics panel, Output
// panel, workspace dirty-state protection, folder project manager + project
// identity, embedded preview panel, and project content preparation. They MUST
// be present in the product graph so the renames are proven real (not dead
// facades), and no issue-numbered module may remain in the product graph.
const PRODUCT_DOMAIN_MODULES = [
  "src/compiler-context.ts",
  "src/live-preview.ts",
  "src/run-stop.ts",
  "src/lifecycle-controller.ts",
  "src/first-run-warning.ts",
  "src/theme-controller.ts",
  "src/monaco-editor.ts",
  "src/problems-panel.ts",
  "src/output-panel.ts",
  "src/dirty-state.ts",
  "src/project-manager.ts",
  "src/preview-panel.ts",
  "src/project-content.ts",
];

// Any first-party module whose basename is issue-numbered (issue46.ts,
// issue047.ts, issue051.ts, ...) is historical implementation architecture that
// must NOT survive into the shipping product graph. Stage 3 renamed the last
// product UI modules to responsibility names, so the presence of ANY
// issue-numbered source module in the product Rollup graph is a HARD FAILURE
// (proof-only modules are already forbidden explicitly above; this generic
// guard also catches any future issue module that survives in the Rollup
// manifest).
const ISSUE_NUMBERED_MODULE_REGEX = /(^|\/)issue\d+[a-z0-9-]*\.ts$/i;

// One marker (`MONOGAME_ISSUE037_PROOF_PHASE`) lives only in a source comment
// naming a shell/Rust env var and is never emitted; it is documented in
// COMMENT_ONLY_MARKERS (still forbidden in product, not required in proof).

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

  // Structural Stage-4 guard: NO src/proof-*.ts scenario module may appear in
  // the PRODUCT graph, whether or not it is enumerated above.
  const leakedProofPrefixModules = manifest.modules.filter((m) =>
    PROOF_MODULE_PREFIX_REGEX.test(m),
  );
  if (leakedProofPrefixModules.length > 0) {
    fail(
      `PRODUCT module graph contains proof-* scenario modules (structurally ` +
        `forbidden): ${leakedProofPrefixModules.join(", ")}`,
    );
  }

  // Generic issue-numbered-module guard: no historical issue-numbered source
  // module may remain in the product graph after Stage 3.
  const issueNumberedModules = manifest.modules.filter((m) =>
    ISSUE_NUMBERED_MODULE_REGEX.test(m),
  );
  if (issueNumberedModules.length > 0) {
    fail(
      `PRODUCT module graph contains issue-numbered modules (Stage 3 requires ` +
        `responsibility-named modules): ${issueNumberedModules.join(", ")}`,
    );
  }

  // Stage-2: the extracted production domain modules must be present (proves the
  // real production code paths were extracted out of issue21/24/37, not merely
  // re-exported through dead facades).
  const missingDomainModules = PRODUCT_DOMAIN_MODULES.filter((m) => !modules.has(m));
  if (missingDomainModules.length > 0) {
    fail(
      `PRODUCT module graph is missing extracted production domain modules: ` +
        `${missingDomainModules.join(", ")}`,
    );
  }

  // Zero markers in emitted output — ANY marker is a hard failure.
  const emitted = markersEmittedIn(distDir);
  console.log(`  module graph: ${manifest.modules.length} modules, ${manifest.chunks.length} chunks`);
  console.log(`  source marker inventory: ${sourceInventory.length}`);
  console.log(`  proof markers found in product output: ${emitted.size}`);
  if (emitted.size > 0) {
    for (const [marker, files] of emitted) {
      fail(`PRODUCT output emits proof marker ${marker} in ${files.join(", ")}`);
    }
  }
  if (
    leakedModules.length === 0 &&
    leakedProofPrefixModules.length === 0 &&
    issueNumberedModules.length === 0 &&
    missingDomainModules.length === 0 &&
    emitted.size === 0 &&
    !modules.has(PROOF_ENTRY_MODULE)
  ) {
    console.log(
      "  PASS: product graph clean, no issue-numbered/proof-only/proof-* modules, domain modules present, no proof markers.",
    );
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

  // Stage-4: PROOF must contain EXACTLY the eight durable scenario modules — all
  // eight present, and NO other src/proof-*.ts module (a stray/duplicate proof-*
  // scenario module is a drift failure).
  const scenarioModulesPresent = SCENARIO_MODULES.filter((m) => modules.has(m));
  const missingScenarioModules = SCENARIO_MODULES.filter((m) => !modules.has(m));
  if (missingScenarioModules.length > 0) {
    fail(
      `PROOF module graph is missing required scenario modules: ${missingScenarioModules.join(", ")}`,
    );
  }
  const proofPrefixModules = manifest.modules.filter((m) =>
    PROOF_MODULE_PREFIX_REGEX.test(m),
  );
  const unexpectedScenarioModules = proofPrefixModules.filter(
    (m) => !SCENARIO_MODULES.includes(m),
  );
  if (unexpectedScenarioModules.length > 0) {
    fail(
      `PROOF module graph contains unexpected proof-* modules (only the eight ` +
        `SCENARIO_MODULES are allowed): ${unexpectedScenarioModules.join(", ")}`,
    );
  }
  if (scenarioModulesPresent.length !== EXPECTED_SCENARIO_COUNT) {
    fail(
      `PROOF module graph has ${scenarioModulesPresent.length} scenario modules, ` +
        `expected exactly ${EXPECTED_SCENARIO_COUNT}.`,
    );
  }

  // Explicit retained-harness assertion (Stage 4 keeps the shared scenario
  // toolkit in PROOF). Stage 5 retired the issue38 isolated-window force-stop
  // harness, so it is no longer asserted present.
  if (!modules.has("src/scenario-toolkit.ts")) {
    fail("PROOF module graph is missing the shared proof toolkit src/scenario-toolkit.ts.");
  }

  // Stage 7 explicit assertion: the shared proof SUPPORT modules the toolkit was
  // split into must ALL be present in PROOF (proves the split is real — the
  // toolkit re-exports live code from each, not dead facades).
  const missingSupportModules = PROOF_SUPPORT_MODULES.filter((m) => !modules.has(m));
  if (missingSupportModules.length > 0) {
    fail(
      `PROOF module graph is missing required proof support modules: ` +
        `${missingSupportModules.join(", ")}`,
    );
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
  console.error("\nProduct/proof artifact separation check FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\nProduct/proof artifact separation check passed.");

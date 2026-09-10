// Generic staged-asset filename guard.
//
// Stage 3–7 renamed every shipping implementation module off its historical
// issue number and onto a responsibility name. The Rollup manifest guard in
// check-profile-artifacts.mjs enforces this for the TypeScript module graph, but
// the compiler/preview WASM staging and the packaged (vite) output also copy
// hand-written JS assets (shared endpoints, the no-wasm-eval observer, proof
// extensions) that are NOT in the Rollup manifest. This guard closes that gap:
// it walks a staged output tree and HARD-FAILS if any emitted file basename is
// issue-numbered (e.g. `issue033-negative-observer.js`, `Issue21Endpoints.js`,
// `issue040-fixture.ts`). Active issue-numbered PROOF protocol identifiers live
// in file *contents* (commands/env/report names) and are unaffected — only the
// asset *filename* is checked here.
//
// The check is profile-independent: after the renames, NEITHER the product NOR
// the proof staging carries an issue-numbered asset filename, so applying it to
// every staged tree is the strongest fail-closed posture.

import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

// A basename is issue-numbered when it starts with `issue` (any case) directly
// followed by one or more digits. This matches `issue21.ts`, `issue033-*.js`,
// `Issue21Endpoints.js`, `Issue21EndpointsProof.js`, etc., while never matching
// dotnet/_framework assets (`dotnet.js`, `blazor.boot.json`,
// `MonoGame.Framework.<hash>.wasm`) or vite hashed chunks (`index-<hash>.js`).
export const ISSUE_NUMBERED_ASSET_REGEX = /^issue\d+/i;

// Precompressed sidecar guard (Stage 7 payload cleanup).
//
// A dotnet browser-wasm publish emits, alongside every canonical raw asset
// (`*.wasm`, `*.dat`, `*.js`, `blazor.boot.json`, ...), a Brotli (`*.br`) and a
// gzip (`*.gz`) precompressed copy for HTTP content-negotiation on a static web
// server. The shipping product never negotiates them:
//   * blazor.boot.json / dotnet.js request the CANONICAL raw asset names only
//     (verified: the boot manifest contains no `.gz`/`.br` reference).
//   * The preview is served by the in-process `playground-preview:` custom
//     protocol, which resolves an EXACT path and sets no `Content-Encoding` /
//     `Accept-Encoding` negotiation — it never requests a sidecar.
//   * The compiler ships as normal Tauri asset-protocol files also requested by
//     canonical name.
// So the ~32 MiB of `.gz`/`.br` sidecars across the compiler + preview trees are
// dead weight in the packaged frontend (and, for the preview, in the embedded
// asset map). They are stripped after staging, and this guard fails closed if a
// sidecar ever re-enters a staged tree while the canonical raw assets remain.
export const PRECOMPRESSED_SIDECAR_REGEX = /\.(gz|br)$/i;

// Returns the list of `.gz`/`.br` sidecar relative paths under `stagedDir`.
export function findPrecompressedSidecars(stagedDir) {
  return walkFiles(stagedDir)
    .filter((file) => PRECOMPRESSED_SIDECAR_REGEX.test(basename(file)))
    .map((file) => file.slice(stagedDir.length + 1));
}

// Removes every `.gz`/`.br` sidecar under `stagedDir`. Returns the list of
// removed relative paths (empty when there were none). Fail-closed callers pair
// this with a required-raw-asset presence check so a mistaken glob can never
// delete a canonical asset unnoticed.
export function removePrecompressedSidecars(stagedDir) {
  const removed = findPrecompressedSidecars(stagedDir);
  for (const rel of removed) {
    unlinkSync(join(stagedDir, rel));
  }
  return removed;
}

// Throws if any `.gz`/`.br` sidecar remains under `stagedDir`. `label` names the
// tree for the error message.
export function assertNoPrecompressedSidecars(stagedDir, label) {
  const offenders = findPrecompressedSidecars(stagedDir);
  if (offenders.length > 0) {
    throw new Error(
      `Staged ${label} contains precompressed .gz/.br sidecars (the product never ` +
        `negotiates content-encoding; canonical raw assets are requested directly, so ` +
        `sidecars are dead weight and must not re-enter staged output): ${offenders.join(", ")}`,
    );
  }
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Returns the list of offending relative paths (empty when clean).
export function findIssueNumberedStagedAssets(stagedDir) {
  return walkFiles(stagedDir)
    .filter((file) => ISSUE_NUMBERED_ASSET_REGEX.test(basename(file)))
    .map((file) => file.slice(stagedDir.length + 1));
}

// Throws if any staged asset filename is issue-numbered. `label` names the tree
// (e.g. "product preview staging") for the error message.
export function assertNoIssueNumberedStagedAssets(stagedDir, label) {
  const offenders = findIssueNumberedStagedAssets(stagedDir);
  if (offenders.length > 0) {
    throw new Error(
      `Staged ${label} contains issue-numbered implementation asset filenames ` +
        `(responsibility names required; issue-numbered filenames must not re-enter ` +
        `shipped/staged assets): ${offenders.join(", ")}`,
    );
  }
}

// --- Negative self-test (proves the guard actually rejects a reintroduction) ---
function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "staged-asset-guard-"));
  let passed = 0;
  let failed = 0;
  const ok = (cond, msg) => {
    if (cond) {
      passed++;
      console.log(`  [PASS] ${msg}`);
    } else {
      failed++;
      console.log(`  [FAIL] ${msg}`);
    }
  };
  try {
    // Clean tree (post-rename asset names) must pass.
    const clean = join(root, "clean");
    mkdirSync(join(clean, "_framework"), { recursive: true });
    for (const name of [
      "index.html",
      "preview.js",
      "ProtocolEndpoints.js",
      "ProtocolEndpointsProof.js",
      "preview-no-wasm-eval-observer.js",
      "preview-proof-extension.js",
      "preview-proof-state.js",
      "preview-proof-audio.js",
      "preview-proof-bridge.js",
      "preview-proof-lifecycle.js",
    ]) {
      writeFileSync(join(clean, name), "// staged asset\n");
    }
    writeFileSync(join(clean, "_framework", "dotnet.js"), "//\n");
    writeFileSync(join(clean, "_framework", "MonoGame.Framework.abc123.wasm"), "\0");
    ok(findIssueNumberedStagedAssets(clean).length === 0, "clean post-rename staging passes");
    let threw = false;
    try {
      assertNoIssueNumberedStagedAssets(clean, "clean tree");
    } catch {
      threw = true;
    }
    ok(!threw, "assert does not throw on clean staging");

    // Reintroduced issue-numbered asset (regression) must be rejected.
    for (const bad of [
      "issue033-negative-observer.js",
      "Issue21Endpoints.js",
      "Issue21EndpointsProof.js",
      "issue040-fixture.ts",
    ]) {
      const dir = join(root, `bad-${bad}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), "//\n");
      writeFileSync(join(dir, bad), "// reintroduced issue-numbered asset\n");
      ok(
        findIssueNumberedStagedAssets(dir).some((f) => f === bad),
        `detects reintroduced ${bad}`,
      );
      let rejected = false;
      try {
        assertNoIssueNumberedStagedAssets(dir, "regression tree");
      } catch {
        rejected = true;
      }
      ok(rejected, `assert rejects reintroduced ${bad}`);
    }

    // Nested issue-numbered asset must also be caught.
    const nested = join(root, "nested");
    mkdirSync(join(nested, "sub"), { recursive: true });
    writeFileSync(join(nested, "sub", "issue21.ts"), "//\n");
    ok(
      findIssueNumberedStagedAssets(nested).some((f) => f.endsWith("issue21.ts")),
      "detects nested issue-numbered asset",
    );

    // False-positive guard: a hashed chunk that merely contains "issue" in the
    // middle must NOT be flagged.
    const fp = join(root, "fp");
    mkdirSync(fp, { recursive: true });
    for (const name of ["known-issue-tracker.js", "reissue-9.js", "index-issue.js"]) {
      writeFileSync(join(fp, name), "//\n");
    }
    ok(findIssueNumberedStagedAssets(fp).length === 0, "does not flag non-issue-prefixed names");

    // --- Precompressed sidecar guard ---
    const side = join(root, "sidecars");
    mkdirSync(join(side, "_framework"), { recursive: true });
    // Canonical raw assets that MUST survive.
    const rawAssets = [
      join("_framework", "dotnet.js"),
      join("_framework", "blazor.boot.json"),
      join("_framework", "MonoGame.Framework.abc123.wasm"),
      join("_framework", "corelib.dat"),
    ];
    for (const rel of rawAssets) writeFileSync(join(side, rel), "raw\n");
    // Sidecars that must be stripped.
    const sidecars = [
      join("_framework", "MonoGame.Framework.abc123.wasm.br"),
      join("_framework", "MonoGame.Framework.abc123.wasm.gz"),
      join("_framework", "dotnet.js.gz"),
      join("_framework", "blazor.boot.json.br"),
    ];
    for (const rel of sidecars) writeFileSync(join(side, rel), "compressed\n");
    ok(findPrecompressedSidecars(side).length === 4, "detects all four .gz/.br sidecars");
    let sideThrew = false;
    try {
      assertNoPrecompressedSidecars(side, "pre-strip tree");
    } catch {
      sideThrew = true;
    }
    ok(sideThrew, "assert rejects a tree that still has sidecars");
    const removed = removePrecompressedSidecars(side);
    ok(removed.length === 4, "removePrecompressedSidecars reports 4 removed");
    ok(findPrecompressedSidecars(side).length === 0, "no sidecars remain after removal");
    ok(
      rawAssets.every((rel) => readdirSync(join(side, "_framework")).includes(basename(rel))),
      "all canonical raw assets survive sidecar removal",
    );
    let sideClean = true;
    try {
      assertNoPrecompressedSidecars(side, "post-strip tree");
    } catch {
      sideClean = false;
    }
    ok(sideClean, "assert passes after sidecars stripped");
    // False-positive guard: a raw asset whose name merely contains gz/br in the
    // middle must NOT be flagged.
    const sfp = join(root, "sidecar-fp");
    mkdirSync(sfp, { recursive: true });
    for (const name of ["gzip-helper.js", "brotli.wasm", "browser.js"]) {
      writeFileSync(join(sfp, name), "//\n");
    }
    ok(findPrecompressedSidecars(sfp).length === 0, "does not flag non-sidecar names containing gz/br");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`\nStaged-asset guard self-test: ${passed}/${passed + failed} assertions passed.`);
  if (failed > 0) {
    console.error("Self-test FAILED: the guard is not enforcing correctly.");
    process.exit(1);
  }
  console.log("Self-test passed: issue-numbered staged assets are rejected; clean staging accepted.");
}

if (process.argv[2] === "--self-test") {
  selfTest();
}

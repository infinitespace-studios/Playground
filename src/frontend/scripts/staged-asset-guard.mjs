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

import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

// A basename is issue-numbered when it starts with `issue` (any case) directly
// followed by one or more digits. This matches `issue21.ts`, `issue033-*.js`,
// `Issue21Endpoints.js`, `Issue21EndpointsProof.js`, etc., while never matching
// dotnet/_framework assets (`dotnet.js`, `blazor.boot.json`,
// `MonoGame.Framework.<hash>.wasm`) or vite hashed chunks (`index-<hash>.js`).
export const ISSUE_NUMBERED_ASSET_REGEX = /^issue\d+/i;

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

#!/usr/bin/env node
/**
 * Release package-size gate (PRODUCT-profile, cross-platform, fail-closed).
 *
 * This is a *gate*: it verifies the freshly built release artifacts of the
 * selected profile exist, that the packaged installer/bundle is within the
 * size target, that the staged frontend is the correct profile, and that the
 * currently-implemented content fixtures are present. Any failed REQUIRED check
 * exits non-zero. It never mutates docs and only writes a JSON report when
 * `--report <path>` is given.
 *
 * Design (repairs over the historical issue-043 script):
 *   - PRODUCT profile is the default and the shipping target. PROOF may be
 *     measured explicitly but is never the release gate.
 *   - CROSS-PLATFORM: accepts explicit --binary / --package / --dist inputs and
 *     resolves any of the six release package formats (.dmg/.app, .msi/.exe,
 *     .deb/.AppImage) under a --package-dir. Nothing is hardcoded to macOS or a
 *     single arch.
 *   - NO PROOF EXPECTATION IN PRODUCT: the product artifact legitimately carries
 *     no proof commands; profile integrity is proven from the staged
 *     profile-manifest.json (and, when a macOS .app is supplied, its
 *     CFBundleIdentifier), not by scanning for proof symbols.
 *   - CONTENT FIXTURES: the issue 039/040 content pipeline is IMPLEMENTED; the
 *     durable proof is the committed frontend fixtures/tests. Their presence is
 *     a REQUIRED check, never a false "not yet implemented".
 *   - FAIL-CLOSED: a missing required binary/package, a wrong-profile staged
 *     dist, a missing content fixture, an over-target package, or (where it can
 *     be positively determined) an unstripped Release binary exit non-zero.
 *   - DETERMINISTIC SELF-TESTS: `--self-test` proves the size verdict, profile
 *     integrity, package resolution/measurement, and the aggregate fail-closed
 *     evaluation without requiring a built artifact.
 *
 * Usage:
 *   node scripts/measure-release-size.mjs [--profile product|proof]
 *       [--binary <path>] [--package <path>] [--package-dir <dir>]
 *       [--dist <dir>] [--target <triple>] [--report <path>]
 *   node scripts/measure-release-size.mjs --self-test
 *
 * Back-compat: --dmg <path> is accepted as an alias for --package <path>.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- Size policy (binary MiB) --------------------------------------------

const MIB = 1024 * 1024;
const TARGET_MIB = 100; // hard gate
const STRETCH_MIB = 50; // informational stretch goal

// Recognised release package artifact extensions across the six-platform matrix.
// `.app` is a macOS bundle *directory*; the rest are files.
const PACKAGE_EXTENSIONS = [".dmg", ".app", ".msi", ".exe", ".deb", ".AppImage"];

const PRODUCT_IDENTIFIER = "com.monogame.playground";
const PROOF_IDENTIFIER = "com.monogame.playground.proof";

// --- Argument parsing ----------------------------------------------------

function parseArgs(argv) {
  const args = {
    profile: "product",
    binary: null,
    package: null,
    packageDir: null,
    dist: null,
    target: null,
    report: null,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--self-test") args.selfTest = true;
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--binary") args.binary = argv[++i];
    else if (a === "--package") args.package = argv[++i];
    else if (a === "--dmg") args.package = argv[++i]; // back-compat alias
    else if (a === "--package-dir") args.packageDir = argv[++i];
    else if (a === "--dist") args.dist = argv[++i];
    else if (a === "--target") args.target = argv[++i];
    else if (a === "--report") args.report = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.profile !== "product" && args.profile !== "proof") {
    throw new Error(`--profile must be "product" or "proof" (got "${args.profile}")`);
  }
  return args;
}

// --- Profile-derived default paths ---------------------------------------

function profileDefaults(profile, target) {
  const tauriTarget = join(REPO, "src/desktop/src-tauri/target");
  const releaseRoot = target
    ? join(tauriTarget, target, "release")
    : join(tauriTarget, "release");
  const exeName =
    process.platform === "win32" ? "monogame-playground.exe" : "monogame-playground";
  const binary = join(releaseRoot, exeName);
  const dist = join(REPO, profile === "proof" ? "src/frontend/dist-proof" : "src/frontend/dist");
  const bundleDir = join(releaseRoot, "bundle");
  const expectedId = profile === "proof" ? PROOF_IDENTIFIER : PRODUCT_IDENTIFIER;
  return { releaseRoot, binary, dist, bundleDir, expectedId };
}

// --- Size measurement (pure; self-testable) ------------------------------

// Measures a file OR a bundle directory (e.g. macOS .app). Returns bytes, or
// null when the path is absent (fail-closed: the caller treats null as missing).
function measurePathSize(path) {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (st.isFile()) return st.size;
  if (st.isDirectory()) {
    let total = 0;
    const visit = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) visit(p);
        else if (entry.isFile()) total += statSync(p).size;
      }
    };
    visit(path);
    return total;
  }
  return null;
}

// Resolve the release package artifact. Preference order:
//   1. explicit --package (must exist)
//   2. any recognised package under --package-dir / the profile bundle dir,
//      preferring an installer/compressed artifact, then the host arch token.
function resolvePackage(explicit, searchDir) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  if (!searchDir || !existsSync(searchDir)) return null;
  const found = [];
  const visit = (dir, depth) => {
    if (depth > 4) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      const ext = PACKAGE_EXTENSIONS.find((e) => entry.name.endsWith(e));
      if (ext === ".app" && entry.isDirectory()) {
        found.push(p);
      } else if (ext && ext !== ".app" && entry.isFile()) {
        found.push(p);
      } else if (entry.isDirectory()) {
        visit(p, depth + 1);
      }
    }
  };
  visit(searchDir, 0);
  if (found.length === 0) return null;
  // Prefer a compressed/installer artifact over a raw .app when both exist,
  // then select the host architecture within that class when filenames expose
  // an architecture token.
  const candidates = found.filter((f) => !f.endsWith(".app"));
  const preferredClass = candidates.length > 0 ? candidates : found;
  const hostToken = process.arch === "arm64" ? "aarch64" : "x64";
  const preferred = preferredClass.find((f) => basename(f).includes(hostToken));
  return preferred ?? preferredClass[0];
}

// --- Profile integrity (pure; self-testable) -----------------------------

function readManifestProfile(dist) {
  const p = join(dist, "profile-manifest.json");
  if (!existsSync(p)) return { ok: false, reason: "missing profile-manifest.json" };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    return { ok: false, reason: `malformed profile-manifest.json: ${err.message}` };
  }
  return { ok: true, profile: manifest.profile ?? null, manifest };
}

// Validates that a staged dist is the requested profile. Fail-closed: an absent
// or wrong-profile manifest fails.
function validateDistProfile(dist, expectedProfile) {
  const res = readManifestProfile(dist);
  if (!res.ok) return { ok: false, reason: res.reason };
  if (res.profile !== expectedProfile) {
    return {
      ok: false,
      reason: `staged dist profile="${res.profile}" but expected "${expectedProfile}"`,
    };
  }
  return { ok: true, profile: res.profile };
}

// Reads a macOS .app CFBundleIdentifier (null if not an .app / no plist).
function readBundleIdentifier(pkgPath) {
  if (!pkgPath || !pkgPath.endsWith(".app")) return null;
  const plist = join(pkgPath, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const xml = readFileSync(plist, "utf8");
  const m = xml.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
  return m ? m[1].trim() : null;
}

// --- Size verdict (pure; self-testable) ----------------------------------

function sizeVerdict(compressedMiB) {
  const overTarget = compressedMiB > TARGET_MIB;
  return {
    targetMiB: TARGET_MIB,
    stretchGoalMiB: STRETCH_MIB,
    measuredMiB: Number(compressedMiB.toFixed(2)),
    meetsStretch: compressedMiB <= STRETCH_MIB,
    verdict: overTarget ? "FAIL" : "PASS",
    waiverNeeded: overTarget,
  };
}

// --- Content fixtures (implemented; committed proof) ---------------------

const CONTENT_FIXTURES = [
  {
    name: "content-validation",
    desc: "Texture2D/XNB content validation",
    file: "src/frontend/src/content-validation.test.ts",
  },
  {
    name: "audio-content",
    desc: "SoundEffect PCM validation + playback contract",
    file: "src/frontend/src/audio-content.test.ts",
  },
  {
    name: "audio-content-fixture",
    desc: "Committed WAV→XNB fixture builder",
    file: "src/frontend/src/audio-content-fixture.ts",
  },
];

function contentFixtureStatus(repo = REPO) {
  return CONTENT_FIXTURES.map((f) => {
    const ok = existsSync(join(repo, f.file));
    return { ...f, ok, note: ok ? "implemented (committed fixture/test present)" : "MISSING" };
  });
}

// --- Debug-symbol check (best-effort, cross-platform) --------------------

// Returns { stripped: bool|null, detail }. `null` means "could not determine on
// this platform"; only a POSITIVE determination that symbols are present fails
// the gate (fail-closed but not falsely-failing on platforms we cannot inspect).
function checkDebugSymbols(binary) {
  if (!binary || !existsSync(binary)) return { stripped: null, detail: "binary absent" };
  const dsym = binary + ".dSYM";
  if (existsSync(dsym)) return { stripped: false, detail: `sidecar .dSYM present: ${dsym}` };
  // `file` exists on macOS/Linux; absent/failing on Windows → indeterminate.
  try {
    const out = execFileSync("file", [binary], { encoding: "utf8", timeout: 30_000 });
    if (/with debug_info|not stripped/.test(out)) {
      return { stripped: false, detail: out.trim() };
    }
    if (/stripped/.test(out)) return { stripped: true, detail: out.trim() };
    return { stripped: null, detail: `indeterminate: ${out.trim()}` };
  } catch {
    return { stripped: null, detail: "`file` unavailable on this platform" };
  }
}

// --- Aggregate evaluation (pure; self-testable) --------------------------

// Given already-measured inputs, produce the ordered failure list. This is the
// single fail-closed decision point shared by main() and the self-test.
function evaluateRelease(input) {
  const failures = [];

  if (!input.binaryExists) {
    failures.push(`required release binary missing: ${input.binaryPath}`);
  }

  if (input.packageSizeBytes == null) {
    failures.push(
      `required release package missing (looked for ${PACKAGE_EXTENSIONS.join("/")}` +
        `${input.packageHint ? ` under ${input.packageHint}` : ""})`,
    );
  } else {
    const verdict = sizeVerdict(input.packageSizeBytes / MIB);
    if (verdict.verdict === "FAIL") {
      failures.push(`package ${verdict.measuredMiB} MiB exceeds ${TARGET_MIB} MiB target`);
    }
  }

  if (!input.distProfile.ok) {
    failures.push(`staged dist profile integrity failed: ${input.distProfile.reason}`);
  }

  if (input.bundleIdentity && input.bundleIdentity.mismatch) {
    failures.push(
      `bundle identity mismatch: CFBundleIdentifier "${input.bundleIdentity.actual}" ` +
        `!= expected "${input.bundleIdentity.expected}"`,
    );
  }

  for (const f of input.fixtures) {
    if (!f.ok) failures.push(`content fixture missing: ${f.file}`);
  }

  // Only a POSITIVE "not stripped" determination fails the gate.
  if (input.debug && input.debug.stripped === false) {
    failures.push(`Release binary is not stripped: ${input.debug.detail}`);
  }

  return failures;
}

// --- Self-test -----------------------------------------------------------

function selfTest() {
  console.log("Self-test: proving the size gate, profile integrity, and package logic are real.\n");
  let pass = 0;
  let fail = 0;
  const assert = (cond, label) => {
    if (cond) {
      pass += 1;
      console.log(`  [PASS] ${label}`);
    } else {
      fail += 1;
      console.log(`  [FAIL] ${label}`);
    }
  };

  // (1) Size verdict boundaries.
  assert(sizeVerdict(40).verdict === "PASS" && sizeVerdict(40).meetsStretch, "40 MiB passes and meets stretch");
  assert(sizeVerdict(80).verdict === "PASS" && !sizeVerdict(80).meetsStretch, "80 MiB passes target, not stretch");
  assert(sizeVerdict(100).verdict === "PASS", "exactly 100 MiB passes (boundary)");
  assert(sizeVerdict(100.01).verdict === "FAIL" && sizeVerdict(100.01).waiverNeeded, "over 100 MiB fails closed");

  // (2) Content fixtures are implemented (present), never falsely unimplemented.
  const fixtures = contentFixtureStatus();
  assert(fixtures.length === 3, "three content fixtures are tracked");
  assert(fixtures.every((f) => f.ok), "all content fixtures present (implemented, not 'not yet implemented')");
  assert(fixtures.every((f) => f.note !== "not yet implemented"), "no fixture falsely marked unimplemented");

  const tmp = mkdtempSync(join(tmpdir(), "relsize-"));
  try {
    // (3) Package resolution + size measurement (file + directory bundle).
    assert(resolvePackage(null, join(tmp, "nope")) === null, "absent package dir → null (no throw)");
    assert(resolvePackage("/no/such/file.dmg", null) === null, "explicit missing package → null");

    const bundleDir = join(tmp, "bundle", "dmg");
    mkdirSync(bundleDir, { recursive: true });
    const dmg = join(bundleDir, "MonoGame Playground_0.1.0_aarch64.dmg");
    writeFileSync(dmg, Buffer.alloc(1234));
    assert(resolvePackage(null, join(tmp, "bundle")) === dmg, "resolves a .dmg under the search dir");
    assert(measurePathSize(dmg) === 1234, "file size measured exactly");

    const app = join(tmp, "bundle", "macos", "MonoGame Playground.app");
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    writeFileSync(join(app, "Contents", "MacOS", "monogame-playground"), Buffer.alloc(2000));
    writeFileSync(join(app, "Contents", "Info.plist"), Buffer.alloc(48));
    assert(measurePathSize(app) === 2048, "directory bundle size summed recursively");
    assert(measurePathSize(join(tmp, "gone")) === null, "absent path → null size");

    // (4) Profile-manifest integrity (match / mismatch / missing / malformed).
    const productDist = join(tmp, "dist");
    mkdirSync(productDist, { recursive: true });
    writeFileSync(join(productDist, "profile-manifest.json"), JSON.stringify({ profile: "product", modules: [] }));
    assert(validateDistProfile(productDist, "product").ok, "product manifest accepted for product");
    assert(!validateDistProfile(productDist, "proof").ok, "product manifest rejected for proof (wrong profile)");
    assert(!validateDistProfile(join(tmp, "missing-dist"), "product").ok, "missing manifest rejected");
    const badDist = join(tmp, "bad-dist");
    mkdirSync(badDist, { recursive: true });
    writeFileSync(join(badDist, "profile-manifest.json"), "{ not json");
    assert(!validateDistProfile(badDist, "product").ok, "malformed manifest rejected");

    // (5) Bundle identity from a .app plist.
    const proofApp = join(tmp, "Proof.app");
    mkdirSync(join(proofApp, "Contents"), { recursive: true });
    writeFileSync(
      join(proofApp, "Contents", "Info.plist"),
      `<key>CFBundleIdentifier</key>\n<string>${PROOF_IDENTIFIER}</string>`,
    );
    assert(readBundleIdentifier(proofApp) === PROOF_IDENTIFIER, "reads CFBundleIdentifier from .app plist");
    assert(readBundleIdentifier(dmg) === null, "non-.app package → null identifier");

    // (6) Aggregate fail-closed evaluation.
    const okInput = {
      binaryExists: true,
      binaryPath: "/x/bin",
      packageSizeBytes: 40 * MIB,
      packageHint: null,
      distProfile: { ok: true, profile: "product" },
      bundleIdentity: null,
      fixtures: contentFixtureStatus(),
      debug: { stripped: true, detail: "stripped" },
    };
    assert(evaluateRelease(okInput).length === 0, "clean inputs → zero failures (PASS)");
    assert(
      evaluateRelease({ ...okInput, binaryExists: false }).some((f) => f.includes("binary missing")),
      "missing binary fails closed",
    );
    assert(
      evaluateRelease({ ...okInput, packageSizeBytes: null }).some((f) => f.includes("package missing")),
      "missing package fails closed",
    );
    assert(
      evaluateRelease({ ...okInput, packageSizeBytes: 101 * MIB }).some((f) => f.includes("exceeds")),
      "over-target package fails closed",
    );
    assert(
      evaluateRelease({ ...okInput, distProfile: { ok: false, reason: "wrong" } }).some((f) =>
        f.includes("profile integrity"),
      ),
      "wrong-profile dist fails closed",
    );
    assert(
      evaluateRelease({
        ...okInput,
        bundleIdentity: { mismatch: true, actual: PROOF_IDENTIFIER, expected: PRODUCT_IDENTIFIER },
      }).some((f) => f.includes("identity mismatch")),
      "wrong bundle identity fails closed",
    );
    assert(
      evaluateRelease({
        ...okInput,
        fixtures: [{ ok: false, file: "src/frontend/src/audio-content-fixture.ts" }],
      }).some((f) => f.includes("content fixture missing")),
      "missing content fixture fails closed",
    );
    assert(
      evaluateRelease({ ...okInput, debug: { stripped: false, detail: "with debug_info" } }).some((f) =>
        f.includes("not stripped"),
      ),
      "unstripped binary fails closed",
    );
    assert(
      evaluateRelease({ ...okInput, debug: { stripped: null, detail: "indeterminate" } }).length === 0,
      "indeterminate strip state does NOT fail (no false failure)",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nSelf-test: ${pass}/${pass + fail} assertions passed.`);
  if (fail > 0) {
    console.error("Self-test FAILED.");
    process.exit(1);
  }
  console.log("Self-test passed: size gate + profile integrity + package logic are real and fail-closed.");
}

// --- Main ----------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
    return;
  }

  const defaults = profileDefaults(args.profile, args.target);
  const binaryPath = args.binary || defaults.binary;
  const dist = args.dist || defaults.dist;
  const packageHint = args.package || args.packageDir || defaults.bundleDir;

  console.log(`=== Release package-size gate (profile: ${args.profile}) ===\n`);

  const binaryExists = existsSync(binaryPath);
  const binarySizeBytes = binaryExists ? statSync(binaryPath).size : null;
  console.log(
    `[1] Release binary: ${binaryExists ? (binarySizeBytes / MIB).toFixed(2) + " MiB" : "MISSING"}` +
      `\n    ${binaryPath.replace(REPO + "/", "")}`,
  );

  const pkgPath = resolvePackage(args.package, args.packageDir || defaults.bundleDir);
  const packageSizeBytes = pkgPath ? measurePathSize(pkgPath) : null;
  if (pkgPath && packageSizeBytes != null) {
    console.log(
      `[2] Release package: ${(packageSizeBytes / MIB).toFixed(2)} MiB` +
        `\n    ${pkgPath.replace(REPO + "/", "")}`,
    );
  } else {
    console.log(`[2] Release package: MISSING (searched ${packageHint.replace(REPO + "/", "")})`);
  }

  const distProfile = validateDistProfile(dist, args.profile);
  console.log(
    `[3] Staged dist profile: ${distProfile.ok ? distProfile.profile : "INVALID — " + distProfile.reason}` +
      `\n    ${dist.replace(REPO + "/", "")}`,
  );

  const actualId = readBundleIdentifier(pkgPath);
  const bundleIdentity =
    actualId != null
      ? { mismatch: actualId !== defaults.expectedId, actual: actualId, expected: defaults.expectedId }
      : null;
  console.log(
    `[4] Bundle identity: ${
      actualId == null ? "n/a (no .app plist)" : actualId + (bundleIdentity.mismatch ? " (MISMATCH)" : " (ok)")
    }`,
  );

  const fixtures = contentFixtureStatus();
  console.log("[5] Content validation fixtures (issues 039/040 — implemented):");
  for (const f of fixtures) console.log(`    ${f.name}: ${f.ok ? "present" : "MISSING"} — ${f.desc}`);

  const debug = checkDebugSymbols(binaryPath);
  console.log(
    `[6] Debug symbols: ${
      debug.stripped === true ? "stripped" : debug.stripped === false ? "NOT stripped" : "indeterminate"
    } (${debug.detail})`,
  );

  const verdict = packageSizeBytes != null ? sizeVerdict(packageSizeBytes / MIB) : null;
  if (verdict) {
    console.log(
      `[7] Size verdict: ${verdict.measuredMiB} MiB / ${TARGET_MIB} MiB target → ${verdict.verdict}` +
        (verdict.waiverNeeded ? " (WAIVER NEEDED)" : "") +
        (verdict.meetsStretch ? ` (meets ${STRETCH_MIB} MiB stretch goal)` : ""),
    );
  }

  const failures = evaluateRelease({
    binaryExists,
    binaryPath,
    packageSizeBytes,
    packageHint: packageHint.replace(REPO + "/", ""),
    distProfile,
    bundleIdentity,
    fixtures,
    debug,
  });

  if (args.report) {
    const report = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      profile: args.profile,
      binary: { path: binaryPath, exists: binaryExists, sizeBytes: binarySizeBytes },
      package: pkgPath ? { path: pkgPath, sizeBytes: packageSizeBytes } : null,
      dist: { path: dist, profile: distProfile },
      bundleIdentity,
      contentFixtures: fixtures,
      debugSymbols: debug,
      sizeVerdict: verdict,
      passed: failures.length === 0,
      failures,
    };
    const reportPath = resolve(args.report);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`\n[8] Report written: ${reportPath.replace(REPO + "/", "")}`);
  }

  if (failures.length > 0) {
    console.error("\nRelease size gate FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nRelease size gate passed.");
}

main();

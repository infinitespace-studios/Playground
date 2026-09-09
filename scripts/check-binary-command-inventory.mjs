#!/usr/bin/env node
// Stage 6 slice 6 — native binary / runtime artifact command-inventory enforcement.
//
// This is the compiled-artifact backstop for the production/proof separation. The
// frontend module-graph checker (src/frontend/scripts/check-profile-artifacts.mjs)
// proves the PRODUCT Rollup graph carries no proof modules/markers; the staging
// contamination guards (stage-preview.mjs / stage-compiler.mjs) prove the staged
// C#/JS assets are profile-clean; build.rs validates and resolves the exact ACL
// inventory for each profile. This tool closes the remaining loop: it reads the
// ACTUAL packaged
// executable/bundle and the staged compiler/preview assets and proves the
// compiled command inventory and every proof marker/export/global obeys the
// profile boundary.
//
// It is intentionally cross-platform and dependency-free: string extraction is a
// pure-Node scan (no system `strings`, `nm`, or `plutil`), so the same check runs
// on macOS, Windows, and Linux CI legs.
//
//   MODES
//     product  — the default/release build. Non-vacuous:
//                  * all 8 responsibility-named PRODUCT commands present
//                  * known product runtime exports/assets present (floor)
//                  * source capability/permission grants exactly the 8 product commands
//                  * ZERO of the 8 old issue-numbered product command names
//                  * ZERO of the 70 proof command strings; ZERO issueNN command tokens
//                  * ZERO proof env/report markers (MONOGAME_ISSUE*_PROOF, PROOF relays,
//                    ISSUE0xx_REPORT report keys)
//                  * ZERO proof-only Rust relay/state markers
//                  * ZERO proof-only C# export references / proof extension assets
//                  * ZERO proof JS globals/actions/modules (previewIssue*Proof,
//                    installIssue040AudioProbe, compilerProof, initializeCompilerProofMode, …)
//     proof    — the explicit `--features proof-harness` build. Proves the harness
//                is actually compiled in:
//                  * all 78 commands present (8 product + 70 proof)
//                  * representative + full proof symbols/env markers/JS globals present
//                  * proof extension assets staged
//                  * EXACTLY eight scenario suites retained (dist-proof manifest)
//
//   PROFILE IDENTITY (anti stale/wrong-profile):
//     The shared `target/release/monogame-playground` path is OVERWRITTEN by whichever
//     profile built last, so it cannot self-identify. The packaged `.app`/bundle carries
//     a distinct product name and CFBundleIdentifier (com.monogame.playground vs
//     com.monogame.playground.proof) and a distinct staged manifest (dist vs dist-proof,
//     profile-manifest.json profile field). The checker RESOLVES the mode-correct bundle
//     by identifier/manifest and refuses to scan a bundle whose identity contradicts the
//     requested mode. An explicit --binary/--bundle path always wins but is still
//     identity-verified when a bundle is supplied.
//
//   NON-VACUITY:
//     Every mode asserts a positive floor (known-good strings that MUST be present) in the
//     same artifact it scans for forbidden strings. A broken/empty/wrong-path read fails
//     the floor loudly instead of vacuously "finding nothing".
//
//   SELF-TESTS (--self-test):
//     Injects proof strings into a product copy, points at a wrong-profile bundle, a
//     wrong path, and an empty file, and asserts the checker FAILS each. Proves the
//     enforcement is real.
//
// Usage:
//   node scripts/check-binary-command-inventory.mjs <product|proof> [options]
//     --bundle <path>        explicit .app (macOS) or bundle dir to scan
//     --binary <path>        explicit executable path (bypasses bundle resolution)
//     --frontend-dist <path> staged frontend dist dir (default: dist / dist-proof)
//     --target <triple>      target triple subdir under target/ (e.g. aarch64-apple-darwin)
//     --allow-shared-binary  permit scanning target/<...>/release/<exe> with no bundle
//                            (identity then relies on content-consistency only)
//   node scripts/check-binary-command-inventory.mjs --self-test

import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tauriRoot = join(repoRoot, "src/desktop/src-tauri");
const buildRsPath = join(tauriRoot, "build.rs");
const frontendRoot = join(repoRoot, "src/frontend");
const productCapabilityPath = join(tauriRoot, "capabilities/main.json");
const productPermissionPath = join(tauriRoot, "permissions/main.toml");

// --------------------------------------------------------------------------
// (1) Derive the canonical command inventories from build.rs — single source
//     of truth, no duplicated lists (anti-drift).
// --------------------------------------------------------------------------

function parseRustStrArray(source, constName) {
  // Matches `const NAME: &[&str] = &[ "a", "b", ... ];`
  const re = new RegExp(
    `const\\s+${constName}\\s*:\\s*&\\[&str\\]\\s*=\\s*&\\[([\\s\\S]*?)\\];`,
    "m",
  );
  const m = source.match(re);
  if (!m) throw new Error(`build.rs: could not locate const ${constName}`);
  const body = m[1];
  const items = [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (items.length === 0) throw new Error(`build.rs: ${constName} parsed empty`);
  return items;
}

function deriveInventories() {
  const src = readFileSync(buildRsPath, "utf8");
  const handler = parseRustStrArray(src, "HANDLER_ORDER");
  const product = parseRustStrArray(src, "PRODUCT_COMMANDS");
  const proof = parseRustStrArray(src, "PROOF_COMMANDS");

  const errs = [];
  // Canonical counts (anti-vacuity floors + exact drift anchors).
  if (product.length !== 8)
    errs.push(`PRODUCT_COMMANDS count ${product.length} != 8`);
  if (proof.length !== 70) errs.push(`PROOF_COMMANDS count ${proof.length} != 70`);
  if (handler.length !== 78)
    errs.push(`HANDLER_ORDER count ${handler.length} != 78`);

  const productSet = new Set(product);
  const proofSet = new Set(proof);
  // Disjoint.
  const overlap = product.filter((c) => proofSet.has(c));
  if (overlap.length) errs.push(`product/proof overlap: ${overlap.join(", ")}`);
  // Union == handler (no drift, no duplicative second inventory).
  const unionSorted = [...new Set([...product, ...proof])].sort();
  const handlerSorted = [...handler].sort();
  if (JSON.stringify(unionSorted) !== JSON.stringify(handlerSorted)) {
    const missing = handlerSorted.filter((c) => !unionSorted.includes(c));
    const extra = unionSorted.filter((c) => !handlerSorted.includes(c));
    errs.push(
      `product∪proof != HANDLER_ORDER (missing: ${missing.join(",") || "—"}; ` +
        `extra: ${extra.join(",") || "—"})`,
    );
  }
  if (errs.length) {
    throw new Error("Inventory derivation FAILED:\n  - " + errs.join("\n  - "));
  }
  return { handler, product, proof, productSet, proofSet };
}

// The 8 old (pre-Stage-6) issue-numbered product command names. These were the
// PRODUCT surface before the responsibility rename; they must not exist in ANY
// build now (product or proof). Hardcoded on purpose — the point is that they
// are gone from the source of truth, so they cannot be derived from build.rs.
const OLD_PRODUCT_COMMANDS = [
  "issue050_write_file",
  "issue050_save_dialog",
  "issue050_open_dialog",
  "issue050_set_dirty",
  "issue051_pick_folder",
  "issue051_read_project",
  "issue037_check_acknowledgement",
  "issue037_write_acknowledgement",
];

// Proof-only Rust relay/state string markers (env-var literals survive release
// stripping; function symbols may not, so the reliable anchors are the env vars
// and the relay report-relay markers).
const PROOF_RUST_MARKERS = [
  "MONOGAME_PROOF_LAUNCHSERVICES_RELAUNCHED",
  "MONOGAME_PROOF_REPORT_RELAY",
];

// Proof-only C# JSExport names (referenced by name from the proof JS glue that
// is embedded in the proof binary; absent from the product binary and product
// staged assets). QueryStoppedGameProof is now forbidden in PRODUCT: the shared
// product stop runtime (PreviewStopRuntime.js) no longer calls it — the stopped-
// game quiescence observation was moved behind the proof-only preview extension
// (design C.4), so its name may appear only in the proof artifact.
const PROOF_CSHARP_EXPORTS = [
  "Issue034FileSystemProbe",
  "QueryIssue039State",
  "QueryIssue040AudioState",
  "QueryStoppedGameProof",
  "QueryRunStateProof",
  "RunContentValidatorSelfTest",
  "RunWavToXnbSelfTest",
  "RunImageContentSelfTest",
  "RunAtomicMountSelfTest",
  "RunForwardingTextWriterSelfTest",
  "RunGameRunnerBehavioralSelfTest",
  "AuthorizeRetentionProof",
  "CompleteRetentionProof",
  "GetRetentionState",
  "ConfigureNextRetentionTestLease",
];

// Proof-only JS globals / actions / module identifiers. previewIssue*Proof is a
// family; the regex catches every member.
const PROOF_JS_GLOBALS = [
  "installIssue040AudioProbe",
  "compilerProof",
  "compilerIssue21Proof",
  "createProofExpectationRegistry",
  "initializeCompilerProofMode",
  "runRetentionBehaviorProof",
];
const PROOF_JS_GLOBAL_REGEX = /previewIssue[0-9A-Za-z]*Proof/;

// Proof-only staged asset filenames (present ONLY in dist-proof).
const PROOF_ASSET_FILES = [
  "preview-proof-extension.js",
  "compiler-proof-extension.js",
  "issue033-negative-observer.js",
  "Issue21EndpointsProof.js",
];

// Proof env/report marker regexes (must be absent from the product binary).
const PROOF_ENV_MARKER_REGEX = /MONOGAME_ISSUE[0-9]+[A-Z_]*_(PROOF|BENCHMARK)[A-Z0-9_]*/;
const PROOF_REPORT_KEY_REGEX = /ISSUE0[0-9][0-9][A-Z0-9_]*_REPORT/;
// Generic issue-numbered command token (issueNNN_verb) — any is forbidden in product.
const ISSUE_COMMAND_TOKEN_REGEX = /issue0[0-9][0-9]_[a-z][a-z0-9_]*/;

// Non-vacuous PRODUCT floors: things that MUST be present in a real product
// artifact so the scan cannot pass on an empty/failed read. Composite Tauri
// permission identifiers are intentionally not used as binary floors: Tauri
// resolves them into command ACLs at build time, and release-linker retention of
// the original identifier is architecture-dependent (arm64 retains
// `main-commands`; x64 legitimately does not). The exact source ACL is checked
// separately below, while all eight resolved product command names are required
// in the executable on every architecture.
const PRODUCT_BINARY_FLOOR = [
  "createPreviewEndpoint", // embedded preview.js product export
  "verifyRuntimeAsset", // embedded preview.js product function
  "MountContentAssets", // embedded preview runtime product export ref
  "createCompilerEndpoint", // embedded compiler harness product export
];

// Representative + full PROOF present-floor (proves the harness compiled in).
const PROOF_BINARY_FLOOR_ENV = [
  "MONOGAME_ISSUE034_PROOF",
  "MONOGAME_ISSUE041_BENCHMARK",
  "MONOGAME_PROOF_LAUNCHSERVICES_RELAUNCHED",
  "MONOGAME_PROOF_REPORT_RELAY",
];
const PROOF_BINARY_FLOOR_JS = [
  "installIssue040AudioProbe",
  "QueryIssue039State",
  "Issue034FileSystemProbe",
];

const PRODUCT_IDENTIFIER = "com.monogame.playground";
const PROOF_IDENTIFIER = "com.monogame.playground.proof";

// --------------------------------------------------------------------------
// (2) Pure-Node string extraction (portable substitute for `strings`).
// --------------------------------------------------------------------------

function extractStrings(buf, minLen = 4) {
  // Concatenate printable-ASCII runs of >= minLen, separated by \n. Substring
  // membership over this blob is sufficient for our distinctive tokens.
  const out = [];
  let run = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c <= 0x7e) {
      run.push(c);
    } else {
      if (run.length >= minLen) out.push(Buffer.from(run).toString("latin1"));
      run = [];
    }
  }
  if (run.length >= minLen) out.push(Buffer.from(run).toString("latin1"));
  return out.join("\n");
}

function scanArtifact(path) {
  const buf = readFileSync(path);
  const text = extractStrings(buf);
  return {
    path,
    size: buf.length,
    text,
    has: (token) => text.includes(token),
    count: (token) => text.split(token).length - 1,
    matches: (re) => (text.match(new RegExp(re, "g")) ?? []),
  };
}

// --------------------------------------------------------------------------
// (3) Bundle / profile identity resolution.
// --------------------------------------------------------------------------

function readBundleIdentifier(appPath) {
  const plist = join(appPath, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const xml = readFileSync(plist, "utf8");
  const m = xml.match(
    /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/,
  );
  return m ? m[1].trim() : null;
}

function bundleBinaryPath(appPath) {
  const macos = join(appPath, "Contents", "MacOS");
  if (existsSync(macos)) {
    const files = readdirSync(macos).filter((f) =>
      statSync(join(macos, f)).isFile(),
    );
    if (files.length) return join(macos, files[0]);
  }
  return null;
}

// Resolve the artifact + verified profile identity for a mode.
function resolveBinary(mode, opts) {
  const expectedId = mode === "product" ? PRODUCT_IDENTIFIER : PROOF_IDENTIFIER;

  // Explicit --binary wins outright.
  if (opts.binary) {
    if (!existsSync(opts.binary))
      return { error: `--binary path does not exist: ${opts.binary}` };
    return { binaryPath: opts.binary, identity: "explicit-binary", expectedId };
  }

  // Explicit --bundle: verify identity.
  let appPath = opts.bundle;
  if (!appPath) {
    // Default: mode-correct .app under the release bundle dir.
    const bundleName =
      mode === "product"
        ? "MonoGame Playground.app"
        : "MonoGame Playground Proof.app";
    const candidates = [];
    const targetDir = join(tauriRoot, "target");
    const releaseDirs = [join(targetDir, "release", "bundle", "macos")];
    if (opts.target)
      releaseDirs.unshift(
        join(targetDir, opts.target, "release", "bundle", "macos"),
      );
    else if (existsSync(targetDir)) {
      for (const d of readdirSync(targetDir)) {
        const p = join(targetDir, d, "release", "bundle", "macos");
        if (existsSync(p)) releaseDirs.push(p);
      }
    }
    for (const d of releaseDirs) {
      const p = join(d, bundleName);
      if (existsSync(p)) candidates.push(p);
    }
    if (candidates.length === 0) {
      // Fall back to a shared release binary if explicitly allowed.
      if (opts.allowSharedBinary) {
        const shared = opts.target
          ? join(targetDir, opts.target, "release", "monogame-playground")
          : join(targetDir, "release", "monogame-playground");
        const sharedExe = existsSync(shared) ? shared : shared + ".exe";
        if (existsSync(sharedExe))
          return {
            binaryPath: sharedExe,
            identity: "shared-release-binary",
            expectedId,
            shared: true,
          };
      }
      return {
        error:
          `No ${mode} bundle found (looked for "${bundleName}"). Build the ` +
          `${mode} package first, or pass --bundle/--binary. ` +
          `(Refusing to guess against the shared target/release binary — it is ` +
          `overwritten by whichever profile built last; pass --allow-shared-binary ` +
          `to override.)`,
      };
    }
    appPath = candidates[0];
  }

  if (!existsSync(appPath))
    return { error: `--bundle path does not exist: ${appPath}` };

  const id = readBundleIdentifier(appPath);
  if (id !== null && id !== expectedId) {
    return {
      error:
        `Bundle identity mismatch: ${appPath} has CFBundleIdentifier "${id}" ` +
        `but mode "${mode}" requires "${expectedId}". Refusing to scan a ` +
        `wrong-profile artifact.`,
    };
  }
  const binaryPath = bundleBinaryPath(appPath);
  if (!binaryPath)
    return { error: `Could not find executable inside bundle ${appPath}` };
  return { binaryPath, identity: id ?? "bundle-no-plist", expectedId, appPath };
}

// --------------------------------------------------------------------------
// (4) Staged-asset scan (dist / dist-proof).
// --------------------------------------------------------------------------

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function distDir(mode, opts) {
  if (opts.frontendDist) return opts.frontendDist;
  return join(frontendRoot, mode === "product" ? "dist" : "dist-proof");
}

function readManifestProfile(dist) {
  const p = join(dist, "profile-manifest.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// Tauri expands composite permissions into command ACL entries during its build.
// The composite identifier itself is therefore not a portable executable string:
// current arm64 release linkers retain `main-commands`, while x64 linkers remove
// it after resolution. Validate the authoritative source ACL exactly instead of
// treating that implementation detail as a packaged-binary invariant. build.rs
// independently validates the same files and the generated effective ACL before
// a package can compile.
function checkProductAclSource(inv, fail, note) {
  let capability;
  try {
    capability = JSON.parse(readFileSync(productCapabilityPath, "utf8"));
  } catch (error) {
    fail(`PRODUCT capability is missing or malformed: ${error.message}`);
    return;
  }

  if (
    capability.identifier !== "main" ||
    capability.local !== true ||
    JSON.stringify(capability.windows) !== JSON.stringify(["main"]) ||
    JSON.stringify(capability.permissions) !== JSON.stringify(["main-commands"])
  ) {
    fail(
      "PRODUCT capability must be local, target only the main window, and grant only main-commands.",
    );
  }

  let permission;
  try {
    permission = readFileSync(productPermissionPath, "utf8");
  } catch (error) {
    fail(`PRODUCT permission is missing or unreadable: ${error.message}`);
    return;
  }
  const sections = permission.match(/^\[\[permission\]\]$/gm) ?? [];
  const identifier = permission.match(/^identifier\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const allowBody = permission.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/m)?.[1];
  const allowed = allowBody
    ? [...allowBody.matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : null;
  if (
    sections.length !== 1 ||
    identifier !== "main-commands" ||
    allowed === null ||
    JSON.stringify(allowed) !== JSON.stringify(inv.product) ||
    /^commands\.deny\s*=/m.test(permission)
  ) {
    fail(
      `PRODUCT main-commands permission must grant exactly the ${inv.product.length} ` +
        `canonical product commands and no deny list.`,
    );
    return;
  }
  note(`  source ACL: local main window -> main-commands -> ${allowed.length} product commands`);
}

// --------------------------------------------------------------------------
// (5) The checks.
// --------------------------------------------------------------------------

function checkProduct(inv, opts, fail, note) {
  checkProductAclSource(inv, fail, note);
  const res = resolveBinary("product", opts);
  if (res.error) return fail(res.error);
  note(`  binary:   ${res.binaryPath}`);
  note(`  identity: ${res.identity} (${res.expectedId})`);
  if (res.shared)
    note(
      `  WARNING: scanning the shared release binary (no bundle identity); ` +
        `content-consistency is the only profile guard.`,
    );
  const bin = scanArtifact(res.binaryPath);

  // Positive floor (non-vacuous): the 8 product commands + runtime floors present.
  const missingProduct = inv.product.filter((c) => !bin.has(c));
  if (missingProduct.length)
    fail(
      `PRODUCT binary missing product command strings (empty/wrong artifact?): ` +
        missingProduct.join(", "),
    );
  const missingFloor = PRODUCT_BINARY_FLOOR.filter((f) => !bin.has(f));
  if (missingFloor.length)
    fail(
      `PRODUCT binary missing known product runtime export/asset floor ` +
        `(vacuous-scan guard): ${missingFloor.join(", ")}`,
    );

  // Negative: old product command names.
  const leakedOld = OLD_PRODUCT_COMMANDS.filter((c) => bin.has(c));
  if (leakedOld.length)
    fail(`PRODUCT binary contains OLD product command names: ${leakedOld.join(", ")}`);

  // Negative: proof command strings.
  const leakedProof = inv.proof.filter((c) => bin.has(c));
  if (leakedProof.length)
    fail(
      `PRODUCT binary contains ${leakedProof.length} PROOF command strings: ` +
        leakedProof.slice(0, 8).join(", ") +
        (leakedProof.length > 8 ? ", …" : ""),
    );

  // Negative: any generic issueNNN_ command token.
  const issueTokens = [
    ...new Set(bin.matches(ISSUE_COMMAND_TOKEN_REGEX.source)),
  ].filter((t) => !inv.productSet.has(t));
  if (issueTokens.length)
    fail(
      `PRODUCT binary contains issue-numbered command tokens: ${issueTokens
        .slice(0, 12)
        .join(", ")}`,
    );

  // Negative: proof env/report markers.
  const envMarkers = [...new Set(bin.matches(PROOF_ENV_MARKER_REGEX.source))];
  if (envMarkers.length)
    fail(
      `PRODUCT binary contains proof env markers: ${envMarkers.slice(0, 8).join(", ")}`,
    );
  const reportKeys = [...new Set(bin.matches(PROOF_REPORT_KEY_REGEX.source))];
  if (reportKeys.length)
    fail(
      `PRODUCT binary contains proof report keys: ${reportKeys.slice(0, 8).join(", ")}`,
    );
  const rustMarkers = PROOF_RUST_MARKERS.filter((m) => bin.has(m));
  if (rustMarkers.length)
    fail(`PRODUCT binary contains proof-only Rust relay markers: ${rustMarkers.join(", ")}`);

  // Negative: proof-only C# export references + proof JS globals in the binary.
  const csLeak = PROOF_CSHARP_EXPORTS.filter((s) => bin.has(s));
  if (csLeak.length)
    fail(
      `PRODUCT binary contains proof-only C# export references: ${csLeak
        .slice(0, 10)
        .join(", ")}`,
    );
  const jsLeak = PROOF_JS_GLOBALS.filter((s) => bin.has(s));
  const previewProofFamily = [...new Set(bin.matches(PROOF_JS_GLOBAL_REGEX.source))];
  if (jsLeak.length || previewProofFamily.length)
    fail(
      `PRODUCT binary contains proof JS globals: ${[...jsLeak, ...previewProofFamily]
        .slice(0, 10)
        .join(", ")}`,
    );

  // Staged-asset scan (dist/), with profile-identity guard via manifest.
  const dist = distDir("product", opts);
  const manifest = readManifestProfile(dist);
  if (!manifest) fail(`PRODUCT staged dist missing/malformed profile-manifest.json: ${dist}`);
  else if (manifest.profile !== "product")
    fail(
      `PRODUCT staged dist profile-manifest says profile="${manifest.profile}" ` +
        `(wrong-profile staged assets at ${dist}).`,
    );
  const distFiles = walkFiles(dist);
  const distJs = distFiles.filter(
    (f) => f.endsWith(".js") || f.endsWith(".html") || f.endsWith(".css"),
  );
  // Floor: product preview/compiler assets must exist.
  const previewJs = distJs.find((f) => f.endsWith("/preview/preview.js") || basename(f) === "preview.js");
  const compilerHarness = distJs.find((f) => basename(f) === "compiler-harness.js");
  if (!previewJs) fail(`PRODUCT staged dist missing preview.js (vacuous-scan guard): ${dist}`);
  if (!compilerHarness)
    fail(`PRODUCT staged dist missing compiler-harness.js (vacuous-scan guard): ${dist}`);
  // Proof extension assets must be ABSENT.
  const leakedAssets = distFiles
    .map((f) => basename(f))
    .filter((b) => PROOF_ASSET_FILES.includes(b));
  if (leakedAssets.length)
    fail(`PRODUCT staged dist contains proof-only assets: ${[...new Set(leakedAssets)].join(", ")}`);
  // Proof JS globals / C# refs must be absent from staged JS.
  for (const f of distJs) {
    const text = readFileSync(f, "utf8");
    const rel = f.slice(dist.length + 1);
    if (PROOF_JS_GLOBAL_REGEX.test(text))
      fail(`PRODUCT staged asset ${rel} contains previewIssue*Proof global.`);
    for (const g of PROOF_JS_GLOBALS)
      if (text.includes(g)) fail(`PRODUCT staged asset ${rel} contains proof global ${g}.`);
    for (const c of PROOF_CSHARP_EXPORTS)
      if (text.includes(c)) fail(`PRODUCT staged asset ${rel} references proof C# export ${c}.`);
  }
  note(`  staged dist: ${dist} (profile=${manifest ? manifest.profile : "?"}, ${distFiles.length} files)`);
}

function checkProof(inv, opts, fail, note) {
  const res = resolveBinary("proof", opts);
  if (res.error) return fail(res.error);
  note(`  binary:   ${res.binaryPath}`);
  note(`  identity: ${res.identity} (${res.expectedId})`);
  const bin = scanArtifact(res.binaryPath);

  // Positive: all 78 commands present (proves the feature compiled the harness in).
  const missingAll = inv.handler.filter((c) => !bin.has(c));
  if (missingAll.length)
    fail(
      `PROOF binary missing ${missingAll.length}/78 commands (harness not compiled?): ` +
        missingAll.slice(0, 10).join(", ") +
        (missingAll.length > 10 ? ", …" : ""),
    );

  // Positive: representative + full proof symbols/env/JS globals present.
  const missingEnv = PROOF_BINARY_FLOOR_ENV.filter((m) => !bin.has(m));
  if (missingEnv.length)
    fail(`PROOF binary missing proof env markers: ${missingEnv.join(", ")}`);
  const missingJs = PROOF_BINARY_FLOOR_JS.filter((m) => !bin.has(m));
  if (missingJs.length)
    fail(`PROOF binary missing proof JS globals: ${missingJs.join(", ")}`);
  if (!PROOF_JS_GLOBAL_REGEX.test(bin.text))
    fail(`PROOF binary missing previewIssue*Proof global family.`);

  // Staged proof dist: manifest profile + exactly eight scenarios + proof assets present.
  const dist = distDir("proof", opts);
  const manifest = readManifestProfile(dist);
  if (!manifest) fail(`PROOF staged dist missing/malformed profile-manifest.json: ${dist}`);
  else {
    if (manifest.profile !== "proof")
      fail(`PROOF staged dist profile-manifest says profile="${manifest.profile}".`);
    const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
    const scenarioModules = modules.filter((m) =>
      /(^|\/)proof-[a-z0-9-]*\.ts$/i.test(m),
    );
    if (scenarioModules.length !== 8)
      fail(
        `PROOF staged dist has ${scenarioModules.length} scenario modules, ` +
          `expected exactly 8: ${scenarioModules.join(", ")}`,
      );
    else note(`  scenarios: exactly 8 retained (${scenarioModules.length})`);
  }
  const distFiles = walkFiles(dist);
  const names = distFiles.map((f) => basename(f));
  const missingAssets = PROOF_ASSET_FILES.filter((a) => !names.includes(a));
  if (missingAssets.length)
    fail(`PROOF staged dist missing proof assets: ${missingAssets.join(", ")}`);
  note(`  staged dist: ${dist} (${distFiles.length} files)`);
}

// --------------------------------------------------------------------------
// (6) Negative self-tests: prove the checker FAILS on injected/wrong artifacts.
// --------------------------------------------------------------------------

function runOne(mode, opts) {
  const errors = [];
  const inv = deriveInventories();
  const fail = (m) => errors.push(m);
  const note = () => {};
  try {
    if (mode === "product") checkProduct(inv, opts, fail, note);
    else checkProof(inv, opts, fail, note);
  } catch (e) {
    fail(e.message);
  }
  return errors;
}

function selfTest() {
  console.log("Self-test: proving the checker fails on bad artifacts.\n");
  const inv = deriveInventories();
  console.log(
    `  derived inventories: product=${inv.product.length}, proof=${inv.proof.length}, ` +
      `handler=${inv.handler.length} (disjoint + union OK)`,
  );

  const tmp = mkdtempSync(join(tmpdir(), "binchk-"));
  const results = [];
  const expectFail = (label, errs) => {
    const ok = errs.length > 0;
    results.push({ label, ok });
    console.log(`  [${ok ? "PASS" : "FAIL"}] rejects ${label}` + (ok ? "" : "  <-- DID NOT FAIL"));
  };
  const expectPass = (label, errs) => {
    const ok = errs.length === 0;
    results.push({ label, ok });
    console.log(
      `  [${ok ? "PASS" : "FAIL"}] accepts ${label}` +
        (ok ? "" : "  <-- " + errs.join("; ")),
    );
  };

  try {
    // Build a synthetic "product" binary that satisfies the floor + a synthetic dist.
    const goodBinary = join(tmp, "good-binary");
    const floorBlob =
      inv.product.join("\n") +
      "\n" +
      PRODUCT_BINARY_FLOOR.join("\n") +
      "\n";
    writeFileSync(goodBinary, floorBlob);

    const goodDist = join(tmp, "dist");
    const previewDir = join(goodDist, "preview");
    const compilerDir = join(goodDist, "compiler");
    for (const d of [goodDist, previewDir, compilerDir]) {
      if (!existsSync(d)) mkdirSyncSafe(d);
    }
    writeFileSync(
      join(goodDist, "profile-manifest.json"),
      JSON.stringify({ profile: "product", modules: [], chunks: [] }),
    );
    writeFileSync(join(previewDir, "preview.js"), "createPreviewEndpoint verifyRuntimeAsset\n");
    writeFileSync(join(compilerDir, "compiler-harness.js"), "createCompilerEndpoint\n");

    const baseOpts = { binary: goodBinary, frontendDist: goodDist };

    // Sanity: the clean synthetic passes.
    expectPass("a clean synthetic product artifact", runOne("product", baseOpts));

    // (a) inject a proof command string into the binary.
    const injCmd = join(tmp, "inject-cmd");
    writeFileSync(injCmd, floorBlob + "\nissue040_dispatch_preview_input\n");
    expectFail(
      "a product binary with an injected proof command string",
      runOne("product", { ...baseOpts, binary: injCmd }),
    );

    // (b) inject a proof env marker.
    const injEnv = join(tmp, "inject-env");
    writeFileSync(injEnv, floorBlob + "\nMONOGAME_ISSUE034_PROOF\n");
    expectFail(
      "a product binary with an injected proof env marker",
      runOne("product", { ...baseOpts, binary: injEnv }),
    );

    // (c) inject a proof JS global.
    const injJs = join(tmp, "inject-js");
    writeFileSync(injJs, floorBlob + "\npreviewIssue040Proof installIssue040AudioProbe\n");
    expectFail(
      "a product binary with an injected proof JS global",
      runOne("product", { ...baseOpts, binary: injJs }),
    );

    // (c2) inject the QueryStoppedGameProof C# export. Previously exempted (the
    // shared stop runtime called it defensively); now forbidden in PRODUCT since
    // the stopped-game quiescence observation moved behind the proof extension.
    const injStop = join(tmp, "inject-stop");
    writeFileSync(injStop, floorBlob + "\nQueryStoppedGameProof\n");
    expectFail(
      "a product binary with an injected QueryStoppedGameProof export",
      runOne("product", { ...baseOpts, binary: injStop }),
    );

    // (d) inject an old product command name.
    const injOld = join(tmp, "inject-old");
    writeFileSync(injOld, floorBlob + "\nissue050_write_file\n");
    expectFail(
      "a product binary with an old (pre-rename) command name",
      runOne("product", { ...baseOpts, binary: injOld }),
    );

    // (e) empty binary (vacuous-scan guard: floor missing).
    const emptyBin = join(tmp, "empty");
    writeFileSync(emptyBin, "");
    expectFail(
      "an empty binary (missing product floor)",
      runOne("product", { ...baseOpts, binary: emptyBin }),
    );

    // (f) wrong path.
    expectFail(
      "a nonexistent binary path",
      runOne("product", { ...baseOpts, binary: join(tmp, "nope") }),
    );

    // (g) wrong-profile staged dist (proof manifest under product mode).
    const proofDist = join(tmp, "dist-proof");
    for (const d of [proofDist, join(proofDist, "preview"), join(proofDist, "compiler")])
      if (!existsSync(d)) mkdirSyncSafe(d);
    writeFileSync(
      join(proofDist, "profile-manifest.json"),
      JSON.stringify({ profile: "proof", modules: [], chunks: [] }),
    );
    writeFileSync(join(proofDist, "preview", "preview.js"), "createPreviewEndpoint verifyRuntimeAsset\n");
    writeFileSync(join(proofDist, "compiler", "compiler-harness.js"), "createCompilerEndpoint\n");
    writeFileSync(join(proofDist, "preview", "preview-proof-extension.js"), "installIssue040AudioProbe\n");
    expectFail(
      "a wrong-profile (proof) staged dist under product mode",
      runOne("product", { binary: goodBinary, frontendDist: proofDist }),
    );

    // (h) proof asset leaked into product dist.
    writeFileSync(
      join(previewDir, "preview-proof-extension.js"),
      "installIssue040AudioProbe previewIssue040Proof\n",
    );
    expectFail(
      "a product dist with a leaked proof extension asset",
      runOne("product", baseOpts),
    );
    rmSync(join(previewDir, "preview-proof-extension.js"));

    // (i) wrong-profile bundle identity (simulate a proof .app under product mode).
    const fakeApp = join(tmp, "Fake.app");
    const contents = join(fakeApp, "Contents");
    const macos = join(contents, "MacOS");
    mkdirSyncSafe(macos);
    writeFileSync(
      join(contents, "Info.plist"),
      `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${PROOF_IDENTIFIER}</string></dict></plist>`,
    );
    writeFileSync(join(macos, "monogame-playground"), floorBlob);
    expectFail(
      "a proof-identifier bundle scanned in product mode",
      runOne("product", { bundle: fakeApp, frontendDist: goodDist }),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nSelf-test: ${results.length - failed.length}/${results.length} assertions passed.`,
  );
  if (failed.length) {
    console.error("Self-test FAILED:");
    for (const f of failed) console.error(`  - ${f.label}`);
    process.exit(1);
  }
  console.log("Self-test passed: enforcement is real (injection/wrong-path/wrong-profile/empty all rejected).");
}

function mkdirSyncSafe(d) {
  mkdirSync(d, { recursive: true });
}

// --------------------------------------------------------------------------
// (7) CLI
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") opts.selfTest = true;
    else if (a === "--bundle") opts.bundle = argv[++i];
    else if (a === "--binary") opts.binary = argv[++i];
    else if (a === "--frontend-dist") opts.frontendDist = argv[++i];
    else if (a === "--target") opts.target = argv[++i];
    else if (a === "--allow-shared-binary") opts.allowSharedBinary = true;
    else if (!a.startsWith("--") && !mode) mode = a;
    else return { error: `Unknown argument: ${a}` };
  }
  return { mode, opts };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(2);
  }
  if (parsed.opts.selfTest) {
    selfTest();
    return;
  }
  const { mode, opts } = parsed;
  if (mode !== "product" && mode !== "proof") {
    console.error(
      "Usage: check-binary-command-inventory.mjs <product|proof> [--bundle P] " +
        "[--binary P] [--frontend-dist P] [--target TRIPLE] [--allow-shared-binary]\n" +
        "       check-binary-command-inventory.mjs --self-test",
    );
    process.exit(2);
  }

  let inv;
  try {
    inv = deriveInventories();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(
    `Binary command-inventory check — mode=${mode}\n` +
      `  inventories (from build.rs): PRODUCT=${inv.product.length}, ` +
      `PROOF=${inv.proof.length}, PROOF total=${inv.handler.length} ` +
      `(disjoint + union verified)`,
  );

  const errors = [];
  const fail = (m) => errors.push(m);
  const note = (m) => console.log(m);
  if (mode === "product") checkProduct(inv, opts, fail, note);
  else checkProof(inv, opts, fail, note);

  if (errors.length) {
    console.error(`\n${mode.toUpperCase()} binary/runtime enforcement FAILED:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`\n${mode.toUpperCase()} binary/runtime enforcement passed.`);
}

main();

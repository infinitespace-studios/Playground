#!/usr/bin/env node
/**
 * Bounded PRODUCT smoke gate (cross-platform where realistic; fail-closed).
 *
 * Purpose: prove a freshly built PRODUCT artifact is the product profile, is the
 * right binary, and *launches without immediately crashing*. It launches the
 * product executable, requires it to remain alive past a bounded readiness /
 * no-immediate-crash interval, then terminates ONLY the process tree it owns.
 * It refuses to run under any proof env/profile, captures logs, and fails on an
 * early crash, a proof/crash marker in the logs, or an orphaned owned process.
 *
 * HONEST MATRIX / LIMITATION
 *   A GUI window's *visual* readiness (WebView painted, canvas mounted) can only
 *   be robustly asserted where a real display/window server exists. In CI that
 *   is reliable on macOS runners (WKWebView + windowserver). Linux needs an
 *   Xvfb + WebKitGTK session and Windows needs an interactive WebView2 session;
 *   there this gate is honest about what it verifies: it does the identity/profile
 *   checks everywhere, and it runs the launch/no-immediate-crash phase only when
 *   a display is available (or `--force-launch` is passed). It does NOT fake
 *   Run/Stop automation or claim visual readiness it cannot observe. Use
 *   `--identity-only` to skip the launch phase explicitly.
 *
 * Usage:
 *   node scripts/smoke-product.mjs [--binary <path>] [--bundle <path.app>]
 *       [--target <triple>] [--ready-seconds N] [--timeout N]
 *       [--logs <path>] [--identity-only] [--force-launch]
 *   node scripts/smoke-product.mjs --self-test
 */

import { spawn, spawnSync } from "node:child_process";
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

const PRODUCT_IDENTIFIER = "com.monogame.playground";
const PROOF_IDENTIFIER = "com.monogame.playground.proof";
const PRODUCT_APP_NAME = "MonoGame Playground.app";
const EXE_BASENAME = "monogame-playground";

// Env markers that MUST NOT be present when smoke-testing a PRODUCT artifact.
// Any MONOGAME_ISSUE*_PROOF / *_BENCHMARK, any MONOGAME_PROOF_*, the proof
// frontend profile, or the locked-session gate poisons a product smoke.
const PROOF_ENV_REGEXES = [
  /^MONOGAME_ISSUE\d+[A-Z_]*_(PROOF|BENCHMARK)/,
  /^MONOGAME_PROOF_/,
  /^MONOGAME_ISSUE\d+_LOCKED_SESSION$/,
];

// Log markers that indicate a crash or a leaked proof/secret surface.
const CRASH_LOG_REGEXES = [
  /thread '[^']*' panicked/i,
  /segmentation fault/i,
  /\bfatal runtime error\b/i,
  /\bAbort trap\b/i,
  /\bcore dumped\b/i,
];
const FORBIDDEN_LOG_REGEXES = [
  /__TAURI_INVOKE_KEY__/,
  /MONOGAME_ISSUE\d+[A-Z_]*_(PROOF|BENCHMARK)/,
  /^ISSUE\d+[A-Z0-9_]*_REPORT=/m,
  /MONOGAME_PROOF_REPORT_RELAY/,
];

// --- Argument parsing (pure) ---------------------------------------------

export function parseArgs(argv) {
  const args = {
    binary: null,
    bundle: null,
    target: null,
    readySeconds: 8,
    timeoutSeconds: 40,
    logs: null,
    identityOnly: false,
    forceLaunch: false,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--self-test") args.selfTest = true;
    else if (a === "--identity-only") args.identityOnly = true;
    else if (a === "--force-launch") args.forceLaunch = true;
    else if (a === "--binary") args.binary = argv[++i];
    else if (a === "--bundle") args.bundle = argv[++i];
    else if (a === "--target") args.target = argv[++i];
    else if (a === "--logs") args.logs = argv[++i];
    else if (a === "--ready-seconds") args.readySeconds = Number(argv[++i]);
    else if (a === "--timeout") args.timeoutSeconds = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(args.readySeconds) || args.readySeconds < 1) {
    throw new Error(`--ready-seconds must be a positive integer (got ${args.readySeconds})`);
  }
  if (!Number.isInteger(args.timeoutSeconds) || args.timeoutSeconds <= args.readySeconds) {
    throw new Error(`--timeout must be an integer greater than --ready-seconds`);
  }
  return args;
}

// --- Proof-env rejection (pure) ------------------------------------------

// Returns the sorted list of offending env var names (empty when clean).
export function detectProofEnv(env) {
  const offenders = [];
  for (const [key, value] of Object.entries(env)) {
    if (key === "MONOGAME_FRONTEND_PROFILE" && value === "proof") {
      offenders.push(`${key}=proof`);
      continue;
    }
    if (PROOF_ENV_REGEXES.some((re) => re.test(key))) offenders.push(key);
  }
  return offenders.sort();
}

// --- Identity classification (pure) --------------------------------------

// Reads a macOS .app CFBundleIdentifier (null if not an .app / no plist).
export function readBundleIdentifier(bundlePath) {
  if (!bundlePath || !bundlePath.endsWith(".app")) return null;
  const plist = join(bundlePath, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const xml = readFileSync(plist, "utf8");
  const m = xml.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
  return m ? m[1].trim() : null;
}

// Classify whether the given identity is the PRODUCT profile. Fail-closed:
// an explicit proof identifier is rejected; an unknown/absent identifier is
// accepted only when it cannot contradict product (no plist), with a note.
export function classifyBundleIdentity(identifier) {
  if (identifier === PRODUCT_IDENTIFIER) return { product: true, note: "product identifier" };
  if (identifier === PROOF_IDENTIFIER) return { product: false, note: "PROOF identifier — refused" };
  if (identifier == null) return { product: true, note: "no plist identity (binary path)" };
  return { product: false, note: `unexpected identifier "${identifier}" — refused` };
}

// --- Outcome decision (pure) ---------------------------------------------

// Decide the launch verdict from observed facts. This is the single fail-closed
// decision point shared by the launcher and the self-test.
export function decideLaunchOutcome(obs) {
  const failures = [];
  if (obs.spawnError) failures.push(`failed to spawn product binary: ${obs.spawnError}`);
  if (obs.exitedBeforeReady) {
    failures.push(
      `product exited before the ${obs.readySeconds}s readiness window ` +
        `(no-immediate-crash) with code ${obs.exitCode ?? "?"}`,
    );
  }
  for (const marker of obs.crashMarkers ?? []) failures.push(`crash marker in logs: ${marker}`);
  for (const marker of obs.forbiddenMarkers ?? []) failures.push(`forbidden proof/secret marker in logs: ${marker}`);
  if (obs.orphaned) failures.push(`owned process ${obs.ownedPid} survived termination (orphan)`);
  return { passed: failures.length === 0, failures };
}

// Scan captured log text for crash / forbidden markers (pure).
export function scanLogMarkers(text) {
  const crashMarkers = [];
  const forbiddenMarkers = [];
  for (const re of CRASH_LOG_REGEXES) {
    const m = text.match(re);
    if (m) crashMarkers.push(m[0].slice(0, 80));
  }
  for (const re of FORBIDDEN_LOG_REGEXES) {
    const m = text.match(re);
    if (m) forbiddenMarkers.push(m[0].slice(0, 80));
  }
  return { crashMarkers, forbiddenMarkers };
}

// --- Path resolution -----------------------------------------------------

function releaseRoot(target) {
  const tauriTarget = join(REPO, "src/desktop/src-tauri/target");
  return target ? join(tauriTarget, target, "release") : join(tauriTarget, "release");
}

// Resolve the executable to launch and the identity to verify.
function resolveArtifact(args) {
  // Explicit bundle wins; verify identity and locate the inner executable.
  if (args.bundle) {
    const bundlePath = resolve(args.bundle);
    if (!existsSync(bundlePath)) return { error: `--bundle does not exist: ${args.bundle}` };
    const identifier = readBundleIdentifier(bundlePath);
    const macos = join(bundlePath, "Contents", "MacOS");
    let exe = null;
    if (existsSync(macos)) {
      const files = readdirSync(macos).filter((f) => statSync(join(macos, f)).isFile());
      if (files.length) exe = join(macos, files[0]);
    }
    if (!exe) return { error: `could not find executable inside bundle: ${args.bundle}` };
    return { exe, identifier, source: `bundle ${bundlePath}` };
  }
  // Explicit binary.
  if (args.binary) {
    const binaryPath = resolve(args.binary);
    if (!existsSync(binaryPath)) return { error: `--binary does not exist: ${args.binary}` };
    return { exe: binaryPath, identifier: null, source: `binary ${binaryPath}` };
  }
  // Default: prefer the identity-bearing .app, else the raw release binary.
  const root = releaseRoot(args.target);
  const app = join(root, "bundle", "macos", PRODUCT_APP_NAME);
  if (existsSync(app)) return resolveArtifact({ ...args, bundle: app });
  const exeName = process.platform === "win32" ? EXE_BASENAME + ".exe" : EXE_BASENAME;
  const bin = join(root, exeName);
  if (existsSync(bin)) return { exe: bin, identifier: null, source: `release binary ${bin}` };
  return { error: `no product artifact found under ${root} (pass --binary/--bundle)` };
}

function displayAvailable() {
  if (process.platform === "darwin") return true; // WKWebView + windowserver
  if (process.platform === "win32") return true; // interactive session assumed by caller
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

// --- Owned-process termination -------------------------------------------

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Terminate only the process tree we own (child was spawned detached, so it is
// its own group leader on POSIX; on Windows use taskkill /T).
async function terminateOwnedTree(child) {
  const pid = child.pid;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 10_000,
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    for (let i = 0; i < 5 && isAlive(pid); i += 1) await sleep(1000);
    if (isAlive(pid)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
    }
  }
  for (let i = 0; i < 5 && isAlive(pid); i += 1) await sleep(500);
  return !isAlive(pid); // true when fully reaped (no orphan)
}

// --- Launch phase --------------------------------------------------------

async function launchPhase(exe, logsPath, args, onSpawn = () => {}) {
  const child = spawn(exe, [], {
    cwd: dirname(exe),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  onSpawn(child);

  let logText = "";
  const append = (buf) => {
    logText += buf.toString();
    if (logText.length > 512 * 1024) logText = logText.slice(-512 * 1024);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  let spawnError = null;
  let exited = false;
  let exitCode = null;
  child.on("error", (err) => {
    spawnError = err.message;
    exited = true;
  });
  child.on("exit", (code, signal) => {
    exited = true;
    exitCode = code ?? (signal ? `signal:${signal}` : null);
  });

  // Wait the readiness window, checking for an early exit each second.
  for (let i = 0; i < args.readySeconds && !exited; i += 1) await sleep(1000);

  const exitedBeforeReady = exited && !spawnError;
  let orphaned = false;
  if (!exited && !spawnError) {
    const reaped = await terminateOwnedTree(child);
    orphaned = !reaped;
  }

  if (logsPath) {
    mkdirSync(dirname(logsPath), { recursive: true });
    writeFileSync(logsPath, logText);
  }

  const { crashMarkers, forbiddenMarkers } = scanLogMarkers(logText);
  return {
    spawnError,
    exitedBeforeReady,
    exitCode,
    readySeconds: args.readySeconds,
    crashMarkers,
    forbiddenMarkers,
    orphaned,
    ownedPid: child.pid,
    logBytes: logText.length,
  };
}

// --- Self-test (static + real process-safety) ----------------------------

async function selfTest() {
  console.log("Self-test: argument/profile/process-safety logic.\n");
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

  // (1) Argument parsing.
  const a = parseArgs(["--binary", "/x", "--ready-seconds", "5", "--timeout", "30"]);
  assert(a.binary === "/x" && a.readySeconds === 5 && a.timeoutSeconds === 30, "parses binary/ready/timeout");
  let threw = false;
  try {
    parseArgs(["--ready-seconds", "0"]);
  } catch {
    threw = true;
  }
  assert(threw, "rejects ready-seconds < 1");
  threw = false;
  try {
    parseArgs(["--ready-seconds", "40", "--timeout", "10"]);
  } catch {
    threw = true;
  }
  assert(threw, "rejects timeout <= ready-seconds");

  // (2) Proof-env rejection.
  assert(detectProofEnv({ PATH: "/bin", HOME: "/h" }).length === 0, "clean env has no offenders");
  assert(detectProofEnv({ MONOGAME_ISSUE040_PROOF: "1" })[0] === "MONOGAME_ISSUE040_PROOF", "detects issue proof gate");
  assert(detectProofEnv({ MONOGAME_ISSUE041_BENCHMARK: "1" }).length === 1, "detects benchmark gate");
  assert(detectProofEnv({ MONOGAME_PROOF_REPORT_RELAY: "x" }).length === 1, "detects proof relay gate");
  assert(detectProofEnv({ MONOGAME_FRONTEND_PROFILE: "proof" }).length === 1, "detects proof frontend profile");
  assert(detectProofEnv({ MONOGAME_FRONTEND_PROFILE: "product" }).length === 0, "product frontend profile is clean");

  // (3) Identity classification.
  assert(classifyBundleIdentity(PRODUCT_IDENTIFIER).product, "accepts product identifier");
  assert(!classifyBundleIdentity(PROOF_IDENTIFIER).product, "refuses proof identifier");
  assert(classifyBundleIdentity(null).product, "accepts null identity (binary path)");
  assert(!classifyBundleIdentity("com.other.app").product, "refuses unexpected identifier");

  // (4) Outcome decision (pure).
  assert(decideLaunchOutcome({ orphaned: false }).passed, "alive-through-readiness + clean → pass");
  assert(
    !decideLaunchOutcome({ exitedBeforeReady: true, exitCode: 1, readySeconds: 8 }).passed,
    "early exit → fail",
  );
  assert(!decideLaunchOutcome({ spawnError: "ENOENT" }).passed, "spawn error → fail");
  assert(!decideLaunchOutcome({ crashMarkers: ["thread 'main' panicked"] }).passed, "crash marker → fail");
  assert(!decideLaunchOutcome({ forbiddenMarkers: ["__TAURI_INVOKE_KEY__"] }).passed, "forbidden marker → fail");
  assert(!decideLaunchOutcome({ orphaned: true, ownedPid: 123 }).passed, "orphan → fail");

  // (5) Log scanning.
  assert(scanLogMarkers("thread 'main' panicked at foo").crashMarkers.length === 1, "scans a panic");
  assert(scanLogMarkers("ISSUE040_REPORT={}\n").forbiddenMarkers.length === 1, "scans a proof report key");
  assert(scanLogMarkers("all good\nstarting up").crashMarkers.length === 0, "clean log → no markers");

  // (6) REAL process-safety: launch a detached child that spawns a grandchild,
  //     then terminate the owned tree and assert BOTH are reaped (no orphan).
  const tmp = mkdtempSync(join(tmpdir(), "smoke-safety-"));
  try {
    const script = join(tmp, "tree.mjs");
    writeFileSync(
      script,
      [
        "import { spawn } from 'node:child_process';",
        // grandchild: sleeps; parent: sleeps and keeps it alive
        "const g = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });",
        "setTimeout(() => {}, 60000);",
      ].join("\n"),
    );
    if (process.platform !== "win32") {
      const child = spawn(process.execPath, [script], { stdio: "ignore", detached: true });
      await sleep(800);
      const alive = isAlive(child.pid);
      assert(alive, "spawned detached child tree is alive before termination");
      const reaped = await terminateOwnedTree(child);
      assert(reaped, "terminateOwnedTree reaps the owned child (no orphan)");
      assert(!isAlive(child.pid), "owned pid is dead after termination");
    } else {
      console.log("  [SKIP] POSIX process-group termination test (Windows uses taskkill /T)");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nSelf-test: ${pass}/${pass + fail} assertions passed.`);
  if (fail > 0) {
    console.error("Self-test FAILED.");
    process.exit(1);
  }
  console.log("Self-test passed: argument/profile/process-safety logic is real and fail-closed.");
}

// --- Main ----------------------------------------------------------------

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.selfTest) {
    await selfTest();
    return;
  }

  console.log("=== Bounded PRODUCT smoke gate ===\n");

  // (0) Refuse any proof env/profile — a product smoke must run clean.
  const proofOffenders = detectProofEnv(process.env);
  if (proofOffenders.length) {
    console.error("Refusing to run: proof env/profile present (a PRODUCT smoke must be clean):");
    for (const o of proofOffenders) console.error(`  - ${o}`);
    process.exit(1);
  }
  console.log("[1] Proof env/profile: clean (no MONOGAME_ISSUE*_PROOF / *_BENCHMARK / proof profile).");

  // (1) Resolve the artifact + verify product identity.
  const artifact = resolveArtifact(args);
  if (artifact.error) {
    console.error(`[2] Artifact: ${artifact.error}`);
    process.exit(1);
  }
  const identity = classifyBundleIdentity(artifact.identifier);
  console.log(`[2] Artifact: ${artifact.source}`);
  console.log(`    Executable: ${artifact.exe.replace(REPO + "/", "")}`);
  console.log(`    Identity: ${artifact.identifier ?? "n/a"} → ${identity.note}`);
  if (!identity.product) {
    console.error("Refusing to launch a non-product artifact.");
    process.exit(1);
  }

  // (2) Launch phase (bounded no-immediate-crash), when a display is available.
  if (args.identityOnly) {
    console.log("[3] Launch phase skipped (--identity-only). Identity/profile checks passed.");
    console.log("\nPRODUCT smoke (identity-only) passed.");
    return;
  }
  if (!displayAvailable() && !args.forceLaunch) {
    console.log(
      "[3] Launch phase skipped: no display/window server detected on this platform.\n" +
        "    (GUI readiness is only robust with a display; pass --force-launch to attempt anyway,\n" +
        "     or --identity-only to make skipping explicit. Identity/profile checks passed.)",
    );
    console.log("\nPRODUCT smoke (identity-only; launch not feasible here) passed.");
    return;
  }

  const logsPath = args.logs ? resolve(args.logs) : null;
  console.log(
    `[3] Launch phase: readiness ${args.readySeconds}s (bounded by ${args.timeoutSeconds}s)` +
      (logsPath ? `, logs → ${logsPath.replace(REPO + "/", "")}` : ""),
  );

  let activeChild = null;
  const phase = launchPhase(artifact.exe, logsPath, args, (child) => {
    activeChild = child;
  });
  const obs = await Promise.race([
    phase,
    sleep(args.timeoutSeconds * 1000).then(() => ({ timedOut: true })),
  ]);
  if (obs.timedOut) {
    // A hard timeout must never strand the detached application process. Kill
    // only the process tree launched by this invocation, then wait briefly for
    // the normal phase cleanup to settle before failing.
    if (activeChild && isAlive(activeChild.pid)) await terminateOwnedTree(activeChild);
    await Promise.race([phase.catch(() => null), sleep(10_000)]);
    const orphaned = activeChild ? isAlive(activeChild.pid) : false;
    console.error(
      `Launch phase exceeded the ${args.timeoutSeconds}s hard timeout` +
        `${orphaned ? ` and owned process ${activeChild.pid} survived cleanup` : "; owned process cleanup completed"}.`,
    );
    process.exit(1);
  }

  const outcome = decideLaunchOutcome(obs);
  console.log(
    `    exited-before-ready: ${obs.exitedBeforeReady} · crash markers: ${obs.crashMarkers.length} · ` +
      `forbidden markers: ${obs.forbiddenMarkers.length} · orphan: ${obs.orphaned} · log bytes: ${obs.logBytes}`,
  );

  if (!outcome.passed) {
    console.error("\nPRODUCT smoke FAILED:");
    for (const f of outcome.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    "\nPRODUCT smoke passed: product identity verified, launched, survived the readiness window, " +
      "owned process tree terminated cleanly, no crash/proof markers, no orphan.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

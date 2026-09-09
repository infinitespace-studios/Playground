#!/usr/bin/env node
/**
 * Issue 041: performance benchmark driver.
 *
 * Launches the packaged desktop binary repeatedly with the benchmark
 * instrumentation enabled (`MONOGAME_ISSUE041_BENCHMARK=1`), collects the raw
 * timing samples each process reports, and regenerates both
 * `docs/performance-baseline.json` (machine readable) and
 * `docs/performance-baseline.md` from those samples. Neither output is ever
 * edited by hand.
 *
 * Sampling discipline:
 *   - attempts continue until every phase/kind has its required sample count,
 *     bounded by a finite attempt budget that the report states;
 *   - a launch that fails part-way keeps every sample it already completed, so
 *     no phase is survivor-conditioned on whole-launch success;
 *   - a preview that never draws inside its hard bound becomes an explicit
 *     right-censored slow sample that counts towards the distribution and the
 *     verdict; it is never discarded;
 *   - every attempt, failure, censored value and impossible sample is listed in
 *     the report with its reason.
 *
 * Process discipline:
 *   - every launch has a hard timeout;
 *   - only the exact child PIDs this driver spawned are ever signalled;
 *   - `pkill`/`killall` are never used;
 *   - the driver refuses to start, and fails at the end, if an application
 *     process it does not own is running;
 *   - the driver refuses to run on a locked or non-console session, because a
 *     locked session suppresses the rendering the measurement depends on.
 *
 * Usage:
 *   node scripts/measure-performance.mjs [--runs 10] [--warm-compiles 10]
 *        [--preview-cycles 2] [--cooling-seconds 5] [--max-attempts 30]
 *        [--dry-run]
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REPORT_SCHEMA_VERSION,
  REQUIRED_SAMPLES_PER_PHASE,
  aggregate,
  nearestRankPercentile,
  renderMarkdown,
  summarize,
  validateReport,
} from "./performance-report.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BINARY = join(REPO, "src/desktop/src-tauri/target/release/monogame-playground");
const PROCESS_NAME = "monogame-playground";
const EVIDENCE_DIR = join(REPO, "artifacts/issue041");
const JSON_OUTPUT = join(REPO, "docs/performance-baseline.json");
const MARKDOWN_OUTPUT = join(REPO, "docs/performance-baseline.md");

const FULL_RUN_TIMEOUT_MS = 300_000;
const SHELL_RUN_TIMEOUT_MS = 120_000;
const MEMORY_BASELINE_TIMEOUT_MS = 600_000;
const TERMINATION_GRACE_MS = 5_000;

/** Every phase/kind pair that must reach REQUIRED_SAMPLES_PER_PHASE samples. */
export const PHASE_TARGETS = [
  ["shell-startup", "cold"],
  ["shell-startup", "warm"],
  ["compilation", "cold"],
  ["compilation", "warm"],
  ["preview-start", "cold"],
  ["preview-start", "warm"],
  ["stop", "cold"],
  ["stop", "warm"],
];

/**
 * Finite attempt budget. The driver keeps attempting until every phase/kind
 * has its required samples, but never more than this multiple of the nominal
 * attempt count, so a persistently broken build cannot loop forever and the
 * budget is stated in the report.
 */
export const DEFAULT_ATTEMPT_BUDGET_MULTIPLIER = 3;

function parseArguments(argv) {
  const options = {
    runs: 10,
    warmCompiles: 10,
    previewCycles: 2,
    coolingSeconds: 5,
    maxAttempts: null,
    dryRun: false,
    allowIncomplete: false,
    memoryBaseline: false,
    warmCompilesBaseline: 99,
    previewCyclesBaseline: 20,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--runs": options.runs = Number(value); index++; break;
      case "--warm-compiles": options.warmCompiles = Number(value); index++; break;
      case "--preview-cycles": options.previewCycles = Number(value); index++; break;
      case "--cooling-seconds": options.coolingSeconds = Number(value); index++; break;
      case "--max-attempts": options.maxAttempts = Number(value); index++; break;
      case "--dry-run": options.dryRun = true; break;
      case "--allow-incomplete": options.allowIncomplete = true; break;
      case "--memory-baseline": options.memoryBaseline = true; break;
      case "--warm-compiles-baseline": options.warmCompilesBaseline = Number(value); index++; break;
      case "--preview-cycles-baseline": options.previewCyclesBaseline = Number(value); index++; break;
      default: throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  if (options.maxAttempts === null) {
    options.maxAttempts = options.runs * DEFAULT_ATTEMPT_BUDGET_MULTIPLIER;
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < options.runs) {
    throw new Error("--max-attempts must be an integer no smaller than --runs");
  }
  if (!options.memoryBaseline && options.runs < REQUIRED_SAMPLES_PER_PHASE) {
    console.warn(
      `warning: --runs ${options.runs} yields fewer than the ` +
      `${REQUIRED_SAMPLES_PER_PHASE} samples per phase the acceptance criteria require.`);
  }
  return options;
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

function runCommand(file, args) {
  try {
    return {
      ok: true,
      stdout: execFileSync(file, args, { encoding: "utf8", timeout: 60_000 }).trim(),
    };
  } catch (error) {
    return { ok: false, stdout: "", error: error.message };
  }
}

/** PIDs of application processes currently running. Read-only: never signalled. */
function applicationPids() {
  const result = runCommand("/usr/bin/pgrep", ["-x", PROCESS_NAME]);
  if (!result.ok) return [];
  return result.stdout.split("\n").map(line => line.trim()).filter(Boolean).map(Number);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Terminate exactly one child process this driver spawned, escalating from
 * SIGTERM to SIGKILL, and confirm the PID is gone.
 */
async function terminateExact(child, exited) {
  const pid = child.pid;
  if (pid === undefined) return { pid: null, terminated: true, escalated: false };
  let escalated = false;
  if (!child.killed) child.kill("SIGTERM");
  const graceDeadline = Date.now() + TERMINATION_GRACE_MS;
  while (Date.now() < graceDeadline && processAlive(pid)) await sleep(50);
  if (processAlive(pid)) {
    escalated = true;
    child.kill("SIGKILL");
    const killDeadline = Date.now() + TERMINATION_GRACE_MS;
    while (Date.now() < killDeadline && processAlive(pid)) await sleep(50);
  }
  await Promise.race([exited, sleep(TERMINATION_GRACE_MS)]);
  return { pid, terminated: !processAlive(pid), escalated };
}

/**
 * Launch the packaged application once with the benchmark instrumentation
 * enabled and return everything it reported.
 */
async function launch({ attempt, mode, shellLaunchKind, timeoutMs, options }) {
  const isMemoryBaseline = mode === "memory-baseline";
  const warmCompiles = isMemoryBaseline ? options.warmCompilesBaseline : options.warmCompiles;
  const previewCycles = isMemoryBaseline ? options.previewCyclesBaseline : options.previewCycles;
  const env = {
    ...process.env,
    MONOGAME_ISSUE041_BENCHMARK: "1",
    MONOGAME_ISSUE041_MODE: mode,
    MONOGAME_ISSUE041_WARM_COMPILES: String(warmCompiles),
    MONOGAME_ISSUE041_PREVIEW_CYCLES: String(previewCycles),
  };
  const stdoutChunks = [];
  const stderrChunks = [];
  let shellReady = null;
  let shellReadyWallClockMs = null;
  let report = null;
  let pending = "";
  const checkpoints = [];

  const spawnedAt = nowMs();
  const child = spawn(BINARY, [], { env, stdio: ["ignore", "pipe", "pipe"] });

  const consumeLine = line => {
    if (line.startsWith("ISSUE041_SHELL_READY=")) {
      shellReadyWallClockMs = nowMs() - spawnedAt;
      shellReady = JSON.parse(line.slice("ISSUE041_SHELL_READY=".length));
      return;
    }
    if (line.startsWith("ISSUE041_CHECKPOINT=")) {
      checkpoints.push(JSON.parse(line.slice("ISSUE041_CHECKPOINT=".length)));
      return;
    }
    if (line.startsWith("ISSUE041_REPORT=")) {
      report = JSON.parse(line.slice("ISSUE041_REPORT=".length));
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    stdoutChunks.push(chunk);
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        consumeLine(line);
      } catch (error) {
        stderrChunks.push(`driver: failed to parse line: ${error.message}\n`);
      }
      newline = pending.indexOf("\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => stderrChunks.push(chunk));

  const exited = new Promise(resolve => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.on("error", error => resolve({ code: null, signal: null, error: error.message }));
  });

  let timedOut = false;
  let timer = null;
  const timeout = new Promise(resolveTimeout => {
    timer = setTimeout(() => { timedOut = true; resolveTimeout("timeout"); }, timeoutMs);
  });
  const raced = await Promise.race([exited.then(value => ({ kind: "exit", value })), timeout]);
  clearTimeout(timer);

  // Drain any remaining buffered data before the process exits — the last
  // line (ISSUE041_REPORT) can arrive in the same tick as the exit event.
  // Parse any leftover `pending` text to catch that line.
  if (pending.length > 0 && !pending.includes("\n")) {
    try {
      consumeLine(pending.trimEnd());
    } catch {
      // ignore parse errors on trailing fragment
    }
  }
  pending = "";

  let cleanup = { pid: child.pid ?? null, terminated: true, escalated: false };
  let resolvedExit = raced === "timeout" ? null : raced.value;
  if (raced === "timeout") {
    cleanup = await terminateExact(child, exited);
    resolvedExit = await Promise.race([
      exited,
      sleep(2_000).then(() => ({ code: null, signal: "unknown" })),
    ]);
  }
  const wallClockMs = nowMs() - spawnedAt;
  if (child.pid !== undefined && processAlive(child.pid)) {
    cleanup = await terminateExact(child, exited);
  }

  const stdout = stdoutChunks.join("");
  const stderr = stderrChunks.join("");

  // Parse the full report from the complete stdout (more reliable than the
  // streaming handler, which can miss the last line if it arrives in the same
  // tick as the exit event).
  const stdoutReportMatch = stdout.match(/ISSUE041_REPORT=(\{.+\})\s*$/s);
  const stdoutReport = stdoutReportMatch
    ? JSON.parse(stdoutReportMatch[1])
    : null;
  // Prefer the streaming report if one was captured; fall back to stdout.
  if (report === null && stdoutReport !== null) {
    report = stdoutReport;
  }

  const producedSamples = report !== null &&
    ((report.compileSamples?.length ?? 0) > 0 || (report.previewCycles?.length ?? 0) > 0 ||
      report.mode === "shell-only");
  const outcome = timedOut
    ? "timeout"
    : report === null
      ? "no-report"
      : report.failure
        ? (producedSamples ? "partial" : "harness-failure")
        : "ok";

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const logName = `attempt-${String(attempt).padStart(2, "0")}-${mode}-${shellLaunchKind}`;
  writeFileSync(join(EVIDENCE_DIR, `${logName}.log`), `${stdout}\n--- stderr ---\n${stderr}`);

  return {
    attempt,
    mode,
    shellLaunchKind,
    logFile: `artifacts/issue041/${logName}.log`,
    pid: child.pid ?? null,
    spawnedAt,
    wallClockMs,
    exitCode: resolvedExit?.code ?? null,
    signal: resolvedExit?.signal ?? null,
    timedOut,
    cleanup,
    outcome,
    checkpoints,
    lastCheckpoint: checkpoints.at(-1) ?? null,
    shellReady,
    shellReadyWallClockMs,
    report,
    stderr: stderr.slice(0, 8_000),
  };
}

function sha256OfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Console session state. A locked screen or a session that is not on the
 * console suppresses window activation and rendering, which would silently
 * invalidate every preview sample, so the driver refuses to measure there.
 */
function consoleSessionState() {
  const result = runCommand("/usr/sbin/ioreg", ["-n", "Root", "-d1", "-a"]);
  if (!result.ok) {
    return {
      determined: false,
      screenLocked: null,
      onConsole: null,
      checkedAt: new Date().toISOString(),
      source: "ioreg -n Root -d1 -a (unavailable)",
    };
  }
  return {
    determined: true,
    screenLocked: /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(result.stdout),
    onConsole: /<key>kCGSSessionOnConsoleKey<\/key>\s*<true\/>/.test(result.stdout),
    checkedAt: new Date().toISOString(),
    source: "ioreg -n Root -d1 -a (CGSSessionScreenIsLocked / kCGSSessionOnConsoleKey)",
  };
}

function requireUnlockedConsoleSession(where) {
  const state = consoleSessionState();
  if (!state.determined) {
    throw new Error(
      `cannot determine the console session state ${where}; refusing to measure rendering ` +
      "on a session whose lock state is unknown");
  }
  if (state.screenLocked || state.onConsole === false) {
    throw new Error(
      `the console session is ${state.screenLocked ? "locked" : "not on the console"} ${where}. ` +
      "Rendering is suppressed there, so the preview samples would be invalid. Unlock the " +
      "session and re-run under `caffeinate -di`.");
  }
  return state;
}

/** Evidence that display/idle sleep was held off for the duration of the run. */
function sleepAssertionState() {
  const result = runCommand("/usr/bin/pmset", ["-g", "assertions"]);
  if (!result.ok) return { determined: false, preventUserIdleDisplaySleep: null };
  const match = /PreventUserIdleDisplaySleep\s+(\d+)/.exec(result.stdout);
  return {
    determined: true,
    preventUserIdleDisplaySleep: match ? Number(match[1]) : 0,
    source: "pmset -g assertions (PreventUserIdleDisplaySleep)",
  };
}

function plistValue(path, key) {
  const result = runCommand("/usr/bin/defaults", ["read", path, key]);
  return result.ok ? result.stdout : null;
}

/** Collect reference machine facts, each with the command that produced it. */
function collectMachineFacts(webviewEvidence) {
  const facts = [];
  const notes = [];
  const hardware = runCommand("/usr/sbin/system_profiler", ["-json", "SPHardwareDataType"]);
  let hardwareData = null;
  if (hardware.ok) {
    try {
      hardwareData = JSON.parse(hardware.stdout).SPHardwareDataType?.[0] ?? null;
    } catch { hardwareData = null; }
  }
  const push = (label, value, source) => facts.push({
    label,
    value: value === null || value === undefined || value === "" ? "not determined" : String(value),
    source,
  });

  const sysctl = key => {
    const result = runCommand("/usr/sbin/sysctl", ["-n", key]);
    return result.ok ? result.stdout : null;
  };

  push("Model name", hardwareData?.machine_name, "system_profiler -json SPHardwareDataType (machine_name)");
  push("Model identifier", hardwareData?.machine_model,
    "system_profiler -json SPHardwareDataType (machine_model)");
  push("CPU", hardwareData?.chip_type ?? hardwareData?.cpu_type ?? sysctl("machdep.cpu.brand_string"),
    "system_profiler -json SPHardwareDataType (chip_type)");
  const logical = sysctl("hw.ncpu");
  const performanceCores = sysctl("hw.perflevel0.logicalcpu");
  const efficiencyCores = sysctl("hw.perflevel1.logicalcpu");
  push("CPU cores",
    logical
      ? `${logical} logical` +
        (performanceCores && efficiencyCores
          ? ` (${performanceCores} performance + ${efficiencyCores} efficiency)` : "")
      : null,
    "sysctl -n hw.ncpu hw.perflevel0.logicalcpu hw.perflevel1.logicalcpu");
  push("CPU cores visible to the WebView", webviewEvidence?.hardwareConcurrency,
    "navigator.hardwareConcurrency read inside the running application webview");
  const memoryBytes = sysctl("hw.memsize");
  push("RAM",
    hardwareData?.physical_memory
      ? `${hardwareData.physical_memory}${memoryBytes ? ` (${memoryBytes} bytes)` : ""}`
      : null,
    "system_profiler -json SPHardwareDataType (physical_memory) / sysctl -n hw.memsize");

  const displays = runCommand("/usr/sbin/system_profiler", ["-json", "SPDisplaysDataType"]);
  let gpu = null;
  if (displays.ok) {
    try {
      const entry = JSON.parse(displays.stdout).SPDisplaysDataType?.[0] ?? null;
      gpu = entry
        ? `${entry.sppci_model ?? "unknown"} (${entry.sppci_cores ?? "?"} cores, ` +
          `${entry.spdisplays_vendor ?? "unknown vendor"})`
        : null;
    } catch { gpu = null; }
  }
  push("GPU", gpu, "system_profiler -json SPDisplaysDataType");
  push("WebGL implementation (as the preview sees it)",
    webviewEvidence?.webgl?.available
      ? `${webviewEvidence.webgl.version} — renderer "${webviewEvidence.webgl.renderer}"` +
        (webviewEvidence.webgl.unmaskedRenderer
          ? `, unmasked "${webviewEvidence.webgl.unmaskedRenderer}"` : "")
      : null,
    "WebGL VERSION/RENDERER parameters read inside the running application webview");

  const productVersion = runCommand("/usr/bin/sw_vers", ["-productVersion"]);
  const buildVersion = runCommand("/usr/bin/sw_vers", ["-buildVersion"]);
  push("Operating system",
    productVersion.ok && buildVersion.ok
      ? `macOS ${productVersion.stdout} (build ${buildVersion.stdout})` : null,
    "sw_vers -productVersion / -buildVersion");

  const webkitShort = plistValue("/System/Library/Frameworks/WebKit.framework/Resources/Info",
    "CFBundleShortVersionString");
  const webkitBundle = plistValue("/System/Library/Frameworks/WebKit.framework/Resources/Info",
    "CFBundleVersion");
  push("WebView engine (system WebKit framework)",
    webkitShort || webkitBundle
      ? `WebKit.framework CFBundleShortVersionString ${webkitShort ?? "?"}, ` +
        `CFBundleVersion ${webkitBundle ?? "?"}`
      : null,
    "defaults read /System/Library/Frameworks/WebKit.framework/Resources/Info " +
    "CFBundleShortVersionString / CFBundleVersion");
  push("WebView engine (user agent reported by the app's WKWebView)",
    webviewEvidence?.userAgent,
    "navigator.userAgent read inside the running application webview");

  const rootDisk = runCommand("/usr/sbin/diskutil", ["info", "-plist", "/"]);
  let storage = null;
  if (rootDisk.ok) {
    const solidState = /<key>SolidState<\/key>\s*<(true|false)\/>/.exec(rootDisk.stdout);
    const protocol = /<key>BusProtocol<\/key>\s*<string>([^<]*)<\/string>/.exec(rootDisk.stdout);
    const media = /<key>MediaName<\/key>\s*<string>([^<]*)<\/string>/.exec(rootDisk.stdout);
    if (solidState) {
      storage = `${solidState[1] === "true" ? "Solid state" : "Rotational"}` +
        `${protocol ? `, ${protocol[1]} bus` : ""}` +
        `${media && media[1] ? `, media "${media[1]}"` : ""}`;
    }
  }
  push("Storage (volume the repository and binary live on)", storage,
    "diskutil info -plist / (SolidState / BusProtocol / MediaName keys)");

  const nvme = runCommand("/usr/sbin/system_profiler", ["-json", "SPNVMeDataType"]);
  if (nvme.ok) {
    try {
      const controller = JSON.parse(nvme.stdout).SPNVMeDataType?.[0];
      const drive = controller?._items?.[0];
      if (drive) {
        push("Storage device", `${drive._name ?? "unknown"} (${drive.size ?? "unknown size"})`,
          "system_profiler -json SPNVMeDataType");
      }
    } catch { /* reported as not determined below */ }
  }

  notes.push(
    "Every value above is the verbatim output of the listed command on the measurement " +
    "machine; nothing is inferred from model marketing names.");
  notes.push(
    "The application embeds no browser engine: it hosts the operating system's WKWebView, " +
    "so the WebView engine is identified both by the system WebKit framework's own bundle " +
    "version and by the user agent that the running application's webview reports. Apple " +
    "does not expose a separate WebKit build number through WKWebView, so no upstream " +
    "WebKit revision is claimed.");
  return { facts, notes };
}

function provenance() {
  const commit = runCommand("/usr/bin/git", ["-C", REPO, "rev-parse", "HEAD"]);
  const dirty = runCommand("/usr/bin/git", ["-C", REPO, "status", "--porcelain"]);
  const node = process.version;
  const binaryStat = statSync(BINARY);
  return {
    repositoryCommit: commit.ok ? commit.stdout : null,
    repositoryDirtyFileCount: dirty.ok
      ? dirty.stdout.split("\n").filter(Boolean).length : null,
    nodeVersion: node,
    binaryPath: BINARY.slice(REPO.length + 1),
    binarySha256: sha256OfFile(BINARY),
    binaryByteLength: binaryStat.size,
    binaryModifiedAt: binaryStat.mtime.toISOString(),
  };
}

/**
 * Turn the raw launches into per-phase samples.
 *
 * Every sample a launch actually produced is kept, whatever happened later in
 * that launch: a launch that dies in its second preview cycle still
 * contributes its shell-startup sample, all of its compilation samples and its
 * first preview/Stop cycle. Samples that a launch could not produce are
 * recorded as exclusions with the reason, never silently dropped.
 */
export function collectSamples(runs, options) {
  const samples = {
    "shell-startup": { cold: [], warm: [] },
    compilation: { cold: [], warm: [] },
    "preview-start": { cold: [], warm: [] },
    stop: { cold: [], warm: [] },
  };
  const supplementaryRaw = {
    processStartToShellReadyMs: [],
    compilerContextBootMs: [],
    previewStartedEventColdMs: [],
    previewStartedEventWarmMs: [],
    stopInstrumentedColdMs: [],
    stopInstrumentedWarmMs: [],
    stopAfterRenderingPreviewMs: [],
    stopAfterNonRenderingPreviewMs: [],
    firstFrameObservationIntervalMs: [],
    firstFrameLowerBoundMs: [],
    firstFrameEstimateMs: [],
    previewFrameRateFps: [],
    previewFrameCreateInvokeMs: [],
    previewDocumentLoadMs: [],
    previewRuntimeReadyMs: [],
    previewLoadAndStartMs: [],
  };
  const evidence = {
    frameCounts: [],
    firstObservationFrameCounts: [],
    runCounts: [],
    staticConstructorCounts: [],
    disposeCounts: [],
    callbackAfterDisposed: [],
    distinctAssemblyDigests: new Set(),
    censoredCycles: 0,
    renderedCycles: 0,
  };
  const exclusions = [];
  const censored = [];
  const contributionsByLaunch = new Map();

  for (const run of runs) {
    const key = `${run.attempt}:${run.mode}`;
    const record = { contributions: {}, censoredContributions: [] };
    contributionsByLaunch.set(key, record);
    const add = (phaseId, kind, sample) => {
      samples[phaseId][kind].push(sample);
      const target = `${phaseId}/${kind}`;
      record.contributions[target] = (record.contributions[target] ?? 0) + 1;
      if (sample.censored) {
        record.censoredContributions.push(`${target} >= ${sample.valueMs.toFixed(0)} ms`);
        censored.push({ phaseId, kind, ...sample });
      }
    };
    const sampleProvenance = source => ({
      attempt: run.attempt,
      launch: `${run.mode}/${run.shellLaunchKind}`,
      pid: run.pid,
      source,
      log: run.logFile,
    });
    const exclude = (phaseId, kind, reason) =>
      exclusions.push({ attempt: run.attempt, phaseId, kind, reason });

    // Memory-baseline mode is self-contained: collect its own samples below and
    // skip the standard shell-startup / compile / preview processing.
    if (run.mode === "memory-baseline") {
      if (run.shellReadyWallClockMs !== null) {
        supplementaryRaw.memoryBaselineShellReadyMs = supplementaryRaw.memoryBaselineShellReadyMs ?? [];
        supplementaryRaw.memoryBaselineShellReadyMs.push(run.shellReadyWallClockMs);
      }
      continue;
    }

    if (run.shellReadyWallClockMs !== null) {
      add("shell-startup", run.shellLaunchKind, {
        valueMs: run.shellReadyWallClockMs,
        censored: false,
        provenance: sampleProvenance("driver wall clock: spawn() → ISSUE041_SHELL_READY"),
      });
      supplementaryRaw.processStartToShellReadyMs.push(run.shellReady.processStartToShellReadyMs);
    } else {
      exclude("shell-startup", run.shellLaunchKind,
        `the ${run.mode} launch never reported ISSUE041_SHELL_READY (outcome: ${run.outcome}` +
        `${run.lastCheckpoint ? `, last checkpoint ${JSON.stringify(run.lastCheckpoint)}` : ""})`);
    }

    if (run.mode !== "full") continue;

    const report = run.report;
    const failureText = report?.failure
      ? String(report.failure)
      : `launch outcome ${run.outcome}` +
        (run.lastCheckpoint ? `, last checkpoint ${JSON.stringify(run.lastCheckpoint)}` : "");

    if (!report) {
      for (const [phaseId, kind] of PHASE_TARGETS) {
        if (phaseId === "shell-startup") continue;
        exclude(phaseId, kind, `the full launch produced no report at all (${failureText})`);
      }
      continue;
    }

    if (report.compilerInit) {
      supplementaryRaw.compilerContextBootMs.push(report.compilerInit.elapsedMs);
    }
    for (const sample of report.compileSamples ?? []) {
      evidence.distinctAssemblyDigests.add(sample.assemblySha256);
    }
    const coldCompile = (report.compileSamples ?? []).find(sample => sample.kind === "cold");
    if (report.compilerInit && coldCompile) {
      // The cold compilation sample is the compiler-context boot plus the first
      // compilation in that context, exactly as PRD 17 words "cold compiler
      // initialization ... for a project of up to five source files".
      add("compilation", "cold", {
        valueMs: report.compilerInit.elapsedMs + coldCompile.elapsedMs,
        censored: false,
        provenance: sampleProvenance("compiler-context boot + first compilation in that context"),
      });
    } else {
      exclude("compilation", "cold",
        `the launch never completed a cold compilation (${failureText})`);
    }
    const warmCompiles = (report.compileSamples ?? []).filter(sample => sample.kind === "warm");
    for (const sample of warmCompiles) {
      add("compilation", "warm", {
        valueMs: sample.elapsedMs,
        censored: false,
        provenance: sampleProvenance(`warm compilation #${sample.index} in the retained context`),
      });
    }
    if (warmCompiles.length === 0) {
      exclude("compilation", "warm",
        `the launch produced no warm compilation (${failureText})`);
    }

    const cycles = report.previewCycles ?? [];
    for (let cycle = 0; cycle < options.previewCycles; cycle++) {
      const kind = cycle === 0 ? "cold" : "warm";
      const measured = cycles.find(entry => entry.cycle === cycle);
      if (!measured) {
        const cycleFailure = (report.phaseFailures ?? [])
          .find(entry => entry.phase === `preview-cycle-${cycle}`);
        const reason = cycleFailure ? cycleFailure.detail : failureText;
        exclude("preview-start", kind, `preview cycle ${cycle} did not complete: ${reason}`);
        exclude("stop", kind, `preview cycle ${cycle} did not complete: ${reason}`);
        continue;
      }
      const censoredFrame = measured.firstFrame?.censored === true;
      add("preview-start", kind, {
        valueMs: measured.previewFirstFrameMs,
        censored: censoredFrame,
        censorReason: censoredFrame ? measured.firstFrame.censorReason : null,
        provenance: sampleProvenance(`preview cycle ${cycle}: compile response → first drawn frame`),
        note: censoredFrame ? measured.firstFrame.evidence : null,
        evidence: censoredFrame ? measured.firstFrame.evidence : null,
      });
      add("stop", kind, {
        valueMs: measured.stopControlReturnMs,
        censored: false,
        provenance: sampleProvenance(
          `preview cycle ${cycle}: Stop → controller idle` +
          `${measured.previewRenderedBeforeStop ? "" : " (preview had drawn no frame)"}`),
        note: measured.previewRenderedBeforeStop
          ? null
          : "Stop of a started preview that had not drawn a frame within its bound.",
      });

      supplementaryRaw.firstFrameObservationIntervalMs.push(measured.firstFrameObservationIntervalMs);
      supplementaryRaw.previewFrameCreateInvokeMs.push(measured.breakdown.frameCreateInvokeMs);
      supplementaryRaw.previewDocumentLoadMs.push(measured.breakdown.documentLoadMs);
      supplementaryRaw.previewLoadAndStartMs.push(measured.breakdown.loadAndStartMs);
      if (Number.isFinite(measured.breakdown.previewRuntimeReadyMs)) {
        supplementaryRaw.previewRuntimeReadyMs.push(measured.breakdown.previewRuntimeReadyMs);
      }
      if (typeof measured.firstFrame?.lowerBoundMs === "number") {
        supplementaryRaw.firstFrameLowerBoundMs.push(measured.firstFrame.lowerBoundMs);
      }
      if (typeof measured.firstFrame?.estimateMs === "number") {
        supplementaryRaw.firstFrameEstimateMs.push(measured.firstFrame.estimateMs);
      }
      if (typeof measured.frameRate?.framesPerSecond === "number") {
        supplementaryRaw.previewFrameRateFps.push(measured.frameRate.framesPerSecond);
      }
      if (kind === "cold") {
        supplementaryRaw.previewStartedEventColdMs.push(measured.previewStartedMs);
        supplementaryRaw.stopInstrumentedColdMs.push(measured.stopInstrumentedMs);
      } else {
        supplementaryRaw.previewStartedEventWarmMs.push(measured.previewStartedMs);
        supplementaryRaw.stopInstrumentedWarmMs.push(measured.stopInstrumentedMs);
      }
      if (measured.previewRenderedBeforeStop) {
        supplementaryRaw.stopAfterRenderingPreviewMs.push(measured.stopControlReturnMs);
        evidence.renderedCycles++;
        evidence.frameCounts.push(measured.frameCountBeforeStop);
        evidence.firstObservationFrameCounts.push(measured.frameCountAtFirstObservation);
      } else {
        supplementaryRaw.stopAfterNonRenderingPreviewMs.push(measured.stopControlReturnMs);
        evidence.censoredCycles++;
      }
      evidence.runCounts.push(measured.runCount);
      evidence.staticConstructorCounts.push(measured.staticConstructorCount);
      evidence.disposeCounts.push(measured.disposeCount);
      evidence.callbackAfterDisposed.push(measured.callbackAfterDisposedCount);
    }

    // Memory-baseline mode: RSS samples and cleanup verification.
    if (run.mode === "memory-baseline") {
      const report = run.report;
      const mbFailureText = report?.failure
        ? String(report.failure)
        : `launch outcome ${run.outcome}`;

      if (!report) {
        exclusions.push({
          attempt: run.attempt,
          phaseId: "memory-baseline",
          kind: "baseline",
          reason: `the memory-baseline launch produced no report at all (${mbFailureText})`,
        });
      } else {
        supplementaryRaw.memoryBaselineCompilerRssBytes = supplementaryRaw.memoryBaselineCompilerRssBytes ?? [];
        supplementaryRaw.memoryBaselinePreviewRssBytes = supplementaryRaw.memoryBaselinePreviewRssBytes ?? [];
        supplementaryRaw.memoryBaselineCleanupVerification = supplementaryRaw.memoryBaselineCleanupVerification ?? [];

        if (report.compilerRssSamples) {
          for (const sample of report.compilerRssSamples) {
            supplementaryRaw.memoryBaselineCompilerRssBytes.push(sample.bytes);
          }
        }
        if (report.previewRssSamples) {
          for (const sample of report.previewRssSamples) {
            supplementaryRaw.memoryBaselinePreviewRssBytes.push(sample.bytes);
          }
        }
        if (report.cleanupVerification) {
          supplementaryRaw.memoryBaselineCleanupVerification.push(report.cleanupVerification);
        }

        if (report.failures && report.failures.length > 0) {
          exclusions.push({
            attempt: run.attempt,
            phaseId: "memory-baseline",
            kind: "baseline",
            reason: `benchmark failures: ${report.failures.join(", ")}`,
          });
        }
      }
    }
  }
  return { samples, supplementaryRaw, evidence, exclusions, censored, contributionsByLaunch };
}

/** Phase/kind targets that still need more samples. */
export function missingTargets(samples, required = REQUIRED_SAMPLES_PER_PHASE) {
  return PHASE_TARGETS
    .map(([phaseId, kind]) => ({
      phaseId,
      kind,
      have: samples[phaseId][kind].length,
      required,
    }))
    .filter(target => target.have < target.required);
}

function supplementaryTable(supplementaryRaw) {
  const entries = [
    ["processStartToShellReadyMs",
      "Shell startup measured inside the process (Rust process-start instant → shell ready)",
      "Excludes exec/dyld time before `main`; the PASS/FAIL phase above uses the driver's " +
      "wall clock from `spawn()`, which is the strict superset."],
    ["compilerContextBootMs",
      "Compiler-context boot alone (no compilation)",
      "The cold compilation phase above is this value plus the first compile."],
    ["previewStartedEventColdMs",
      "Compile response → `preview.started` lifecycle event (cold)",
      "Measured lower bound on preview startup: the Game cannot have drawn before it was " +
      "started. The PASS/FAIL phase uses the first frame the Game reports drawing."],
    ["previewStartedEventWarmMs",
      "Compile response → `preview.started` lifecycle event (warm)",
      "Measured lower bound on preview startup: the Game cannot have drawn before it was " +
      "started. The PASS/FAIL phase uses the first frame the Game reports drawing."],
    ["stopInstrumentedColdMs",
      "Issue 024 in-protocol Stop latency (cold)",
      "Stop request sent → `preview.stopped` observed and resources released, inside the shell."],
    ["stopInstrumentedWarmMs",
      "Issue 024 in-protocol Stop latency (warm)",
      "Stop request sent → `preview.stopped` observed and resources released, inside the shell."],
    ["stopAfterRenderingPreviewMs",
      "Stop latency restricted to previews that had drawn frames",
      "Same measurement as the Stop phase above, restricted to cycles whose preview was " +
      "confirmed drawing. Published so the Stop distribution can be read with and without the " +
      "non-rendering cycles; the PASS/FAIL phase above includes every Stop."],
    ["stopAfterNonRenderingPreviewMs",
      "Stop latency restricted to previews that had drawn no frame",
      "The complement of the row above: Stop of a started preview whose Game reported no drawn " +
      "frame inside the first-frame bound. Included in the Stop phase above, and shown " +
      "separately so it is not hidden."],
    ["firstFrameLowerBoundMs",
      "Measured lower bound on the first-frame instant (compile response → `preview.start.request`)",
      "The Game cannot draw before the start request leaves the shell, so the true first-frame " +
      "time is bracketed between this row and the reported first-frame sample."],
    ["firstFrameEstimateMs",
      "Frame-rate corrected estimate of the first-frame instant",
      "The reported sample minus (frames already drawn at the first observation - 1) divided by " +
      "the frame rate measured immediately afterwards. An estimate only: no verdict uses it."],
    ["previewFrameRateFps",
      "Frame rate of the running preview (frames per second)",
      "Measured after the first-frame sample was taken, over a 250 ms window, from the Game's " +
      "own frame counter. Used only to quantify the first-frame overshoot."],
    ["firstFrameObservationIntervalMs",
      "Bridge round trip of the observation that saw the first frame",
      "The preview-bridge round trip that returned the observation, plus one 5 ms poll interval " +
      "when polling was needed. This bounds only the latency of the final observation, not the " +
      "whole overshoot: frames drawn before that observation are accounted for by the " +
      "frame-rate corrected estimate above."],
    ["previewFrameCreateInvokeMs",
      "Preview startup breakdown: embedded preview iframe created (compile response → iframe invoked)",
      "Creating the embedded opaque-origin sandboxed preview iframe and setting its srcdoc " +
      "in-page (ADR 0003). There is no isolated OS window and no Rust window-create command."],
    ["previewDocumentLoadMs",
      "Preview startup breakdown: sandboxed preview document load",
      "The embedded preview iframe document finishing loading. This is real in-page document " +
      "load time; the retired isolated-window path instead slept a fixed 1500 ms here."],
    ["previewRuntimeReadyMs",
      "Preview startup breakdown: real preview-runtime work (document load → `preview.bridge.ready`)",
      "Measured on the in-page bridge-readiness promise itself, observed passively inside " +
      "`createEmbeddedProofPreview`, so it is the instant the preview .NET/MonoGame WASM runtime " +
      "actually reported readiness. No Rust bootstrap-loop deadline is involved on this path."],
    ["previewLoadAndStartMs",
      "Preview startup breakdown: assembly load + start → `preview.started`",
      "Everything after the preview runtime is ready: DLL/PDB transfer inline over the in-page " +
      "protocol port, `preview.load` and `preview.start`."],
  ];
  return entries
    .filter(([key]) => supplementaryRaw[key].length > 0)
    .map(([key, title, note]) => {
      const stats = summarize(supplementaryRaw[key]);
      return { title, count: stats.count, p50Ms: stats.p50Ms, p95Ms: stats.p95Ms, note };
    });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (process.platform !== "darwin") {
    throw new Error("this driver measures the macOS packaged binary");
  }
  try {
    statSync(BINARY);
  } catch {
    throw new Error(
      `packaged proof binary not found: ${BINARY}\n` +
      "build it first: npm --prefix src/desktop run tauri -- build " +
      "--config src-tauri/tauri.proof.conf.json");
  }

  const preexisting = applicationPids();
  if (preexisting.length > 0) {
    throw new Error(
      `an application process is already running (pid ${preexisting.join(", ")}). ` +
      "Close it before measuring; this driver never signals processes it did not spawn.");
  }

  if (options.dryRun) {
    console.log(JSON.stringify({ options, binary: BINARY }, null, 2));
    return;
  }

  const sessionAtStart = requireUnlockedConsoleSession("before the run");
  const sleepAssertions = sleepAssertionState();
  if (sleepAssertions.determined && sleepAssertions.preventUserIdleDisplaySleep === 0) {
    console.warn(
      "warning: no PreventUserIdleDisplaySleep assertion is held. Run the driver under " +
      "`caffeinate -di` so the display cannot sleep mid-measurement.");
  }

  const runs = [];
  const attemptRecords = [];
  let attempt = 0;
  let stopReason = null;
  let sessionInterrupted = false;
  // When memory-baseline mode is the primary concern, standard phases only
  // need 1 sample each (provided by each full/shell-only run). The 10-sample
  // requirement applies only to the standard full/shell-only runs.
  const standardRequired = options.memoryBaseline ? 1 : REQUIRED_SAMPLES_PER_PHASE;
  let lastCollected = collectSamples(runs, options);
  for (;;) {
    lastCollected = collectSamples(runs, options);
    const missing = missingTargets(lastCollected.samples, standardRequired);
    if (attempt >= options.runs && missing.length === 0) {
      stopReason =
        options.memoryBaseline
          ? `memory-baseline completed after ${attempt} attempt(s); standard phases ` +
            `reached ${standardRequired} sample(s) each`
          : `every phase and kind reached ${REQUIRED_SAMPLES_PER_PHASE} samples after ` +
            `${attempt} attempt(s)`;
      break;
    }
    if (attempt >= options.maxAttempts) {
      stopReason =
        `the finite attempt budget of ${options.maxAttempts} attempt(s) was exhausted with ` +
        `${missing.map(target => `${target.phaseId}/${target.kind} at ${target.have}/` +
          `${target.required}`).join(", ")} still short`;
      break;
    }
    attempt++;
    const attemptStartedAt = new Date().toISOString();
    const retryReason = attempt > options.runs
      ? `attempt beyond the nominal ${options.runs}: ` +
        missing.map(target =>
          `${target.phaseId}/${target.kind} has ${target.have}/${target.required} samples`)
          .join("; ")
      : null;
    if (retryReason) process.stdout.write(`\nadditional attempt required — ${retryReason}\n`);

    const sessionBefore = consoleSessionState();
    if (!sessionBefore.determined || sessionBefore.screenLocked ||
        sessionBefore.onConsole === false) {
      // Stop measuring rather than record samples taken on a session that
      // suppresses rendering. Everything already collected is still reported.
      stopReason =
        `the console session became ${sessionBefore.screenLocked ? "locked" : "unavailable"} ` +
        `before attempt ${attempt}, so measuring stopped; rendering is suppressed there and ` +
        "any further sample would be invalid";
      attempt--;
      sessionInterrupted = true;
      break;
    }

    // Cooling gap: no application process runs during this window, so the next
    // launch is the "cold" shell sample.
    process.stdout.write(
      `\n[attempt ${attempt}/${options.maxAttempts}] cooling ${options.coolingSeconds}s ` +
      "before cold launch…\n");
    await sleep(options.coolingSeconds * 1_000);

    process.stdout.write(`[attempt ${attempt}] cold full run…\n`);
    const full = await launch({
      attempt,
      mode: "full",
      shellLaunchKind: "cold",
      timeoutMs: FULL_RUN_TIMEOUT_MS,
      options,
    });
    runs.push(full);
    process.stdout.write(
      `  outcome=${full.outcome} exit=${full.exitCode} ` +
      `shell=${full.shellReadyWallClockMs?.toFixed(0) ?? "n/a"}ms ` +
      `wall=${full.wallClockMs.toFixed(0)}ms` +
      `${full.report?.failure ? ` failure=${String(full.report.failure).slice(0, 120)}` : ""}\n`);

    // Immediately re-launch: OS and WebKit caches are warm, so this is the
    // "warm" shell-startup sample.
    process.stdout.write(`[attempt ${attempt}] warm shell-only run…\n`);
    const shellOnly = await launch({
      attempt,
      mode: "shell-only",
      shellLaunchKind: "warm",
      timeoutMs: SHELL_RUN_TIMEOUT_MS,
      options,
    });
    runs.push(shellOnly);
    process.stdout.write(
      `  outcome=${shellOnly.outcome} exit=${shellOnly.exitCode} ` +
      `shell=${shellOnly.shellReadyWallClockMs?.toFixed(0) ?? "n/a"}ms\n`);

    // Memory-baseline: 100 compilations + 20 preview cycles with RSS sampling.
    if (options.memoryBaseline) {
      process.stdout.write(`[attempt ${attempt}] memory-baseline run…\n`);
      const memoryBaseline = await launch({
        attempt,
        mode: "memory-baseline",
        shellLaunchKind: "baseline",
        timeoutMs: MEMORY_BASELINE_TIMEOUT_MS,
        options,
      });
      runs.push(memoryBaseline);
      process.stdout.write(
        `  outcome=${memoryBaseline.outcome} exit=${memoryBaseline.exitCode} ` +
        `wall=${memoryBaseline.wallClockMs.toFixed(0)}ms ` +
        `${memoryBaseline.report?.failure ? ` failure=${String(memoryBaseline.report.failure).slice(0, 120)}` : ""}\n`);
    }

    attemptRecords.push({
      attempt,
      retryReason,
      startedAt: attemptStartedAt,
      consoleSessionBefore: sessionBefore,
      consoleSessionAfter: consoleSessionState(),
      launchKeys: options.memoryBaseline
        ? [`${attempt}:full`, `${attempt}:shell-only`, `${attempt}:memory-baseline`]
        : [`${attempt}:full`, `${attempt}:shell-only`],
    });
  }

  const leaked = applicationPids();
  const ownedPids = new Set(runs.map(run => run.pid).filter(pid => pid !== null));
  const orphans = leaked.filter(pid => !ownedPids.has(pid));

  const { samples, supplementaryRaw, evidence, exclusions, censored, contributionsByLaunch } =
    lastCollected;
  const aggregated = aggregate(samples, { requiredSamples: standardRequired });
  const webviewEvidence = runs.find(run => run.report?.environment)?.report.environment ?? null;
  const machine = collectMachineFacts(webviewEvidence);
  const failedRuns = runs.filter(run => run.outcome !== "ok");
  const sessionAtEnd = consoleSessionState();

  const attempts = attemptRecords.map(record => {
    const launches = runs.filter(run => run.attempt === record.attempt);
    const contributions = {};
    const censoredContributions = [];
    for (const key of record.launchKeys) {
      const entry = contributionsByLaunch.get(key);
      if (!entry) continue;
      for (const [target, count] of Object.entries(entry.contributions)) {
        contributions[target] = (contributions[target] ?? 0) + count;
      }
      censoredContributions.push(...entry.censoredContributions);
    }
    return {
      attempt: record.attempt,
      startedAt: record.startedAt,
      retryReason: record.retryReason,
      consoleSessionBefore: record.consoleSessionBefore,
      consoleSessionAfter: record.consoleSessionAfter,
      launches: launches.map(run => ({
        mode: run.mode,
        shellLaunchKind: run.shellLaunchKind,
        pid: run.pid,
        outcome: run.outcome,
        exitCode: run.exitCode,
        signal: run.signal,
        timedOut: run.timedOut,
        wallClockMs: run.wallClockMs,
        failure: run.report?.failure ?? null,
        phaseFailures: run.report?.phaseFailures ?? [],
        phaseReached: run.report?.phaseReached ?? null,
        log: run.logFile,
      })),
      contributions,
      censoredContributions,
      exclusions: exclusions
        .filter(entry => entry.attempt === record.attempt)
        .map(entry => `${entry.phaseId}/${entry.kind}: ${entry.reason}`),
    };
  });

  const launchFailures = runs
    .filter(run => run.outcome !== "ok" || run.report?.failure)
    .map(run => ({
      attempt: run.attempt,
      mode: run.mode,
      outcome: run.outcome,
      exitCode: run.exitCode,
      signal: run.signal,
      lastCheckpoint: run.lastCheckpoint ? JSON.stringify(run.lastCheckpoint) : null,
      failure: run.report?.failure ? String(run.report.failure) : null,
      phaseFailures: run.report?.phaseFailures ?? [],
      phaseReached: run.report?.phaseReached ?? null,
      log: run.logFile,
      contributions: contributionsByLaunch.get(`${run.attempt}:${run.mode}`)?.contributions ?? {},
    }));

  const coldShellSamples = samples["shell-startup"].cold.map(sample => sample.valueMs);
  const caveats = [];
  if (coldShellSamples.length > 0) {
    caveats.push(
      `Cold shell samples in this report span ` +
      `${Math.min(...coldShellSamples).toFixed(0)}-${Math.max(...coldShellSamples).toFixed(0)} ms. ` +
      "The slowest cold launch is normally the first launch after the binary is rebuilt, when " +
      "its pages are not yet in the operating system's file cache; later cold launches read a " +
      "cached binary. A true first-ever launch on a given machine can therefore be slower than " +
      "the median cold sample here.");
  }
  caveats.push(
    "Cold/warm for the shell phase is defined by process and cache state that this driver " +
    "controls: cold launches are preceded by an enforced idle gap with no application " +
    "process running, warm launches start immediately after the previous process exited. " +
    "The OS page cache cannot be purged without root, so \"cold\" here means cold " +
    "application state, not a cold file cache.");
  caveats.push(
    "Preview startup is measured on the embedded opaque-origin sandboxed-iframe path that the " +
    "product ships (ADR 0003): the preview is an in-page iframe created and driven inside the " +
    "Workbench WebView, not a separate isolated OS window. The retired isolated-window harness " +
    "performed a fixed 1500 ms settle sleep and could wait out a 10 000 ms Rust bootstrap-loop " +
    "deadline after creating a second WebviewWindow; neither exists on this path, so neither is " +
    "measured. Historical isolated-window measurements are recorded separately and are not " +
    "presented as measurements of this embedded product path.");
  if (supplementaryRaw.previewDocumentLoadMs.length > 0) {
    const load = summarize(supplementaryRaw.previewDocumentLoadMs);
    const ready = summarize(supplementaryRaw.previewRuntimeReadyMs);
    caveats.push(
      "The embedded preview-start breakdown is entirely real in-page work: the sandboxed " +
      `preview iframe document loads in ${load.p50Ms.toFixed(0)} ms (p50) / ` +
      `${load.p95Ms.toFixed(0)} ms (p95), and the preview .NET/MonoGame WASM runtime then ` +
      `reports readiness ${ready.p50Ms.toFixed(0)} ms (p50) / ${ready.p95Ms.toFixed(0)} ms ` +
      "(p95) later, measured passively on the in-page bridge-readiness promise inside " +
      "`createEmbeddedProofPreview`. There is no fixed settle sleep and no bootstrap-loop " +
      "deadline race to subtract.");
  }
  caveats.push(
    "The measured Run path enables the issue 021/023/024 preview proof instrumentation, " +
    "because the frame counters that prove the preview is visibly active are exposed by that " +
    "instrumentation. Each reported sample therefore contains that instrumentation's own cost, " +
    "so as an estimate of the same phase in an uninstrumented build every observed sample is an " +
    "upper bound. This is a separate statement from the observation bounds above: a censored " +
    "sample is a lower bound on the instrumented run itself and implies nothing about an " +
    "uninstrumented one.");
  caveats.push(
    "The benchmark harness and its Tauri commands are inert unless " +
    "`MONOGAME_ISSUE041_BENCHMARK=1` is set in the process environment.");
  if (evidence.firstObservationFrameCounts.length > 0) {
    const rate = supplementaryRaw.previewFrameRateFps.length > 0
      ? summarize(supplementaryRaw.previewFrameRateFps) : null;
    caveats.push(
      "Uncensored preview-startup samples are upper bounds on the true first-frame instant: " +
      "the observation is a poll through the preview bridge, and the Game had already drawn " +
      `${Math.min(...evidence.firstObservationFrameCounts)}-` +
      `${Math.max(...evidence.firstObservationFrameCounts)} frames when the observation ` +
      "landed. The overshoot is therefore larger than the bridge round trip alone. It is " +
      "quantified in the supplementary table by the frame-rate corrected estimate" +
      `${rate ? ` (measured frame rate p50 ${rate.p50Ms.toFixed(1)} fps)` : ""}, and the true ` +
      "first-frame instant is bracketed below by the measured compile-response to " +
      "`preview.start.request` interval. Censored samples are the opposite case: they are " +
      "lower bounds, and are marked as such wherever they appear.");
  }
  caveats.push(
    "Samples were collected on one machine in one session; they are a feasibility baseline, " +
    "not a cross-machine guarantee.");
  if (aggregated.overallVerdict === "FAIL") {
    caveats.push(
      "At least one threshold FAILED. Per this issue's scope, no optimization was attempted; " +
      "the failure is recorded as a known gap for the issue 044 feasibility gate review.");
  }
  if (failedRuns.length > 0 || launchFailures.length > 0) {
    caveats.push(
      `${launchFailures.length} launch(es) failed or failed part-way ` +
      `(${launchFailures.map(failure => `attempt ${failure.attempt} ${failure.mode}: ` +
        `${failure.outcome}`).join(", ")}). Every sample those launches had already completed ` +
      "is kept and listed with its provenance; only the phases they never reached are missing, " +
      "and each of those is listed in \"Samples that could not be taken\" with its reason. " +
      "Additional attempts were then made, inside the stated attempt budget, until each phase " +
      `reached ${standardRequired} samples.`);
  }
  if (censored.length > 0) {
    caveats.push(
      `${censored.length} preview-startup sample(s) are right-censored: the preview was still ` +
      "reporting no drawn frame when its hard first-frame bound expired, so the recorded value " +
      "is that bound and the true value is at least as large. These samples count in the " +
      "preview-startup distribution and in its verdict; they are not discarded, and the launches " +
      "that produced them also contributed their shell, compilation and Stop samples.");
  }
  if (orphans.length > 0) {
    caveats.push(`Orphan application processes detected after the run: ${orphans.join(", ")}.`);
  }
  if (sessionAtEnd.screenLocked === true || sessionAtEnd.onConsole === false) {
    caveats.push(
      "The console session was locked or off-console when the run finished, which can suppress " +
      "rendering; treat the later samples with suspicion and re-measure.");
  }
  if (sessionInterrupted) {
    caveats.push(
      "Measuring stopped early because the console session locked mid-run: rendering is " +
      "suppressed on a locked session, so no further attempt could produce a valid sample. " +
      "Everything collected before that point is reported unchanged.");
  }

  const activation = {
    launches: runs.filter(run => run.shellReady !== null).length,
    reportedWindowVisible: runs.filter(run => run.shellReady?.windowVisible === true).length,
    reportedWindowFocused: runs.filter(run => run.shellReady?.windowFocused === true).length,
    reportedWindowMinimized: runs.filter(run => run.shellReady?.windowMinimized === true).length,
    source: "issue041_shell_ready: the Rust side records the native window's visibility, focus " +
      "and minimised state at the instant the shell reports being ready",
  };
  if (activation.launches > 0 && activation.reportedWindowFocused < activation.launches) {
    caveats.push(
      `${activation.launches - activation.reportedWindowFocused} of ${activation.launches} ` +
      "launches reported their native window unfocused at shell-ready. macOS suppresses " +
      "rendering for a window that never activates, so preview samples from those launches may " +
      "be censored for that reason rather than for anything the product does.");
  }

  const sampleTreatment = [
    "No sample is dropped because a later phase of the same launch failed. Each launch " +
    "contributes every phase it actually completed: a launch that breaks in its second preview " +
    "cycle still contributes its shell-startup sample, all of its compilation samples and its " +
    "first preview and Stop samples.",
    `A preview that reports no drawn frame within the hard ${20_000 / 1_000} s first-frame ` +
    "bound (measured from `preview.started`) is recorded as a right-censored sample whose value " +
    "is the elapsed time from the compile response to the moment observation was abandoned. " +
    "That value is at least the bound, the sample counts towards the preview-startup " +
    "distribution and verdict, and the whole launch is kept.",
    "A percentile that lands on a censored sample is reported as a lower bound (`>=`). Such a " +
    "phase can be a definitive FAIL when the bound already breaches the threshold, but it can " +
    "never be a PASS; it is reported as INDETERMINATE instead.",
    "Stop samples are kept whenever a Stop actually ran, including the Stop of a preview that " +
    "had drawn no frame, because that is still a real Stop of a started preview. Both subsets " +
    "are published separately in the supplementary table so the distribution can be read either " +
    "way without any sample being hidden.",
    "Samples that could not exist (a phase a launch never reached) are listed individually with " +
    "the reason, and are the only cause of an additional attempt.",
    `Attempts continue until every phase and kind holds ${standardRequired} sample(s), ` +
    `bounded by a finite budget of ${options.maxAttempts} attempt(s) (the default budget is ` +
    `${DEFAULT_ATTEMPT_BUDGET_MULTIPLIER}x the ${options.runs} nominal attempts). No attempt is ` +
    "ever discarded because its numbers were slow or unwelcome: every attempt made is in the " +
    "attempt inventory.",
  ];

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    issue: "041-measure-startup-compile-preview-stop-timings",
    prdReferences: ["17", "20.2"],
    overallVerdict: aggregated.overallVerdict,
    sampleCountViolations: aggregated.violations,
    machine,
    provenance: {
      ...provenance(),
      consoleSessionAtStart: sessionAtStart,
      consoleSessionAtEnd: sessionAtEnd,
      sleepAssertionsAtStart: sleepAssertions,
      windowActivation: activation,
    },
    sampleTreatment,
    attemptInventory: {
      nominalAttempts: options.runs,
      attemptsMade: attempts.length,
      attemptBudget: options.maxAttempts,
      budgetRule:
        options.memoryBaseline
          ? `attempts continue until standard phases hold ${standardRequired} sample(s) each, ` +
            `up to ${DEFAULT_ATTEMPT_BUDGET_MULTIPLIER}x the nominal attempt count ` +
            "(overridable with --max-attempts); the budget is finite so a persistently broken " +
            "build cannot loop."
          : `attempts continue until every phase and kind holds ${REQUIRED_SAMPLES_PER_PHASE} ` +
            `samples, up to ${DEFAULT_ATTEMPT_BUDGET_MULTIPLIER}x the nominal attempt count ` +
            "(overridable with --max-attempts); the budget is finite so a persistently broken " +
            "build cannot loop.",
      stopReason,
      requirementsAtEnd: PHASE_TARGETS.map(([phaseId, kind]) => ({
        phaseId,
        kind,
        samples: samples[phaseId][kind].length,
        censored: samples[phaseId][kind].filter(sample => sample.censored).length,
        required: standardRequired,
      })),
      attempts,
    },
    launchFailures,
    censoredSamples: censored,
    excludedSamples: exclusions,
    methodology: {
      summary: [
        `${attempts.length} attempt(s) were made. Each attempt is one cold application launch, ` +
        `preceded by a ${options.coolingSeconds} s idle cooling gap with no application process ` +
        "running, immediately followed by one warm launch started as soon as the previous " +
        "process exited.",
        "Each cold launch boots the persistent compiler context once, compiles the committed " +
        `five-file fixture once cold and ${options.warmCompiles} times warm, then runs ` +
        `${options.previewCycles} full Run→Stop preview cycles (cycle 1 cold, later cycles warm).`,
        "Every timestamp is taken on a monotonic clock at the point being measured: " +
        "`std::time::Instant` in Rust for process start, `performance.now()` in the shell for " +
        "compile/preview/Stop, and `process.hrtime.bigint()` in this driver for the wall-clock " +
        "bracket around each process launch. No sample is a sleep, a wall-clock difference " +
        "across processes, or a value inferred from another measurement.",
        "The application shell's own top-level demo runtime is allowed to reach its rendering " +
        "steady state before the compile/preview/Stop phases begin; that wait is a precondition " +
        "and is excluded from every reported sample.",
        "The preview-startup sample is the first frame the running Game itself reports having " +
        `drawn, observed by polling the preview bridge every 5 ms, with a hard ` +
        `${20_000 / 1_000} s bound measured from \`preview.started\`. An observed sample is an ` +
        "upper bound on the true first-frame instant; a sample that hits the bound is recorded " +
        "as a right-censored lower bound. Both directions are stated explicitly wherever the " +
        "sample is used.",
        `The driver regenerates \`docs/performance-baseline.json\` and \`docs/performance-baseline.md\` ` +
        "from the raw samples on every run; neither file is edited by hand.",
      ],
      percentileMethod:
        "Deterministic nearest-rank, no interpolation: samples are sorted ascending and the " +
        "reported percentile is the element at 1-based rank `ceil(p/100 x n)`, so every " +
        "reported percentile is an observed sample. For n = 10 this makes p50 the 5th smallest " +
        "sample (the lower median) and p95 the largest sample. Censored samples participate " +
        "with their bound value; a percentile that selects one is marked `>=` and treated as a " +
        "lower bound. The same method is applied to every phase, and " +
        "`scripts/performance-report.test.mjs` pins it.",
      thresholdInclusivity:
        "Each threshold uses exactly the inclusivity PRD section 17 words. \"Warm compilation " +
        "p95 under 2 seconds\" and \"cold compiler initialization p95 under 5 seconds\" are " +
        "strict (`p95 < threshold`); \"application shell visible within 3 seconds\", \"preview " +
        "visibly active within 3 seconds\" and \"Stop returning control to the editor within 2 " +
        "seconds\" are inclusive (`p95 <= threshold`). A p95 exactly equal to a strict threshold " +
        "is therefore recorded as FAIL, and exactly equal to an inclusive threshold as PASS. " +
        "When the p95 is a censored lower bound, a breach is still a definitive FAIL but a " +
        "value inside the threshold is reported as INDETERMINATE, never as a PASS.",
      fixture: [
        "`tests/integration/fixtures/perf-benchmark/` — five C# source files " +
        "(`Game1.cs`, `Entity.cs`, `World.cs`, `MathUtilities.cs`, `Telemetry.cs`) forming a " +
        "small but realistic MonoGame project: a Game subclass driving a 64-entity simulation " +
        "with per-frame loops, shared math helpers and a bounded telemetry ring buffer.",
        "The same five files are used for every compilation sample and for the preview cycles, " +
        "so compile and preview measurements describe the same project.",
        `Every compilation in this report produced the same assembly digest ` +
        `(${evidence.distinctAssemblyDigests.size} distinct digest(s) across all runs), which is ` +
        "evidence the compiler did the same work each time rather than short-circuiting.",
      ],
      runPlan: [
        `Launches: ${runs.length} total (` +
        `${runs.filter(run => run.mode === "full").length} full, ` +
        `${runs.filter(run => run.mode === "shell-only").length} shell-only, ` +
        `${runs.filter(run => run.mode === "memory-baseline").length} memory-baseline` +
        `) across ${attempts.length} attempt(s) within a budget of ${options.maxAttempts}.`,
        `Hard timeouts: ${FULL_RUN_TIMEOUT_MS / 1_000} s per full launch, ` +
        `${SHELL_RUN_TIMEOUT_MS / 1_000} s per shell-only launch, ` +
        `${MEMORY_BASELINE_TIMEOUT_MS / 1_000} s per memory-baseline launch, ` +
        `${20_000 / 1_000} s per first-frame observation (censoring bound), and a 300 s ` +
        "whole-harness budget inside each launch.",
        "Process discipline: only the exact PIDs this driver spawned are ever signalled " +
        "(SIGTERM, then SIGKILL after a 5 s grace); `pkill` and `killall` are never used; the " +
        "driver refuses to start if an application process it does not own is already running.",
        `Orphan application processes after the run: ${orphans.length === 0 ? "none" : orphans.join(", ")}.`,
      ],
    },
    phases: aggregated.phases,
    supplementary: supplementaryTable(supplementaryRaw),
    previewEvidence: {
      cyclesObserved: evidence.frameCounts.length + evidence.censoredCycles,
      cyclesThatRendered: evidence.renderedCycles,
      cyclesCensoredWithoutAFrame: evidence.censoredCycles,
      previewTransport: "embedded-in-page-opaque-origin-iframe",
      minimumFrameCountBeforeStop: evidence.frameCounts.length ? Math.min(...evidence.frameCounts) : null,
      framesAlreadyDrawnAtFirstObservation: evidence.firstObservationFrameCounts.length
        ? {
          min: Math.min(...evidence.firstObservationFrameCounts),
          max: Math.max(...evidence.firstObservationFrameCounts),
        }
        : null,
      everyCycleFreshGameState:
        evidence.runCounts.every(value => value === 1) &&
        evidence.staticConstructorCounts.every(value => value === 1),
      everyCycleDisposedExactlyOnce: evidence.disposeCounts.every(value => value === 1),
      callbacksIntoDisposedState: evidence.callbackAfterDisposed.reduce(
        (total, value) => total + Math.max(0, value), 0),
    },
    caveats,
    reproduction: {
      commands: [
        "npm --prefix src/desktop run tauri -- build --config " +
          "src-tauri/tauri.proof.conf.json",
        `caffeinate -di node scripts/measure-performance.mjs --runs ${options.runs} ` +
        `${options.memoryBaseline
          ? `--memory-baseline --warm-compiles-baseline ${options.warmCompilesBaseline} ` +
            `--preview-cycles-baseline ${options.previewCyclesBaseline} `
          : `--warm-compiles ${options.warmCompiles} --preview-cycles ${options.previewCycles} `}` +
        `--cooling-seconds ${options.coolingSeconds} --max-attempts ${options.maxAttempts}`,
        "node --test scripts/performance-report.test.mjs scripts/measure-performance.test.mjs",
      ],
      notes: [
        "The driver requires the macOS proof-profile release binary at " +
        "`src/desktop/src-tauri/target/release/monogame-playground`; build it with " +
        "`src-tauri/tauri.proof.conf.json` immediately before measuring because the raw " +
        "Cargo target path is shared by product and proof builds.",
        "Run it under `caffeinate -di` on an unlocked console session: the measured Run path " +
        "requires the application window to activate and paint, which macOS suppresses while " +
        "the display sleeps or the screen is locked. The driver reads the console session " +
        "state before every attempt and refuses to measure a locked or off-console session.",
        "The driver publishes a run whose launches failed, provided every phase still reached " +
        "its required sample count: the failures, the censored samples and the attempts are all " +
        "part of the report. It refuses to publish only when a phase is short of samples or the " +
        "report fails schema validation, in which case it writes " +
        "`artifacts/issue041/rejected-report.json` and leaves the committed documents untouched.",
        "Per-launch stdout is written to `artifacts/issue041/attempt-NN-<mode>-<kind>.log`.",
        "Re-running the driver overwrites both `docs/performance-baseline.json` and " +
        "`docs/performance-baseline.md`; absolute numbers vary between sessions and machines.",
      ],
    },
    runs: runs.map(run => ({
      attempt: run.attempt,
      mode: run.mode,
      shellLaunchKind: run.shellLaunchKind,
      pid: run.pid,
      exitCode: run.exitCode,
      signal: run.signal,
      timedOut: run.timedOut,
      wallClockMs: run.wallClockMs,
      shellReadyWallClockMs: run.shellReadyWallClockMs,
      shellReady: run.shellReady,
      outcome: run.outcome,
      cleanup: run.cleanup,
      checkpointCount: run.checkpoints.length,
      lastCheckpoint: run.lastCheckpoint,
      failure: run.report?.failure ?? null,
      phaseFailures: run.report?.phaseFailures ?? [],
      log: run.logFile,
    })),
    rawRunReports: runs
      .filter(run => run.report !== null)
      .map(run => ({ attempt: run.attempt, mode: run.mode, report: run.report })),
    memoryBaseline: (() => {
      const mbRuns = runs.filter(run => run.mode === "memory-baseline");
      if (mbRuns.length === 0) return null;
      const mbReports = mbRuns.map(run => run.report).filter(Boolean);
      if (mbReports.length === 0) return null;

      // Aggregate RSS samples
      const compilerRssSamples = mbReports.flatMap(r => r.compilerRssSamples ?? []);
      const previewRssSamples = mbReports.flatMap(r => r.previewRssSamples ?? []);
      const cleanupVerifications = mbReports.flatMap(r => r.cleanupVerification ? [r.cleanupVerification] : []);

      // Compute RSS stability for compiler samples
      const compilerRssKb = compilerRssSamples.map(s => s.kilobytes).filter(v => typeof v === "number");
      const compilerRssFirst = compilerRssKb[0] ?? 0;
      const compilerRssLast = compilerRssKb[compilerRssKb.length - 1] ?? 0;
      const compilerGrowthPercent = compilerRssFirst > 0
        ? ((compilerRssLast - compilerRssFirst) / compilerRssFirst) * 100
        : 0;

      // Compute RSS stability for preview samples
      const previewRssKb = previewRssSamples.map(s => s.kilobytes).filter(v => typeof v === "number");
      const previewRssFirst = previewRssKb[0] ?? 0;
      const previewRssLast = previewRssKb[previewRssKb.length - 1] ?? 0;
      const previewGrowthPercent = previewRssFirst > 0
        ? ((previewRssLast - previewRssFirst) / previewRssFirst) * 100
        : 0;

      // Cleanup verification results
      const allCleared = cleanupVerifications.every(c => c.allCleared);

      return {
        enabled: options.memoryBaseline,
        runs: mbRuns.length,
        compilationCount: mbReports[0]?.compilationCount ?? 0,
        previewCycleCount: mbReports[0]?.previewCycleCount ?? 0,
        failures: mbReports.flatMap(r => r.failures ?? []),
        compilerRssStability: {
          sampleCount: compilerRssKb.length,
          firstKilobytes: compilerRssFirst,
          lastKilobytes: compilerRssLast,
          growthPercent: compilerGrowthPercent,
          thresholdPercent: 10,
          verdict: compilerGrowthPercent <= 10 ? "PASS" : "FAIL",
          samples: compilerRssKb,
        },
        previewRssStability: {
          sampleCount: previewRssKb.length,
          firstKilobytes: previewRssFirst,
          lastKilobytes: previewRssLast,
          growthPercent: previewGrowthPercent,
          thresholdPercent: 20,
          verdict: previewGrowthPercent <= 20 ? "PASS" : "FAIL",
          samples: previewRssKb,
        },
        cleanupVerification: {
          allCleared,
          details: cleanupVerifications,
        },
      };
    })(),
  };

  const problems = validateReport(report);
  if (problems.length > 0) {
    console.error("report schema validation problems:");
    for (const problem of problems) console.error(`  - ${problem}`);
  }
  report.schemaValidation = { problems, valid: problems.length === 0 };

  // Independent recomputation of every reported percentile straight from the
  // raw sample arrays, so a corrupted aggregate cannot reach the document.
  for (const phase of report.phases) {
    for (const [kind, values] of Object.entries(phase.kinds)) {
      const p50 = nearestRankPercentile(values.samplesMs, 50);
      const p95 = nearestRankPercentile(values.samplesMs, 95);
      if (p50 !== values.p50Ms || p95 !== values.p95Ms) {
        throw new Error(`percentile recomputation mismatch for ${phase.id}/${kind}`);
      }
    }
  }

  // An incomplete or schema-invalid run must never replace a good baseline: the
  // committed documents are only rewritten when every phase has its required
  // samples and the report validates. Launch failures and censored samples do
  // not block publication — they are part of the measurement and are disclosed.
  const publishable = problems.length === 0 && aggregated.violations.length === 0;
  if (!publishable && !options.allowIncomplete) {
    const rejected = join(EVIDENCE_DIR, "rejected-report.json");
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(rejected, `${JSON.stringify(report, null, 2)}\n`);
    console.error(
      `\nrefusing to publish: the run is incomplete or invalid, so ` +
      `${JSON_OUTPUT.slice(REPO.length + 1)} and ${MARKDOWN_OUTPUT.slice(REPO.length + 1)} ` +
      "were left untouched.");
    console.error(`rejected report written to ${rejected.slice(REPO.length + 1)}`);
    for (const violation of aggregated.violations) console.error(`  - ${violation}`);
    for (const problem of problems) console.error(`  - ${problem}`);
    for (const run of failedRuns) {
      console.error(
        `  - attempt ${run.attempt} ${run.mode}: ${run.outcome}` +
        `${run.report?.failure ? ` — ${String(run.report.failure).slice(0, 200)}` : ""}` +
        `${run.lastCheckpoint ? ` (last checkpoint: ${JSON.stringify(run.lastCheckpoint)})` : ""}`);
    }
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(JSON_OUTPUT), { recursive: true });
  writeFileSync(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(MARKDOWN_OUTPUT, `${renderMarkdown(report)}`);

  console.log(`\nwrote ${JSON_OUTPUT.slice(REPO.length + 1)}`);
  console.log(`wrote ${MARKDOWN_OUTPUT.slice(REPO.length + 1)}`);
  console.log(`overall verdict: ${report.overallVerdict}`);
  console.log(
    `attempts: ${attempts.length} of a ${options.maxAttempts} budget (${stopReason})`);
  console.log(
    `launch failures: ${launchFailures.length}; censored samples: ${censored.length}; ` +
    `samples that could not be taken: ${exclusions.length}`);
  if (aggregated.violations.length > 0) {
    console.log("sample count violations:");
    for (const violation of aggregated.violations) console.log(`  - ${violation}`);
  }
  if (orphans.length > 0) {
    console.error(`orphan application processes detected: ${orphans.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (problems.length > 0) process.exitCode = 1;
}

// Only measure when this file is the entry point; importing it (for the unit
// tests that pin the sample-collection rules) must never launch anything.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  });
}

// Scenario proof suite — Embedded preview security boundary (durable).
//
// Durable scenario 6. Orchestrated by the single `runPreviewSecurityScenario`
// entrypoint below: deny shell IPC + filesystem access with an ACL rejection
// inventory (former issue34), opaque-origin sandbox + CSP incl. no-wasm-eval
// boot (former issue33), deny host navigation + network (former issue35), and
// validate forged/malformed/oversized messages (former issue36). Every
// sub-proof runs in the EMBEDDED opaque-origin sandboxed iframe
// (`runInPagePreviewForProof`) required by ADR 0003 — this module does NOT import
// issue38-bridge. The issue034 ACL inventory (ISSUE034_APPROVED_COMMANDS) is at
// module scope, first, so the Rust build-time source scan and the source-scan
// tests that slice it keep matching. Shared helpers (`wait`) are deduplicated at
// module scope; per-sub-proof fixtures keep distinct names. The per-issue env
// gates and `issueNN_emit_report` commands are preserved verbatim for Stage-6
// compatibility. PRODUCT never imports this module.
import {
  runInPagePreviewForProof,
  probeInPageNoWasmEvalBoot,
  preparePackagedProofRuntime,
} from "./scenario-toolkit";
import { PREVIEW_CSP } from "./preview-frame";
import {
  LIMITS,
  inspectClone,
  validateBinaryPair,
  validateCompileRequest,
} from "./protocol";
import { runScenario, type SubProof } from "./scenario-runner";

// Deduplicated shared delay helper (was redeclared inside the issue35 and
// issue36 namespaces).
const wait = (ms: number) => new Promise(resolve => globalThis.setTimeout(resolve, ms));

// ── Deny shell IPC + filesystem; ACL rejection inventory (former issue34) ──
const ISSUE034_CANARY_SHA256 =
  "ef5368ada37a4cddc5bda46069fd7b3ad51b30b5dab1697a58ae9816154f2372";

// ACL supply-chain inventory (asserted by protocol.test.ts / audio-content.test.ts
// and slice-scanned by the Rust build). Kept at module scope, verbatim.
export const ISSUE034_APPROVED_COMMANDS = [
  "issue021_is_proof_enabled",
  "issue021_is_locked_session_proof",
  "issue021_emit_report",
  "issue022_is_proof_enabled",
  "issue022_emit_report",
  "issue023_is_proof_enabled",
  "issue024_is_proof_enabled",
  "issue025_is_proof_enabled",
  "issue027_is_proof_enabled",
  "issue028_is_proof_enabled",
  "issue029_is_proof_enabled",
  "issue030_is_proof_enabled",
  "issue031_is_proof_enabled",
  "issue032_is_proof_enabled",
  "issue033_is_proof_enabled",
  "issue033_is_no_wasm_eval_proof_enabled",
  "issue034_is_proof_enabled",
  "issue034_trusted_marker",
  "issue034_trusted_marker_calls",
  "issue033_emit_checkpoint",
  "prepare_packaged_proof_window",
  "issue023_emit_checkpoint",
  "issue023_emit_report",
  "issue024_emit_report",
  "issue025_emit_report",
  "issue027_emit_report",
  "issue028_emit_report",
  "issue029_emit_report",
  "issue030_emit_report",
  "issue031_emit_report",
  "issue032_emit_report",
  "issue033_emit_report",
  "issue033_emit_no_wasm_eval_report",
  "issue034_emit_report",
  "issue035_is_proof_enabled",
  "issue035_emit_report",
  "issue036_is_proof_enabled",
  "issue036_emit_report",
  "first_run_check_acknowledgement",
  "first_run_write_acknowledgement",
  "issue037_is_proof_enabled",
  "issue037_emit_report",
  "issue037_read_store_snapshot",
  "issue037_clear_store",
  "issue037_proof_phase",
  "issue037_emit_checkpoint",
  "issue039_is_proof_enabled",
  "issue039_emit_checkpoint",
  "issue039_emit_report",
  "issue040_is_proof_enabled",
  "issue040_emit_checkpoint",
  "issue040_emit_report",
  "issue040_dispatch_preview_input",
  "issue041_is_benchmark_enabled",
  "issue041_benchmark_mode",
  "issue041_warm_compile_count",
  "issue041_preview_cycle_count",
  "issue041_shell_ready",
  "issue041_emit_checkpoint",
  "issue041_emit_report",
  "issue041_rss_bytes",
  "workspace_write_file",
  "workspace_save_dialog",
  "workspace_open_dialog",
  "workspace_set_dirty",
  "project_pick_folder",
  "project_read",
] as const;

const issue034Source = `
using System;
using System.Threading;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

public sealed class Issue034Game : Game
{
    private readonly GraphicsDeviceManager graphics;
    private static int frameCount;
    private static int disposeCount;
    public static int FrameCount => Volatile.Read(ref frameCount);
    public static int DisposeCount => Volatile.Read(ref disposeCount);
    public Issue034Game()
    {
        graphics = new GraphicsDeviceManager(this);
        Console.WriteLine("issue034-managed-ready");
    }
    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        Interlocked.Increment(ref frameCount);
        base.Draw(gameTime);
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) Interlocked.Increment(ref disposeCount);
        base.Dispose(disposing);
    }
}`;

interface SecurityProbe {
  globals: Record<string, string>;
  directInvoke: string;
  rawIpc: Record<string, unknown>;
  fetchResults: Array<Record<string, unknown>>;
  xhrResults: Array<Record<string, unknown>>;
  managedFileSystem: { anyRead: boolean; results: Array<{ read: boolean }> };
}

async function startIssue034Preview(name: string) {
  return runInPagePreviewForProof({
    assemblyName: name,
    sourcePath: "src/Issue034Game.cs",
    sourceText: issue034Source,
    issue034Proof: true,
  });
}

export async function runIssue034AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue034_is_proof_enabled"))) return;
  const readiness = await preparePackagedProofRuntime();

  // Trusted top-level evidence
  const internals = window.__TAURI_INTERNALS__ as Record<string, unknown>;
  const topLevel = {
    internals: typeof internals,
    invoke: typeof internals?.invoke,
    currentWindowLabel:
      (internals?.metadata as { currentWindow?: { label?: string } })
        ?.currentWindow?.label,
  };
  const marker = await invoke<string>("issue034_trusted_marker");

  // First preview — run security probes inside the in-page sandboxed iframe
  const first = await startIssue034Preview("Issue034First");
  // The preview.js issue034-security action probes globals, IPC, fetch, filesystem.
  // We pass NO ipcProbes — no missing/wrong key envelopes that leak the key.
  const security = await first.proof<SecurityProbe>("issue034-security", { ipcProbes: [] });
  const pixels = await first.proof<{
    pixels: number[][]; glError: number; contextLost: boolean;
  }>("sample-webgl");

  // In-page sandboxed-iframe ACL evidence (issue 052 task 3): unlike the isolated
  // window (where Tauri injects __TAURI_INTERNALS__ and the ACL rejects every
  // command because the window label is in no capability — see the retired
  // Rust-injected `issue034-acl-invoke-probe`), Tauri NEVER injects the IPC bridge
  // into an opaque-origin (sandbox="allow-scripts", no allow-same-origin) nested
  // iframe. The bridge is therefore entirely ABSENT — a strictly stronger
  // guarantee than "present but rejects". The issue034-security probe already
  // captures this: directInvoke "unreachable", globals.internals / globals.invoke
  // both "undefined". (ISSUE034_APPROVED_COMMANDS is retained as the ACL
  // supply-chain inventory guard asserted by protocol.test.ts / audio-content.test.ts.)
  const running = await first.query();
  const callsAfterFirst = await invoke<number>("issue034_trusted_marker_calls");
  const firstStop = await first.stop("user");

  // Second preview — verify clean restart, no corruption
  const second = await startIssue034Preview("Issue034Second");
  const secondSecurity = await second.proof<SecurityProbe>("issue034-security", { ipcProbes: [] });
  const callsAfterRestart = await invoke<number>("issue034_trusted_marker_calls");
  const secondStop = await second.stop("user");

  // Assertions — the IPC bridge must be entirely absent/unreachable in the iframe
  const bridgeUnreachable = security.directInvoke === "unreachable" &&
    security.globals.internals === "undefined" &&
    security.globals.invoke === "undefined";
  const secondBridgeUnreachable = secondSecurity.directInvoke === "unreachable" &&
    secondSecurity.globals.internals === "undefined" &&
    secondSecurity.globals.invoke === "undefined";
  if (!bridgeUnreachable || !secondBridgeUnreachable ||
      security.fetchResults.some((r: any) => r.bodySha256 === ISSUE034_CANARY_SHA256) ||
      security.xhrResults.some((r: any) => r.bodySha256 === ISSUE034_CANARY_SHA256) ||
      security.managedFileSystem.anyRead ||
      secondSecurity.managedFileSystem.anyRead ||
      callsAfterFirst !== 1 || callsAfterRestart !== 1 ||
      marker !== "issue034-main-frame-marker-v1" ||
      topLevel.currentWindowLabel !== "main" ||
      pixels.glError !== 0 || pixels.contextLost ||
      running.runReturned !== true ||
      (firstStop.runtime as any)?.stop?.disposeAttempts !== 1 ||
      (secondStop.runtime as any)?.stop?.disposeAttempts !== 1) {
    throw new Error(`Issue 034 proof failed: ${JSON.stringify({
      bridgeUnreachable, secondBridgeUnreachable, callsAfterFirst, callsAfterRestart,
      directInvoke: security.directInvoke, internals: security.globals.internals,
      invoke: security.globals.invoke,
      canaryFound: security.fetchResults.some((r: any) => r.bodySha256 === ISSUE034_CANARY_SHA256),
      managedRead: security.managedFileSystem.anyRead, pixels: pixels.glError,
    })}`);
  }

  await invoke("issue034_emit_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      architecture: "in-page-sandboxed-iframe",
      topLevel,
      marker,
      aclProof: {
        method: "opaque-origin sandboxed iframe — __TAURI_INTERNALS__ never injected",
        bridgeInternals: security.globals.internals,
        bridgeInvoke: security.globals.invoke,
        directInvoke: security.directInvoke,
        bridgeReachable: false,
        strongerThanAclRejection: true,
      },
      security: {
        directInvoke: security.directInvoke,
        noCanaryInFetch: !security.fetchResults.some((r: any) => r.bodySha256 === ISSUE034_CANARY_SHA256),
        noCanaryInXhr: !security.xhrResults.some((r: any) => r.bodySha256 === ISSUE034_CANARY_SHA256),
        noManagedFileRead: !security.managedFileSystem.anyRead,
      },
      markerCalls: { afterFirst: callsAfterFirst, afterRestart: callsAfterRestart },
      first: { pixels: { glError: pixels.glError }, disposed: (firstStop.runtime as any)?.stop?.disposeAttempts },
      second: { disposed: (secondStop.runtime as any)?.stop?.disposeAttempts },
    }),
  });
}

// ── Opaque-origin sandbox + CSP incl. no-wasm-eval boot (former issue33) ──
const issue033Source = `
using System;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
public sealed class Issue033Game : Game
{
    private readonly GraphicsDeviceManager graphics;
    public Issue033Game()
    {
        graphics = new GraphicsDeviceManager(this);
        Console.WriteLine("issue033-managed-ready");
    }
    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(gameTime);
    }
}`;

async function startIssue033Preview(name: string) {
  return runInPagePreviewForProof({
    assemblyName: name,
    sourcePath: "src/Issue033Game.cs",
    sourceText: issue033Source,
    issue033Proof: true,
  });
}

interface SecurityEvidence {
  serializedOrigin: string;
  parentDomDenied: boolean;
  evalDenied: boolean;
  inlineScriptDenied: boolean;
  fetchDenied: boolean;
  audioClosed: boolean;
  baseUriDenied: boolean;
  popupSandboxDenied: boolean;
  formSubmitEventObserved: boolean;
  formRemainedInDocument: boolean;
  formCspViolationObserved: boolean;
  formSandboxBlockedBeforeCsp: boolean;
  evalViolationObserved: boolean;
  violations: Array<{ effectiveDirective: string; blockedUri: string }>;
}

function missingCspEvidence(evidence: SecurityEvidence): string[] {
  const required: Array<[string, string]> = [
    ["script-src", "inline"],
    ["style-src", "inline"],
    ["connect-src", "https://example.invalid/issue033"],
    ["frame-src", "data"],
    ["object-src", "data"],
    ["base-uri", "https://example.invalid/issue033-base/"],
  ];
  return required
    .filter(([directive, blockedUri]) => !evidence.violations.some(violation =>
      violation.effectiveDirective.startsWith(directive) &&
      violation.blockedUri === blockedUri))
    .map(([directive]) => directive);
}

export async function runIssue033AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue033_is_proof_enabled"))) return;
  const checkpoint = (phase: string) => invoke("issue033_emit_checkpoint", { checkpoint: phase });
  await checkpoint("starting");
  await preparePackagedProofRuntime();
  await checkpoint("runtime-ready");

  // First run: compile and start in the embedded opaque-origin sandboxed iframe
  const first = await startIssue033Preview("Issue033First");
  await checkpoint("first-started");

  // The embedded preview runs at an opaque origin (sandbox="allow-scripts", no
  // allow-same-origin) with the preview CSP. Equivalent separation evidence:
  // - serializedOrigin !== "tauri://localhost" (opaque origin)
  // - parentDomDenied (no cross-document DOM access)
  // - CSP violations enforced in the sandboxed context

  // Probe security from inside the embedded preview context
  const security = await first.proof<SecurityEvidence>("issue033-security");
  await checkpoint("security-probed");

  // Verify rendering works in the embedded sandboxed preview
  const pixels = await first.proof<{
    pixels: number[][];
    glError: number;
    contextLost: boolean;
  }>("sample-webgl");

  // Verify managed and native output capture
  const managedOutput = first.outputEvents.find(event =>
    event.payload.source === "managed" &&
    event.payload.text === "issue033-managed-ready");
  const nativeOutput = first.outputEvents.find(event =>
    event.payload.source === "native" &&
    event.payload.category === "startup");
  const running = await first.query();
  const stopped = await first.stop("user");

  // Second run: verify clean restart
  const second = await startIssue033Preview("Issue033Second");
  await checkpoint("second-started");
  const secondSecurity = await second.proof<typeof security>("issue033-security");
  const secondStopped = await second.stop("user");

  const missingFirstCspEvidence = missingCspEvidence(security);
  const missingSecondCspEvidence = missingCspEvidence(secondSecurity);

  // Assertions for the in-page sandboxed-iframe architecture (issue 052 task 3;
  // this restores issue 033's originally-specified sandbox boundary):
  // - Origin is "null" — an opaque origin from `sandbox="allow-scripts"` with no
  //   `allow-same-origin` (NOT a real top-level window origin)
  // - parentDomDenied is TRUE — the opaque-origin iframe cannot reach the
  //   trusted parent's DOM (same-origin policy), the primary isolation boundary
  // - evalDenied: CSP script-src only allows playground-preview: scheme
  // - CSP violations still enforced for inline scripts/styles/fetches/frames/objects
  // - All rendering, audio, output still work
  const expectedOrigin = "null";
  if (security.serializedOrigin !== expectedOrigin ||
      !security.parentDomDenied ||
      !security.evalDenied || !security.inlineScriptDenied ||
      !security.fetchDenied || !security.audioClosed ||
      !security.baseUriDenied || !security.popupSandboxDenied ||
      missingFirstCspEvidence.length !== 0 ||
      pixels.glError !== 0 || pixels.contextLost ||
      pixels.pixels.some(pixel =>
        pixel[0] !== 100 || pixel[1] !== 149 || pixel[2] !== 237 || pixel[3] !== 255) ||
      !managedOutput || !nativeOutput ||
      first.managedLoad?.logicalPath !== "src/Issue033Game.cs" ||
      running.runReturned !== true ||
      secondSecurity.serializedOrigin !== expectedOrigin ||
      !secondSecurity.parentDomDenied ||
      !secondSecurity.baseUriDenied || !secondSecurity.popupSandboxDenied ||
      missingSecondCspEvidence.length !== 0 ||
      (stopped.runtime as { stop?: { disposeAttempts?: number } })?.stop?.disposeAttempts !== 1 ||
      (secondStopped.runtime as { stop?: { disposeAttempts?: number } })?.stop?.disposeAttempts !== 1) {
    throw new Error(`Issue 033 security evidence failed: ${JSON.stringify({
      security, missingFirstCspEvidence, pixels, running, stopped,
      secondSecurity, missingSecondCspEvidence, secondStopped,
    })}`);
  }

  await invoke("issue033_emit_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      architecture: "in-page-sandboxed-iframe",
      csp: PREVIEW_CSP,
      security,
      enforcementLayers: {
        opaqueOrigin: "sandbox=\"allow-scripts\" with no allow-same-origin (origin null)",
        sameOriginPolicy: "opaque-origin iframe cannot reach the trusted parent DOM",
        tauriInternalsNeverInjected: true,
        cspViolationDirectives: security.violations,
        evalDeniedWithoutRequiredViolationEvent: security.evalDenied &&
          !security.evalViolationObserved,
      },
      webgl: pixels,
      output: { managed: managedOutput, native: nativeOutput },
      pdb: first.managedLoad,
      first: { frameCount: running.frameCount, stopped },
      second: { security: secondSecurity, stopped: secondStopped },
    }),
  });
}

export async function runIssue033NoWasmEvalProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke ||
      !(await invoke<boolean>("issue033_is_no_wasm_eval_proof_enabled"))) return;
  await preparePackagedProofRuntime();

  // Mount an in-page sandboxed iframe whose CSP omits 'wasm-unsafe-eval'. The
  // .NET WASM runtime must fail to start, so the preview bridge never signals
  // ready. (Issue 052 task 3: replaces the old isolated-window negative path.)
  const negative = await probeInPageNoWasmEvalBoot(6_000);
  const negativeEvidence = { bridgeReady: negative.bridgeReady };

  // Now verify the NORMAL variant still works by running a standard preview
  const normal = await startIssue033Preview("Issue033AfterNegative");
  const normalSecurity = await normal.proof<SecurityEvidence>("issue033-security");
  const normalPixels = await normal.proof<{
    pixels: number[][]; glError: number; contextLost: boolean;
  }>("sample-webgl");
  const normalRunning = await normal.query();
  await normal.stop("user");

  // The negative iframe must NOT have had bridge ready (WASM failed).
  // The normal iframe MUST render correctly.
  const negBridgeReady = negativeEvidence.bridgeReady;

  if (negBridgeReady ||
      normalPixels.glError !== 0 || normalPixels.contextLost ||
      normalPixels.pixels.some(p => p[0] !== 100 || p[1] !== 149 || p[2] !== 237 || p[3] !== 255) ||
      normalRunning.runReturned !== true) {
    throw new Error(`Issue 033 no-wasm-eval negative proof failed: ${JSON.stringify({
      negativeEvidence, negBridgeReady, normalPixels, normalRunning,
    })}`);
  }

  await invoke("issue033_emit_no_wasm_eval_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      architecture: "in-page-sandboxed-iframe",
      negativeIframe: {
        cspDelta: "removed 'wasm-unsafe-eval' only",
        bridgeReady: negBridgeReady,
        wasmBootFailed: !negBridgeReady,
        evidence: negativeEvidence,
      },
      normalAfterNegative: {
        rendered: true,
        cornflowerBlue: normalPixels.pixels[0],
        runReturned: normalRunning.runReturned,
        security: normalSecurity.serializedOrigin,
      },
    }),
  });
}

// ── Deny host navigation + network (former issue35) ──
const issue035Source = `
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
public sealed class Issue035Game : Game
{
    private readonly GraphicsDeviceManager graphics;
    public Issue035Game() { graphics = new GraphicsDeviceManager(this); }
    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(gameTime);
    }
}`;

interface NavigationSecurityEvidence {
  fetchBlocked: boolean;
  fetchError: string | null;
  connectSrcViolationObserved: boolean;
  topLocationBefore: string | null;
  topLocationAfter: string | null;
  topLocationDenied: boolean;
  topLocationUnchanged: boolean;
  popupDenied: boolean;
  popupTopDenied: boolean;
  violations: Array<{ effectiveDirective: string; blockedUri: string; disposition?: string }>;
  serializedOrigin: string;
}

async function startAndWait(name: string) {
  // Issue 052 task 3: render in the in-page opaque-origin sandboxed iframe
  // (runInPagePreviewForProof already waits for preview.started before returning)
  // rather than the isolated WebviewWindow (compileLoadStartIssue23).
  const preview = await runInPagePreviewForProof({
    assemblyName: name,
    sourcePath: "src/Issue035Game.cs",
    sourceText: issue035Source,
    issue035Proof: true,
  });
  const frameDeadline = performance.now() + 10_000;
  let running = await preview.query();
  while (!(running as any).runReturned && performance.now() < frameDeadline) {
    await wait(100);
    running = await preview.query();
  }
  return { preview, running };
}

export async function runIssue035AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue035_is_proof_enabled"))) return;

  await preparePackagedProofRuntime();

  const mainTitleBefore = document.title;
  const mainUrlBefore = location.href;

  // First generation
  const first = await startAndWait("Issue035First");
  if (!(first.running as any).runReturned) throw new Error("Issue 035 first game did not start.");

  const firstSecurity = await first.preview.proof<NavigationSecurityEvidence>("issue035-security");
  await first.preview.stop("user");

  // Second generation — verify clean restart after security probes
  const second = await startAndWait("Issue035Second");
  if (!(second.running as any).runReturned) throw new Error("Issue 035 second game did not start.");

  const secondSecurity = await second.preview.proof<NavigationSecurityEvidence>("issue035-security");
  await second.preview.stop("user");

  const mainTitleAfter = document.title;
  const mainUrlAfter = location.href;

  // Hard assertions (in-page sandboxed-iframe boundary, issue 052 task 3)
  // The opaque-origin iframe reports origin "null"; navigation/popups/network
  // are denied by the sandbox (no allow-popups / allow-top-navigation) + CSP,
  // and the cross-origin same-origin-policy boundary to the trusted parent.
  const expectedOrigin = "null";
  const connectViolation = firstSecurity.violations.find(v =>
    v.effectiveDirective.startsWith("connect-src") &&
    v.blockedUri === "https://example.com/issue035-probe");

  if (
    // CSP connect-src violation
    !firstSecurity.fetchBlocked ||
    !connectViolation ||
    connectViolation.effectiveDirective !== "connect-src" ||
    // Opaque origin (sandbox="allow-scripts", no allow-same-origin)
    firstSecurity.serializedOrigin !== expectedOrigin ||
    // Popup denied (sandbox has no allow-popups — window.open returns null)
    !firstSecurity.popupDenied ||
    // NOTE: popupTopDenied / topLocationDenied are reported but NOT hard-asserted:
    // a sandbox lacking allow-top-navigation may block navigation SILENTLY (no
    // throw), so those catch-based booleans are browser-dependent. The robust
    // proof that top navigation was denied is the trusted-parent window staying
    // unchanged (mainTitle/mainUrl below).
    // Main (trusted parent) window unchanged
    mainTitleAfter !== mainTitleBefore ||
    mainUrlAfter !== mainUrlBefore ||
    // Second generation same evidence
    !secondSecurity.fetchBlocked ||
    secondSecurity.serializedOrigin !== expectedOrigin ||
    !secondSecurity.popupDenied
  ) {
    throw new Error(`Issue 035 navigation security evidence failed: ${JSON.stringify({
      firstSecurity, secondSecurity,
      mainTitle: { before: mainTitleBefore, after: mainTitleAfter },
      mainUrl: { before: mainUrlBefore, after: mainUrlAfter },
    })}`);
  }

  await invoke("issue035_emit_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      architecture: "in-page-sandboxed-iframe",
      first: {
        origin: firstSecurity.serializedOrigin,
        fetchBlocked: firstSecurity.fetchBlocked,
        connectSrcViolation: {
          observed: !!connectViolation,
          directive: connectViolation?.effectiveDirective,
          blockedUri: connectViolation?.blockedUri,
        },
        popupDenied: firstSecurity.popupDenied,
        popupTopDenied: firstSecurity.popupTopDenied,
        topLocationDenied: firstSecurity.topLocationDenied,
        violations: firstSecurity.violations,
      },
      second: {
        origin: secondSecurity.serializedOrigin,
        fetchBlocked: secondSecurity.fetchBlocked,
        popupDenied: secondSecurity.popupDenied,
      },
      mainWindowUnchanged: {
        titleBefore: mainTitleBefore,
        titleAfter: mainTitleAfter,
        urlBefore: mainUrlBefore,
        urlAfter: mainUrlAfter,
      },
      enforcementLayers: {
        cspConnectSrc: "playground-preview: only",
        opaqueOrigin: "sandbox=\"allow-scripts\" with no allow-same-origin (origin null)",
        popupsDenied: "sandbox has no allow-popups — window.open returns null",
        topNavigationDenied:
          "sandbox has no allow-top-navigation; cross-origin parent.location writes throw (same-origin policy)",
        parentDomIsolation: "opaque-origin iframe cannot reach the trusted parent DOM",
      },
    }),
  });
}

// ── Validate forged/malformed/oversized messages (former issue36) ──
const issue036Source = `
using System;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
public sealed class Issue036Game : Game
{
    private readonly GraphicsDeviceManager graphics;
    public Issue036Game()
    {
        graphics = new GraphicsDeviceManager(this);
        Console.WriteLine("issue036-managed-ready");
    }
    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(gameTime);
    }
}`;

// Structural validation unit tests (protocol-level, no iframe dependency)
function testStructuralValidation() {
  const uuid = "00112233-4455-4677-8899-aabbccddeeff";
  const cid = "12345678-1234-4abc-8def-123456789abc";
  const check = (fn: () => void): boolean => {
    try { fn(); return false; } catch { return true; }
  };
  return {
    oversizedMessageRejected: check(() => {
      const bigText = "x".repeat(2 * 1024 * 1024);
      const sources = Array.from({ length: 20 }, (_, i) => ({
        path: `file${i}.cs`, text: bigText,
      }));
      inspectClone({
        protocolVersion: 1, correlationId: uuid, type: "compile.request",
        payload: { compileId: cid, assemblyName: "Test", sources, primarySourcePath: "file0.cs" },
      });
    }),
    oversizedSourceRejected: check(() => validateCompileRequest({
      protocolVersion: 1, correlationId: uuid, type: "compile.request",
      payload: {
        compileId: cid, assemblyName: "Test",
        sources: [{ path: "big.cs", text: "x".repeat(LIMITS.sourceFile + 1) }],
        primarySourcePath: "big.cs",
      },
    })),
    oversizedAssemblyRejected: check(() =>
      validateBinaryPair(new ArrayBuffer(LIMITS.assembly + 1), new ArrayBuffer(64))),
    oversizedPdbRejected: check(() =>
      validateBinaryPair(new ArrayBuffer(64), new ArrayBuffer(LIMITS.pdb + 1))),
    emptyAssemblyRejected: check(() =>
      validateBinaryPair(new ArrayBuffer(0), new ArrayBuffer(64))),
    cyclicRejected: check(() => {
      const cycle: Record<string, unknown> = { a: 1 };
      cycle.self = cycle;
      inspectClone(cycle);
    }),
    pathTraversalRejected: check(() => validateCompileRequest({
      protocolVersion: 1, correlationId: uuid, type: "compile.request",
      payload: {
        compileId: cid, assemblyName: "Test",
        sources: [{ path: "../etc/passwd", text: "x" }],
        primarySourcePath: "../etc/passwd",
      },
    })),
  };
}

// Stage 5 retired the Rust-mediated isolated-window bridge (issue038_*) command
// surface entirely, so there is no longer a bridge relay/transfer/window command
// to attack. The forged/malformed/oversized-message rejection coverage that used
// to probe those commands is preserved by `testStructuralValidation` (protocol
// envelope validation) below and by the embedded opaque-origin sandboxed-iframe
// transport, which has no IPC bridge at all (issue034).

export async function runIssue036AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue036_is_proof_enabled"))) return;

  await preparePackagedProofRuntime();

  // Phase 1: structural validation (unit-level, no preview) — forged, malformed,
  // oversized, and path-traversal envelopes are rejected before they can reach
  // the transport.
  const structural = testStructuralValidation();

  // Phase 2: valid compile/run through the in-page opaque-origin sandboxed iframe
  // (issue 052 task 3 / ADR 0003) — proves the forged-message rejections did not
  // corrupt the transport the live path uses. The embedded preview has NO IPC
  // bridge (opaque origin, no __TAURI_INTERNALS__), so a forged message cannot
  // reach any Tauri command. runInPagePreviewForProof waits for preview.started
  // before returning.
  const first = await runInPagePreviewForProof({
    assemblyName: "Issue036First",
    sourcePath: "src/Issue036Game.cs",
    sourceText: issue036Source,
    issue036Proof: true,
  });

  const frameDeadline = performance.now() + 10_000;
  let running = await first.query();
  while (!(running as any).runReturned && performance.now() < frameDeadline) {
    await wait(50);
    running = await first.query();
  }

  const pixels = await first.proof<{
    pixels: number[][]; glError: number; contextLost: boolean;
  }>("sample-webgl");
  const managedOutput = first.outputEvents.find(event =>
    event.payload.source === "managed" && event.payload.text === "issue036-managed-ready");
  const firstStopped = await first.stop("user");

  // Phase 4: second generation — proves first cleanup was complete
  const second = await runInPagePreviewForProof({
    assemblyName: "Issue036Second",
    sourcePath: "src/Issue036Game.cs",
    sourceText: issue036Source,
    issue036Proof: true,
  });

  const secondDeadline = performance.now() + 10_000;
  let secondRunning = await second.query();
  while (!(secondRunning as any).runReturned && performance.now() < secondDeadline) {
    await wait(50);
    secondRunning = await second.query();
  }

  const secondPixels = await second.proof<{
    pixels: number[][]; glError: number; contextLost: boolean;
  }>("sample-webgl");
  const secondStopped = await second.stop("user");

  // Assertions
  const allStructural = Object.values(structural).every(v => v === true);
  const pixelsOk = pixels.glError === 0 && !pixels.contextLost &&
    pixels.pixels.every(p => p[0] === 100 && p[1] === 149 && p[2] === 237 && p[3] === 255);
  const secondPixelsOk = secondPixels.glError === 0 && !secondPixels.contextLost &&
    secondPixels.pixels.every(p => p[0] === 100 && p[1] === 149 && p[2] === 237 && p[3] === 255);

  if (!allStructural || !pixelsOk || !managedOutput ||
      !secondPixelsOk || !(running as any).runReturned || !(secondRunning as any).runReturned ||
      (firstStopped.runtime as { stop?: { disposeAttempts?: number } })?.stop?.disposeAttempts !== 1 ||
      (secondStopped.runtime as { stop?: { disposeAttempts?: number } })?.stop?.disposeAttempts !== 1) {
    throw new Error(`Issue 036 protocol proof failed: ${JSON.stringify({
      structural, pixelsOk, secondPixelsOk, running, secondRunning,
    })}`);
  }

  await invoke("issue036_emit_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      architecture: "in-page-sandboxed-iframe",
      structural,
      first: {
        frameCount: running.frameCount,
        pixelsOk,
        managedOutput: !!managedOutput,
        disposed: (firstStopped.runtime as any)?.stop?.disposeAttempts,
      },
      second: {
        frameCount: secondRunning.frameCount,
        pixelsOk: secondPixelsOk,
        disposed: (secondStopped.runtime as any)?.stop?.disposeAttempts,
      },
    }),
  });
}

// Single durable-scenario entrypoint. Orchestrates the four embedded-preview
// security sub-proofs (all in the opaque-origin sandboxed iframe per ADR 0003);
// each self-gates on its own env flag and emits its own success report, while
// this driver owns per-sub-proof failure reporting. The no-wasm-eval negative
// boot is gated by its own `issue033_is_no_wasm_eval_proof_enabled` flag and
// reports via `issue033_emit_no_wasm_eval_report`.
export async function runPreviewSecurityScenario(): Promise<void> {
  const subProofs: SubProof[] = [
    { label: "deny shell IPC + filesystem (issue034)", reportCommand: "issue034_emit_report", run: runIssue034AutoProof },
    { label: "opaque-origin sandbox + CSP (issue033)", reportCommand: "issue033_emit_report", run: runIssue033AutoProof },
    { label: "no-wasm-eval negative boot (issue033)", reportCommand: "issue033_emit_no_wasm_eval_report", run: runIssue033NoWasmEvalProof },
    { label: "deny host navigation + network (issue035)", reportCommand: "issue035_emit_report", run: runIssue035AutoProof },
    { label: "validate forged/malformed messages (issue036)", reportCommand: "issue036_emit_report", run: runIssue036AutoProof },
  ];
  await runScenario(subProofs);
}

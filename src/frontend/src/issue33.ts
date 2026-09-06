import { runInPagePreviewForProof, probeInPageNoWasmEvalBoot, preparePackagedProofRuntime } from "./issue21";
import { PREVIEW_CSP } from "./preview-frame";

const source = `
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

async function start(name: string) {
  return runInPagePreviewForProof({
    assemblyName: name,
    sourcePath: "src/Issue033Game.cs",
    sourceText: source,
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

  // First run: compile and start in isolated window
  const first = await start("Issue033First");
  await checkpoint("first-started");

  // Isolated window has no sandbox attribute — security is via process
  // isolation + ACL + CSP. Equivalent separation evidence:
  // - serializedOrigin !== "tauri://localhost" (separate origin)
  // - parentDomDenied (no cross-window DOM access)
  // - CSP violations enforced in isolated context

  // Probe security from inside the isolated preview context
  const security = await first.proof<SecurityEvidence>("issue033-security");
  await checkpoint("security-probed");

  // Verify rendering works in isolated window
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
  const second = await start("Issue033Second");
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
  const normal = await start("Issue033AfterNegative");
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

import { compileLoadStartIssue23, preparePackagedProofRuntime } from "./issue21";
import {
  assertPreviewSandbox,
  createPreviewBridge,
  createPreviewIframe,
  loadIssue033NoWasmEvalPreviewIframe,
  PREVIEW_CSP,
  PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL,
  PREVIEW_SANDBOX,
} from "./preview-frame";

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
  return compileLoadStartIssue23({
    assemblyName: name,
    sourcePath: "src/Issue033Game.cs",
    sourceText: source,
    proofMode: true,
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
  const first = await start("Issue033First");
  await checkpoint("first-started");
  assertPreviewSandbox(first.frame);
  let parentChildDomDenied = first.frame.contentDocument === null;
  try { void first.frame.contentDocument?.body; } catch { parentChildDomDenied = true; }
  const security = await first.proof<SecurityEvidence>("issue033-security");
  await checkpoint("security-probed");
  const pixels = await first.proof<{
    pixels: number[][];
    glError: number;
    contextLost: boolean;
  }>("sample-webgl");
  const managedOutput = first.outputEvents.find(event =>
    event.payload.source === "managed" &&
    event.payload.text === "issue033-managed-ready");
  const nativeOutput = first.outputEvents.find(event =>
    event.payload.source === "native" &&
    event.payload.category === "startup");
  const running = await first.query();
  const stopped = await first.stop("user");
  const second = await start("Issue033Second");
  await checkpoint("second-started");
  assertPreviewSandbox(second.frame);
  const secondSecurity = await second.proof<typeof security>("issue033-security");
  const secondStopped = await second.stop("user");
  const missingFirstCspEvidence = missingCspEvidence(security);
  const missingSecondCspEvidence = missingCspEvidence(secondSecurity);
  if (PREVIEW_SANDBOX !== "allow-scripts" ||
      !parentChildDomDenied || security.serializedOrigin !== "null" ||
      !security.parentDomDenied || !security.evalDenied || !security.inlineScriptDenied ||
      !security.fetchDenied || !security.audioClosed ||
      !security.baseUriDenied || !security.popupSandboxDenied ||
      !security.formSubmitEventObserved || !security.formRemainedInDocument ||
      !(security.formCspViolationObserved || security.formSandboxBlockedBeforeCsp) ||
      missingFirstCspEvidence.length !== 0 ||
      pixels.glError !== 0 || pixels.contextLost ||
      pixels.pixels.some(pixel =>
        pixel[0] !== 100 || pixel[1] !== 149 || pixel[2] !== 237 || pixel[3] !== 255) ||
      !managedOutput || !nativeOutput ||
      first.managedLoad?.logicalPath !== "src/Issue033Game.cs" ||
      running.runReturned !== true ||
      secondSecurity.serializedOrigin !== "null" ||
      !secondSecurity.baseUriDenied || !secondSecurity.popupSandboxDenied ||
      !secondSecurity.formSubmitEventObserved || !secondSecurity.formRemainedInDocument ||
      !(secondSecurity.formCspViolationObserved ||
        secondSecurity.formSandboxBlockedBeforeCsp) ||
      missingSecondCspEvidence.length !== 0 ||
      (stopped.runtime as { stop?: { disposeAttempts?: number } })?.stop?.disposeAttempts !== 1 ||
      (secondStopped.runtime as { stop?: { disposeAttempts?: number } })?.stop?.disposeAttempts !== 1) {
    throw new Error(`Issue 033 security evidence failed: ${JSON.stringify({
      parentChildDomDenied, security, missingFirstCspEvidence, pixels, running, stopped,
      secondSecurity, missingSecondCspEvidence, secondStopped,
    })}`);
  }

  await invoke("issue033_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sandbox: first.frame.getAttribute("sandbox"),
      csp: PREVIEW_CSP,
      parentChildDomDenied,
      security,
      enforcementLayers: {
        cspViolationDirectives: security.violations,
        sandboxPopupDenied: security.popupSandboxDenied,
        formActionPolicy: "form-action 'none'",
        formActionViolationObserved: security.formCspViolationObserved,
        formSandboxBlockedBeforeCsp: security.formSandboxBlockedBeforeCsp,
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

interface NegativeObservation {
  eventType: string;
  effectiveDirective?: string;
  violatedDirective?: string;
  blockedUri?: string;
  disposition?: string;
  message?: string;
}

export async function runIssue033NoWasmEvalProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke ||
      !(await invoke<boolean>("issue033_is_no_wasm_eval_proof_enabled"))) return;
  await preparePackagedProofRuntime();

  const frame = createPreviewIframe();
  const bridge = createPreviewBridge(frame);
  const channel = new MessageChannel();
  const generation = crypto.randomUUID();
  const previewId = crypto.randomUUID();
  const observations: NegativeObservation[] = [];
  const observe = (event: MessageEvent) => {
    const data = event.data;
    if (event.source !== frame.contentWindow || event.origin !== "null" ||
        !data || Object.getPrototypeOf(data) !== Object.prototype ||
        data.type !== "issue033.negative.observation" ||
        !["securitypolicyviolation", "unhandledrejection", "error"]
          .includes(data.eventType) ||
        observations.length >= 32) return;
    const text = (value: unknown) =>
      typeof value === "string" ? value.slice(0, 2048) : undefined;
    observations.push({
      eventType: data.eventType,
      effectiveDirective: text(data.effectiveDirective),
      violatedDirective: text(data.violatedDirective),
      blockedUri: text(data.blockedUri),
      disposition: text(data.disposition),
      message: text(data.message),
    });
  };
  window.addEventListener("message", observe);
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Negative preview document load timed out.")), 30_000);
    frame.addEventListener("load", () => {
      window.clearTimeout(timer);
      const target = frame.contentWindow;
      if (!target) return reject(new Error("Negative preview window is unavailable."));
      target.postMessage({
        type: "protocol.bootstrap",
        contextGeneration: generation,
        previewId,
        issue021Proof: false,
        issue033Proof: true,
      }, "*", [channel.port2, bridge.childPort]);
      resolve();
    }, { once: true });
  });
  frame.hidden = true;
  frame.title = "Issue 033 no-wasm-unsafe-eval negative proof";
  loadIssue033NoWasmEvalPreviewIframe(frame);
  document.body.append(frame);

  let runtimeReady = false;
  let startupOutcome = "bridge-ready-timeout";
  let protocolPortClosed = false;
  let bridgeClosed = false;
  try {
    await loaded;
    runtimeReady = await Promise.race([
      bridge.ready.then(() => true, () => false),
      new Promise<false>(resolve => window.setTimeout(() => resolve(false), 15_000)),
    ]);
    if (runtimeReady) startupOutcome = "unexpected-runtime-ready";
    await new Promise(resolve => window.setTimeout(resolve, 100));
  } finally {
    window.removeEventListener("message", observe);
    channel.port1.close();
    protocolPortClosed = true;
    bridge.close();
    bridgeClosed = true;
    frame.remove();
  }

  const startupFailure = observations.find(observation =>
    ["error", "unhandledrejection"].includes(observation.eventType) &&
    observation.message?.includes("WebAssembly") &&
    observation.message.includes("instantiate") &&
    observation.message.includes("unsafe-eval") &&
    observation.message.includes("wasm-unsafe-eval"));
  if (PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL !==
        PREVIEW_CSP.replace(" 'wasm-unsafe-eval'", "") ||
      PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL.includes("wasm-unsafe-eval") ||
      runtimeReady || !startupFailure ||
      !protocolPortClosed || !bridgeClosed || frame.isConnected) {
    throw new Error(`Issue 033 no-wasm negative proof failed: ${JSON.stringify({
      runtimeReady, startupOutcome, observations,
    })}`);
  }
  await invoke("issue033_emit_no_wasm_eval_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE033_NO_WASM_EVAL_PROOF=1",
      canonicalCsp: PREVIEW_CSP,
      tightenedCsp: PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL,
      difference: { removed: ["'wasm-unsafe-eval'"], added: [] },
      runtimeReady,
      startupOutcome,
      wasmViolationEventObserved: observations.some(observation =>
        observation.eventType === "securitypolicyviolation" &&
        observation.blockedUri?.includes("wasm")),
      wasmViolationEventLimitation:
        "WebKit reports the WebAssembly CSP denial as an unhandled rejection, not a securitypolicyviolation event.",
      startupFailure,
      observations,
      retired: !frame.isConnected,
      protocolPortClosed,
      bridgeClosed,
    }),
  });
}

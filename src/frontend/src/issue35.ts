import { compileLoadStartIssue23, preparePackagedProofRuntime } from "./issue21";
import {
  assertPreviewSandbox,
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
} from "./preview-frame";

const source = `
using System;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
public sealed class Issue035Game : Game
{
    private readonly GraphicsDeviceManager graphics;
    public Issue035Game()
    {
        graphics = new GraphicsDeviceManager(this);
        Console.WriteLine("issue035-managed-ready");
    }
    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(gameTime);
    }
}`;

interface SecurityEvidence {
  fetchBlocked: boolean;
  fetchError: string | null;
  connectSrcViolationObserved: boolean;
  topLocationBefore: string | null;
  topLocationAfter: string | null;
  topLocationDenied: boolean;
  topLocationUnchanged: boolean;
  popupDenied: boolean;
  popupTopDenied: boolean;
  violations: Array<{
    effectiveDirective: string;
    blockedUri: string;
    disposition: string;
  }>;
  serializedOrigin: string;
}

async function start(assemblyName: string) {
  return compileLoadStartIssue23({
    assemblyName,
    sourcePath: "src/Issue035Game.cs",
    sourceText: source,
    proofMode: true,
    issue035Proof: true,
  });
}

export async function runIssue035AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue035_is_proof_enabled"))) return;

  await preparePackagedProofRuntime();

  const topLocationBefore = window.location.href;
  const topTitleBefore = document.title;

  const first = await start("Issue035First");
  assertPreviewSandbox(first.frame);

  const security = await first.proof<SecurityEvidence>("issue035-security");

  const pixels = await first.proof<{
    pixels: number[][];
    glError: number;
    contextLost: boolean;
  }>("sample-webgl");

  const managedOutput = first.outputEvents.find(
    (event) =>
      event.payload.source === "managed" &&
      event.payload.text === "issue035-managed-ready",
  );

  const topLocationAfter = window.location.href;
  const topTitleAfter = document.title;

  const stopped = await first.stop("user");

  // Validate all assertions
  const connectViolation = security.violations.find(
    (item) =>
      item.effectiveDirective.startsWith("connect-src") &&
      item.blockedUri === "https://example.com/issue035-probe",
  );

  if (
    PREVIEW_SANDBOX !== "allow-scripts" ||
    !security.fetchBlocked ||
    !security.connectSrcViolationObserved ||
    security.serializedOrigin !== "null" ||
    !security.topLocationDenied ||
    !security.topLocationUnchanged ||
    !security.popupDenied ||
    !security.popupTopDenied ||
    !connectViolation ||
    topLocationAfter !== topLocationBefore ||
    topTitleAfter !== topTitleBefore ||
    pixels.glError !== 0 ||
    pixels.contextLost ||
    pixels.pixels.some(
      (pixel) =>
        pixel[0] !== 100 ||
        pixel[1] !== 149 ||
        pixel[2] !== 237 ||
        pixel[3] !== 255,
    ) ||
    !managedOutput ||
    (stopped.runtime as { stop?: { disposeAttempts?: number } })?.stop
      ?.disposeAttempts !== 1
  ) {
    throw new Error(
      `Issue 035 security evidence failed: ${JSON.stringify({
        security,
        pixels,
        topLocation: {
          before: topLocationBefore,
          after: topLocationAfter,
        },
        topTitle: { before: topTitleBefore, after: topTitleAfter },
        managedOutput,
        stopped,
      })}`,
    );
  }

  // Run a second generation to confirm isolation survives restart
  const second = await start("Issue035Second");
  assertPreviewSandbox(second.frame);
  const secondSecurity = await second.proof<SecurityEvidence>("issue035-security");
  const secondPixels = await second.proof<{
    pixels: number[][];
    glError: number;
    contextLost: boolean;
  }>("sample-webgl");
  const secondStopped = await second.stop("user");
  const topLocationFinal = window.location.href;

  if (
    !secondSecurity.fetchBlocked ||
    !secondSecurity.connectSrcViolationObserved ||
    !secondSecurity.topLocationDenied ||
    !secondSecurity.topLocationUnchanged ||
    !secondSecurity.popupDenied ||
    !secondSecurity.popupTopDenied ||
    secondSecurity.serializedOrigin !== "null" ||
    topLocationFinal !== topLocationBefore ||
    secondPixels.glError !== 0 ||
    secondPixels.contextLost ||
    secondPixels.pixels.some(
      (pixel) =>
        pixel[0] !== 100 ||
        pixel[1] !== 149 ||
        pixel[2] !== 237 ||
        pixel[3] !== 255,
    ) ||
    (secondStopped.runtime as { stop?: { disposeAttempts?: number } })?.stop
      ?.disposeAttempts !== 1
  ) {
    throw new Error(
      `Issue 035 second-generation evidence failed: ${JSON.stringify({
        secondSecurity,
        secondPixels,
        topLocationFinal,
        secondStopped,
      })}`,
    );
  }

  await invoke("issue035_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE035_PROOF=1",
      sandbox: first.frame.getAttribute("sandbox"),
      csp: PREVIEW_CSP,
      first: {
        security,
        connectSrcViolation: connectViolation,
        pixels,
        managedOutput,
        stopped,
      },
      second: {
        security: secondSecurity,
        pixels: secondPixels,
        stopped: secondStopped,
      },
      topLevel: {
        locationBefore: topLocationBefore,
        locationAfterFirstProbe: topLocationAfter,
        locationAfterSecondProbe: topLocationFinal,
        titleBefore: topTitleBefore,
        titleAfterFirstProbe: topTitleAfter,
        unchanged: topLocationBefore === topLocationAfter &&
          topLocationAfter === topLocationFinal,
      },
      enforcementLayers: {
        cspConnectSrc: "connect-src playground-preview:",
        sandboxNavigationDenied: "allow-scripts only (no allow-top-navigation)",
        sandboxPopupDenied: "allow-scripts only (no allow-popups)",
        shellNavigationHook: "on_navigation allows only tauri://, playground-preview://, and about: schemes",
        shellNewWindowHook: "on_new_window denies all",
      },
    }),
  });
}

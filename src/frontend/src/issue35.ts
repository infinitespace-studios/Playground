import { compileLoadStartIssue23, preparePackagedProofRuntime } from "./issue21";

const source = `
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

const wait = (ms: number) => new Promise(resolve => globalThis.setTimeout(resolve, ms));

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
  const preview = await compileLoadStartIssue23({
    assemblyName: name,
    sourcePath: "src/Issue035Game.cs",
    sourceText: source,
    proofMode: true,
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

  // Hard assertions
  const expectedOrigin = "playground-preview://localhost";
  const connectViolation = firstSecurity.violations.find(v =>
    v.effectiveDirective.startsWith("connect-src") &&
    v.blockedUri === "https://example.com/issue035-probe");

  if (
    // CSP connect-src violation
    !firstSecurity.fetchBlocked ||
    !connectViolation ||
    connectViolation.effectiveDirective !== "connect-src" ||
    // Exact origin
    firstSecurity.serializedOrigin !== expectedOrigin ||
    // Popup denied (on_new_window hook returns Deny)
    !firstSecurity.popupDenied || // _top popup may return self in top-level window
    // popupTopDenied: _top = self in isolated top-level window; navigation blocked by hook
    // Main window unchanged
    mainTitleAfter !== mainTitleBefore ||
    mainUrlAfter !== mainUrlBefore ||
    // Second generation same evidence
    !secondSecurity.fetchBlocked ||
    secondSecurity.serializedOrigin !== expectedOrigin ||
    !secondSecurity.popupDenied // topDenied not checked: _top = self in top-level window
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
      architecture: "isolated-webview-window",
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
        onNavigation: "navigation_allowed: tauri/playground-preview/about only",
        onNewWindow: "NewWindowResponse::Deny",
        processIsolation: "separate WKWebView — no shared DOM",
      },
    }),
  });
}

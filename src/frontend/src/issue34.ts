import { runInPagePreviewForProof, preparePackagedProofRuntime } from "./issue21";

const ISSUE034_CANARY_SHA256 =
  "ef5368ada37a4cddc5bda46069fd7b3ad51b30b5dab1697a58ae9816154f2372";

export const ISSUE034_APPROVED_COMMANDS = [
  "issue009_is_proof_enabled",
  "issue009_emit_report",
  "issue011_is_proof_enabled",
  "issue011_set_outer_size",
  "issue011_outer_bounds",
  "issue011_emit_report",
  "issue010_is_proof_enabled",
  "issue010_emit_report",
  "issue020_is_proof_enabled",
  "issue020_emit_checkpoint",
  "issue020_emit_report",
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
  "issue037_check_acknowledgement",
  "issue037_write_acknowledgement",
  "issue037_is_proof_enabled",
  "issue037_emit_report",
  "issue037_read_store_snapshot",
  "issue037_clear_store",
  "issue037_proof_phase",
  "issue037_emit_checkpoint",
  "issue038_is_proof_enabled",
  "issue038_store_transfer",
  "issue038_clear_transfer",
  "issue038_create_preview_window",
  "issue038_destroy_preview_window",
  "issue038_preview_window_exists",
  "issue038_relay_to_preview",
  "issue038_collect_bridge_messages",
  "issue038_monotonic_nanos",
  "issue038_destroy_all_previews",
  "issue038_bootstrap_preview",
  "issue038_inject_script",
  "issue038_emit_checkpoint",
  "issue038_create_no_wasm_eval_window",
  "issue038_emit_report",
  "issue039_is_proof_enabled",
  "issue039_emit_checkpoint",
  "issue039_emit_report",
  "issue039_store_asset",
  "issue039_asset_manifest",
  "issue039_clear_assets",
  "issue039_transfer_state",
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
  "issue050_write_file",
  "issue050_save_dialog",
  "issue050_open_dialog",
  "issue050_set_dirty",
  "issue051_pick_folder",
  "issue051_read_project",
] as const;

const source = `
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

async function start(name: string) {
  return runInPagePreviewForProof({
    assemblyName: name,
    sourcePath: "src/Issue034Game.cs",
    sourceText: source,
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
  const first = await start("Issue034First");
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
  // supply-chain inventory guard asserted by protocol.test.ts / issue040.test.ts.)
  const running = await first.query();
  const callsAfterFirst = await invoke<number>("issue034_trusted_marker_calls");
  const firstStop = await first.stop("user");

  // Second preview — verify clean restart, no corruption
  const second = await start("Issue034Second");
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

import { runInPagePreviewForProof, preparePackagedProofRuntime } from "./issue21";
import {
  LIMITS,
  inspectClone,
  validateBinaryPair,
  validateCompileRequest,
} from "./protocol";

const source = `
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

const wait = (ms: number) => new Promise(resolve => globalThis.setTimeout(resolve, ms));

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

// Bridge protocol attack tests — attack the Rust-mediated bridge surface
async function testBridgeAttacks(invoke: Function) {
  const attacks: Record<string, { sent: boolean; rejected: boolean }> = {};
  const fakeGen = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const realGen = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

  // Attack 1: relay to non-existent generation
  try {
    await invoke("issue038_relay_to_preview", {
      generation: fakeGen,
      message: JSON.stringify({ channel: "protocol", data: { type: "attack" } }),
    });
    attacks.staleGeneration = { sent: true, rejected: false };
  } catch {
    attacks.staleGeneration = { sent: false, rejected: true };
  }

  // Attack 2: collect from non-existent generation
  try {
    const msgs = await invoke("issue038_collect_bridge_messages", { generation: fakeGen });
    attacks.collectStaleGen = { sent: true, rejected: Array.isArray(msgs) && msgs.length === 0 };
  } catch {
    attacks.collectStaleGen = { sent: false, rejected: true };
  }

  // Attack 3: bootstrap non-existent window
  try {
    await invoke("issue038_bootstrap_preview", {
      generation: fakeGen,
      bootstrapJson: "{}",
    });
    attacks.bootstrapStale = { sent: true, rejected: false };
  } catch {
    attacks.bootstrapStale = { sent: false, rejected: true };
  }

  // Attack 4: invalid generation format
  try {
    await invoke("issue038_create_preview_window", { generation: "../escape" });
    attacks.invalidGen = { sent: true, rejected: false };
  } catch {
    attacks.invalidGen = { sent: false, rejected: true };
  }

  // Attack 5: invalid transfer token
  try {
    await invoke("issue038_store_transfer", {
      token: "../../escape", assembly: [0], pdb: [0],
    });
    attacks.invalidToken = { sent: true, rejected: false };
  } catch {
    attacks.invalidToken = { sent: false, rejected: true };
  }

  // Attack 6: oversized transfer
  try {
    await invoke("issue038_store_transfer", {
      token: "test", assembly: [], pdb: [0],
    });
    attacks.emptyTransfer = { sent: true, rejected: false };
  } catch {
    attacks.emptyTransfer = { sent: false, rejected: true };
  }

  return attacks;
}

export async function runIssue036AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue036_is_proof_enabled"))) return;

  await preparePackagedProofRuntime();

  // Phase 1: structural validation (unit-level, no preview)
  const structural = testStructuralValidation();

  // Phase 2: bridge protocol attacks (Rust command surface). These issue038_*
  // commands still exist and remain ACL-registered until task 4's deliberate
  // retirement, so this continues to prove they reject forged/malformed input
  // (stale/invalid generations, path-escape tokens, oversized/empty transfers).
  const bridgeAttacks = await testBridgeAttacks(invoke);

  // Phase 3: valid compile/run through the in-page opaque-origin sandboxed iframe
  // (issue 052 task 3) — proves the forged-message attacks did not corrupt the
  // transport the live path now uses. runInPagePreviewForProof waits for
  // preview.started before returning.
  const first = await runInPagePreviewForProof({
    assemblyName: "Issue036First",
    sourcePath: "src/Issue036Game.cs",
    sourceText: source,
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
    sourceText: source,
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
  const allAttacksRejected = Object.values(bridgeAttacks).every(a => a.rejected);
  const pixelsOk = pixels.glError === 0 && !pixels.contextLost &&
    pixels.pixels.every(p => p[0] === 100 && p[1] === 149 && p[2] === 237 && p[3] === 255);
  const secondPixelsOk = secondPixels.glError === 0 && !secondPixels.contextLost &&
    secondPixels.pixels.every(p => p[0] === 100 && p[1] === 149 && p[2] === 237 && p[3] === 255);

  if (!allStructural || !allAttacksRejected || !pixelsOk || !managedOutput ||
      !secondPixelsOk || !(running as any).runReturned || !(secondRunning as any).runReturned ||
      (firstStopped.runtime as { stop?: { disposeAttempts?: number } })?.stop?.disposeAttempts !== 1 ||
      (secondStopped.runtime as { stop?: { disposeAttempts?: number } })?.stop?.disposeAttempts !== 1) {
    throw new Error(`Issue 036 protocol proof failed: ${JSON.stringify({
      structural, bridgeAttacks, pixelsOk, secondPixelsOk, running, secondRunning,
    })}`);
  }

  await invoke("issue036_emit_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      architecture: "in-page-sandboxed-iframe",
      structural,
      bridgeAttacks,
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

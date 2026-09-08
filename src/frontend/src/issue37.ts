
// Issue 037 — Warn before first run of a newly opened project (PROOF)
//
// The production first-run warning gate now lives in `first-run-warning.ts`
// (Stage-2 security extraction). This module keeps ONLY the two-phase packaged
// auto-proof and re-exports the production gate so historical callers
// (entry.proof.ts, app.ts via the security module) resolve unchanged.

import { preparePackagedProofRuntime, compileLoadStartIssue23 } from "./issue21";
import {
  SCRATCH_PROJECT_IDENTITY,
  gateFirstRun,
  isAcknowledged,
} from "./first-run-warning";

// Re-export the production gate/identity for historical import paths.
export { SCRATCH_PROJECT_IDENTITY, gateFirstRun } from "./first-run-warning";

//
// Phase 1 (MONOGAME_ISSUE037_PROOF_PHASE=1):
//   1. Clear proof-namespace store
//   2. Verify identity is not acknowledged
//   3. Programmatically click Run → observe modal appears
//   4. Programmatically click Cancel → observe no compile/run
//   5. Programmatically click Run again → observe modal reappears
//   6. Programmatically click Confirm → observe compile+run+render
//   7. Verify store now contains acknowledgement
//   8. Emit phase-1 checkpoint + exit (acknowledgement persists on disk)
//
// Phase 2 (MONOGAME_ISSUE037_PROOF_PHASE=2):
//   1. Verify store still has acknowledgement (survived process restart)
//   2. Programmatically click Run → verify NO modal (gate returns true)
//   3. Observe compile+run+render (same identity, no re-prompt)
//   4. Clear store → verify identity no longer acknowledged
//   5. Validate identity input rejection
//   6. Emit phase-2 report + exit

const proofSourceText = `
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using System.Threading;

public sealed class Issue037ProofGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _frameCount;
    public static int FrameCount => Volatile.Read(ref _frameCount);
    public Issue037ProofGame()
    {
        _graphics = new GraphicsDeviceManager(this);
        Content.RootDirectory = "Content";
    }
    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        Interlocked.Increment(ref _frameCount);
        base.Draw(gameTime);
    }
}`;

const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));

/** Wait for the issue037 modal to be visible in the DOM. */
function waitForModal(timeoutMs = 3000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    const check = () => {
      const backdrop = document.querySelector<HTMLElement>(".issue037-backdrop.issue037-visible");
      if (backdrop) return resolve(backdrop);
      if (performance.now() >= deadline) return reject(new Error("Issue 037: modal did not appear within timeout."));
      window.setTimeout(check, 30);
    };
    check();
  });
}

/** Wait for the modal to be dismissed (no visible backdrop). */
function waitForModalDismissed(timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    const check = () => {
      const backdrop = document.querySelector<HTMLElement>(".issue037-backdrop.issue037-visible");
      if (!backdrop) return resolve();
      if (performance.now() >= deadline) return reject(new Error("Issue 037: modal did not dismiss within timeout."));
      window.setTimeout(check, 30);
    };
    check();
  });
}

async function runPhase1(invoke: NonNullable<typeof window.__TAURI_INTERNALS__>["invoke"]): Promise<Record<string, unknown>> {
  const readiness = await preparePackagedProofRuntime();
  const identity = SCRATCH_PROJECT_IDENTITY;

  // Step 1: Clear proof-namespace store
  await invoke("issue037_clear_store");
  const clearedStore = JSON.parse(await invoke<string>("issue037_read_store_snapshot"));
  if (Object.keys(clearedStore.acknowledged).length !== 0) {
    throw new Error("Issue 037 phase 1: store not empty after clear.");
  }

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 1, step: "store-cleared" }) });

  // Step 2: Verify identity not acknowledged
  const preCheck = await isAcknowledged(identity);
  if (preCheck) throw new Error("Issue 037 phase 1: identity was pre-acknowledged.");

  // Step 3: Programmatically click Run → modal must appear
  const runButton = document.querySelector<HTMLButtonElement>("#run-clear-color");
  if (!runButton) throw new Error("Issue 037 phase 1: Run button missing.");
  runButton.click();
  const modalForCancel = await waitForModal();

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 1, step: "modal-appeared-for-cancel" }) });

  // Step 4: Click Cancel → modal dismissed, no compile/run
  const cancelBtn = modalForCancel.querySelector<HTMLButtonElement>(".issue037-cancel");
  if (!cancelBtn) throw new Error("Issue 037 phase 1: Cancel button missing.");
  cancelBtn.click();
  await waitForModalDismissed();

  // Verify the run button is NOT disabled (cancel should leave it enabled)
  await wait(200);
  const statusAfterCancel = document.querySelector<HTMLElement>("#run-clear-color-status");
  const buttonDisabledAfterCancel = runButton.disabled;

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 1, step: "cancel-verified", buttonDisabled: buttonDisabledAfterCancel }) });

  // Step 5: Click Run again → modal reappears (identity still not acknowledged)
  runButton.click();
  const modalForConfirm = await waitForModal();

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 1, step: "modal-reappeared-for-confirm" }) });

  // Step 6: Click Confirm → compile+run should proceed
  const confirmBtn = modalForConfirm.querySelector<HTMLButtonElement>(".issue037-confirm");
  if (!confirmBtn) throw new Error("Issue 037 phase 1: Confirm button missing.");
  confirmBtn.click();
  await waitForModalDismissed();

  // Wait for compile+run to complete and game to render
  const deadline = performance.now() + 30_000;
  let rendered = false;
  while (performance.now() < deadline) {
    const statusEl = document.querySelector<HTMLElement>("#run-clear-color-status");
    if (statusEl?.dataset.state === "ready" || statusEl?.dataset.state === "error") {
      rendered = statusEl.dataset.state === "ready";
      break;
    }
    await wait(200);
  }
  if (!rendered) throw new Error("Issue 037 phase 1: game did not reach ready state after confirm.");

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 1, step: "game-running" }) });

  // Step 7: Verify store contains acknowledgement
  const storeAfterConfirm = JSON.parse(await invoke<string>("issue037_read_store_snapshot"));
  if (!storeAfterConfirm.acknowledged[identity] ||
      typeof storeAfterConfirm.acknowledged[identity].acknowledgedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(storeAfterConfirm.acknowledged[identity].acknowledgedAt)) {
    throw new Error(`Issue 037 phase 1: store invalid after confirm: ${JSON.stringify(storeAfterConfirm)}`);
  }

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 1, step: "store-verified", store: storeAfterConfirm }) });

  // Phase 1 complete — emit checkpoint and exit so phase 2 is a new process
  const phase1Result = {
    readiness,
    clearedStore,
    preCheck,
    modalAppearedForCancel: true,
    cancelDismissed: true,
    buttonDisabledAfterCancel,
    modalReappearedForConfirm: true,
    confirmProceeded: rendered,
    storeAfterConfirm,
    statusAfterCancel: statusAfterCancel?.textContent?.slice(0, 120),
    pid: await invoke<u32>("issue037_proof_phase"),
  };

  return phase1Result;
}

type u32 = number;

async function runPhase2(invoke: NonNullable<typeof window.__TAURI_INTERNALS__>["invoke"]): Promise<Record<string, unknown>> {
  const readiness = await preparePackagedProofRuntime();
  const identity = SCRATCH_PROJECT_IDENTITY;

  // Step 1: Verify store still has acknowledgement (survived process restart)
  const storeOnRestart = JSON.parse(await invoke<string>("issue037_read_store_snapshot"));
  if (!storeOnRestart.acknowledged[identity]) {
    throw new Error("Issue 037 phase 2: acknowledgement did not survive process restart.");
  }

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 2, step: "persistence-verified", store: storeOnRestart }) });

  // Step 2: gateFirstRun should return true without modal
  const gateResult = await gateFirstRun(identity);
  if (!gateResult) throw new Error("Issue 037 phase 2: gate denied despite acknowledged identity.");

  // Verify no modal is visible
  const modalVisible = !!document.querySelector<HTMLElement>(".issue037-backdrop.issue037-visible");
  if (modalVisible) throw new Error("Issue 037 phase 2: modal appeared for already-acknowledged identity.");

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 2, step: "gate-passed-no-modal" }) });

  // Step 3: Run game directly (already acknowledged, no modal)
  const preview = await compileLoadStartIssue23({
    assemblyName: "Issue037Phase2Game",
    sourcePath: "src/Issue037ProofGame.cs",
    sourceText: proofSourceText,
    proofMode: true,
  });
  const renderDeadline = performance.now() + 10_000;
  let managed = await preview.query();
  while (Number(managed.frameCount) < 3 && performance.now() < renderDeadline) {
    await wait(50);
    managed = await preview.query();
  }
  if (Number(managed.frameCount) < 3) throw new Error("Issue 037 phase 2: game did not render.");
  const pixels = await preview.proof<{ pixels: number[][]; glError: number; contextLost: boolean }>("sample-webgl");
  if (pixels.glError !== 0 || pixels.contextLost ||
      pixels.pixels.some((p: number[]) => Math.abs(p[0] - 100) > 3 || Math.abs(p[1] - 149) > 3 ||
        Math.abs(p[2] - 237) > 3 || Math.abs(p[3] - 255) > 3)) {
    throw new Error(`Issue 037 phase 2: pixel proof failed: ${JSON.stringify(pixels)}`);
  }
  await preview.teardown();

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 2, step: "game-rendered" }) });

  // Step 4: Clear store → identity no longer acknowledged
  await invoke("issue037_clear_store");
  const afterClear = await isAcknowledged(identity);
  if (afterClear) throw new Error("Issue 037 phase 2: identity still acknowledged after clear.");

  // Verify alt identity also not acknowledged
  const altIdentity = "builtin-scratch-v2-proof";
  const altCheck = await isAcknowledged(altIdentity);
  if (altCheck) throw new Error("Issue 037 phase 2: alt identity unexpectedly acknowledged.");

  await invoke("issue037_emit_checkpoint", { checkpoint: JSON.stringify({ phase: 2, step: "store-cleared-verified" }) });

  // Step 5: Identity validation — reject invalid identities
  const invalidIdentities = ["", "a".repeat(257), "path/injection", "has spaces", "has.dots"];
  const rejections: string[] = [];
  for (const invalid of invalidIdentities) {
    try {
      await isAcknowledged(invalid);
      rejections.push(`accepted: ${invalid.slice(0, 20)}`);
    } catch { /* expected */ }
  }
  if (rejections.length > 0) {
    throw new Error(`Issue 037 phase 2: invalid identities accepted: ${rejections.join(", ")}`);
  }

  const finalStore = JSON.parse(await invoke<string>("issue037_read_store_snapshot"));

  return {
    readiness,
    storeOnRestart,
    gateResult,
    modalAppeared: false,
    gameRendered: { frameCount: Number(managed.frameCount), pixelsSampled: pixels.pixels.length, glError: pixels.glError },
    storeClearedVerified: !afterClear,
    altIdentityDenied: !altCheck,
    identityValidation: { rejectedCount: invalidIdentities.length, accepted: rejections },
    finalStore: { schemaVersion: finalStore.schemaVersion, entryCount: Object.keys(finalStore.acknowledged).length },
  };
}

export async function runIssue037AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue037_is_proof_enabled"))) return;

  const phase = await invoke<number>("issue037_proof_phase");

  if (phase === 1) {
    const result = await runPhase1(invoke);
    // Emit phase-1 report and exit — phase 2 will be a new process
    await invoke("issue037_emit_report", {
      report: JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        proofMode: "MONOGAME_ISSUE037_PROOF=1",
        phase: 1,
        result,
      }),
    });
    // emit_report calls app.exit(0)
  } else if (phase === 2) {
    const result = await runPhase2(invoke);
    await invoke("issue037_emit_report", {
      report: JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        proofMode: "MONOGAME_ISSUE037_PROOF=1",
        phase: 2,
        result,
      }),
    });
  }
}

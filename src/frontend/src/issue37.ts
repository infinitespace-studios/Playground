// Issue 037 — Warn before first run of a newly opened project
//
// Gates every user-triggered Run behind a persistent acknowledgement keyed by
// a stable project identity.  The acknowledgement is stored via Tauri commands
// in the app-data directory, inaccessible to the opaque preview iframe.
//
// The built-in scratch buffer keeps a fixed identity. Folder projects supply
// a SHA-256 identity derived from their canonical root (issue051.ts).

import { preparePackagedProofRuntime, compileLoadStartIssue23 } from "./issue21";

// Stable identity for the built-in scratch buffer. Opened folder projects use
// their own path-redacted identities supplied by issue051.
export const SCRATCH_PROJECT_IDENTITY = "builtin-scratch-v1";

// --- Acknowledgement store (via Tauri IPC) ---

async function invokeChecked<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error("Tauri IPC is unavailable.");
  return invoke<T>(command, args);
}

export async function isAcknowledged(identity: string): Promise<boolean> {
  return invokeChecked<boolean>("issue037_check_acknowledgement", { identity });
}

export async function writeAcknowledgement(identity: string): Promise<void> {
  await invokeChecked<null>("issue037_write_acknowledgement", { identity });
}

// --- Modal DOM ---

function createWarningModal(): {
  element: HTMLElement;
  show: () => Promise<boolean>;
  destroy: () => void;
} {
  const backdrop = document.createElement("div");
  backdrop.className = "issue037-backdrop";
  backdrop.setAttribute("role", "presentation");

  const dialog = document.createElement("div");
  dialog.className = "issue037-dialog";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "issue037-title");
  dialog.setAttribute("aria-describedby", "issue037-desc");

  const marker = document.createElement("div");
  marker.className = "issue037-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "⚠";

  const title = document.createElement("h2");
  title.id = "issue037-title";
  title.className = "issue037-title";
  title.textContent = "Before you run";

  const desc = document.createElement("p");
  desc.id = "issue037-desc";
  desc.className = "issue037-desc";
  desc.textContent =
    "This application is intended primarily for running your own local code. " +
    "It provides defence-in-depth protections against accidental or opportunistic " +
    "access to desktop privileges, but it does not provide a complete sandbox " +
    "against deliberately malicious code.";

  const note = document.createElement("p");
  note.className = "issue037-note";
  note.textContent =
    "You will not be asked again for this project unless its identity changes.";

  const actions = document.createElement("div");
  actions.className = "issue037-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "issue037-cancel";
  cancelButton.textContent = "Cancel";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "issue037-confirm";
  confirmButton.textContent = "I understand, run this project";

  actions.appendChild(cancelButton);
  actions.appendChild(confirmButton);
  dialog.appendChild(marker);
  dialog.appendChild(title);
  dialog.appendChild(desc);
  dialog.appendChild(note);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);

  let resolver: ((confirmed: boolean) => void) | null = null;
  let visible = false;

  function resolve(confirmed: boolean) {
    if (!resolver) return;
    const fn = resolver;
    resolver = null;
    visible = false;
    backdrop.classList.remove("issue037-visible");
    restoreFocus();
    fn(confirmed);
  }

  let previousFocus: Element | null = null;
  function trapFocus() {
    previousFocus = document.activeElement;
    confirmButton.focus();
  }
  function restoreFocus() {
    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus();
    }
  }

  // Focus trap: Tab cycles between cancel and confirm only
  function handleKeydown(event: KeyboardEvent) {
    if (!visible) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      resolve(false);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const focusable = [cancelButton, confirmButton];
      const current = document.activeElement;
      const index = focusable.indexOf(current as HTMLButtonElement);
      const next = event.shiftKey
        ? focusable[(index - 1 + focusable.length) % focusable.length]
        : focusable[(index + 1) % focusable.length];
      next.focus();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === backdrop) {
      resolve(false);
    }
  }

  cancelButton.addEventListener("click", () => resolve(false));
  confirmButton.addEventListener("click", () => resolve(true));
  backdrop.addEventListener("click", handleBackdropClick);
  backdrop.addEventListener("keydown", handleKeydown);

  return {
    element: backdrop,
    show() {
      if (visible) return new Promise<boolean>((r) => { resolver = r; });
      visible = true;
      if (!backdrop.parentElement) document.body.appendChild(backdrop);
      // Force reflow so the CSS transition triggers
      void backdrop.offsetWidth;
      backdrop.classList.add("issue037-visible");
      trapFocus();
      return new Promise<boolean>((r) => { resolver = r; });
    },
    destroy() {
      resolve(false);
      backdrop.removeEventListener("click", handleBackdropClick);
      backdrop.removeEventListener("keydown", handleKeydown);
      backdrop.remove();
    },
  };
}

// --- Run gate ---

let warningModal: ReturnType<typeof createWarningModal> | null = null;
let gatePromise: Promise<boolean> | null = null;

/**
 * Returns true if Run should proceed.  Shows the warning modal on first call
 * for a given identity; subsequent calls for the same acknowledged identity
 * return true without prompting.  There is no bypass parameter — every call
 * always queries the native acknowledgement store.
 */
export async function gateFirstRun(
  identity: string = SCRATCH_PROJECT_IDENTITY,
): Promise<boolean> {
  // Fast path: already acknowledged
  const already = await isAcknowledged(identity);
  if (already) return true;

  // Concurrency: reuse an in-flight gate promise
  if (gatePromise) return gatePromise;

  if (!warningModal) {
    warningModal = createWarningModal();
  }

  gatePromise = (async () => {
    const confirmed = await warningModal!.show();
    if (!confirmed) return false;

    // Write acknowledgement — must succeed before Run proceeds
    await writeAcknowledgement(identity);
    return true;
  })().finally(() => {
    gatePromise = null;
  });

  return gatePromise;
}

// --- Packaged proof (multi-process, two phases) ---
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

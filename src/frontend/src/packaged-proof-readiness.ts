// ── Packaged proof readiness / native window activation ─────────────────────
//
// Proof-only support module (never imported by the product graph). Split out of
// the former mixed scenario-toolkit.ts by responsibility: it owns the packaged
// (Tauri) proof runtime readiness gate — driving the native
// `prepare_packaged_proof_window` activation, waiting for the shell window to be
// visible/active and for the page to paint two progressing animation frames,
// then returning the readiness evidence embedded verbatim into every packaged
// proof report. It carries no compiler/preview transport itself; callers invoke
// it before running their scenario's transfer/lifecycle proofs.
//
// Depends only on browser + ambient host globals (window.__TAURI_INTERNALS__,
// window.__MONOGAME_DIAGNOSTICS__, document, performance), so it has no import
// edges into the rest of the proof toolkit and cannot introduce a cycle.

export async function preparePackagedProofRuntime(): Promise<Record<string, unknown>> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error("Tauri proof runtime is unavailable.");
  const requestedAt = performance.now();
  const framesBefore = window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved;
  type NativeProofWindow = [
    string, boolean, boolean, boolean, boolean, boolean,
    boolean, boolean, boolean, number, number,
  ];
  const activate = async () => {
    const native = await invoke<NativeProofWindow>("prepare_packaged_proof_window");
    window.focus();
    const [
      platform,
      activationPolicyRegular,
      unhideRequested,
      runningActivationRequested,
      applicationActive,
      nativeWindowFocused,
      visible,
      focused,
      minimized,
      nativeAttempts,
      nativeElapsedMilliseconds,
    ] = native;
    return {
      platform,
      activationPolicyRegular,
      unhideRequested,
      runningActivationRequested,
      applicationActive,
      nativeWindowFocused,
      visible,
      focused,
      minimized,
      attempts: nativeAttempts,
      elapsedMilliseconds: nativeElapsedMilliseconds,
    };
  };
  let nativeActivation = await activate();
  let activationRounds = 1;
  const readinessDeadline = performance.now() + 20_000;
  let nextActivationAt = performance.now() + 1_000;
  let animationFrameBefore: number | null = null;
  let animationFrameAfter: number | null = null;
  const nextAnimationFrame = () => Promise.race([
    new Promise<number>(resolve => window.requestAnimationFrame(resolve)),
    new Promise<null>(resolve => window.setTimeout(() => resolve(null), 500)),
  ]);
  while (performance.now() < readinessDeadline) {
    if (document.visibilityState === "visible" &&
        nativeActivation.visible && nativeActivation.focused && !nativeActivation.minimized) {
      animationFrameBefore = await nextAnimationFrame();
      animationFrameAfter = animationFrameBefore === null ? null : await nextAnimationFrame();
      // Issue 052 task-A: readiness is the window being visible/active and the
      // page painting (two progressing animation frames) — NOT the obsolete
      // top-level MonoGame demo rendering (issue 45 removed its #canvas; the
      // proofs' own compiler/preview iframes drive the WASM runtime).
      if (animationFrameBefore !== null && animationFrameAfter !== null &&
          animationFrameAfter > animationFrameBefore) break;
    }

    if (performance.now() >= nextActivationAt && activationRounds < 3) {
      nativeActivation = await activate();
      activationRounds += 1;
      nextActivationAt = performance.now() + 1_000;
    }
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  const framesAfter = window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved;
  if (document.visibilityState !== "visible" ||
      !nativeActivation.applicationActive || !nativeActivation.nativeWindowFocused ||
      !nativeActivation.visible || !nativeActivation.focused || nativeActivation.minimized ||
      animationFrameBefore === null || animationFrameAfter === null ||
      animationFrameAfter <= animationFrameBefore) {
    throw new Error(`Packaged proof readiness failed: ${JSON.stringify({
      nativeActivation,
      activationRounds,
      documentVisibility: document.visibilityState,
      animationFrameBefore,
      animationFrameAfter,
      framesBefore,
      framesAfter,
      runtimeState: document.documentElement.dataset.runtime ?? null,
    })}`);
  }
  return {
    requestedAt,
    readyAt: performance.now(),
    nativeActivation,
    activationRounds,
    visibilityState: document.visibilityState,
    animationFrameProgressMilliseconds: animationFrameAfter - animationFrameBefore,
    renderedFramesObserved: framesAfter,
    frameIncrease: framesAfter - framesBefore,
    runtimeState: document.documentElement.dataset.runtime,
  };
}


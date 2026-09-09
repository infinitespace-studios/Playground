// The stop executor drives the product cooperative-stop lifecycle (stop the
// game, record the managed outcome, emit the terminal `preview.stopped` event).
// It carries NO proof instrumentation: the optional `observeStopped` hook is a
// product-neutral post-stop observation seam. In the PRODUCT profile no hook is
// supplied, so the executor performs no additional work after the managed stop.
// The PROOF preview extension supplies a hook that observes the stopped game's
// quiescence; that proof-only reflection lives entirely in the extension, never
// here.
export function createPreviewStopExecutor({
  getState,
  setState,
  getExports,
  createLifecycleEvent,
  recordStop,
  observeStopped,
}) {
  let cleanup = null;

  return message => {
    const state = getState();
    if (state === "disposed" || state === "stopped") {
      return {
        result: {
          success: true,
          data: { previewId: message.payload.previewId, accepted: false, alreadyStopped: true },
        },
        closeAfterResponse: true,
        closeReason: "already-stopped-retirement",
      };
    }

    if (cleanup) {
      return cleanup.then(() => ({
        result: {
          success: true,
          data: { previewId: message.payload.previewId, accepted: true, alreadyStopped: false },
        },
      }));
    }

    setState("stopping");
    cleanup = Promise.resolve().then(async () => {
      const exports = await getExports();
      if (typeof exports.StopGame !== "function") throw new Error("INTERNAL_ERROR");
      const managed = JSON.parse(exports.StopGame());
      recordStop(managed);
      if (!managed.success) {
        const error = {
          code: managed.error?.code ?? "PREVIEW_STOP_FAILED",
          message: managed.error?.message ?? "Cooperative preview cleanup failed.",
        };
        setState("disposed");
        return {
          result: { success: false, error },
          events: [
            createLifecycleEvent("preview.failed", message.correlationId, {
              phase: "stop", error,
            }),
            createLifecycleEvent("preview.stopped", message.correlationId, { reason: "failed" }),
          ],
        };
      }

      const observed = typeof observeStopped === "function"
        ? (await observeStopped(exports)) ?? null
        : null;
      recordStop({ ...managed, quiescent: observed });
      setState("disposed");
      return {
        result: {
          success: true,
          data: { previewId: message.payload.previewId, accepted: true, alreadyStopped: false },
        },
        events: [
          createLifecycleEvent("preview.stopped", message.correlationId, { reason: "requested" }),
        ],
      };
    });
    return cleanup;
  };
}

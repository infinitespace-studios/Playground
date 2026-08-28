export function createPreviewStopExecutor({
  getState,
  setState,
  getExports,
  createLifecycleEvent,
  recordStop,
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

      await new Promise(resolve => globalThis.setTimeout(resolve, 100));
      const quiescent = typeof exports.QueryStoppedGameProof === "function"
        ? JSON.parse(exports.QueryStoppedGameProof())
        : null;
      recordStop({ ...managed, quiescent });
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

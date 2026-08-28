export class UnexpectedStartBoundaryError extends Error {
  constructor() {
    super("INTERNAL_ERROR");
    this.name = "UnexpectedStartBoundaryError";
  }
}

const wait = milliseconds =>
  new Promise(resolve => globalThis.setTimeout(resolve, milliseconds));

export function createPreviewStartExecutor({
  getState,
  setState,
  getExports,
  createLifecycleEvent,
  recordStart,
  recordFailureTeardown,
  recordUnexpected,
  beforeRunDelayMs = 0,
  startedEventDelayMs = 0,
  throwUnexpectedBeforeExport = false,
}) {
  const fail = (exports, message, error) => {
    setState("failed");
    const failed = createLifecycleEvent("preview.failed", message.correlationId, {
      phase: "start",
      error,
    });
    const teardown = typeof exports.TeardownGame === "function"
      ? JSON.parse(exports.TeardownGame())
      : null;
    recordFailureTeardown(teardown);
    const stopped = createLifecycleEvent("preview.stopped", message.correlationId, {
      reason: "failed",
    });
    setState("disposed");
    return {
      result: { success: false, error },
      events: [failed, stopped],
      closeAfterResponse: true,
    };
  };

  return async message => {
    if (getState() !== "loaded") throw new Error("INVALID_STATE");
    setState("starting");
    const cancelled = () => getState() !== "starting";
    const cancelledOutcome = () => ({
      result: {
        success: false,
        error: {
          code: "CANCELLED",
          message: "Preview start was cancelled by teardown.",
        },
      },
    });
    const timeoutMs = message.payload.timeoutMs ?? 10_000;
    const startedAt = performance.now();
    if (beforeRunDelayMs > 0) await wait(beforeRunDelayMs);
    if (cancelled()) return cancelledOutcome();
    const exports = await getExports();
    if (cancelled()) return cancelledOutcome();
    if (typeof exports.RunLoadedGame !== "function") throw new UnexpectedStartBoundaryError();

    let managed;
    try {
      if (throwUnexpectedBeforeExport) throw new Error("injected unexpected boundary failure");
      managed = JSON.parse(exports.RunLoadedGame());
    } catch (cause) {
      setState("tainted");
      recordUnexpected({
        category: "start-boundary",
        code: "INTERNAL_ERROR",
        name: cause instanceof Error ? cause.name : "UnknownError",
      });
      try {
        if (typeof exports.TeardownGame === "function") exports.TeardownGame();
      } finally {
        throw new UnexpectedStartBoundaryError();
      }
    }

    const returnedAt = performance.now();
    recordStart({
      correlationId: message.correlationId,
      invokedAt: startedAt,
      returnedAt,
      callDurationMilliseconds: returnedAt - startedAt,
      managed,
    });
    if (cancelled()) return cancelledOutcome();
    if (returnedAt - startedAt > timeoutMs) {
      return fail(exports, message, {
        code: "TIMEOUT",
        message: "Preview start exceeded its accepted deadline.",
      });
    }
    if (!managed.success) {
      return fail(exports, message, {
        code: managed.error?.code ?? "PREVIEW_START_FAILED",
        message: managed.error?.message ?? "Managed preview startup failed.",
      });
    }

    setState("running");
    const started = createLifecycleEvent("preview.started", message.correlationId);
    return {
      result: { success: true, data: { previewId: message.payload.previewId, accepted: true } },
      ...(startedEventDelayMs > 0
        ? {
            delayedEvents: [{
              event: started,
              delayMs: startedEventDelayMs,
              shouldPost: () => getState() === "running",
            }],
          }
        : { events: [started] }),
    };
  };
}

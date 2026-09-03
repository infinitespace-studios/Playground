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
    const teardown = typeof exports.TeardownGame === "function"
      ? JSON.parse(exports.TeardownGame())
      : null;
    if (error.code === "PREVIEW_RUNTIME_FAILED" && teardown) {
      error = {
        ...error,
        details: {
          ...(error.details ?? {}),
          cleanupSucceeded: teardown.success === true,
          disposeAttempts: teardown.disposeAttempts,
        },
      };
    }
    recordFailureTeardown(teardown);
    const failed = createLifecycleEvent("preview.failed", message.correlationId, {
      phase: "start",
      error,
    });
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
      const failureDetails = managed.failure
        ? { exceptionType: managed.failure.exceptionType }
        : null;
      const firstFrame = managed.failure?.frames?.[0];
      if (firstFrame) {
        Object.assign(failureDetails, {
          frame0Method: firstFrame.method,
          frame0File: firstFrame.file,
          frame0Line: firstFrame.line,
          frame0Column: firstFrame.column,
        });
      }
      return fail(exports, message, managed.failure
        ? {
            code: "PREVIEW_RUNTIME_FAILED",
            message: managed.failure.message ?? "Managed preview startup failed.",
            details: failureDetails,
          }
        : {
            code: managed.error?.code ?? "PREVIEW_START_FAILED",
            message: managed.error?.message ?? "Managed preview startup failed.",
          });
    }

    // Detect normal game exit (Game.Exit() on WebGL): the loop terminated
    // and the game disposed itself without throwing an exception.
    if (managed.terminationReason === "exited" && managed.disposed === true) {
      const exited = createLifecycleEvent("preview.exited", crypto.randomUUID(), {
        previewId: message.payload.previewId,
        sequence: 1,
        exitCode: 0,
      });
      const stopped = createLifecycleEvent("preview.stopped", message.correlationId, {
        reason: "exited",
      });
      return {
        result: { success: true, data: { previewId: message.payload.previewId, accepted: true } },
        events: [exited, stopped],
        closeAfterResponse: true,
      };
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

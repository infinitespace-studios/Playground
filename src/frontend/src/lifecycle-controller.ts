// Neutral, production run/stop lifecycle state machine. Owns the run/stop/restart
// transitions, start-throw recovery, stop coalescing, restart queueing, failure
// observation, and the optional preview-panel lifecycle indicator. It is
// production-neutral: no proof markers, no issue-numbered behaviour. Both the
// product run/stop control (`run-stop.ts`) and the proof scenarios
// (`proof-compile-run-stop.ts`, `proof-runtime-exception.ts`,
// `proof-performance.ts`) import `createRunStopController` from here directly.
export type PreviewLifecycleState = "loading" | "running" | "stopped" | "error";

export function createRunStopController<T>({
  start,
  stop,
  setRunDisabled,
  setStopDisabled,
  setStatus,
  reportError,
  observeFailure,
  onLifecycle,
}: {
  start: () => Promise<T>;
  stop: (preview: T, reason?: "user" | "restart") => Promise<unknown>;
  setRunDisabled: (disabled: boolean) => void;
  setStopDisabled: (disabled: boolean) => void;
  setStatus: (state: "busy" | "ready" | "error", text: string) => void;
  reportError: (error: unknown) => void;
  observeFailure?: (preview: T) => Promise<unknown>;
  // Issue 052: additive, optional. Emits the PRD 14.4 preview lifecycle state
  // (loading/running/stopped/error) at each transition so the preview-panel
  // status indicator can reflect it. Existing proof callers omit it (no-op).
  onLifecycle?: (state: PreviewLifecycleState) => void;
}) {
  const emitLifecycle = (state: PreviewLifecycleState) => {
    try { onLifecycle?.(state); } catch { /* indicator must never break Run/Stop */ }
  };
  let state: "idle" | "starting" | "running" | "stopping" = "idle";
  let active: T | null = null;
  let stopOperation: Promise<unknown> | null = null;
  let startOperation: Promise<T> | null = null;
  let queuedRun: Promise<T> | null = null;

  const beginStart = () => {
    state = "starting";
    setRunDisabled(true);
    setStopDisabled(true);
    setStatus("busy", "Compiling and starting clear-color Game…");
    emitLifecycle("loading");
    // `start()` may throw SYNCHRONOUSLY (e.g. issue 052 contentProvider rejects a
    // non-Web contentProfile before any async work). A synchronous throw would
    // bypass the .then(onRejected) recovery below and leave the controller stuck
    // in "starting" (both buttons disabled, status "Loading"). Convert it to a
    // rejected promise so the same error path resets state and re-enables Run.
    const invokeStart = (): Promise<T> => {
      try {
        return start();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const operation = invokeStart().then(preview => {
      active = preview;
      state = "running";
      setStopDisabled(false);
      setStatus("ready", "Running clear-color Game in a fresh preview.");
      emitLifecycle("running");
      if (observeFailure) {
        void observeFailure(preview).then(() => {
          if (active !== preview || state !== "running") return;
          active = null;
          state = "idle";
          setRunDisabled(false);
          setStopDisabled(true);
          setStatus("error", "Preview failed; editor controls recovered.");
          emitLifecycle("error");
        }, error => {
          if (active !== preview || state !== "running") return;
          active = null;
          state = "idle";
          setRunDisabled(false);
          setStopDisabled(true);
          setStatus("error", error instanceof Error ? error.message : String(error));
          emitLifecycle("error");
          reportError(error);
        });
      }
      return preview;
    }, error => {
      active = null;
      state = "idle";
      setRunDisabled(false);
      setStatus("error", error instanceof Error ? error.message : String(error));
      emitLifecycle("error");
      reportError(error);
      throw error;
    }).finally(() => {
      if (startOperation === operation) startOperation = null;
    });
    startOperation = operation;
    return operation;
  };

  const performStop = (preview: T, reason: "user" | "restart") => {
    state = "stopping";
    setStopDisabled(true);
    setStatus("busy", reason === "restart"
      ? "Stopping the previous preview before restart…"
      : "Stopping Game and releasing preview resources…");
    emitLifecycle("loading");
    return stop(preview, reason).then(result => {
      active = null;
      state = "idle";
      setRunDisabled(false);
      setStatus("ready", "Preview stopped; editor controls recovered.");
      // A restart immediately starts a fresh preview (beginStart emits
      // "loading" next), so only a user-initiated stop is terminal "stopped".
      if (reason !== "restart") emitLifecycle("stopped");
      return result;
    }, error => {
      active = null;
      state = "idle";
      setRunDisabled(false);
      setStatus("error", error instanceof Error ? error.message : String(error));
      emitLifecycle("error");
      reportError(error);
      throw error;
    });
  };

  const publishStop = (operation: Promise<unknown>) => {
    const published = operation.finally(() => {
      if (stopOperation === published) stopOperation = null;
    });
    stopOperation = published;
    return published;
  };

  const beginStop = (preview: T, reason: "user" | "restart") => {
    const operation = publishStop(performStop(preview, reason));
    return operation;
  };

  const queueRunAfterStop = () => {
    if (queuedRun) return queuedRun;
    if (!stopOperation) throw new Error("No preview stop is available for restart.");
    const operation = stopOperation.then(() => beginStart()).finally(() => {
      if (queuedRun === operation) queuedRun = null;
    });
    queuedRun = operation;
    return operation;
  };

  return {
    get state() { return state; },
    run() {
      if (queuedRun) return queuedRun;
      if (stopOperation) return queueRunAfterStop();
      if (startOperation) return startOperation;
      if (state === "running" && active !== null) {
        beginStop(active, "restart");
        return queueRunAfterStop();
      }
      if (state !== "idle") {
        return Promise.reject(new Error(`Cannot run while preview is ${state}.`));
      }
      return beginStart();
    },
    stop(reason: "user" | "restart" = "user") {
      if (stopOperation) return stopOperation;
      if (startOperation) {
        return publishStop(startOperation.then(preview => performStop(preview, reason)));
      }
      if (state !== "running" || active === null) {
        return Promise.reject(new Error("No running preview is available to stop."));
      }
      return beginStop(active, reason);
    },
  };
}

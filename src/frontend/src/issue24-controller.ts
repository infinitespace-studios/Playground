export function createIssue024RunStopController<T>({
  start,
  stop,
  setRunDisabled,
  setStopDisabled,
  setStatus,
  reportError,
  observeFailure,
}: {
  start: () => Promise<T>;
  stop: (preview: T, reason?: "user" | "restart") => Promise<unknown>;
  setRunDisabled: (disabled: boolean) => void;
  setStopDisabled: (disabled: boolean) => void;
  setStatus: (state: "busy" | "ready" | "error", text: string) => void;
  reportError: (error: unknown) => void;
  observeFailure?: (preview: T) => Promise<unknown>;
}) {
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
    const operation = start().then(preview => {
      active = preview;
      state = "running";
      setStopDisabled(false);
      setStatus("ready", "Running clear-color Game in a fresh preview.");
      if (observeFailure) {
        void observeFailure(preview).then(() => {
          if (active !== preview || state !== "running") return;
          active = null;
          state = "idle";
          setRunDisabled(false);
          setStopDisabled(true);
          setStatus("error", "Preview failed; editor controls recovered.");
        }, error => {
          if (active !== preview || state !== "running") return;
          active = null;
          state = "idle";
          setRunDisabled(false);
          setStopDisabled(true);
          setStatus("error", error instanceof Error ? error.message : String(error));
          reportError(error);
        });
      }
      return preview;
    }, error => {
      active = null;
      state = "idle";
      setRunDisabled(false);
      setStatus("error", error instanceof Error ? error.message : String(error));
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
    return stop(preview, reason).then(result => {
      active = null;
      state = "idle";
      setRunDisabled(false);
      setStatus("ready", "Preview stopped; editor controls recovered.");
      return result;
    }, error => {
      active = null;
      state = "idle";
      setRunDisabled(false);
      setStatus("error", error instanceof Error ? error.message : String(error));
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

export function createIssue024RunStopController<T>({
  start,
  stop,
  setRunDisabled,
  setStopDisabled,
  setStatus,
  reportError,
}: {
  start: () => Promise<T>;
  stop: (preview: T) => Promise<unknown>;
  setRunDisabled: (disabled: boolean) => void;
  setStopDisabled: (disabled: boolean) => void;
  setStatus: (state: "busy" | "ready" | "error", text: string) => void;
  reportError: (error: unknown) => void;
}) {
  let state: "idle" | "starting" | "running" | "stopping" = "idle";
  let active: T | null = null;
  let stopOperation: Promise<unknown> | null = null;

  return {
    get state() { return state; },
    async run() {
      if (state !== "idle") throw new Error("A clear-color preview is already active.");
      state = "starting";
      setRunDisabled(true);
      setStopDisabled(true);
      setStatus("busy", "Compiling and starting clear-color Game…");
      try {
        active = await start();
        state = "running";
        setStopDisabled(false);
        setStatus("ready", "Running clear-color Game in retained preview.");
        return active;
      } catch (error) {
        active = null;
        state = "idle";
        setRunDisabled(false);
        setStatus("error", error instanceof Error ? error.message : String(error));
        reportError(error);
        throw error;
      }
    },
    stop() {
      if (stopOperation) return stopOperation;
      if (state !== "running" || active === null) {
        return Promise.reject(new Error("No running preview is available to stop."));
      }
      state = "stopping";
      setStopDisabled(true);
      setStatus("busy", "Stopping Game and releasing preview resources…");
      stopOperation = stop(active).then(result => {
        active = null;
        state = "idle";
        stopOperation = null;
        setRunDisabled(false);
        setStatus("ready", "Preview stopped; editor controls recovered.");
        return result;
      }, error => {
        active = null;
        state = "idle";
        stopOperation = null;
        setRunDisabled(false);
        setStatus("error", error instanceof Error ? error.message : String(error));
        reportError(error);
        throw error;
      });
      return stopOperation;
    },
  };
}

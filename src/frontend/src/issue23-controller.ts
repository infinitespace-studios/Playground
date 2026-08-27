export function createIssue023RunController({
  start,
  setDisabled,
  setStatus,
  reportError,
}: {
  start: () => Promise<unknown>;
  setDisabled: (disabled: boolean) => void;
  setStatus: (state: "busy" | "ready" | "error", text: string) => void;
  reportError: (error: unknown) => void;
}) {
  let state: "idle" | "starting" | "running" = "idle";
  let attempts = 0;
  return {
    get state() { return state; },
    get attempts() { return attempts; },
    async run() {
      if (state !== "idle") throw new Error("A clear-color preview is already active.");
      state = "starting";
      attempts += 1;
      setDisabled(true);
      setStatus("busy", "Compiling and starting clear-color Game…");
      try {
        const result = await start();
        state = "running";
        setStatus("ready", "Running clear-color Game in retained preview.");
        return result;
      } catch (error) {
        state = "idle";
        setDisabled(false);
        setStatus("error", error instanceof Error ? error.message : String(error));
        reportError(error);
        throw error;
      }
    },
  };
}

export async function withForcedPreviewRetirement<T>(
  operation: Promise<T>,
  retire: (reason: unknown) => void,
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    retire(error);
    throw error;
  }
}

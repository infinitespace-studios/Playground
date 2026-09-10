export interface ProofLoadSummary {
  assemblySimpleName: string;
  visibleSequencePointCount: number;
}

interface ProbeRejection {
  probePhase: string;
  expectedCode: string;
  observedCode: string;
}

interface ProofOutcomeInput {
  expectedProbeRejections: ProbeRejection[];
  preMutationObservedCode: string;
  postMutationObservedCode: string;
  taintFailure?: string;
  retryExpectationRemoved?: boolean;
}

export function verifyProofLoadOutcomes(
  proofEnabled: boolean,
  readInput: () => ProofOutcomeInput,
): { expectedProbeRejections: ProbeRejection[]; assertionsPassed: boolean } {
  if (!proofEnabled) {
    return { expectedProbeRejections: [], assertionsPassed: true };
  }

  const input = readInput();
  const expectedPhases = new Map([
    ["preMutationInvalid", "PREVIEW_LOAD_FAILED"],
    ["postMutationSecondLoad", "INVALID_STATE"],
    ["post-mutation-identity-mismatch", "PREVIEW_LOAD_FAILED"],
  ]);
  const assertionsPassed =
    input.expectedProbeRejections.length === expectedPhases.size &&
    input.expectedProbeRejections.every(rejection =>
      rejection.observedCode === rejection.expectedCode &&
      expectedPhases.get(rejection.probePhase) === rejection.expectedCode);
  if (!assertionsPassed) throw new Error("An expected proof rejection did not match.");
  if (input.preMutationObservedCode !== "PREVIEW_LOAD_FAILED" ||
      input.postMutationObservedCode !== "INVALID_STATE" ||
      input.taintFailure !== "TIMEOUT" ||
      input.retryExpectationRemoved !== true) {
    throw new Error("A host-side proof outcome did not match.");
  }
  return { expectedProbeRejections: input.expectedProbeRejections, assertionsPassed };
}

export function createProofLoadController<T>({
  execute,
  setDisabled,
  setStatus,
  reportError,
}: {
  execute: () => Promise<{ value: T; summary: ProofLoadSummary }>;
  setDisabled: (disabled: boolean) => void;
  setStatus: (state: "busy" | "ready" | "error", text: string) => void;
  reportError: (error: unknown) => void;
}) {
  let state: "idle" | "busy" | "loaded" = "idle";
  return {
    get state() { return state; },
    async run(): Promise<T> {
      if (state === "busy") throw new Error("A compile/load operation is already active.");
      if (state === "loaded") throw new Error("Preview is already loaded; reload before loading again.");
      state = "busy";
      setDisabled(true);
      setStatus("busy", "Compiling and transferring…");
      try {
        const result = await execute();
        state = "loaded";
        setStatus(
          "ready",
          `Loaded ${result.summary.assemblySimpleName} · ` +
          `${result.summary.visibleSequencePointCount} sequence points`,
        );
        return result.value;
      } catch (error) {
        state = "idle";
        setStatus("error", error instanceof Error ? error.message : String(error));
        reportError(error);
        throw error;
      } finally {
        setDisabled(state !== "idle");
      }
    },
  };
}

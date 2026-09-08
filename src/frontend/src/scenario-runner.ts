// Durable scenario orchestration infrastructure (Stage 4).
//
// This module is the shared driver that every `proof-*` scenario suite uses to
// run its constituent sub-proofs and to own its own failure reporting. It is
// deliberately NOT named `proof-*` so the artifact checker's structural
// `src/proof-*.ts` PRODUCT-rejection rule stays reserved for the eight scenario
// suites; it is enumerated explicitly in the checker's proof-only inventory.
//
// Before Stage 4, `entry.proof.ts` imported fifteen-plus per-issue `runIssueNN`
// runners and wrapped each in an ad-hoc `void run().catch(emitReport)` block, so
// issue-specific selection and reporting lived in the entry graph. Stage 4 moves
// that responsibility INTO each scenario driver: a scenario entrypoint declares
// its ordered sub-proofs and the report command each one emits on failure, and
// this runner executes them. `entry.proof.ts` now only dispatches the eight
// scenario entrypoints (plus the retained top-level-shell inline proofs and the
// issue038 force-stop harness).
//
// Existing Rust env gates (`issueNN_is_proof_enabled`) and report command names
// (`issueNN_emit_report`) are preserved verbatim for Stage-6 compatibility; each
// sub-proof keeps its own internal env gate so only the requested proof does
// work. The renames of those commands are Stage 6, not Stage 4.

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const invokeBridge = (): TauriInvoke | undefined => window.__TAURI_INTERNALS__?.invoke;

/** Best-effort snapshot of the shared runtime diagnostics, attached to failure
 *  reports as debugging aid. Never throws. */
function diagnosticsSnapshot(): unknown {
  try {
    return (window as unknown as { __MONOGAME_DIAGNOSTICS__?: unknown }).__MONOGAME_DIAGNOSTICS__ ?? null;
  } catch {
    return null;
  }
}

/** One sub-proof within a durable scenario. `run` performs the sub-proof (which
 *  self-gates on its own `issueNN_is_proof_enabled` env check and, on success,
 *  emits its own `issueNN_emit_report`). `reportCommand` is the Tauri command
 *  used to emit a structured FAILURE report if `run` throws. `buildFailure`
 *  optionally shapes the failure payload for sub-proofs whose historical report
 *  schema differs (e.g. issue021's nested failure object, issue029's partial
 *  evidence channel). */
export interface SubProof {
  readonly label: string;
  readonly reportCommand: string;
  run(): Promise<void>;
  buildFailure?(error: unknown): Record<string, unknown>;
}

function defaultFailureReport(error: unknown): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    failure: error instanceof Error ? error.message : String(error),
    diagnostics: diagnosticsSnapshot(),
  };
}

/** Run one sub-proof, emitting its failure report on throw. Isolated so one
 *  failing sub-proof never prevents the rest of the scenario from running. */
async function runSubProof(subProof: SubProof): Promise<void> {
  try {
    await subProof.run();
  } catch (error: unknown) {
    const report = subProof.buildFailure
      ? subProof.buildFailure(error)
      : defaultFailureReport(error);
    try {
      await invokeBridge()?.(subProof.reportCommand, { report: JSON.stringify(report) });
    } catch {
      /* the report channel itself is unavailable (non-packaged run) */
    }
    console.error(`Scenario sub-proof "${subProof.label}" failed`, error);
  }
}

/**
 * Execute an ordered list of sub-proofs that make up one durable scenario.
 * Sub-proofs run sequentially; a failure in one is reported and does not abort
 * the others (only one is typically env-enabled per packaged run, so ordering is
 * a no-op in normal proof runs but keeps multi-enabled dev runs deterministic).
 */
export async function runScenario(subProofs: readonly SubProof[]): Promise<void> {
  for (const subProof of subProofs) {
    await runSubProof(subProof);
  }
}

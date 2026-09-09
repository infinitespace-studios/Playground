// Compatibility fa\u00e7ade — the run/stop lifecycle controller moved to
// `lifecycle-controller.ts` (Stage-2 production/proof cleanup). This file keeps
// the historical `createIssue024RunStopController` / `Issue052PreviewLifecycle`
// names so proof modules (issue24/25/29/30/041) and the protocol test continue
// to resolve unchanged.
//
// PRODUCT NEVER IMPORTS THIS FILE: app.ts / run-stop.ts import the domain module
// (`lifecycle-controller.ts`) directly, so this fa\u00e7ade stays out of the product
// Rollup module graph.
export {
  createRunStopController as createIssue024RunStopController,
  createRunStopController,
} from "./lifecycle-controller.ts";
export type {
  PreviewLifecycleState,
} from "./lifecycle-controller.ts";
import type { PreviewLifecycleState } from "./lifecycle-controller.ts";
/**
 * @deprecated historical issue-numbered name; use PreviewLifecycleState. Kept
 * ONLY in this issue-numbered compatibility façade so the product domain module
 * (`lifecycle-controller.ts`) carries no issue-numbered identifier.
 */
export type Issue052PreviewLifecycle = PreviewLifecycleState;

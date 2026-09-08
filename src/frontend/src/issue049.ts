// Compatibility façade — the Output panel moved to `output-panel.ts` (Stage-3
// production/proof cleanup). This file keeps the historical
// `getIssue049OutputPanel` / `formatOutputLine` names so the proof modules
// (issue27/issue28) continue to render into the same real Output panel.
//
// PRODUCT NEVER IMPORTS THIS FILE: app.ts imports the domain module
// (`output-panel.ts`) directly, so this façade stays out of the product Rollup
// module graph.
export {
  getOutputPanel as getIssue049OutputPanel,
  formatOutputLine,
} from "./output-panel.ts";
export type { OutputPanel as Issue049OutputPanel } from "./output-panel.ts";

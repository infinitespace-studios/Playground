// Compatibility façade — the folder project manager and project identity moved
// to `project-manager.ts` (Stage-3 production/proof cleanup). This file keeps
// the historical `installIssue051ProjectManager` / `__resetIssue051State` names
// so the existing project-identity/issue051 tests continue to resolve unchanged.
//
// PRODUCT NEVER IMPORTS THIS FILE: app.ts imports the domain module
// (`project-manager.ts`) directly, so this façade stays out of the product
// Rollup module graph.
export {
  installProjectManager as installIssue051ProjectManager,
  __resetProjectManagerState as __resetIssue051State,
  folderProjectIdentity,
  parseManifest,
  serializeManifest,
  ISSUE051_SCHEMA_VERSION,
} from "./project-manager.ts";
export type {
  Issue051Manifest,
  Issue051Hooks,
  Issue051Api,
} from "./project-manager.ts";

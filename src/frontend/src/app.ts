import { installIssue024RunStopControl } from "./issue24";
import { gateFirstRun } from "./issue37";
import { installIssue047Editor } from "./issue047";

// Workbench application controller wiring
// Run/Stop buttons are wired into the workbench toolbar (see index.html)
// This module is imported by main.ts at the bottom; DOM is already parsed
// by the time this module-level code executes.

// Issue 047: mount the real Monaco editor with the default HelloWorld example
// before wiring Run, so Run can read the live editor buffer.
const editor = installIssue047Editor();

installIssue024RunStopControl(() => {
  // Gate Run behind first-run warning acknowledgement.
  // In non-Tauri environments (dev mode), allow Run without gating.
  if (!(window as any).__TAURI_INTERNALS__?.invoke) return Promise.resolve(true);
  return gateFirstRun();
}, editor.getValue);

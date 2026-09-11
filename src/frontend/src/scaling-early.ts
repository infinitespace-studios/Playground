// Early application-scale application (issue 062).
//
// This module is imported by both `entry.product.ts` and `entry.proof.ts`
// BEFORE `./app` (which mounts Monaco and renders the workbench). Because ES
// module imports execute in order and synchronously, applying the persisted
// application scale here guarantees the document root carries `data-app-scale`
// before the workbench first paints, so the interface never renders at the
// wrong size and then snaps to the saved scale (no flash-of-wrong-size).
//
// Malformed/invalid persisted data is handled inside applyPersistedAppScaleEarly
// (it falls back to the safe 100% default and never throws), so a corrupt store
// cannot leave the UI at an unreadable size or block startup.

import { applyPersistedAppScaleEarly } from "./scaling-controller";

applyPersistedAppScaleEarly();

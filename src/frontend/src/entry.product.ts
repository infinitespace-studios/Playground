// Product frontend entry (Stage 1 of the production/proof split).
//
// This is the compile-time PRODUCT entry point selected by the default Vite
// build (see vite.config.ts `MONOGAME_FRONTEND_PROFILE`). It must initialize
// ONLY the shipping Workbench product and its theme. It must NOT import the
// auto-proof entry graph (the former `main.ts`, now `entry.proof.ts`), so that
// the giant per-issue proof instrumentation and its environment markers
// (MONOGAME_ISSUE0xx_PROOF) are absent from the product dist.
//
// Stage-2 note: `./app` still transitively imports a few mixed modules
// (issue21/issue24/issue37) that carry their own proof markers. Product uses
// only their controller/gate exports, so their `runIssueXXXAutoProof` marker
// strings are tree-shaken out of the emitted product bundle. Those modules are
// tracked as remaining coupling to extract in a later stage; see
// `scripts/check-profile-artifacts.mjs` (MIXED_TRANSITIONAL_MODULES). The
// checker allows those modules in the product module graph but HARD-FAILS if
// any proof marker string is emitted into a product artifact.

import "./style.css";

// Workbench application controller wiring (editor, panels, run/stop, projects).
import "./app";

// Issue 046: persistent theme + accessibility.
import { initTheme } from "./issue46";

initTheme();

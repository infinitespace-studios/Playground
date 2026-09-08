// Product frontend entry (Stage 1 of the production/proof split).
//
// This is the compile-time PRODUCT entry point selected by the default Vite
// build (see vite.config.ts `MONOGAME_FRONTEND_PROFILE`). It must initialize
// ONLY the shipping Workbench product and its theme. It must NOT import the
// auto-proof entry graph (the former `main.ts`, now `entry.proof.ts`), so that
// the giant per-issue proof instrumentation and its environment markers
// (MONOGAME_ISSUE0xx_PROOF) are absent from the product dist.
//
// Stage-2 note: the real production compiler / embedded-preview / run-stop /
// first-run code was extracted out of the former mixed modules
// (issue21/issue24/issue37) into production-neutral domain modules
// (compiler-context, live-preview, run-stop, lifecycle-controller,
// first-run-warning). `./app` imports ONLY those domain modules, so
// issue21/issue24/issue37 — and their `runIssueXXXAutoProof` marker strings —
// are absent from the product Rollup module graph entirely (proven by
// `scripts/check-profile-artifacts.mjs`, which now hard-fails if any of those
// three modules appears in the product graph).

import "./style.css";

// Workbench application controller wiring (editor, panels, run/stop, projects).
import "./app";

// Issue 046: persistent theme + accessibility.
import { initTheme } from "./issue46";

initTheme();

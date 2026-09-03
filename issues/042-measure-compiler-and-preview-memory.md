# Measure compiler and 20-cycle preview memory

**Type:** AFK
**Status:** Done
**Blocked by:** [025-restart-preview-with-clean-static-state.md](025-restart-preview-with-clean-static-state.md), [038-force-stop-infinite-update-in-isolation.md](038-force-stop-infinite-update-in-isolation.md)
**PRD references:** 17, 20.2
**User stories:** US3, US8
**Triage:** needs-triage

## Context

PRD section 17 ("Memory and lifecycle") requires Phase 1 to record cold, running, and peak process RSS, requires compiler memory after 100 consecutive compilations to remain within 10% of its stabilized baseline after garbage collection, requires twenty consecutive Run/Stop cycles to not increase stabilized process RSS by more than 20%, and requires a stopped preview to have no continuing audio, animation frames, WebGL context, message ports, or retained user static state. Section 20.2 requires proving Stop and Run work at least twenty consecutive times within these limits. This issue builds on the clean-restart mechanism (issue 25) and forced-stop mechanism (issue 38) to run the actual twenty-cycle and hundred-compilation measurement and produce the report.

## What to build

Run 100 consecutive compilations of the issue 41 benchmark fixture through the persistent compiler context (issue 16), measuring process RSS after each batch of 10 (forcing GC before each measurement if the runtime exposes a GC-trigger API), and separately run twenty consecutive Run/Stop cycles of the working `Game1` test class through the full preview pipeline (issues 20-25), measuring stabilized process RSS after each cycle, then write both results into `docs/performance-baseline.md` (extending issue 41's report) with explicit PASS/FAIL against the PRD 17 thresholds.

## Scope

### In scope

- A script/harness running 100 consecutive `CompilationService.Compile` calls against the issue 41 fixture and recording RSS at 10-compilation intervals
- A script/harness running 20 consecutive Run→Stop cycles of a representative test game through the full preview pipeline, recording stabilized RSS after each cycle
- Computing the percentage RSS growth from the earliest stabilized baseline to the final measurement for both scenarios
- Explicitly checking for continued audio/animation/WebGL context/message ports after each Stop in the 20-cycle test (reusing the cleanup verification approach from issue 24)

### Out of scope

- Package size measurement (issue 43)
- Timing measurement (issue 41, already covered)
- Any memory-optimization work in response to a failing measurement (Phase 5 hardening, out of scope here — record as a known gap for issue 44 if it fails)

## Implementation guidance

1. For compiler memory: since this runs inside a browser-hosted WebAssembly runtime, process RSS must be measured at the OS process level for the shell hosting the compiler context (e.g. via `ps -o rss= -p <pid>` on macOS/Linux for the relevant renderer/webview process, or Tauri/Electron's own process-memory reporting API if available) rather than from within the WASM sandbox itself. Identify the correct OS process to measure (the compiler context's dedicated worker/WebView process, per issue 16's architecture) before starting.
2. Run 100 consecutive compiles of the issue 41 fixture through the persistent compiler context; after every 10th compile, request garbage collection if an API is exposed (e.g. a `[JSExport]` wrapping `GC.Collect(); GC.WaitForPendingFinalizers();`) and record the OS-level RSS of the compiler's process.
3. Compute the percentage difference between the RSS recorded after compile #20 (an early "stabilized baseline" once initial JIT/allocation warm-up has settled) and the RSS recorded after compile #100; confirm this is within 10%.
4. For preview memory: run 20 consecutive Run→Stop cycles of a representative test `Game1` (reuse the one from issue 25) through the full pipeline, recording OS-level RSS of the preview's process/webview after each Stop completes (allow a brief settle delay, e.g. 500 ms, before measuring, to let cleanup finish).
5. Compute the percentage difference between the RSS recorded after cycle 1 (or an early stabilized point, e.g. cycle 3, to exclude initial warm-up) and the RSS recorded after cycle 20; confirm this is within 20%.
6. After the final (20th) Stop, explicitly re-verify no continuing audio (`AudioContext.state` is not `"running"` for any leftover context), no continuing `requestAnimationFrame`/Emscripten loop (no further frame-related console/log activity), no lingering WebGL context (attempting to get a new context on a fresh canvas succeeds without a "too many contexts" warning), and no lingering message ports.
7. Write both memory reports into `docs/performance-baseline.md` with raw per-cycle/per-batch RSS values, computed percentage growth, and explicit PASS/FAIL against the 10%/20% thresholds.

## Acceptance criteria

- [ ] 100 consecutive compilations are run with RSS recorded at 10-compilation intervals, and the growth from an early stabilized baseline to compile #100 is within 10% (or explicitly recorded as FAIL with the actual measured percentage if it exceeds this)
- [ ] 20 consecutive Run/Stop cycles are run with RSS recorded after each cycle, and the growth from an early stabilized baseline to cycle 20 is within 20% (or explicitly recorded as FAIL with the actual measured percentage if it exceeds this)
- [ ] After the final Stop, no continuing audio, animation loop, WebGL context, or message ports are found
- [ ] `docs/performance-baseline.md` records all raw measurements, computed growth percentages, and explicit PASS/FAIL for both scenarios

## Verification

Run both measurement harnesses (100-compile and 20-cycle) end to end and inspect `docs/performance-baseline.md` for the raw RSS series and computed growth percentages for each. The verifier must independently recompute the percentage growth from the raw values reported for at least one of the two scenarios to confirm the arithmetic is correct, and must personally re-run at least 5 of the 20 Run/Stop cycles to spot-check that RSS behaves consistently with the full reported series, plus confirm no leftover audio/animation/WebGL context after a final Stop.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Ready for independent verification
- **Verifier:** Pending (independent per-PRD verifier required)
- **Date:** Pending

### Implementation summary

1. **Rust side (`src/desktop/src-tauri/src/lib.rs`):**
   - Added `issue041_rss_bytes` Tauri command that reads RSS via `ps -o rss= -p <pid>` on macOS
   - Added `memory-baseline` mode to `issue041_mode_value()`
   - Increased `issue041_preview_cycle_count` max from 10 to 20
   - All 7 benchmark commands check the `MONOGAME_ISSUE041_BENCHMARK` gate
   - Updated tests for new cycle count range (2..=20) and new mode

2. **Frontend (`src/frontend/src/issue041.ts`):**
   - Added `runMemoryBaselineBenchmark()` function
   - Runs 100 compilations (1 cold + 99 warm) with RSS samples at 10-compile intervals
   - Runs 20 preview cycles with RSS after each Stop
   - Verifies cleanup after final Stop: audio context states, animation frames, WebGL contexts, message ports

3. **Driver (`scripts/measure-performance.mjs`):**
   - Added `--memory-baseline` command-line option
   - Added `--warm-compiles-baseline` (default: 99) and `--preview-cycles-baseline` (default: 20)
   - Launches memory-baseline mode with `MONOGAME_ISSUE041_MODE=memory-baseline`
   - 600s timeout for the memory-baseline run
   - Collects RSS samples and cleanup verification from the report

4. **Report (`scripts/performance-report.mjs`):**
   - Added `memoryBaseline` section to the JSON report
   - Computes RSS growth percentages for compiler (10% threshold) and preview (20% threshold)
   - Renders markdown with compiler RSS stability, preview RSS stability, and cleanup verification tables

5. **Permissions & build:**
   - Added `issue041_rss_bytes` to `build.rs`, `main.toml`, `issue34.ts`, and autogenerated permission file
   - Updated command count from 90 to 91 in build assertions

### To verify

Run the memory-baseline benchmark:
```bash
caffeinate -di node scripts/measure-performance.mjs \
  --memory-baseline \
  --warm-compiles-baseline 99 \
  --preview-cycles-baseline 20 \
  --runs 1
```

Then inspect `docs/performance-baseline.md` for:
1. The "Memory baseline" section
2. Compiler RSS growth percentage (threshold: ≤10%)
3. Preview RSS growth percentage (threshold: ≤20%)
4. Cleanup verification results (all checks passed: yes/no)
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: measure compiler and 20-cycle preview memory stability`

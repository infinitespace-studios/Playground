# Measure startup/compile/preview/Stop timings

**Type:** AFK
**Status:** Done
**Blocked by:** [025-restart-preview-with-clean-static-state.md](025-restart-preview-with-clean-static-state.md), [038-force-stop-infinite-update-in-isolation.md](038-force-stop-infinite-update-in-isolation.md)
**PRD references:** 17, 20.2
**User stories:** US7, US8
**Triage:** needs-triage

## Context

PRD section 17 requires a reference machine/VM to be defined (CPU, memory, GPU/WebGL implementation, Windows version, WebView2 version, storage type), and requires versioned benchmark projects reporting cold and warm p50/p95 values over at least ten runs for: application shell visible within 3 seconds, warm compilation p95 under 2 seconds and cold compiler initialization p95 under 5 seconds for a project of up to five source files, preview visibly active within 3 seconds after successful compilation at p95, and Stop returning control to the editor within 2 seconds. Section 20.2 requires the feasibility spike to document these measurements. This issue builds the actual benchmark harness and produces the first real measurement report, using the working pipeline proven in issues 16-38.

## What to build

Define and record the reference measurement machine's specifications in `docs/performance-baseline.md`, build a repeatable benchmark script that runs at least ten cold and ten warm cycles of (a) application shell startup, (b) compilation of a five-file benchmark project, (c) preview startup after compilation, and (d) Stop latency, computes p50/p95 for each, and writes the results into `docs/performance-baseline.md`, comparing them against the PRD 17 thresholds and flagging any that fail.

## Scope

### In scope

- Recording the actual measurement machine's specs (CPU, RAM, GPU/WebGL implementation, OS version, WebView version, storage type) in `docs/performance-baseline.md`
- A five-source-file benchmark project under `tests/integration/fixtures/perf-benchmark/` (create this path) representative of a realistic small project
- A benchmark script (`scripts/measure-performance.sh`/`.ps1` or a small Node/TypeScript test driver, whichever fits the existing frontend tooling) automating at least ten cold and ten warm cycles for each of the four measured phases
- Computing and recording p50/p95 for each phase, explicitly comparing each against its PRD 17 threshold and marking PASS/FAIL

### Out of scope

- Memory measurement (issue 42, a related but separate benchmark)
- Package size measurement (issue 43)
- Any performance optimization work in response to a failing measurement (that is Phase 5 hardening per PRD section 24, out of scope for this feasibility-phase measurement issue — if a threshold fails, record it as a known gap for issue 44's gate review, do not attempt to fix it here)

## Implementation guidance

1. Record the actual machine used for measurement in `docs/performance-baseline.md`'s "Reference machine" section: run `system_profiler SPHardwareDataType` (macOS) or equivalent, note CPU model, RAM size, GPU, OS version, and the WebView/browser engine version used by the selected shell (from issue 14's ADR), and storage type (SSD/NVMe/HDD).
2. Build the five-file benchmark fixture at `tests/integration/fixtures/perf-benchmark/`: a `Game1.cs` plus four supporting classes with a modest amount of realistic code (loops, a few methods each, some MonoGame API usage) sized similarly to a small real project.
3. Write a benchmark driver that: (a) for "cold" application-shell timing, launches the packaged app binary fresh each time and measures wall-clock time from process start to the shell's UI becoming visible/interactive (e.g. instrument a JS-side `performance.now()` timestamp fired when the app's root UI mounts, logged to a file the driver can read after each run); (b) for compilation timing, calls `CompilationService.Compile` with the five-file fixture and measures elapsed time, once cold (fresh compiler-context boot) and nine more times warm (same persistent compiler context, per issue 16); (c) for preview-startup timing, measures from `preview.load` message sent to the first rendered frame (or a `preview.started` event) being observed; (d) for Stop timing, reuses the exact instrumentation built in issue 24.
4. Run each measured phase at least ten times, compute p50 and p95 (sort the ten-plus values and take the median and 95th-percentile index), and write all raw values plus computed percentiles into `docs/performance-baseline.md`.
5. Compare each computed p95 against its PRD 17 threshold (shell visible ≤3s; warm compile p95 <2s; cold compiler init p95 <5s; preview visible p95 ≤3s after compile; Stop ≤2s) and mark each PASS/FAIL explicitly in the report.

## Acceptance criteria

- [ ] `docs/performance-baseline.md` records the exact reference machine specifications used for measurement
- [ ] At least ten cold and ten warm timing samples are recorded for each of: application shell startup, compilation, preview startup, and Stop
- [ ] p50 and p95 are computed and reported for each measured phase
- [ ] Each p95 result is explicitly compared against its PRD section 17 threshold and marked PASS or FAIL
- [ ] The five-file benchmark fixture used for compilation timing is saved under `tests/integration/fixtures/perf-benchmark/` for reuse by future measurement runs

## Verification

Run the benchmark driver end-to-end and inspect `docs/performance-baseline.md` for the recorded reference machine specs, the raw timing samples (at least ten per phase), and the computed p50/p95 with explicit PASS/FAIL markers against the PRD 17 thresholds. The verifier must independently recompute p50/p95 from at least one phase's raw sample list to confirm the reported percentiles are calculated correctly, and must re-run the benchmark driver at least once themselves to confirm it is reproducible and produces comparable results.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Ready
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: measure and record startup/compile/preview/Stop timings`

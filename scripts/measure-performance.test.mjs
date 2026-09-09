/**
 * Issue 041: rules the benchmark driver applies when it turns raw launches into
 * samples. These are the rules that decide what is kept, what is censored, what
 * is impossible and when another attempt is required, so they are pinned here
 * rather than only being exercised by a live measurement run.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PHASE_TARGETS, collectSamples, missingTargets } from "./measure-performance.mjs";
import { REQUIRED_SAMPLES_PER_PHASE, aggregate } from "./performance-report.mjs";

const OPTIONS = { previewCycles: 2, warmCompiles: 3, runs: 10 };

const cycle = (index, kind, overrides = {}) => ({
  cycle: index,
  kind,
  compileWithinRunMs: 160,
  previewStartedMs: 12_000,
  previewFirstFrameMs: 12_200,
  firstFrame: {
    censored: false,
    deadlineMs: 20_000,
    pollIntervalMs: 5,
    observationIntervalMs: 60,
    queryCount: 1,
    queryFailureCount: 0,
    lastQueryError: null,
    lowerBoundMs: 11_900,
    estimateMs: 12_050,
    censorReason: null,
    evidence: null,
    ...(overrides.firstFrame ?? {}),
  },
  firstFrameObservationIntervalMs: 60,
  frameRate: { framesDrawn: 15, elapsedMs: 250, framesPerSecond: 60 },
  stopControlReturnMs: 270,
  stopInstrumentedMs: 268,
  stopMeaningful: true,
  previewRenderedBeforeStop: true,
  frameCountAtFirstObservation: 12,
  frameCountBeforeStop: 27,
  frameCountAfterStop: 27,
  keptDrawing: true,
  runCount: 1,
  staticConstructorCount: 1,
  disposeCount: 1,
  callbackAfterDisposedCount: 0,
  controllerIdleAfterStop: true,
  previewWindowRemoved: true,
  breakdown: {
    frameCreateInvokeMs: 40,
    documentLoadMs: 120,
    previewRuntimeReadyMs: 60,
    loadAndStartMs: 260,
  },
  bootstrapDetail: {
    transport: "embedded-in-page",
    generation: "gen-test",
    previewId: "preview-test",
    readyPromiseResolved: true,
    readyPromiseResolvedAtMs: 12_000,
  },
  marks: {},
  ...overrides,
});

const censoredCycle = (index, kind) => cycle(index, kind, {
  previewFirstFrameMs: 20_310.5,
  previewRenderedBeforeStop: false,
  frameCountAtFirstObservation: 0,
  frameCountBeforeStop: 0,
  keptDrawing: false,
  firstFrame: {
    censored: true,
    censorReason: "the running Game reported no drawn frame within the 20000 ms bound",
    evidence: "bridge answered 3901 queries; FrameCount stayed 0",
    lowerBoundMs: 11_950,
    estimateMs: null,
  },
});

const fullLaunch = (attempt, overrides = {}) => ({
  attempt,
  mode: "full",
  shellLaunchKind: "cold",
  pid: 1_000 + attempt,
  logFile: `artifacts/issue041/attempt-${attempt}-full-cold.log`,
  outcome: "ok",
  exitCode: 0,
  signal: null,
  timedOut: false,
  wallClockMs: 30_000,
  shellReadyWallClockMs: 350,
  shellReady: { processStartToShellReadyMs: 330 },
  lastCheckpoint: null,
  report: {
    compilerInit: { kind: "cold", elapsedMs: 350, compilerRuntimeStarts: 1 },
    compileSamples: [
      { index: 0, kind: "cold", elapsedMs: 900, assemblySha256: "aa" },
      { index: 1, kind: "warm", elapsedMs: 200, assemblySha256: "aa" },
      { index: 2, kind: "warm", elapsedMs: 190, assemblySha256: "aa" },
      { index: 3, kind: "warm", elapsedMs: 185, assemblySha256: "aa" },
    ],
    previewCycles: [cycle(0, "cold"), cycle(1, "warm")],
    phaseFailures: [],
    phaseReached: "complete",
    failure: null,
  },
  ...overrides,
});

const shellLaunch = (attempt, overrides = {}) => ({
  attempt,
  mode: "shell-only",
  shellLaunchKind: "warm",
  pid: 2_000 + attempt,
  logFile: `artifacts/issue041/attempt-${attempt}-shell-only-warm.log`,
  outcome: "ok",
  exitCode: 0,
  signal: null,
  timedOut: false,
  wallClockMs: 320,
  shellReadyWallClockMs: 300,
  shellReady: { processStartToShellReadyMs: 290 },
  lastCheckpoint: null,
  report: { compileSamples: [], previewCycles: [], phaseFailures: [] },
  ...overrides,
});

test("a healthy attempt contributes every phase exactly once per cycle", () => {
  const collected = collectSamples([fullLaunch(1), shellLaunch(1)], OPTIONS);
  assert.equal(collected.samples["shell-startup"].cold.length, 1);
  assert.equal(collected.samples["shell-startup"].warm.length, 1);
  assert.equal(collected.samples.compilation.cold.length, 1);
  assert.equal(collected.samples.compilation.cold[0].valueMs, 1_250, "boot + first compile");
  assert.equal(collected.samples.compilation.warm.length, 3);
  assert.equal(collected.samples["preview-start"].cold.length, 1);
  assert.equal(collected.samples.stop.warm.length, 1);
  assert.deepEqual(collected.exclusions, []);
  assert.deepEqual(collected.censored, []);
  for (const list of Object.values(collected.samples)) {
    for (const kind of Object.values(list)) {
      for (const entry of kind) {
        assert.equal(entry.provenance.attempt, 1);
        assert.match(entry.provenance.log, /attempt-1-/);
      }
    }
  }
});

test("a launch that fails in its second preview cycle keeps everything it completed", () => {
  const broken = fullLaunch(2, {
    outcome: "harness-failure",
    lastCheckpoint: { name: "preview-cycle-begin", cycle: 1 },
    report: {
      compilerInit: { kind: "cold", elapsedMs: 340, compilerRuntimeStarts: 1 },
      compileSamples: [
        { index: 0, kind: "cold", elapsedMs: 880, assemblySha256: "aa" },
        { index: 1, kind: "warm", elapsedMs: 205, assemblySha256: "aa" },
      ],
      previewCycles: [cycle(0, "cold")],
      phaseFailures: [{ phase: "preview-cycle-1", detail: "preview bridge closed" }],
      phaseReached: "preview-cycle-0-complete",
      failure: "preview-cycle-1: preview bridge closed",
    },
  });
  const collected = collectSamples([broken, shellLaunch(2)], OPTIONS);

  assert.equal(collected.samples["shell-startup"].cold.length, 1, "shell sample survives");
  assert.equal(collected.samples["shell-startup"].warm.length, 1);
  assert.equal(collected.samples.compilation.cold.length, 1, "cold compile survives");
  assert.equal(collected.samples.compilation.warm.length, 1, "warm compile survives");
  assert.equal(collected.samples["preview-start"].cold.length, 1, "cycle 0 survives");
  assert.equal(collected.samples.stop.cold.length, 1, "cycle 0 Stop survives");
  assert.equal(collected.samples["preview-start"].warm.length, 0);
  assert.equal(collected.samples.stop.warm.length, 0);

  const reasons = collected.exclusions.map(entry => `${entry.phaseId}/${entry.kind}`);
  assert.deepEqual(reasons.sort(), ["preview-start/warm", "stop/warm"]);
  for (const entry of collected.exclusions) {
    assert.match(entry.reason, /preview cycle 1 did not complete: preview bridge closed/);
    assert.equal(entry.attempt, 2);
  }
});

test("a preview that never draws becomes a counted censored sample, not a lost launch", () => {
  const slow = fullLaunch(3, {
    report: {
      ...fullLaunch(3).report,
      previewCycles: [censoredCycle(0, "cold"), cycle(1, "warm")],
    },
  });
  const collected = collectSamples([slow, shellLaunch(3)], OPTIONS);

  const previewCold = collected.samples["preview-start"].cold;
  assert.equal(previewCold.length, 1);
  assert.equal(previewCold[0].censored, true);
  assert.ok(previewCold[0].valueMs >= 20_000, "the censored value is at least the bound");
  assert.match(previewCold[0].censorReason, /no drawn frame within the 20000 ms bound/);
  assert.match(previewCold[0].evidence, /FrameCount stayed 0/);

  assert.equal(collected.samples.stop.cold.length, 1, "the Stop of that cycle is still measured");
  assert.equal(collected.samples.stop.cold[0].censored, false);
  assert.match(collected.samples.stop.cold[0].note, /had not drawn a frame/);
  assert.equal(collected.samples.compilation.warm.length, 3, "compilation is untouched");
  assert.deepEqual(collected.exclusions, [], "nothing is missing: the sample exists, censored");
  assert.equal(collected.censored.length, 1);
  assert.equal(collected.censored[0].phaseId, "preview-start");

  const contributions = collected.contributionsByLaunch.get("3:full");
  assert.equal(contributions.contributions["preview-start/cold"], 1);
  assert.deepEqual(contributions.censoredContributions, ["preview-start/cold >= 20311 ms"]);

  // Both Stop subsets are published, so no Stop sample is hidden.
  assert.equal(collected.supplementaryRaw.stopAfterRenderingPreviewMs.length, 1);
  assert.equal(collected.supplementaryRaw.stopAfterNonRenderingPreviewMs.length, 1);
});

test("a launch that dies before reporting anything excludes each sample with a reason", () => {
  const dead = fullLaunch(4, {
    outcome: "timeout",
    timedOut: true,
    exitCode: null,
    signal: "SIGKILL",
    shellReadyWallClockMs: null,
    shellReady: null,
    lastCheckpoint: { name: "shell-ready" },
    report: null,
  });
  const collected = collectSamples([dead, shellLaunch(4)], OPTIONS);
  const excluded = collected.exclusions.map(entry => `${entry.phaseId}/${entry.kind}`).sort();
  assert.deepEqual(excluded, [
    "compilation/cold", "compilation/warm", "preview-start/cold", "preview-start/warm",
    "shell-startup/cold", "stop/cold", "stop/warm",
  ]);
  assert.ok(collected.exclusions.every(entry => entry.reason.length > 0));
  assert.match(
    collected.exclusions.find(entry => entry.phaseId === "shell-startup").reason,
    /never reported ISSUE041_SHELL_READY/);
  assert.equal(collected.samples["shell-startup"].warm.length, 1,
    "the paired warm launch still contributed");
});

test("missingTargets drives further attempts and clears once every target is met", () => {
  const runs = [];
  for (let attempt = 1; attempt <= 9; attempt++) {
    runs.push(fullLaunch(attempt), shellLaunch(attempt));
  }
  const nine = collectSamples(runs, OPTIONS);
  const missing = missingTargets(nine.samples);
  assert.deepEqual(
    missing.map(target => `${target.phaseId}/${target.kind}`).sort(),
    ["preview-start/cold", "preview-start/warm", "shell-startup/cold", "shell-startup/warm",
      "stop/cold", "stop/warm", "compilation/cold"].sort());
  assert.ok(missing.every(target => target.have === 9 && target.required === 10));

  runs.push(fullLaunch(10), shellLaunch(10));
  const ten = collectSamples(runs, OPTIONS);
  assert.deepEqual(missingTargets(ten.samples), []);
  assert.deepEqual(aggregate(ten.samples).violations, []);
  assert.equal(PHASE_TARGETS.length, 8);
  assert.equal(REQUIRED_SAMPLES_PER_PHASE, 10);
});

test("censored samples satisfy the sample requirement instead of forcing endless attempts", () => {
  const runs = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    const launch = fullLaunch(attempt);
    if (attempt % 2 === 0) {
      launch.report = {
        ...launch.report,
        previewCycles: [censoredCycle(0, "cold"), cycle(1, "warm")],
      };
    }
    runs.push(launch, shellLaunch(attempt));
  }
  const collected = collectSamples(runs, OPTIONS);
  assert.deepEqual(missingTargets(collected.samples), []);
  assert.equal(collected.censored.length, 5);
  const aggregated = aggregate(collected.samples);
  const preview = aggregated.phases.find(phase => phase.id === "preview-start");
  assert.equal(preview.kinds.cold.count, 10);
  assert.equal(preview.kinds.cold.censoredCount, 5);
  assert.equal(preview.kinds.cold.p95Censored, true);
  assert.equal(preview.kinds.cold.threshold.verdict, "FAIL");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASES,
  REPORT_SCHEMA_VERSION,
  aggregate,
  evaluateThreshold,
  nearestRankPercentile,
  normalizeSample,
  percentileIsCensored,
  phaseById,
  renderMarkdown,
  summarize,
  summarizeSamples,
  validateReport,
} from "./performance-report.mjs";

const range = (count, produce) => Array.from({ length: count }, (_, index) => produce(index));

/** A sample as the driver records it: a value plus where it came from. */
const sample = (valueMs, attempt = 1, extra = {}) => ({
  valueMs,
  censored: false,
  provenance: { attempt, launch: "full/cold", source: "unit test" },
  ...extra,
});

const censoredSample = (valueMs, attempt = 1, reason = "no first frame within 20000 ms") =>
  sample(valueMs, attempt, { censored: true, censorReason: reason });

test("nearest-rank percentile returns an observed sample at ceil(p/100 * n)", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // p50 -> rank ceil(0.5 * 10) = 5 -> fifth smallest = 5 (lower median, no interpolation)
  assert.equal(nearestRankPercentile(values, 50), 5);
  // p95 -> rank ceil(0.95 * 10) = 10 -> largest sample
  assert.equal(nearestRankPercentile(values, 95), 10);
  assert.equal(nearestRankPercentile(values, 100), 10);
  assert.equal(nearestRankPercentile(values, 1), 1);
});

test("nearest-rank percentile is order independent and handles duplicates", () => {
  const ascending = [10, 20, 20, 30, 40, 50, 60, 70, 80, 90];
  const shuffled = [50, 20, 90, 30, 10, 80, 20, 70, 40, 60];
  assert.equal(nearestRankPercentile(shuffled, 50), nearestRankPercentile(ascending, 50));
  assert.equal(nearestRankPercentile(shuffled, 95), nearestRankPercentile(ascending, 95));
  assert.equal(nearestRankPercentile(ascending, 50), 40);
  assert.equal(nearestRankPercentile(ascending, 95), 90);
});

test("nearest-rank percentile handles single samples and odd sizes", () => {
  assert.equal(nearestRankPercentile([7], 50), 7);
  assert.equal(nearestRankPercentile([7], 95), 7);
  // n = 11 -> p50 rank ceil(5.5) = 6 -> true median; p95 rank ceil(10.45) = 11
  const eleven = range(11, index => index + 1);
  assert.equal(nearestRankPercentile(eleven, 50), 6);
  assert.equal(nearestRankPercentile(eleven, 95), 11);
  // n = 20 -> p95 rank ceil(19) = 19 -> second largest
  const twenty = range(20, index => index + 1);
  assert.equal(nearestRankPercentile(twenty, 95), 19);
});

test("nearest-rank percentile rejects invalid input", () => {
  assert.throws(() => nearestRankPercentile([], 50), /at least one sample/);
  assert.throws(() => nearestRankPercentile([1, Number.NaN], 50), /not a finite number/);
  assert.throws(() => nearestRankPercentile([1], 0), /percentile must be/);
  assert.throws(() => nearestRankPercentile([1], 101), /percentile must be/);
});

test("summarize reports count, extremes, mean and both percentiles", () => {
  const stats = summarize([5, 1, 3, 2, 4]);
  assert.deepEqual(stats, {
    count: 5,
    minMs: 1,
    maxMs: 5,
    meanMs: 3,
    p50Ms: 3,
    p95Ms: 5,
  });
});

test("normalizeSample accepts plain numbers and demands a reason for censoring", () => {
  assert.deepEqual(normalizeSample(12), {
    valueMs: 12, censored: false, censorReason: null, provenance: null, note: null,
  });
  assert.equal(normalizeSample(censoredSample(20_000)).censored, true);
  assert.throws(() => normalizeSample({ valueMs: 1, censored: true }), /censorReason/);
  assert.throws(() => normalizeSample({ valueMs: "x" }), /finite number/);
});

test("a censored sample is kept in the distribution and marks the percentile it wins", () => {
  const samples = [...range(9, index => sample(1_000 + index)), censoredSample(20_000)];
  const stats = summarizeSamples(samples);
  assert.equal(stats.count, 10, "censored samples are counted, never dropped");
  assert.equal(stats.censoredCount, 1);
  assert.equal(stats.observedCount, 9);
  assert.equal(stats.p95Ms, 20_000);
  assert.equal(stats.p95Censored, true, "p95 lands on the censored sample");
  assert.equal(stats.p50Censored, false, "p50 does not");
  assert.equal(stats.maxCensored, true);
  assert.equal(stats.meanIsLowerBound, true);
  assert.equal(percentileIsCensored(samples, 95), true);
  assert.equal(percentileIsCensored(samples, 50), false);
});

test("a tie between a censored and an observed sample is read conservatively", () => {
  const samples = [...range(9, () => sample(3_000)), censoredSample(3_000)];
  assert.equal(percentileIsCensored(samples, 95), true);
  assert.equal(percentileIsCensored(samples, 50), true);
});

test("threshold inclusivity distinguishes 'under' from 'within' at exact equality", () => {
  assert.equal(evaluateThreshold(2_000, 2_000, "lt").verdict, "FAIL");
  assert.equal(evaluateThreshold(2_000, 2_000, "lte").verdict, "PASS");
  assert.equal(evaluateThreshold(1_999.999, 2_000, "lt").verdict, "PASS");
  assert.equal(evaluateThreshold(2_000.001, 2_000, "lte").verdict, "FAIL");
  assert.equal(evaluateThreshold(1_500, 2_000, "lte").marginMs, 500);
  assert.equal(evaluateThreshold(2_500, 2_000, "lte").marginMs, -500);
  assert.equal(evaluateThreshold(1, 2, "lt").comparisonSymbol, "<");
  assert.equal(evaluateThreshold(1, 2, "lte").comparisonSymbol, "<=");
  assert.throws(() => evaluateThreshold(1, 2, "le"), /unknown threshold comparison/);
});

test("a censored p95 can fail definitively but can never pass", () => {
  const breaching = evaluateThreshold(20_000, 3_000, "lte", { censored: true });
  assert.equal(breaching.verdict, "FAIL");
  assert.match(breaching.censoringNote, /FAIL is definitive/);
  const inside = evaluateThreshold(1_200, 3_000, "lte", { censored: true });
  assert.equal(inside.verdict, "INDETERMINATE");
  assert.equal(inside.p95IsLowerBound, true);
  assert.equal(inside.marginIsUpperBound, true);
  assert.equal(evaluateThreshold(1_200, 3_000, "lte").verdict, "PASS");
});

test("PRD 17 thresholds and inclusivity are pinned per phase and kind", () => {
  assert.deepEqual(PHASES.map(phase => phase.id), [
    "shell-startup", "compilation", "preview-start", "stop",
  ]);
  const pinned = {
    "shell-startup": { cold: [3_000, "lte"], warm: [3_000, "lte"] },
    compilation: { cold: [5_000, "lt"], warm: [2_000, "lt"] },
    "preview-start": { cold: [3_000, "lte"], warm: [3_000, "lte"] },
    stop: { cold: [2_000, "lte"], warm: [2_000, "lte"] },
  };
  for (const [id, kinds] of Object.entries(pinned)) {
    for (const [kind, [thresholdMs, comparison]] of Object.entries(kinds)) {
      const spec = phaseById(id).kinds[kind];
      assert.equal(spec.thresholdMs, thresholdMs, `${id}/${kind} threshold`);
      assert.equal(spec.comparison, comparison, `${id}/${kind} comparison`);
      assert.ok(spec.definition.length > 0, `${id}/${kind} definition`);
    }
  }
});

const passingSamples = () => ({
  "shell-startup": {
    cold: range(10, index => sample(1_000 + index, index + 1)),
    warm: range(10, index => sample(900 + index, index + 1)),
  },
  compilation: {
    cold: range(10, index => sample(4_000 + index, index + 1)),
    warm: range(10, index => sample(500 + index, index + 1)),
  },
  "preview-start": {
    cold: range(10, index => sample(2_000 + index, index + 1)),
    warm: range(10, index => sample(1_800 + index, index + 1)),
  },
  stop: {
    cold: range(10, index => sample(300 + index, index + 1)),
    warm: range(10, index => sample(250 + index, index + 1)),
  },
});

test("aggregate computes percentiles and verdicts for every phase and kind", () => {
  const result = aggregate(passingSamples());
  assert.deepEqual(result.violations, []);
  assert.equal(result.overallVerdict, "PASS");
  const compilation = result.phases.find(phase => phase.id === "compilation");
  assert.equal(compilation.kinds.cold.count, 10);
  assert.equal(compilation.kinds.cold.censoredCount, 0);
  assert.equal(compilation.kinds.cold.p50Ms, 4_004);
  assert.equal(compilation.kinds.cold.p95Ms, 4_009);
  assert.equal(compilation.kinds.cold.threshold.verdict, "PASS");
  assert.equal(compilation.kinds.warm.p95Ms, 509);
  assert.deepEqual(compilation.kinds.warm.samplesMs, range(10, index => 500 + index));
});

test("aggregate keeps censored samples, counts them and reports a bounded verdict", () => {
  const samples = passingSamples();
  samples["preview-start"].cold = [
    ...range(8, index => sample(2_000 + index, index + 1)),
    censoredSample(20_137.4, 9),
    censoredSample(20_055.2, 10),
  ];
  const result = aggregate(samples);
  const preview = result.phases.find(phase => phase.id === "preview-start");
  assert.equal(preview.kinds.cold.count, 10, "censored samples count towards the required ten");
  assert.equal(preview.kinds.cold.censoredCount, 2);
  assert.equal(preview.kinds.cold.censoredSamples.length, 2);
  assert.equal(preview.kinds.cold.p95Ms, 20_137.4);
  assert.equal(preview.kinds.cold.p95Censored, true);
  assert.equal(preview.kinds.cold.threshold.verdict, "FAIL");
  assert.deepEqual(result.violations, [], "censored samples do not create a sample shortfall");
  assert.equal(result.overallVerdict, "FAIL");
});

test("aggregate reports INDETERMINATE when a censored p95 is inside the threshold", () => {
  const samples = passingSamples();
  samples.stop.warm = [
    ...range(9, index => sample(250 + index, index + 1)),
    censoredSample(400, 10),
  ];
  const result = aggregate(samples);
  const stop = result.phases.find(phase => phase.id === "stop");
  assert.equal(stop.kinds.warm.threshold.verdict, "INDETERMINATE");
  assert.equal(result.overallVerdict, "INDETERMINATE");
});

test("aggregate flags a failing phase without altering the raw samples", () => {
  const samples = passingSamples();
  samples.stop.warm = [...range(9, index => sample(250 + index, index + 1)), sample(2_500, 10)];
  const result = aggregate(samples);
  const stop = result.phases.find(phase => phase.id === "stop");
  assert.equal(stop.kinds.warm.p95Ms, 2_500);
  assert.equal(stop.kinds.warm.threshold.verdict, "FAIL");
  assert.equal(result.overallVerdict, "FAIL");
  assert.equal(stop.kinds.warm.samplesMs.at(-1), 2_500);
});

test("aggregate reports a violation when a phase has fewer than ten samples", () => {
  const samples = passingSamples();
  samples["preview-start"].warm = range(9, index => sample(1_800 + index, index + 1));
  const result = aggregate(samples);
  assert.equal(result.overallVerdict, "FAIL");
  assert.ok(result.violations.some(violation => violation.includes("9 warm samples")));
});

test("aggregate reports a violation when a phase is missing entirely", () => {
  const samples = passingSamples();
  delete samples.stop;
  const result = aggregate(samples);
  assert.ok(result.violations.some(violation => violation.includes("phase stop has no samples")));
  assert.equal(result.overallVerdict, "FAIL");
});

const buildReport = ({ samples = passingSamples(), censoredSamples = [] } = {}) => {
  const aggregated = aggregate(samples);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: "2026-01-01T00:00:00.000Z",
    machine: {
      facts: [{ label: "CPU", value: "Test CPU", source: "system_profiler SPHardwareDataType" }],
      notes: ["note"],
    },
    methodology: {
      summary: ["summary"],
      percentileMethod: "nearest rank",
      thresholdInclusivity: "as worded by PRD 17",
      fixture: ["five files"],
      runPlan: ["ten cold runs"],
    },
    sampleTreatment: ["no launch is survivor-conditioned"],
    attemptInventory: {
      nominalAttempts: 10,
      attemptsMade: 10,
      attemptBudget: 30,
      budgetRule: "up to 3x the nominal attempt count",
      stopReason: "every phase reached ten samples",
      requirementsAtEnd: [],
      attempts: range(10, index => ({
        attempt: index + 1,
        retryReason: null,
        launches: [{ mode: "full", shellLaunchKind: "cold", outcome: "ok" }],
        contributions: { "stop/cold": 1 },
        censoredContributions: [],
        exclusions: [],
      })),
    },
    launchFailures: [],
    censoredSamples,
    excludedSamples: [],
    phases: aggregated.phases,
    overallVerdict: aggregated.overallVerdict,
    supplementary: [
      { title: "Compiler context boot", count: 10, p50Ms: 1, p95Ms: 2, note: "note" },
    ],
    caveats: ["caveat"],
    reproduction: { commands: ["node scripts/measure-performance.mjs"], notes: ["note"] },
    runs: [{
      attempt: 1,
      mode: "full",
      shellLaunchKind: "cold",
      exitCode: 0,
      wallClockMs: 1_234,
      outcome: "ok",
    }],
  };
};

test("validateReport accepts a well-formed report", () => {
  assert.deepEqual(validateReport(buildReport()), []);
});

test("validateReport accepts a report whose censored samples are fully disclosed", () => {
  const samples = passingSamples();
  const censored = censoredSample(20_500, 7);
  samples["preview-start"].cold = [
    ...range(9, index => sample(2_000 + index, index + 1)),
    censored,
  ];
  const report = buildReport({
    samples,
    censoredSamples: [{ phaseId: "preview-start", kind: "cold", ...censored }],
  });
  assert.deepEqual(validateReport(report), []);
});

test("validateReport rejects censored samples that are not disclosed", () => {
  const samples = passingSamples();
  samples["preview-start"].cold = [
    ...range(9, index => sample(2_000 + index, index + 1)),
    censoredSample(20_500, 7),
  ];
  const report = buildReport({ samples });
  assert.ok(validateReport(report)
    .some(problem => problem.includes("not all listed in censoredSamples")));
});

test("validateReport rejects tampered percentiles, verdicts and missing phases", () => {
  const tamperedPercentile = buildReport();
  tamperedPercentile.phases[0].kinds.cold.p95Ms = 1;
  assert.ok(validateReport(tamperedPercentile)
    .some(problem => problem.includes("p95 does not match")));

  const tamperedVerdict = buildReport();
  tamperedVerdict.phases[1].kinds.cold.threshold.verdict = "PASS";
  tamperedVerdict.phases[1].kinds.cold.p95Ms = 9_000;
  tamperedVerdict.phases[1].kinds.cold.samplesMs = range(10, () => 9_000);
  tamperedVerdict.phases[1].kinds.cold.samples = range(10, () => sample(9_000));
  tamperedVerdict.phases[1].kinds.cold.p50Ms = 9_000;
  assert.ok(validateReport(tamperedVerdict)
    .some(problem => problem.includes("verdict does not match")));

  const missingPhase = buildReport();
  missingPhase.phases = missingPhase.phases.slice(0, 2);
  assert.ok(validateReport(missingPhase).some(problem => problem.includes("missing phase")));

  const missingKind = buildReport();
  delete missingKind.phases[0].kinds.warm;
  assert.ok(validateReport(missingKind).some(problem => problem.includes("missing phase kind")));

  const wrongSchema = buildReport();
  wrongSchema.schemaVersion = 99;
  assert.ok(validateReport(wrongSchema).some(problem => problem.includes("schemaVersion")));

  const missingMachine = buildReport();
  delete missingMachine.machine;
  assert.ok(validateReport(missingMachine)
    .some(problem => problem.includes("missing top-level key: machine")));

  const emptySamples = buildReport();
  emptySamples.phases[0].kinds.cold.samplesMs = [];
  assert.ok(validateReport(emptySamples).some(problem => problem.includes("no raw samples")));

  const mismatchedCount = buildReport();
  mismatchedCount.phases[0].kinds.cold.count = 3;
  assert.ok(validateReport(mismatchedCount)
    .some(problem => problem.includes("count does not match")));
});

test("validateReport demands the attempt inventory, failures and exclusions", () => {
  for (const key of [
    "attemptInventory", "launchFailures", "censoredSamples", "excludedSamples", "sampleTreatment",
  ]) {
    const report = buildReport();
    delete report[key];
    assert.ok(validateReport(report).some(problem => problem.includes(key)),
      `${key} must be required`);
  }

  const shortInventory = buildReport();
  shortInventory.attemptInventory.attempts = shortInventory.attemptInventory.attempts.slice(0, 3);
  assert.ok(validateReport(shortInventory)
    .some(problem => problem.includes("does not list every attempt made")));

  const overBudget = buildReport();
  overBudget.attemptInventory.attemptBudget = 5;
  assert.ok(validateReport(overBudget)
    .some(problem => problem.includes("exceeds the declared attempt budget")));

  const noContributions = buildReport();
  delete noContributions.attemptInventory.attempts[0].contributions;
  assert.ok(validateReport(noContributions)
    .some(problem => problem.includes("sample contributions")));
});

test("validateReport rejects samples without provenance or a censoring reason", () => {
  const noProvenance = buildReport();
  noProvenance.phases[0].kinds.cold.samples[0].provenance = null;
  assert.ok(validateReport(noProvenance)
    .some(problem => problem.includes("which attempt produced it")));

  const noReason = buildReport();
  noReason.phases[0].kinds.cold.samples[0].censored = true;
  noReason.phases[0].kinds.cold.samples[0].censorReason = null;
  assert.ok(validateReport(noReason)
    .some(problem => problem.includes("censored without a reason")));

  const wrongFlag = buildReport();
  wrongFlag.phases[0].kinds.cold.p95Censored = true;
  assert.ok(validateReport(wrongFlag)
    .some(problem => problem.includes("p95 censoring flag is wrong")));
});

test("renderMarkdown emits machine, methodology, raw samples, percentiles and verdicts", () => {
  const markdown = renderMarkdown(buildReport());
  assert.match(markdown, /^# Performance baseline/);
  assert.match(markdown, /GENERATED FILE/);
  assert.match(markdown, /## Reference machine/);
  assert.match(markdown, /Test CPU/);
  assert.match(markdown, /## Methodology/);
  assert.match(markdown, /### How samples are treated/);
  assert.match(markdown, /## Results against PRD section 17 thresholds/);
  assert.match(markdown, /## Caveats and known gaps/);
  assert.match(markdown, /## Censored samples/);
  assert.match(markdown, /## Attempt inventory/);
  assert.match(markdown, /### Launch failures and partial launches/);
  assert.match(markdown, /### Samples that could not be taken/);
  assert.match(markdown, /Raw samples in collection order/);
  assert.match(markdown, /Sample provenance/);
  for (const phase of PHASES) {
    assert.ok(markdown.includes(phase.title), `missing ${phase.id}`);
  }
  assert.equal((markdown.match(/\*\*PASS\*\*/g) ?? []).length, 16);
  assert.match(markdown, /p95 <= 3000\.0 ms/);
  assert.match(markdown, /p95 < 2000\.0 ms/);
});

test("renderMarkdown surfaces FAIL verdicts verbatim", () => {
  const report = buildReport();
  const failing = aggregate({
    ...passingSamples(),
    stop: {
      cold: range(10, index => sample(300 + index, index + 1)),
      warm: range(10, index => sample(2_500, index + 1)),
    },
  });
  report.phases = failing.phases;
  report.overallVerdict = failing.overallVerdict;
  const markdown = renderMarkdown(report);
  assert.match(markdown, /\*\*Overall verdict:\*\* FAIL/);
  assert.match(markdown, /\*\*FAIL\*\*/);
});

test("renderMarkdown marks censored values, failures and retried attempts", () => {
  const samples = passingSamples();
  const censored = censoredSample(20_500, 11);
  samples["preview-start"].cold = [
    ...range(9, index => sample(2_000 + index, index + 1)),
    censored,
  ];
  const report = buildReport({
    samples,
    censoredSamples: [{
      phaseId: "preview-start",
      kind: "cold",
      ...censored,
      evidence: "bridge answered 3900 queries; FrameCount stayed 0",
    }],
  });
  report.attemptInventory.attemptsMade = 11;
  report.attemptInventory.attempts.push({
    attempt: 11,
    retryReason: "preview-start/cold has 9/10 samples",
    launches: [{ mode: "full", shellLaunchKind: "cold", outcome: "harness-failure" }],
    contributions: { "preview-start/cold": 1 },
    censoredContributions: ["preview-start/cold >= 20500 ms"],
    exclusions: [],
  });
  report.launchFailures = [{
    attempt: 4,
    mode: "full",
    outcome: "harness-failure",
    exitCode: 0,
    signal: null,
    lastCheckpoint: "{\"name\":\"preview-cycle-begin\"}",
    failure: "preview cycle 1 did not complete",
    contributions: { "shell-startup/cold": 1, "compilation/warm": 10 },
  }];
  report.excludedSamples = [{
    attempt: 4,
    phaseId: "preview-start",
    kind: "warm",
    reason: "preview cycle 1 did not complete: bridge closed",
  }];
  const markdown = renderMarkdown(report);
  assert.match(markdown, />= 20500\.0 ms/);
  assert.match(markdown, /bridge answered 3900 queries/);
  assert.match(markdown, /preview-start\/cold has 9\/10 samples/);
  assert.match(markdown, /preview cycle 1 did not complete: bridge closed/);
  assert.match(markdown, /harness-failure/);
  assert.match(markdown, /compilation\/warm: 10/);
});

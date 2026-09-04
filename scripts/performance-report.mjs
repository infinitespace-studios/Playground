/**
 * Issue 041: pure aggregation, threshold evaluation and rendering for the
 * startup / compile / preview / Stop performance baseline.
 *
 * This module contains no I/O and no process control so the percentile and
 * report logic can be unit tested directly (`scripts/performance-report.test.mjs`).
 */

export const REPORT_SCHEMA_VERSION = 2;

/** Minimum number of samples the acceptance criteria demand per phase and kind. */
export const REQUIRED_SAMPLES_PER_PHASE = 10;

/**
 * A sample is either exactly observed or right-censored.
 *
 * A right-censored sample is one where the measured phase was still not
 * complete when a hard observation bound expired. Its recorded value is the
 * bound itself, so the true value is *at least* the recorded value. Censored
 * samples are never dropped: they are kept in the distribution, marked, and
 * make any percentile that lands on them a lower bound.
 */
export function normalizeSample(sample) {
  if (typeof sample === "number") {
    return {
      valueMs: sample,
      censored: false,
      censorReason: null,
      provenance: null,
      note: null,
    };
  }
  if (sample === null || typeof sample !== "object") {
    throw new Error(`sample must be a number or an object: ${String(sample)}`);
  }
  if (typeof sample.valueMs !== "number" || !Number.isFinite(sample.valueMs)) {
    throw new Error(`sample.valueMs is not a finite number: ${String(sample.valueMs)}`);
  }
  const censored = sample.censored === true;
  if (censored && typeof sample.censorReason !== "string") {
    throw new Error("a censored sample must carry censorReason");
  }
  return {
    valueMs: sample.valueMs,
    censored,
    censorReason: censored ? sample.censorReason : null,
    provenance: sample.provenance ?? null,
    note: sample.note ?? null,
  };
}

/**
 * Deterministic nearest-rank percentile (no interpolation).
 *
 * Values are sorted ascending and the reported value is the element at
 * rank `ceil(p/100 * n)`, 1-based, which is always an observed sample.
 * p50 of an even-sized list is therefore the lower median, and p95 of ten
 * samples is the tenth (largest) sample. The method is stated in the report so
 * a verifier can recompute it by hand.
 */
export function nearestRankPercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("nearestRankPercentile requires at least one sample");
  }
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) {
    throw new Error(`percentile must be in (0, 100]: ${percentile}`);
  }
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`sample is not a finite number: ${String(value)}`);
    }
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    meanMs: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50Ms: nearestRankPercentile(sorted, 50),
    p95Ms: nearestRankPercentile(sorted, 95),
  };
}

/**
 * Is the value selected by a nearest-rank percentile a censored (lower-bound)
 * sample?
 *
 * The percentile itself is computed from the numeric values alone, exactly as
 * `nearestRankPercentile` documents. A percentile is then reported as censored
 * when *any* sample holding the selected value is censored, which is the
 * conservative reading: with ties the reported percentile can only be a lower
 * bound on the truth.
 */
export function percentileIsCensored(samples, percentile) {
  const normalized = samples.map(normalizeSample);
  const value = nearestRankPercentile(normalized.map(sample => sample.valueMs), percentile);
  return normalized.some(sample => sample.censored && sample.valueMs === value);
}

/**
 * Censoring-aware summary. Every statistic that a censored sample can only
 * push upwards is flagged as a lower bound rather than silently reported as an
 * exact value.
 */
export function summarizeSamples(samples) {
  const normalized = samples.map(normalizeSample);
  const values = normalized.map(sample => sample.valueMs);
  const numeric = summarize(values);
  const censoredCount = normalized.filter(sample => sample.censored).length;
  const maxSample = normalized.reduce(
    (largest, sample) => (sample.valueMs > largest.valueMs ? sample : largest), normalized[0]);
  return {
    sampleCount: normalized.length,
    ...numeric,
    censoredCount,
    observedCount: normalized.length - censoredCount,
    p50Censored: percentileIsCensored(normalized, 50),
    p95Censored: percentileIsCensored(normalized, 95),
    maxCensored: maxSample.censored,
    meanIsLowerBound: censoredCount > 0,
  };
}

/**
 * Evaluate a p95 against a PRD section 17 threshold.
 *
 * `comparison` is the exact inclusivity the PRD text uses: `lt` for "under N
 * seconds" and `lte` for "within N seconds". Equality therefore passes only
 * where the PRD says "within".
 *
 * When the p95 lands on a right-censored sample the reported value is only a
 * lower bound on the true p95. A lower bound that already breaches the
 * threshold is a definitive FAIL; a lower bound that is still inside the
 * threshold cannot prove a PASS, so it is reported as INDETERMINATE rather
 * than being claimed as a pass.
 */
export function evaluateThreshold(p95Ms, thresholdMs, comparison, { censored = false } = {}) {
  if (comparison !== "lt" && comparison !== "lte") {
    throw new Error(`unknown threshold comparison: ${comparison}`);
  }
  const withinThreshold = comparison === "lt" ? p95Ms < thresholdMs : p95Ms <= thresholdMs;
  const verdict = withinThreshold ? (censored ? "INDETERMINATE" : "PASS") : "FAIL";
  return {
    thresholdMs,
    comparison,
    comparisonSymbol: comparison === "lt" ? "<" : "<=",
    marginMs: thresholdMs - p95Ms,
    marginIsUpperBound: censored,
    p95IsLowerBound: censored,
    verdict,
    censoringNote: censored
      ? "The p95 lands on a right-censored sample, so the reported p95 is a lower bound on " +
        "the true p95." +
        (withinThreshold
          ? " A lower bound inside the threshold cannot establish a PASS, so this phase is " +
            "INDETERMINATE."
          : " The lower bound already breaches the threshold, so FAIL is definitive.")
      : null,
  };
}

/**
 * The measured phases, the PRD section 17 threshold that applies to each
 * cold/warm kind, and the exact inclusivity of each threshold as the PRD words
 * it (`lt` for "under N seconds", `lte` for "within N seconds").
 */
export const PHASES = [
  {
    id: "shell-startup",
    title: "Application shell startup",
    measurement:
      "Driver wall clock from `spawn()` of the packaged binary to the shell's " +
      "`ISSUE041_SHELL_READY` line (DOM parsed, all five shell controls present, " +
      "two animation frames painted, main thread servicing a fresh macrotask, " +
      "and the native window reported visible by Rust at that instant).",
    kinds: {
      cold: {
        thresholdMs: 3_000,
        comparison: "lte",
        prdText: "application shell visible within 3 seconds",
        definition:
          "Fresh process launch preceded by an enforced idle cooling gap with no " +
          "instance of the application running and no application process having " +
          "run during the gap.",
      },
      warm: {
        thresholdMs: 3_000,
        comparison: "lte",
        prdText: "application shell visible within 3 seconds",
        definition:
          "Fresh process launch started immediately (< 1 s) after a preceding " +
          "launch of the same binary exited, so the OS page cache, the dyld " +
          "shared cache and WebKit's caches are warm.",
      },
    },
  },
  {
    id: "compilation",
    title: "Compilation of the five-file benchmark project",
    measurement:
      "`compile.request` sent on the persistent compiler protocol port until the " +
      "validated `compile.response` carrying the DLL and PDB resolves, measured " +
      "with `performance.now()` in the shell. The cold sample additionally " +
      "includes the compiler-context boot that precedes it (compiler iframe load, " +
      ".NET WASM runtime boot, Roslyn context creation, protocol bootstrap).",
    kinds: {
      cold: {
        thresholdMs: 5_000,
        comparison: "lt",
        prdText:
          "cold compiler initialization p95 under 5 seconds for a project of up to five source files",
        definition:
          "Compiler-context boot in a fresh application process plus the first " +
          "compilation of the five-file fixture in that context. A process can " +
          "produce exactly one such sample, so each cold sample comes from its own " +
          "application launch.",
      },
      warm: {
        thresholdMs: 2_000,
        comparison: "lt",
        prdText:
          "warm compilation p95 under 2 seconds for a project of up to five source files",
        definition:
          "Any later compilation of the same five-file fixture through the same " +
          "retained compiler context in the same process.",
      },
    },
  },
  {
    id: "preview-start",
    title: "Preview visibly active after successful compilation",
    measurement:
      "From the validated `compile.response` for the fixture to the first frame " +
      "the running Game itself reports having drawn (`FrameCount >= 1`, read " +
      "through the preview bridge). The `preview.started` lifecycle event is " +
      "reported separately as a lower bound.",
    kinds: {
      cold: {
        thresholdMs: 3_000,
        comparison: "lte",
        prdText: "preview visibly active within 3 seconds after successful compilation at p95",
        definition:
          "First preview start in a fresh application process: no preview window, " +
          "preview runtime or preview asset has been instantiated in the process yet.",
      },
      warm: {
        thresholdMs: 3_000,
        comparison: "lte",
        prdText: "preview visibly active within 3 seconds after successful compilation at p95",
        definition:
          "A later preview start in the same process, after a previous preview was " +
          "started and stopped, so the isolated preview runtime assets are already " +
          "in the process's caches.",
      },
    },
  },
  {
    id: "stop",
    title: "Stop returns control to the editor",
    measurement:
      "Shell wall clock around the issue 024 Run/Stop control's `stop()`: from the " +
      "call the Stop button makes until the controller has returned to `idle` and " +
      "the editor's Run control is enabled again.",
    kinds: {
      cold: {
        thresholdMs: 2_000,
        comparison: "lte",
        prdText: "Stop returning control to the editor within 2 seconds",
        definition: "Stop of the first preview in a fresh application process.",
      },
      warm: {
        thresholdMs: 2_000,
        comparison: "lte",
        prdText: "Stop returning control to the editor within 2 seconds",
        definition: "Stop of a later preview in the same process.",
      },
    },
  },
];

export function phaseById(id) {
  const phase = PHASES.find(candidate => candidate.id === id);
  if (!phase) throw new Error(`unknown phase: ${id}`);
  return phase;
}

/**
 * Aggregate raw per-run samples into the report structure.
 *
 * `samples` maps `<phase id>` to `{ cold: [], warm: [] }`; each entry is either
 * a plain number of milliseconds or a sample object
 * `{ valueMs, censored, censorReason, provenance, note }`. Every phase and both
 * kinds declared in PHASES must be present with at least `requiredSamples`
 * values; censored samples count towards that requirement because they are
 * real, bounded observations of the phase, not missing data.
 */
export function aggregate(samples, { requiredSamples = REQUIRED_SAMPLES_PER_PHASE } = {}) {
  const phases = [];
  const violations = [];
  for (const phase of PHASES) {
    const measured = samples[phase.id];
    if (!measured) {
      violations.push(`phase ${phase.id} has no samples`);
      continue;
    }
    const kinds = {};
    for (const [kind, spec] of Object.entries(phase.kinds)) {
      const values = (measured[kind] ?? []).map(normalizeSample);
      if (values.length < requiredSamples) {
        violations.push(
          `phase ${phase.id} has ${values.length} ${kind} samples; ${requiredSamples} required`);
      }
      if (values.length === 0) continue;
      const stats = summarizeSamples(values);
      kinds[kind] = {
        ...stats,
        prdText: spec.prdText,
        definition: spec.definition,
        thresholdMs: spec.thresholdMs,
        comparison: spec.comparison,
        samples: values,
        samplesMs: values.map(sample => sample.valueMs),
        sortedSamplesMs: values.map(sample => sample.valueMs)
          .sort((left, right) => left - right),
        censoredSamples: values.filter(sample => sample.censored),
        threshold: evaluateThreshold(stats.p95Ms, spec.thresholdMs, spec.comparison, {
          censored: stats.p95Censored,
        }),
      };
    }
    phases.push({
      id: phase.id,
      title: phase.title,
      measurement: phase.measurement,
      kinds,
    });
  }
  const verdicts = phases.flatMap(phase =>
    Object.values(phase.kinds).map(kind => kind.threshold.verdict));
  let overallVerdict = "FAIL";
  if (violations.length === 0 && verdicts.length > 0) {
    if (verdicts.every(verdict => verdict === "PASS")) overallVerdict = "PASS";
    else if (verdicts.includes("FAIL")) overallVerdict = "FAIL";
    else overallVerdict = "INDETERMINATE";
  }
  return { phases, violations, overallVerdict };
}

/** Schema check for a completed report. Returns the list of problems found. */
export function validateReport(report) {
  const problems = [];
  if (report?.schemaVersion !== REPORT_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${REPORT_SCHEMA_VERSION}`);
  }
  for (const key of [
    "generatedAt", "machine", "methodology", "phases", "overallVerdict",
    "attemptInventory", "launchFailures", "censoredSamples", "excludedSamples",
    "sampleTreatment",
  ]) {
    if (report?.[key] === undefined) problems.push(`missing top-level key: ${key}`);
  }
  if (report?.attemptInventory !== undefined) {
    const inventory = report.attemptInventory;
    if (!Array.isArray(inventory.attempts) || inventory.attempts.length === 0) {
      problems.push("attemptInventory.attempts must list every attempt made");
    }
    for (const key of ["attemptsMade", "attemptBudget", "nominalAttempts"]) {
      if (!Number.isInteger(inventory?.[key])) {
        problems.push(`attemptInventory.${key} must be an integer`);
      }
    }
    if (Array.isArray(inventory?.attempts) &&
        Number.isInteger(inventory?.attemptsMade) &&
        inventory.attempts.length !== inventory.attemptsMade) {
      problems.push("attemptInventory.attempts does not list every attempt made");
    }
    if (Number.isInteger(inventory?.attemptsMade) && Number.isInteger(inventory?.attemptBudget) &&
        inventory.attemptsMade > inventory.attemptBudget) {
      problems.push("attemptInventory.attemptsMade exceeds the declared attempt budget");
    }
    for (const attempt of inventory?.attempts ?? []) {
      if (!Array.isArray(attempt.launches) || attempt.launches.length === 0) {
        problems.push(`attempt ${attempt.attempt} lists no launches`);
      }
      if (attempt.contributions === undefined) {
        problems.push(`attempt ${attempt.attempt} does not record its sample contributions`);
      }
    }
  }
  const phaseIds = new Set((report?.phases ?? []).map(phase => phase.id));
  for (const phase of PHASES) {
    if (!phaseIds.has(phase.id)) {
      problems.push(`missing phase: ${phase.id}`);
      continue;
    }
    const measured = report.phases.find(candidate => candidate.id === phase.id);
    for (const kind of Object.keys(phase.kinds)) {
      if (measured.kinds?.[kind] === undefined) {
        problems.push(`missing phase kind: ${phase.id}/${kind}`);
      }
    }
  }
  const censoredIndex = new Map();
  for (const entry of report?.censoredSamples ?? []) {
    const key = `${entry.phaseId}/${entry.kind}`;
    censoredIndex.set(key, (censoredIndex.get(key) ?? 0) + 1);
  }
  for (const phase of report?.phases ?? []) {
    for (const [kind, values] of Object.entries(phase.kinds ?? {})) {
      if (!Array.isArray(values.samplesMs) || values.samplesMs.length === 0) {
        problems.push(`phase ${phase.id}/${kind} has no raw samples`);
        continue;
      }
      if (values.count !== values.samplesMs.length) {
        problems.push(`phase ${phase.id}/${kind} count does not match its raw samples`);
      }
      if (!Array.isArray(values.samples) || values.samples.length !== values.samplesMs.length) {
        problems.push(`phase ${phase.id}/${kind} does not describe every sample`);
        continue;
      }
      for (const [index, sample] of values.samples.entries()) {
        if (sample.valueMs !== values.samplesMs[index]) {
          problems.push(
            `phase ${phase.id}/${kind} sample ${index} disagrees with its raw value`);
        }
        if (sample.censored === true && typeof sample.censorReason !== "string") {
          problems.push(
            `phase ${phase.id}/${kind} sample ${index} is censored without a reason`);
        }
        if (sample.provenance === null || sample.provenance === undefined) {
          problems.push(
            `phase ${phase.id}/${kind} sample ${index} does not record which attempt produced it`);
        }
      }
      const censoredCount = values.samples.filter(sample => sample.censored === true).length;
      if (values.censoredCount !== censoredCount) {
        problems.push(`phase ${phase.id}/${kind} censoredCount does not match its samples`);
      }
      if ((censoredIndex.get(`${phase.id}/${kind}`) ?? 0) !== censoredCount) {
        problems.push(
          `phase ${phase.id}/${kind} censored samples are not all listed in censoredSamples`);
      }
      const p50 = nearestRankPercentile(values.samplesMs, 50);
      const p95 = nearestRankPercentile(values.samplesMs, 95);
      if (Math.abs(p50 - values.p50Ms) > 1e-9) {
        problems.push(`phase ${phase.id}/${kind} p50 does not match its raw samples`);
      }
      if (Math.abs(p95 - values.p95Ms) > 1e-9) {
        problems.push(`phase ${phase.id}/${kind} p95 does not match its raw samples`);
      }
      // Tolerant of malformed samples: validation reports problems, never throws.
      const censoringFlag = percentileValue =>
        values.samples.some(
          entry => entry.censored === true && entry.valueMs === percentileValue);
      if (values.p50Censored !== censoringFlag(p50)) {
        problems.push(`phase ${phase.id}/${kind} p50 censoring flag is wrong`);
      }
      if (values.p95Censored !== censoringFlag(p95)) {
        problems.push(`phase ${phase.id}/${kind} p95 censoring flag is wrong`);
      }
      const expected = evaluateThreshold(values.p95Ms, values.thresholdMs, values.comparison, {
        censored: values.p95Censored === true,
      });
      if (expected.verdict !== values.threshold?.verdict) {
        problems.push(`phase ${phase.id}/${kind} verdict does not match its threshold comparison`);
      }
    }
  }
  return problems;
}

const ms = value => `${value.toFixed(1)} ms`;

/** A censored statistic is only ever a lower bound, and is rendered as one. */
const bounded = (value, censored) => `${censored ? ">= " : ""}${ms(value)}`;

const table = rows => {
  const header = `| ${rows[0].join(" | ")} |`;
  const divider = `| ${rows[0].map(() => "---").join(" | ")} |`;
  const body = rows.slice(1).map(row => `| ${row.join(" | ")} |`);
  return [header, divider, ...body].join("\n");
};

function machineSection(machine) {
  const rows = [["Property", "Value", "Source"]];
  for (const entry of machine.facts) {
    rows.push([entry.label, entry.value, entry.source]);
  }
  return table(rows);
}

/** Render the committed Markdown baseline. Fully derived from the JSON report. */
export function renderMarkdown(report) {
  const lines = [];
  lines.push("# Performance baseline");
  lines.push("");
  lines.push("<!-- GENERATED FILE — do not edit by hand.");
  lines.push("     Regenerate with: node scripts/measure-performance.mjs");
  lines.push("     Machine-readable source of truth: docs/performance-baseline.json -->");
  lines.push("");
  lines.push(`**Report schema version:** ${report.schemaVersion}`);
  lines.push("");
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push("");
  lines.push(`**Issue:** 041 — measure startup/compile/preview/Stop timings (PRD 17, 20.2)`);
  lines.push("");
  lines.push(`**Overall verdict:** ${report.overallVerdict}`);
  lines.push("");
  lines.push("## Reference machine");
  lines.push("");
  lines.push(machineSection(report.machine));
  lines.push("");
  if (report.machine.notes?.length) {
    lines.push("### Evidence notes");
    lines.push("");
    for (const note of report.machine.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  lines.push("## Methodology");
  lines.push("");
  for (const item of report.methodology.summary) lines.push(`- ${item}`);
  lines.push("");
  lines.push("### Percentile method");
  lines.push("");
  lines.push(report.methodology.percentileMethod);
  lines.push("");
  lines.push("### Threshold inclusivity");
  lines.push("");
  lines.push(report.methodology.thresholdInclusivity);
  lines.push("");
  lines.push("### Benchmark project");
  lines.push("");
  for (const item of report.methodology.fixture) lines.push(`- ${item}`);
  lines.push("");
  lines.push("### Run plan");
  lines.push("");
  for (const item of report.methodology.runPlan) lines.push(`- ${item}`);
  lines.push("");
  lines.push("### How samples are treated");
  lines.push("");
  for (const item of report.sampleTreatment) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Results against PRD section 17 thresholds");
  lines.push("");
  const summaryRows = [[
    "Phase", "Kind", "n", "censored", "p50", "p95", "Threshold", "Verdict",
  ]];
  for (const phase of report.phases) {
    for (const [kind, values] of Object.entries(phase.kinds)) {
      summaryRows.push([
        phase.title,
        kind,
        String(values.count),
        String(values.censoredCount ?? 0),
        bounded(values.p50Ms, values.p50Censored === true),
        bounded(values.p95Ms, values.p95Censored === true),
        `p95 ${values.threshold.comparisonSymbol} ${ms(values.thresholdMs)}`,
        `**${values.threshold.verdict}**`,
      ]);
    }
  }
  lines.push(table(summaryRows));
  lines.push("");
  lines.push(
    "`>=` marks a statistic that lands on a right-censored sample: the true value is at " +
    "least the number shown. A phase whose p95 is a censored lower bound can be a definitive " +
    "FAIL (the bound already breaches the threshold) but can never be a PASS; such a phase is " +
    "reported as INDETERMINATE.");
  lines.push("");
  lines.push("## Per-phase detail");
  lines.push("");
  for (const phase of report.phases) {
    lines.push(`### ${phase.title}`);
    lines.push("");
    lines.push(`- **Measured:** ${phase.measurement}`);
    lines.push("");
    for (const [kind, values] of Object.entries(phase.kinds)) {
      lines.push(`#### ${kind} samples (n = ${values.count}, ` +
        `${values.censoredCount ?? 0} right-censored)`);
      lines.push("");
      lines.push(`- **PRD 17 requirement:** ${values.prdText}`);
      lines.push(`- **Threshold applied:** p95 ${values.threshold.comparisonSymbol} ${ms(values.thresholdMs)}`);
      lines.push(`- **"${kind}" means:** ${values.definition}`);
      if (values.threshold.censoringNote) {
        lines.push(`- **Censoring:** ${values.threshold.censoringNote}`);
      }
      lines.push("");
      lines.push("Raw samples in collection order (ms, `>=` marks a censored lower bound):");
      lines.push("");
      lines.push("```");
      lines.push(values.samples
        .map(sample => `${sample.censored ? ">=" : ""}${sample.valueMs.toFixed(1)}`)
        .join(", "));
      lines.push("```");
      lines.push("");
      lines.push("Sorted ascending (ms):");
      lines.push("");
      lines.push("```");
      lines.push(values.sortedSamplesMs.map(value => value.toFixed(1)).join(", "));
      lines.push("```");
      lines.push("");
      lines.push(table([
        ["min", "p50", "mean", "p95", "max", "Verdict", "Margin to threshold"],
        [
          ms(values.minMs),
          bounded(values.p50Ms, values.p50Censored === true),
          bounded(values.meanMs, values.meanIsLowerBound === true),
          bounded(values.p95Ms, values.p95Censored === true),
          bounded(values.maxMs, values.maxCensored === true),
          `**${values.threshold.verdict}**`,
          `${values.threshold.marginIsUpperBound ? "<= " : ""}${ms(values.threshold.marginMs)}`,
        ],
      ]));
      lines.push("");
      lines.push("Sample provenance (which attempt and launch produced each sample):");
      lines.push("");
      lines.push(table([
        ["#", "Value", "Censored", "Attempt", "Source"],
        ...values.samples.map((sample, index) => [
          String(index + 1),
          bounded(sample.valueMs, sample.censored),
          sample.censored ? `yes — ${sample.censorReason}` : "no",
          String(sample.provenance?.attempt ?? "?"),
          sample.provenance?.source ?? "?",
        ]),
      ]));
      lines.push("");
    }
  }
  if (report.supplementary?.length) {
    lines.push("## Supplementary measurements (not PRD thresholds)");
    lines.push("");
    const rows = [["Measurement", "n", "p50", "p95", "Note"]];
    for (const entry of report.supplementary) {
      rows.push([
        entry.title,
        String(entry.count),
        ms(entry.p50Ms),
        ms(entry.p95Ms),
        entry.note,
      ]);
    }
    lines.push(table(rows));
    lines.push("");
  }

  // Memory-baseline section (Issue 042).
  if (report.memoryBaseline !== null && report.memoryBaseline !== undefined) {
    const mb = report.memoryBaseline;
    lines.push("## Memory baseline (Issue 042 — RSS stability after 100 compiles and 20 preview cycles)");
    lines.push("");
    if (!mb.enabled) {
      lines.push("Memory-baseline mode was not enabled for this report.");
      lines.push("");
    } else {
      lines.push(`**Runs:** ${mb.runs} | **Compilations:** ${mb.compilationCount} | ` +
        `**Preview cycles:** ${mb.previewCycleCount}`);
      lines.push("");

      if (mb.failures.length > 0) {
        lines.push("**Failures:**");
        lines.push("");
        for (const failure of mb.failures) {
          lines.push(`- ${failure}`);
        }
        lines.push("");
      }

      // Compiler RSS stability
      const compiler = mb.compilerRssStability;
      lines.push(`### Compiler RSS after ${mb.compilationCount} compilations`);
      lines.push("");
      lines.push(`- **Threshold:** p95 growth ≤ 10%`);
      lines.push(`- **Verdict:** **${compiler.verdict}**`);
      lines.push(`- **Sample count:** ${compiler.sampleCount}`);
      lines.push(`- **First RSS:** ${compiler.firstKilobytes.toFixed(1)} KB`);
      lines.push(`- **Last RSS:** ${compiler.lastKilobytes.toFixed(1)} KB`);
      lines.push(`- **Growth:** ${compiler.growthPercent.toFixed(2)}%`);
      lines.push("");

      if (compiler.sampleCount > 0) {
        const compilerSorted = [...compiler.samples].sort((a, b) => a - b);
        const compilerP50 = compilerSorted[Math.floor(compilerSorted.length * 0.5)] ?? 0;
        const compilerP95 = compilerSorted[Math.ceil(compilerSorted.length * 0.95) - 1] ?? 0;
        lines.push("| min | p50 | mean | p95 | max | Growth% | Verdict |");
        lines.push("| --- | --- | ---- | --- | --- | ------- | ------- |");
        const cMin = Math.min(...compiler.samples);
        const cMax = Math.max(...compiler.samples);
        const cMean = compiler.samples.reduce((a, b) => a + b, 0) / compiler.samples.length;
        lines.push(`| ${cMin.toFixed(1)} KB | ${compilerP50.toFixed(1)} KB | ${cMean.toFixed(1)} KB | ${compilerP95.toFixed(1)} KB | ${cMax.toFixed(1)} KB | ${compiler.growthPercent.toFixed(2)}% | **${compiler.verdict}** |`);
        lines.push("");
      }

      // Preview RSS stability
      const preview = mb.previewRssStability;
      lines.push(`### Preview RSS after ${mb.previewCycleCount} Run/Stop cycles`);
      lines.push("");
      lines.push(`- **Threshold:** p95 growth ≤ 20%`);
      lines.push(`- **Verdict:** **${preview.verdict}**`);
      lines.push(`- **Sample count:** ${preview.sampleCount}`);
      lines.push(`- **First RSS:** ${preview.firstKilobytes.toFixed(1)} KB`);
      lines.push(`- **Last RSS:** ${preview.lastKilobytes.toFixed(1)} KB`);
      lines.push(`- **Growth:** ${preview.growthPercent.toFixed(2)}%`);
      lines.push("");

      if (preview.sampleCount > 0) {
        const previewSorted = [...preview.samples].sort((a, b) => a - b);
        const previewP50 = previewSorted[Math.floor(previewSorted.length * 0.5)] ?? 0;
        const previewP95 = previewSorted[Math.ceil(previewSorted.length * 0.95) - 1] ?? 0;
        lines.push("| min | p50 | mean | p95 | max | Growth% | Verdict |");
        lines.push("| --- | --- | ---- | --- | --- | ------- | ------- |");
        const pMin = Math.min(...preview.samples);
        const pMax = Math.max(...preview.samples);
        const pMean = preview.samples.reduce((a, b) => a + b, 0) / preview.samples.length;
        lines.push(`| ${pMin.toFixed(1)} KB | ${previewP50.toFixed(1)} KB | ${pMean.toFixed(1)} KB | ${previewP95.toFixed(1)} KB | ${pMax.toFixed(1)} KB | ${preview.growthPercent.toFixed(2)}% | **${preview.verdict}** |`);
        lines.push("");
      }

      // Cleanup verification
      lines.push("### Resource cleanup verification");
      lines.push("");
      lines.push(`- **All checks passed:** ${mb.cleanupVerification.allCleared ? "yes" : "no"}`);
      lines.push("");
      for (const detail of mb.cleanupVerification.details) {
        lines.push(`- Audio contexts: ${detail.audioContextStates.join(", ")}`);
        lines.push(`- Animation frames observed: ${detail.animationFrameCount}`);
        lines.push(`- WebGL contexts: ${detail.webglContextCount}`);
        lines.push(`- Message ports: ${detail.messagePortCount}`);
        lines.push(`- Detail: ${detail.detail}`);
      }
      lines.push("");
    }
  }

  lines.push("## Caveats and known gaps");
  lines.push("");
  for (const caveat of report.caveats) lines.push(`- ${caveat}`);
  lines.push("");
  lines.push("## Censored samples");
  lines.push("");
  if (report.censoredSamples.length === 0) {
    lines.push("No sample in this report is censored: every measured phase completed inside " +
      "its observation bound.");
  } else {
    lines.push(
      `${report.censoredSamples.length} sample(s) are right-censored. Each one is a measured ` +
      "observation that the phase had *not* completed when its hard bound expired, so the " +
      "recorded value is that bound and the true value is at least as large. They are counted " +
      "in the distributions and verdicts above, not discarded.");
    lines.push("");
    lines.push(table([
      ["Phase", "Kind", "Attempt", "Recorded bound", "Reason", "Evidence at the bound"],
      ...report.censoredSamples.map(entry => [
        entry.phaseId,
        entry.kind,
        String(entry.provenance?.attempt ?? "?"),
        `>= ${ms(entry.valueMs)}`,
        entry.censorReason,
        entry.evidence ?? "—",
      ]),
    ]));
  }
  lines.push("");
  lines.push("## Attempt inventory");
  lines.push("");
  lines.push(
    `- Nominal attempts: ${report.attemptInventory.nominalAttempts}; ` +
    `attempts made: ${report.attemptInventory.attemptsMade}; ` +
    `finite attempt budget: ${report.attemptInventory.attemptBudget}.`);
  lines.push(`- Stop reason: ${report.attemptInventory.stopReason}`);
  lines.push(`- Budget rule: ${report.attemptInventory.budgetRule}`);
  lines.push("");
  lines.push(table([
    ["Attempt", "Launches", "Outcomes", "Samples contributed", "Censored", "Retry reason"],
    ...report.attemptInventory.attempts.map(attempt => [
      String(attempt.attempt),
      attempt.launches.map(launch => `${launch.mode}/${launch.shellLaunchKind}`).join(", "),
      attempt.launches.map(launch => launch.outcome).join(", "),
      Object.entries(attempt.contributions)
        .map(([target, count]) => `${target}: ${count}`).join("; ") || "none",
      attempt.censoredContributions.length === 0
        ? "none"
        : attempt.censoredContributions.join("; "),
      attempt.retryReason ?? "—",
    ]),
  ]));
  lines.push("");
  lines.push("### Launch failures and partial launches");
  lines.push("");
  if (report.launchFailures.length === 0) {
    lines.push("Every launch in this report completed its whole programme.");
  } else {
    lines.push(
      "A launch that fails part-way keeps the samples it had already completed; only the " +
      "phases it never reached are missing, and those are listed as exclusions below.");
    lines.push("");
    lines.push(table([
      ["Attempt", "Mode", "Outcome", "Exit", "Last checkpoint", "Failure", "Samples kept"],
      ...report.launchFailures.map(failure => [
        String(failure.attempt),
        failure.mode,
        failure.outcome,
        `${failure.exitCode ?? "n/a"}${failure.signal ? `/${failure.signal}` : ""}`,
        failure.lastCheckpoint ? `\`${failure.lastCheckpoint}\`` : "—",
        failure.failure ?? "—",
        Object.entries(failure.contributions ?? {})
          .map(([target, count]) => `${target}: ${count}`).join("; ") || "none",
      ]),
    ]));
  }
  lines.push("");
  lines.push("### Samples that could not be taken");
  lines.push("");
  if (report.excludedSamples.length === 0) {
    lines.push("Every launch produced every sample its mode is capable of producing.");
  } else {
    lines.push(table([
      ["Attempt", "Target", "Why the sample does not exist"],
      ...report.excludedSamples.map(entry => [
        String(entry.attempt),
        `${entry.phaseId}/${entry.kind}`,
        entry.reason,
      ]),
    ]));
  }
  lines.push("");
  lines.push("## Reproducing this report");
  lines.push("");
  lines.push("```sh");
  for (const command of report.reproduction.commands) lines.push(command);
  lines.push("```");
  lines.push("");
  for (const item of report.reproduction.notes) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Launch inventory");
  lines.push("");
  const runRows = [[
    "Attempt", "Mode", "Shell launch kind", "Exit code", "Duration", "Outcome",
  ]];
  for (const run of report.runs) {
    runRows.push([
      String(run.attempt ?? run.index),
      run.mode,
      run.shellLaunchKind,
      String(run.exitCode),
      ms(run.wallClockMs),
      run.outcome,
    ]);
  }
  lines.push(table(runRows));
  lines.push("");
  return lines.join("\n");
}

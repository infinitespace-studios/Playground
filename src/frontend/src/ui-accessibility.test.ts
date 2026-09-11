// Deterministic accessibility / type-scale / contrast tests for the Workbench
// shell (issue 061). These run under `node --test` with no DOM: they read the
// shipped `style.css`, `index.html`, and `monaco-editor.ts` as text and assert
// the readability invariants the issue requires, so a regression (a reintroduced
// sub-12px literal, a failing small-text contrast pair, a duplicate id, or a
// downgraded editor font) fails CI rather than only being caught by manual GUI
// inspection.
//
// The WCAG 2.2 relative-luminance / contrast formulas are implemented inline so
// the test has zero dependencies. Backgrounds that are literals in the CSS
// (e.g. the drawer #0f1313) are named explicitly here; theme foreground colours
// are parsed from the CSS custom properties so the test tracks the real values.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, "style.css");
const htmlPath = join(here, "..", "index.html");
const monacoPath = join(here, "monaco-editor.ts");

const css = readFileSync(cssPath, "utf8");
const html = readFileSync(htmlPath, "utf8");
const monaco = readFileSync(monacoPath, "utf8");

// ---------------------------------------------------------------------------
// WCAG contrast helpers
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function relativeLuminance(hex: string): number {
  const chan = hexToRgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}
function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// CSS custom-property parsing (per theme block)
// ---------------------------------------------------------------------------
function extractBlock(source: string, selector: string): string {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `Expected to find selector "${selector}" in style.css`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}
function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1].trim()] = m[2].trim();
  }
  return vars;
}

const darkVars = parseVars(extractBlock(css, ":root {"));
const lightVars = parseVars(extractBlock(css, 'body[data-theme="light"] {'));

// ---------------------------------------------------------------------------
// Type scale: every named UI/status size >= 12px, editor >= 14px.
// ---------------------------------------------------------------------------
function px(value: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(value);
  assert.ok(m, `Expected a px value, got "${value}"`);
  return Number(m![1]);
}

test("type scale defines named font-size variables (no scattered literals)", () => {
  for (const name of ["--fs-caption", "--fs-control", "--fs-body", "--fs-editor"]) {
    assert.ok(darkVars[name], `Missing type-scale variable ${name}`);
  }
});

test("interactive/control/status/body tiers compute to at least 12px", () => {
  for (const name of ["--fs-caption", "--fs-control", "--fs-body"]) {
    assert.ok(
      px(darkVars[name]) >= 12,
      `${name} must be >= 12px, got ${darkVars[name]}`,
    );
  }
});

test("editor tier is at least 14px", () => {
  assert.ok(px(darkVars["--fs-editor"]) >= 14, `--fs-editor must be >= 14px, got ${darkVars["--fs-editor"]}`);
});

test("Monaco editor default fontSize is at least 14", () => {
  const m = /fontSize:\s*(\d+)/.exec(monaco);
  assert.ok(m, "Could not find Monaco fontSize option");
  assert.ok(Number(m![1]) >= 14, `Monaco fontSize must be >= 14, got ${m![1]}`);
});

test("no visible font shorthand smaller than 12px remains in style.css", () => {
  // Match `font:` shorthands with a raw px size (not a var). Allow decorative
  // non-text glyph sizes >= 12. The only bare literal sizes permitted are the
  // large brand fallback (14px at the 600px breakpoint) and the 22px first-run
  // marker glyph — both well above the floor.
  const offenders: string[] = [];
  for (const m of css.matchAll(/font(?:-size)?:\s*[^;]*?(\d+(?:\.\d+)?)px/g)) {
    const size = Number(m[1]);
    if (size < 12) offenders.push(m[0].trim());
  }
  assert.deepEqual(offenders, [], `Found sub-12px font literals: ${offenders.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// Contrast: small-text foreground/background pairs meet WCAG 2.2 AA (4.5:1).
// Backgrounds that are literals in the CSS are named here explicitly.
// ---------------------------------------------------------------------------
const AA_NORMAL = 4.5;

interface Pair { name: string; fg: string; bg: string; }

function pairs(vars: Record<string, string>, bgs: Record<string, string>): Pair[] {
  return [
    { name: "muted text on lightest surface", fg: vars["--muted"], bg: bgs.lightestSurface },
    { name: "muted text on base bg", fg: vars["--muted"], bg: vars["--bg"] },
    { name: "primary text on base bg", fg: vars["--text"], bg: vars["--bg"] },
    { name: "accent text on tab-active surface", fg: vars["--accent-text"], bg: bgs.tabActive },
    { name: "log-time on drawer", fg: vars["--log-time"], bg: bgs.drawer },
    { name: "green cue on base bg", fg: vars["--green"], bg: vars["--bg"] },
    { name: "red cue on drawer", fg: vars["--red"], bg: bgs.drawer },
    { name: "runtime-error heading on error surface", fg: vars["--red"], bg: bgs.runtimeError },
    { name: "runtime-error frames on error surface", fg: vars["--muted"], bg: bgs.runtimeError },
  ];
}

test("dark theme: small-text pairs meet WCAG AA (4.5:1)", () => {
  const bgs = {
    lightestSurface: darkVars["--panel2"],
    tabActive: darkVars["--panel2"],
    drawer: "#0f1313",
    runtimeError: darkVars["--runtime-error-bg"],
  };
  for (const p of pairs(darkVars, bgs)) {
    const r = contrastRatio(p.fg, p.bg);
    assert.ok(r >= AA_NORMAL, `DARK ${p.name}: ${p.fg} on ${p.bg} = ${r.toFixed(2)}:1 (< ${AA_NORMAL})`);
  }
});

test("light theme: small-text pairs meet WCAG AA (4.5:1)", () => {
  // In the light theme the drawer and tab-active are literal colours.
  const bgs = {
    lightestSurface: "#f5f4ed",
    tabActive: "#d6d6cc",
    drawer: "#f5f4ed",
    runtimeError: lightVars["--runtime-error-bg"],
  };
  for (const p of pairs(lightVars, bgs)) {
    const r = contrastRatio(p.fg, p.bg);
    assert.ok(r >= AA_NORMAL, `LIGHT ${p.name}: ${p.fg} on ${p.bg} = ${r.toFixed(2)}:1 (< ${AA_NORMAL})`);
  }
});

test("primary control ink meets AA on the amber fill in both themes", () => {
  // Both themes render the primary Run/confirm control as dark ink on amber.
  const darkAmber = darkVars["--amber"];
  const lightAmber = lightVars["--amber"];
  assert.ok(contrastRatio("#10130d", darkAmber) >= AA_NORMAL, "dark primary ink on amber fails AA");
  assert.ok(contrastRatio("#10130d", lightAmber) >= AA_NORMAL, "light primary ink on amber fails AA");
});

// ---------------------------------------------------------------------------
// Structural defects: valid, unique ids; forced-colors handling present.
// ---------------------------------------------------------------------------
test("index.html has no duplicate id attributes", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  assert.deepEqual([...dupes], [], `Duplicate ids in index.html: ${[...dupes].join(", ")}`);
});

test("style.css includes a forced-colors (high-contrast) block", () => {
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/, "Missing forced-colors media query");
});

test("reduced-motion handling is preserved", () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, "Missing reduced-motion media query");
});

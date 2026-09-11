// Deterministic unit + static tests for issue 062: one bounded,
// keyboard-accessible, persisted application scale.
//
// These run under `node --test` with no DOM. The pure logic (parse/serialize/
// step/derive + safe persistence with an injectable store) is exercised
// directly; the DOM/Monaco wiring is asserted statically by reading the source
// files as text (global capture shortcuts registered with no Alt, no visible
// scale chrome, Monaco scaled + relaid-out from the single preference, early
// application wired before the app, CSS scale levels bounded). A regression — a
// lost shortcut, a reintroduced button, an unbounded level, a missing
// malformed-value fallback, or a dropped no-flash early apply — fails CI rather
// than only being caught by manual GUI inspection.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  APP_SCALE_LEVELS,
  APP_SCALE_DEFAULT,
  MONACO_BASE_FONT_SIZE,
  APP_SCALE_STORAGE_KEY,
  SCALE_SCHEMA_VERSION,
  isValidAppScaleLevel,
  parseAppScale,
  serializeAppScale,
  stepAppScaleLevel,
  monacoFontSizeForScale,
  readPersistedAppScale,
  persistAppScale,
  applyAppScaleToDocument,
  getDefaultStorage,
  type AppScaleLevel,
} from "./scaling-controller.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), "utf8");
const readRoot = (rel: string): string => readFileSync(join(here, "..", rel), "utf8");

// ---------------------------------------------------------------------------
// Bounded domain
// ---------------------------------------------------------------------------
test("application scale offers at least three bounded levels; default is the minimum", () => {
  assert.ok(APP_SCALE_LEVELS.length >= 3, "need >= 3 discrete application-scale levels");
  assert.equal(APP_SCALE_LEVELS[0], APP_SCALE_DEFAULT, "first level is the default");
  assert.equal(APP_SCALE_DEFAULT, 100, "default application scale is 100% (issue 061 readable default)");
  // Bounded: monotonically increasing, no arbitrary/unbounded zoom.
  for (let i = 1; i < APP_SCALE_LEVELS.length; i++) {
    assert.ok(APP_SCALE_LEVELS[i] > APP_SCALE_LEVELS[i - 1], "levels strictly increase");
  }
  // The default is the minimum: there is no level below the readable default.
  for (const level of APP_SCALE_LEVELS) {
    assert.ok(level >= APP_SCALE_DEFAULT, "no level below the readable default/minimum");
  }
});

test("Monaco base font size preserves issue 061's >=14px floor", () => {
  assert.ok(MONACO_BASE_FONT_SIZE >= 14, "Monaco base font >= 14");
  // The minimum scale (100%) yields the readable floor; higher levels grow it.
  assert.equal(monacoFontSizeForScale(APP_SCALE_DEFAULT), MONACO_BASE_FONT_SIZE);
  const max = APP_SCALE_LEVELS[APP_SCALE_LEVELS.length - 1];
  assert.ok(monacoFontSizeForScale(max) > MONACO_BASE_FONT_SIZE, "max scale enlarges Monaco");
});

test("monacoFontSizeForScale scales the base proportionally and rounds", () => {
  assert.equal(monacoFontSizeForScale(100 as AppScaleLevel), 14);
  assert.equal(monacoFontSizeForScale(115 as AppScaleLevel), 16); // round(16.1)
  assert.equal(monacoFontSizeForScale(130 as AppScaleLevel), 18); // round(18.2)
});

// ---------------------------------------------------------------------------
// Parse / serialize / round-trip / malformed fallback
// ---------------------------------------------------------------------------
test("application scale round-trips through the versioned envelope", () => {
  for (const level of APP_SCALE_LEVELS) {
    const raw = serializeAppScale(level);
    assert.match(raw, new RegExp(`"v":${SCALE_SCHEMA_VERSION}`), "envelope carries schema version");
    assert.equal(parseAppScale(raw), level);
  }
});

test("application scale parse falls back safely for every malformed input", () => {
  const bad = [
    null,
    "",
    "not json",
    "{",
    "42",
    "[100]",
    JSON.stringify({ level: 115 }), // missing version
    JSON.stringify({ v: SCALE_SCHEMA_VERSION + 1, level: 115 }), // wrong version
    JSON.stringify({ v: SCALE_SCHEMA_VERSION, level: 999 }), // out of set
    JSON.stringify({ v: SCALE_SCHEMA_VERSION, level: 85 }), // below the minimum
    JSON.stringify({ v: SCALE_SCHEMA_VERSION, level: "115" }), // wrong type
    JSON.stringify({ v: SCALE_SCHEMA_VERSION }), // missing level
  ];
  for (const raw of bad) {
    assert.equal(parseAppScale(raw), APP_SCALE_DEFAULT, `malformed input should fall back: ${raw}`);
  }
});

test("isValidAppScaleLevel accepts only the bounded set", () => {
  assert.ok(isValidAppScaleLevel(100));
  assert.ok(!isValidAppScaleLevel(140));
  assert.ok(!isValidAppScaleLevel(85)); // below the minimum
  assert.ok(!isValidAppScaleLevel("100"));
  assert.ok(!isValidAppScaleLevel(NaN));
});

test("stepAppScaleLevel is clamped at both ends", () => {
  const min = APP_SCALE_LEVELS[0];
  const max = APP_SCALE_LEVELS[APP_SCALE_LEVELS.length - 1];
  assert.equal(stepAppScaleLevel(min, -1), min, "cannot go below the minimum/default");
  assert.equal(stepAppScaleLevel(max, 1), max, "cannot exceed the maximum");
  assert.equal(stepAppScaleLevel(min, 1), APP_SCALE_LEVELS[1], "steps up one level");
  assert.equal(stepAppScaleLevel(max, -1), APP_SCALE_LEVELS[APP_SCALE_LEVELS.length - 2]);
});

// ---------------------------------------------------------------------------
// Safe persistence with an injectable store (no localStorage in node --test)
// ---------------------------------------------------------------------------
function makeStore(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

test("persist + read round-trip for application scale through an injected store", () => {
  const store = makeStore();
  persistAppScale(130, store);
  assert.equal(store.map.get(APP_SCALE_STORAGE_KEY), serializeAppScale(130));
  assert.equal(readPersistedAppScale(store), 130);
});

test("a throwing/hostile store never throws and falls back to defaults", () => {
  const hostile = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.doesNotThrow(() => persistAppScale(115, hostile));
  assert.equal(readPersistedAppScale(hostile), APP_SCALE_DEFAULT);
});

// Default-store ACQUISITION itself must be safe: reading `globalThis`'s
// `localStorage` can throw (SecurityError when storage is blocked) or be absent
// (non-browser host). getDefaultStorage() guards that access, and the default
// parameter routes through it, so the public read/persist helpers never throw
// even when called with no explicit store in a hostile/absent environment.
function withGlobalLocalStorage<T>(descriptor: PropertyDescriptor | "delete", body: () => T): T {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const original = had
    ? Object.getOwnPropertyDescriptor(globalThis, "localStorage")
    : undefined;
  try {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    if (descriptor !== "delete") {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    }
    return body();
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    if (had && original) Object.defineProperty(globalThis, "localStorage", original);
  }
}

test("getDefaultStorage returns null when localStorage is absent", () => {
  withGlobalLocalStorage("delete", () => {
    assert.equal(getDefaultStorage(), null, "absent storage acquires as null");
  });
});

test("getDefaultStorage returns null when localStorage access throws", () => {
  withGlobalLocalStorage(
    { configurable: true, get() { throw new Error("SecurityError: storage blocked"); } },
    () => {
      assert.doesNotThrow(() => getDefaultStorage(), "throwing acquisition must not propagate");
      assert.equal(getDefaultStorage(), null, "throwing acquisition acquires as null");
    },
  );
});

test("default-store read/persist never throw when acquisition is absent", () => {
  withGlobalLocalStorage("delete", () => {
    assert.doesNotThrow(() => persistAppScale(115));
    assert.equal(readPersistedAppScale(), APP_SCALE_DEFAULT);
  });
});

test("default-store read/persist never throw when acquisition throws", () => {
  withGlobalLocalStorage(
    { configurable: true, get() { throw new Error("SecurityError: storage blocked"); } },
    () => {
      assert.doesNotThrow(() => persistAppScale(130));
      assert.equal(readPersistedAppScale(), APP_SCALE_DEFAULT);
    },
  );
});

test("getDefaultStorage returns the store when localStorage is present and usable", () => {
  const backing = makeStore();
  withGlobalLocalStorage(
    { configurable: true, value: backing, writable: true },
    () => {
      assert.equal(getDefaultStorage(), backing, "present storage is acquired");
      persistAppScale(130);
      assert.equal(readPersistedAppScale(), 130, "default store persists + reads back");
    },
  );
});

test("corrupt persisted values are ignored on read", () => {
  const store = makeStore({
    [APP_SCALE_STORAGE_KEY]: "{{{",
  });
  assert.equal(readPersistedAppScale(store), APP_SCALE_DEFAULT);
});

// ---------------------------------------------------------------------------
// applyAppScaleToDocument: attribute reflects level; default clears it
// ---------------------------------------------------------------------------
test("applyAppScaleToDocument sets data-app-scale for non-default and clears at default", () => {
  const fake = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
  applyAppScaleToDocument(130 as AppScaleLevel, fake);
  assert.equal(fake.dataset.appScale, "130");
  applyAppScaleToDocument(APP_SCALE_DEFAULT, fake);
  assert.equal(fake.dataset.appScale, undefined, "default level clears the attribute");
});

// ---------------------------------------------------------------------------
// Static wiring assertions (source-as-text)
// ---------------------------------------------------------------------------
test("CSS defines a bounded --ui-scale multiplier driven by data-app-scale", () => {
  const css = read("style.css");
  assert.match(css, /--ui-scale:\s*1;/, "base --ui-scale defaults to 1 (100%)");
  assert.match(css, /--fs-caption:\s*calc\(12px \* var\(--ui-scale\)\)/, "caption tier scales");
  assert.match(css, /--fs-editor:\s*calc\(14px \* var\(--ui-scale\)\)/, "editor tier scales");
  // Each non-default level is a bounded override on <html>.
  for (const level of APP_SCALE_LEVELS.slice(1)) {
    assert.match(css, new RegExp(`html\\[data-app-scale="${level}"\\]`), `level ${level} is defined`);
  }
});

test("no visible font-size / zoom / scale button chrome remains", () => {
  // The product owner rejected on-screen scaling buttons; scaling is keyboard
  // only. Assert the removed control ids, classes, and group markup are gone
  // from every visible surface so a reintroduced button fails CI.
  const html = readRoot("index.html");
  const css = read("style.css");
  for (const remnant of [
    "ui-scale-increase", "ui-scale-decrease", "ui-scale-reset", "ui-scale-value",
    "editor-font-increase", "editor-font-decrease", "editor-font-reset", "editor-font-value",
    "scale-group", "scale-btn", "scale-value",
  ]) {
    assert.doesNotMatch(html, new RegExp(remnant), `index.html must not reference "${remnant}"`);
    assert.doesNotMatch(css, new RegExp(`\\.${remnant}\\b`), `style.css must not style ".${remnant}"`);
  }
});

test("no obsolete independent editor-font storage/API remains", () => {
  // The two-preference design (a separate editor font size) was collapsed into
  // one application scale. Assert the removed symbols/keys are gone so obsolete
  // storage/actions cannot silently return.
  const controller = read("scaling-controller.ts");
  const monacoSrc = read("monaco-editor.ts");
  for (const gone of [
    "EDITOR_FONT", "editor-font-size", "editor.increaseFontSize",
    "editor.decreaseFontSize", "editor.resetFontSize", "readPersistedEditorFontSize",
    "persistEditorFontSize", "installFontSizeControls", "UI_SCALE_",
  ]) {
    assert.doesNotMatch(controller, new RegExp(gone), `scaling-controller must not reference "${gone}"`);
    assert.doesNotMatch(monacoSrc, new RegExp(gone), `monaco-editor must not reference "${gone}"`);
  }
  // Exactly one persisted key remains.
  assert.match(controller, /APP_SCALE_STORAGE_KEY = "workbench-app-scale"/, "single scale storage key");
});

test("Monaco is scaled from the single preference and relaid-out preserving selection", () => {
  const src = read("monaco-editor.ts");
  assert.match(src, /monacoFontSizeForScale\(readPersistedAppScale\(\)\)/, "mounts at scale-derived font size (no flash)");
  assert.match(src, /fontSize:\s*initialFontSize/, "create-time font size from persisted scale");
  assert.match(src, /applyScale:\s*\(level: AppScaleLevel\)/, "exposes applyScale for scale changes");
  assert.match(src, /updateOptions\(\{\s*fontSize: monacoFontSizeForScale\(level\)/, "font size applied via public options API");
  assert.match(src, /getSelections\(\)/, "captures selections before relayout");
  assert.match(src, /setSelections\(/, "restores selections after relayout");
  assert.match(src, /\.layout\(\)/, "re-layouts Monaco");
});

test("app wires the single scale controller to scale Monaco on change", () => {
  const app = read("app.ts");
  assert.match(app, /installAppScaleControls\(\{\s*onChange: level => editor\.applyScale\(level\)/, "onChange scales Monaco from the same preference");
});

test("application-scale controller registers conventional global shortcuts with no Alt", () => {
  const src = read("scaling-controller.ts");
  // Uses the primary command modifier and explicitly NOT Alt.
  assert.match(src, /event\.ctrlKey \|\| event\.metaKey/, "uses the command modifier");
  assert.match(src, /event\.altKey/, "references Alt");
  assert.match(src, /\|\| event\.altKey\) return/, "requires NOT Alt (returns when Alt held)");
  // Matches on the physical key (`event.code`), not the locale/layout-dependent
  // `event.key`, so the shortcuts survive non-US layouts.
  assert.match(src, /switch \(event\.code\)/, "keys off event.code, not event.key");
  assert.doesNotMatch(src, /switch \(event\.key\)/, "must not key off locale-sensitive event.key");
  assert.match(src, /case "Equal":/, "increase bound to the Equal physical key");
  assert.match(src, /case "Minus":/, "decrease bound to the Minus physical key");
  assert.match(src, /case "Digit0":/, "reset bound to the Digit0 physical key");
  // Attached at the window in the CAPTURE phase so it runs before Monaco's
  // keybinding service — the shortcut works with focus inside Monaco.
  assert.match(src, /window\.addEventListener\(\s*"keydown"/, "listens at the window");
  assert.match(src, /\/\/ Capture phase[\s\S]*?\n\s*true,\n\s*\);/, "registered in the capture phase");
  assert.match(src, /controls\.increase\(\)/);
  assert.match(src, /controls\.decrease\(\)/);
  assert.match(src, /controls\.reset\(\)/);
});

test("early application-scale application is imported before the app in both entries", () => {
  for (const entryName of ["entry.product.ts", "entry.proof.ts"]) {
    const entry = read(entryName);
    const earlyIdx = entry.indexOf('"./scaling-early"');
    const appIdx = entry.indexOf('"./app"');
    assert.ok(earlyIdx !== -1, `${entryName} imports scaling-early`);
    assert.ok(appIdx !== -1, `${entryName} imports app`);
    assert.ok(earlyIdx < appIdx, `scaling-early must be imported before app in ${entryName} (no flash)`);
  }
  const early = read("scaling-early.ts");
  assert.match(early, /applyPersistedAppScaleEarly\(\)/, "early module applies persisted scale");
});

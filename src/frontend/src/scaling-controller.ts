// Scaling controller — one persisted, bounded, keyboard-accessible application
// scale (issue 062).
//
// A single preference is managed here: a whole-application scale multiplier.
// The same bounded level drives BOTH:
//
//   1. Workbench typography — applied as a `--ui-scale` multiplier over the CSS
//      type scale (via `data-app-scale` on the document root; see style.css).
//   2. The Monaco editor font size — derived from the same level and applied
//      through Monaco's public options API so its layout and cursor/selection
//      rendering stay correct.
//
// The scale has a small set of discrete, bounded levels (100 / 115 / 130 %).
// The minimum, 100 %, is issue 061's readable default; there is no smaller
// level (the readable default is the floor) and no arbitrary/unbounded zoom (a
// bounded maximum keeps every supported responsive width usable).
//
// The preference persists locally using a *versioned, validated* envelope.
// Malformed, out-of-range, wrong-version, or unparseable persisted values are
// ignored and fall back to the safe default; a bad value never throws and never
// leaves the UI at an unreadable size.
//
// Pure logic (parse/serialize/step/derive) is exported separately from the DOM
// wiring so it can be unit-tested with no DOM (see scaling.test.ts).

// ---------------------------------------------------------------------------
// Bounded domain
// ---------------------------------------------------------------------------

/** Discrete application-scale levels (percent). The first entry is the default
 *  and the minimum supported level — issue 061's readable default. */
export const APP_SCALE_LEVELS = [100, 115, 130] as const;
export type AppScaleLevel = (typeof APP_SCALE_LEVELS)[number];
export const APP_SCALE_DEFAULT: AppScaleLevel = 100;

/** Monaco base font size (px) at 100 % — issue 061's readable >=14px floor. */
export const MONACO_BASE_FONT_SIZE = 14;

/** localStorage key for the single application-scale preference. */
export const APP_SCALE_STORAGE_KEY = "workbench-app-scale";

/** Persisted schema version. Bumping this invalidates old payloads safely. */
export const SCALE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Pure validation / (de)serialization / derivation
// ---------------------------------------------------------------------------

/** True when `value` is one of the discrete bounded application-scale levels. */
export function isValidAppScaleLevel(value: unknown): value is AppScaleLevel {
  return typeof value === "number" && (APP_SCALE_LEVELS as readonly number[]).includes(value);
}

/**
 * Parse a persisted application-scale envelope. Returns the stored level only
 * when the payload is a versioned object of the current schema carrying a valid
 * bounded level; anything else (null, malformed JSON, wrong version,
 * out-of-range level, wrong shape) falls back to the default.
 */
export function parseAppScale(raw: string | null): AppScaleLevel {
  if (raw === null) return APP_SCALE_DEFAULT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return APP_SCALE_DEFAULT;
  }
  if (typeof parsed !== "object" || parsed === null) return APP_SCALE_DEFAULT;
  const record = parsed as Record<string, unknown>;
  if (record.v !== SCALE_SCHEMA_VERSION) return APP_SCALE_DEFAULT;
  if (!isValidAppScaleLevel(record.level)) return APP_SCALE_DEFAULT;
  return record.level;
}

/** Serialize an application-scale level into the versioned persisted envelope. */
export function serializeAppScale(level: AppScaleLevel): string {
  return JSON.stringify({ v: SCALE_SCHEMA_VERSION, level });
}

/** Step the scale level up/down within its bounded set (clamped at both ends). */
export function stepAppScaleLevel(level: AppScaleLevel, direction: 1 | -1): AppScaleLevel {
  const index = APP_SCALE_LEVELS.indexOf(level);
  const base = index === -1 ? APP_SCALE_LEVELS.indexOf(APP_SCALE_DEFAULT) : index;
  const next = Math.min(APP_SCALE_LEVELS.length - 1, Math.max(0, base + direction));
  return APP_SCALE_LEVELS[next];
}

/**
 * Derive the Monaco editor font size (px) for a scale level from the same
 * bounded preference that drives the Workbench typography. At 100 % this is the
 * readable base (14 px); higher levels scale proportionally and round to a whole
 * pixel so the interface text and the editor grow together.
 */
export function monacoFontSizeForScale(level: AppScaleLevel): number {
  return Math.round((MONACO_BASE_FONT_SIZE * level) / 100);
}

// ---------------------------------------------------------------------------
// Safe persistence (never throws; a hostile/unavailable store is tolerated)
// ---------------------------------------------------------------------------

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Safely acquire the default persistence store. Accessing `globalThis`'s
 * `localStorage` can itself throw (e.g. a `SecurityError` when cookies/storage
 * are blocked) or be absent entirely (non-browser hosts). A default parameter
 * such as `store: StorageLike = localStorage` would evaluate that access at call
 * time — BEFORE the body's try/catch — and so could throw before `safeGet`/
 * `safeSet` ever run. Resolving the store through this guarded accessor instead
 * keeps acquisition genuinely safe: it returns `null` when storage is missing or
 * throws, and callers treat a `null` store as "unavailable" (falling back to the
 * default value; writes become no-ops).
 */
export function getDefaultStorage(): StorageLike | null {
  try {
    const candidate = (globalThis as { localStorage?: StorageLike }).localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

function safeGet(store: StorageLike | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: StorageLike | null, key: string, value: string): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    /* storage unavailable / quota — the in-memory value still applies */
  }
}

/** Read the persisted application-scale level, falling back safely. */
export function readPersistedAppScale(store: StorageLike | null = getDefaultStorage()): AppScaleLevel {
  return parseAppScale(safeGet(store, APP_SCALE_STORAGE_KEY));
}

/** Persist an application-scale level using the versioned envelope. */
export function persistAppScale(level: AppScaleLevel, store: StorageLike | null = getDefaultStorage()): void {
  safeSet(store, APP_SCALE_STORAGE_KEY, serializeAppScale(level));
}

// ---------------------------------------------------------------------------
// DOM application
// ---------------------------------------------------------------------------

/**
 * Apply an application-scale level to the document root by setting
 * `data-app-scale`, which style.css maps to a `--ui-scale` multiplier over the
 * type scale. Level 100 is the unscaled default and clears the attribute so
 * nothing is scaled.
 */
export function applyAppScaleToDocument(
  level: AppScaleLevel,
  root: HTMLElement = document.documentElement,
): void {
  if (level === APP_SCALE_DEFAULT) {
    delete root.dataset.appScale;
  } else {
    root.dataset.appScale = String(level);
  }
}

/**
 * Early application-scale application. Imported by both entries BEFORE the app
 * (which mounts Monaco) so the persisted scale is on the document root before
 * first paint — the interface never flashes at the wrong size then snaps.
 * Returns the level applied.
 */
export function applyPersistedAppScaleEarly(): AppScaleLevel {
  const level = readPersistedAppScale();
  applyAppScaleToDocument(level);
  return level;
}

// ---------------------------------------------------------------------------
// Application-scale controls (global keyboard shortcuts, no visible chrome)
// ---------------------------------------------------------------------------

export interface AppScaleControls {
  /** Current bounded level. */
  getLevel(): AppScaleLevel;
  /** Set an explicit bounded level (invalid input is ignored). */
  setLevel(level: number): void;
  /** Step up one bounded level. */
  increase(): void;
  /** Step down one bounded level. */
  decrease(): void;
  /** Reset to the default/minimum (100 %). */
  reset(): void;
}

export interface InstallAppScaleOptions {
  /** Called after every applied change (e.g. to scale + re-layout Monaco). */
  onChange?: (level: AppScaleLevel) => void;
}

/**
 * Wire the conventional global application-scale keyboard shortcuts and apply
 * the persisted level.
 *
 * Shortcuts (no visible chrome — the product owner rejected on-screen buttons):
 *   - `Cmd/Ctrl` + `Plus`  (`=` / numpad `+`) → increase
 *   - `Cmd/Ctrl` + `Minus` (`-` / numpad `-`) → decrease
 *   - `Cmd/Ctrl` + `0`     (`0` / numpad `0`) → reset
 *
 * The listener is attached at the WINDOW in the CAPTURE phase so it runs before
 * Monaco's own keybinding service, guaranteeing the shortcuts fire regardless of
 * whether focus is inside Monaco or the surrounding Workbench. Matching is on
 * the physical key (`event.code`), not the locale/layout-dependent `event.key`,
 * so the shortcuts survive non-US layouts. There is deliberately NO Alt
 * modifier — these are the standard application-zoom chords.
 */
export function installAppScaleControls(options: InstallAppScaleOptions = {}): AppScaleControls {
  let level: AppScaleLevel = readPersistedAppScale();
  applyAppScaleToDocument(level);

  const apply = (next: AppScaleLevel): void => {
    if (next === level) return;
    level = next;
    applyAppScaleToDocument(level);
    persistAppScale(level);
    options.onChange?.(level);
  };

  const controls: AppScaleControls = {
    getLevel: () => level,
    setLevel: next => {
      if (isValidAppScaleLevel(next)) apply(next);
    },
    increase: () => apply(stepAppScaleLevel(level, 1)),
    decrease: () => apply(stepAppScaleLevel(level, -1)),
    reset: () => apply(APP_SCALE_DEFAULT),
  };

  window.addEventListener(
    "keydown",
    event => {
      // Require the primary command modifier (Ctrl on Windows/Linux, Cmd on
      // macOS) and explicitly NOT Alt, matching the conventional zoom chords.
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      switch (event.code) {
        // `Equal` covers Ctrl/Cmd + `=` and Ctrl/Cmd + Shift + `=` (i.e. "+").
        case "Equal":
        case "NumpadAdd":
          event.preventDefault();
          event.stopPropagation();
          controls.increase();
          break;
        case "Minus":
        case "NumpadSubtract":
          event.preventDefault();
          event.stopPropagation();
          controls.decrease();
          break;
        case "Digit0":
        case "Numpad0":
          event.preventDefault();
          event.stopPropagation();
          controls.reset();
          break;
        default:
          break;
      }
    },
    // Capture phase: run before Monaco's editor keybinding handling so the
    // shortcut works even when the editor has focus.
    true,
  );

  return controls;
}

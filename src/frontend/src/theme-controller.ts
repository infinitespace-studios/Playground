// Theme controller — persistent dark/light Workbench themes + accessibility.
// (Formerly issue46.ts.)
//
// Applies a CSS variable theme set (dark or light) to <body data-theme>.
// - On first launch with no persisted choice, reads `prefers-color-scheme`.
// - Once the user toggles, the explicit choice persists in localStorage
//   and is always respected on subsequent launches (never overridden by OS
//   preference changes).
//
// All interactive elements already carry non-color cues:
//   • Run/Stop buttons: icon + label text (▶ Run / ■ Stop)
//   • Status lamp: animated glow + color shift (green on dark)
//   • Tab selection: amber text + different background color
//   • Diagnostic severity: bold label (WARNING / ERROR / INFO)
//   • Focus ring: solid outline (4px solid) — see style.css

const THEME_STORAGE_KEY = "workbench-theme";

/**
 * Resolve the initial theme.
 * Returns "dark" or "light".
 */
function resolveInitialTheme(): "dark" | "light" {
  // 1. Check persisted user choice first
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* localStorage unavailable — fall through */
  }

  // 2. Fall back to OS preference
  const prefersDark =
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

/** Persist a user choice of theme. */
function persistTheme(theme: "dark" | "light"): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* localStorage unavailable — silently ignore */
  }
}

/**
 * Initialize the theme system and wire up the toggle button.
 * Must be called after the DOM is fully parsed.
 */
export function initTheme(): void {
  const initial = resolveInitialTheme();
  document.body.dataset.theme = initial;

  const toggleBtn = document.querySelector<HTMLButtonElement>(
    '[data-theme-toggle]',
  );
  if (!toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    const current = document.body.dataset.theme;
    const next: "dark" | "light" =
      current === "light" ? "dark" : "light";
    document.body.dataset.theme = next;
    persistTheme(next);
  });
}

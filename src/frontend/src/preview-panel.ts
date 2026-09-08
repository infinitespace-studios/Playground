// Embedded preview panel — focus/input routing + status indicator.
// (Formerly issue052.ts.)
//
// Now that the live Run renders in the in-page opaque-origin sandboxed iframe
// (issue 052 task 1), this module wires the two preview-panel UX requirements
// from PRD 14.4:
//
//  1. Focus/input routing. Keyboard input must reach the running game ONLY when
//     the preview has focus, and reach Monaco ONLY when the editor has focus —
//     with no leakage in either direction. The sandboxed iframe gives us the
//     ISOLATION for free: it is a separate document/browsing context, so key
//     events dispatched while it is focused never surface in the parent, and
//     key events typed into Monaco (parent document) are never observed by the
//     preview's `Keyboard.GetState()`. What we must add is correct ROUTING:
//     clicking/tabbing the preview transfers focus INTO the iframe
//     (`iframe.contentWindow.focus()` — one of the few cross-origin-permitted
//     window methods, allowed even without `allow-same-origin`), and clicking
//     Monaco returns focus there (Monaco does this natively).
//
//  2. Status indicator. A visible preview status cycling loading/running/
//     stopped/error, each with a NON-COLOR cue (icon glyph + text label), driven
//     by the run/stop controller lifecycle (issue 24) via its additive
//     `onLifecycle` hook.

import type { Issue052PreviewLifecycle } from "./lifecycle-controller";

const STATUS_PRESENTATION: Record<
  Issue052PreviewLifecycle | "idle",
  { glyph: string; label: string; state: string }
> = {
  idle: { glyph: "○", label: "Idle", state: "idle" },
  loading: { glyph: "◐", label: "Loading…", state: "loading" },
  running: { glyph: "▶", label: "Running", state: "running" },
  stopped: { glyph: "■", label: "Stopped", state: "stopped" },
  error: { glyph: "✕", label: "Error", state: "error" },
};

/**
 * Find the currently-mounted live preview iframe (created by the in-page
 * runners with class `live-preview-frame`), or null when no preview is running.
 */
function livePreviewFrame(host: HTMLElement): HTMLIFrameElement | null {
  return host.querySelector<HTMLIFrameElement>("iframe.live-preview-frame");
}

/**
 * Route keyboard focus into the running preview: focus the opaque-origin iframe
 * so its document (and MonoGame's `Keyboard`/window listeners) receive key
 * events. Safe no-op when no preview is mounted. `contentWindow.focus()` is
 * permitted cross-origin, so it works despite the sandbox omitting
 * `allow-same-origin`.
 */
function focusPreview(host: HTMLElement): void {
  const frame = livePreviewFrame(host);
  if (!frame) return;
  try {
    frame.focus();
    frame.contentWindow?.focus();
  } catch {
    /* focus is best-effort; never break the click */
  }
}

/** Create + insert the preview status indicator into the preview panel header. */
function installStatusIndicator(): (state: Issue052PreviewLifecycle) => void {
  const head = document.querySelector<HTMLElement>(".preview .panel-head");
  if (!head) throw new Error("Issue 052 preview panel header (.preview .panel-head) is missing.");

  const indicator = document.createElement("span");
  indicator.id = "preview-status-indicator";
  indicator.className = "preview-status";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");

  const glyph = document.createElement("span");
  glyph.className = "preview-status-glyph";
  glyph.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "preview-status-label";
  indicator.append(glyph, label);

  const apply = (key: Issue052PreviewLifecycle | "idle") => {
    const presentation = STATUS_PRESENTATION[key];
    indicator.dataset.state = presentation.state;
    glyph.textContent = presentation.glyph;
    label.textContent = presentation.label;
    // Non-color cue is carried by glyph + label text; state also drives the
    // accessible name so assistive tech announces it without relying on color.
    indicator.setAttribute("aria-label", `Preview ${presentation.label}`);
  };
  apply("idle");

  // Place the indicator at the end of the header (after the WEBGL2 · 60HZ span).
  head.appendChild(indicator);

  return (state: Issue052PreviewLifecycle) => apply(state);
}

/**
 * Install issue 052 preview-panel UX. Returns the `onLifecycle` callback to hand
 * to `installIssue024RunStopControl` so the indicator tracks Run/Stop.
 */
export function installPreviewPanel(): {
  onLifecycle: (state: Issue052PreviewLifecycle) => void;
} {
  const host = document.getElementById("canvas-frame");
  if (!host) throw new Error("Issue 052 preview host (#canvas-frame) is missing.");

  // Make the preview panel keyboard-focusable and route focus into the running
  // preview iframe on click or programmatic focus. `tabindex=0` lets a user Tab
  // to the preview; the focus handler forwards into the iframe.
  host.tabIndex = 0;
  host.setAttribute("aria-label", "Game preview — click to send keyboard input to the running game");
  host.addEventListener("pointerdown", () => focusPreview(host));
  host.addEventListener("focus", () => focusPreview(host));

  const updateStatus = installStatusIndicator();

  return { onLifecycle: updateStatus };
}

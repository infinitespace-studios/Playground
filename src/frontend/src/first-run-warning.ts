// First-run safety-notice gate.
//
// Gates every user-triggered Run behind a persistent acknowledgement of the
// application-level safety notice, stored via Tauri commands in the app-data
// directory (inaccessible to the opaque preview iframe).
//
// Issue 063 made this notice application-level and *versioned* instead of
// per-project. A single acknowledgement of the current notice version
// suppresses the modal for every project. Bumping SAFETY_NOTICE_VERSION shows
// the notice once again. The Rust store migrates the old per-project (schema
// v1) acknowledgement format to an empty v2 store on read, discarding the
// legacy project identities without ever re-exposing them.
//
// The concise default view keeps the disclosure to a short heading and three
// brief sentences; the full defence-in-depth / non-yielding-code explanation
// lives in an expandable Details region so normal local experimentation is not
// interrupted by a wall of text.
//
// This module is production-neutral: no proof markers, no auto-proof entry. The
// two-phase packaged first-run PROOF lives in the Stage-4 scenario suite
// `proof-project-lifecycle.ts`, which re-exports
// `gateFirstRun` / `SAFETY_NOTICE_VERSION` from here.

// Version of the application-level safety notice. Changing this string shows
// the notice once again to every user (the previous acknowledgement no longer
// matches). It is stored as the acknowledgement key, so no project identity is
// persisted.
export const SAFETY_NOTICE_VERSION = "safety-notice-v1";

// --- Acknowledgement store (via Tauri IPC) ---

async function invokeChecked<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error("Tauri IPC is unavailable.");
  return invoke<T>(command, args);
}

export async function isAcknowledged(noticeVersion: string): Promise<boolean> {
  return invokeChecked<boolean>("first_run_check_acknowledgement", { noticeVersion });
}

export async function writeAcknowledgement(noticeVersion: string): Promise<void> {
  await invokeChecked<null>("first_run_write_acknowledgement", { noticeVersion });
}

// --- Modal DOM ---

export function createWarningModal(): {
  element: HTMLElement;
  show: () => Promise<boolean>;
  destroy: () => void;
} {
  const backdrop = document.createElement("div");
  backdrop.className = "first-run-backdrop";
  backdrop.setAttribute("role", "presentation");

  const dialog = document.createElement("div");
  dialog.className = "first-run-dialog";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "first-run-title");
  dialog.setAttribute("aria-describedby", "first-run-desc");

  const marker = document.createElement("div");
  marker.className = "first-run-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "\u26A0";

  const title = document.createElement("h2");
  title.id = "first-run-title";
  title.className = "first-run-title";
  title.textContent = "Before you run";

  // Concise summary: one short heading and three brief sentences. It must not
  // overstate isolation — the app is defence in depth, not a sandbox against
  // deliberately malicious code.
  const desc = document.createElement("p");
  desc.id = "first-run-desc";
  desc.className = "first-run-desc";
  desc.textContent =
    "This app runs your own C# with defence-in-depth protections, not a complete " +
    "sandbox against deliberately malicious code. Code that never yields — such " +
    "as an unbounded loop in Update or Draw — can freeze the preview and editor " +
    "and may require relaunching the app. You will only see this notice again if " +
    "the notice changes.";

  // Expandable Details: the full defence-in-depth / non-yielding explanation,
  // collapsed by default so it does not interrupt normal experimentation.
  const details = document.createElement("details");
  details.className = "first-run-details";

  const summary = document.createElement("summary");
  summary.className = "first-run-summary";
  summary.textContent = "Details";
  details.appendChild(summary);

  const detailBody = document.createElement("div");
  detailBody.className = "first-run-details-body";

  const p1 = document.createElement("p");
  p1.textContent =
    "The preview runs in an opaque-origin sandboxed iframe under a strict " +
    "content-security policy, with no Tauri IPC, no project filesystem access, " +
    "and no host navigation or arbitrary network access. These layers are " +
    "defence in depth: they reduce accidental or opportunistic access to " +
    "desktop privileges, but they are not a guarantee of isolation against " +
    "code written to be hostile.";

  const p2 = document.createElement("p");
  p2.textContent =
    "Your game callbacks run cooperatively on the Workbench's single UI thread. " +
    "Finite loops are fully supported. Synchronous code that never returns " +
    "control — an unbounded loop in the constructor, LoadContent, Update, or " +
    "Draw — cannot be stopped once it holds that thread, because the Stop " +
    "button and unsaved-change prompts cannot run. Recovering may require " +
    "terminating and relaunching the application, and unsaved edits could be " +
    "lost. This notice cannot be made to detect or reject every such program " +
    "before it runs.";

  detailBody.appendChild(p1);
  detailBody.appendChild(p2);
  details.appendChild(detailBody);

  const actions = document.createElement("div");
  actions.className = "first-run-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "first-run-cancel";
  cancelButton.textContent = "Cancel";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "first-run-confirm";
  confirmButton.textContent = "I understand, run";

  actions.appendChild(cancelButton);
  actions.appendChild(confirmButton);
  dialog.appendChild(marker);
  dialog.appendChild(title);
  dialog.appendChild(desc);
  dialog.appendChild(details);
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);

  let resolver: ((confirmed: boolean) => void) | null = null;
  let visible = false;

  function resolve(confirmed: boolean) {
    if (!resolver) return;
    const fn = resolver;
    resolver = null;
    visible = false;
    backdrop.classList.remove("first-run-visible");
    restoreFocus();
    fn(confirmed);
  }

  let previousFocus: Element | null = null;
  function trapFocus() {
    previousFocus = document.activeElement;
    confirmButton.focus();
  }
  function restoreFocus() {
    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus();
    }
  }

  // The tab order includes the expandable Details summary so keyboard users can
  // reach the full explanation without leaving the trap.
  function focusOrder(): HTMLElement[] {
    return [summary, cancelButton, confirmButton];
  }

  // Focus trap: Tab cycles between the Details summary, Cancel, and Confirm.
  function handleKeydown(event: KeyboardEvent) {
    if (!visible) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      resolve(false);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const focusable = focusOrder();
      const current = document.activeElement;
      const index = focusable.indexOf(current as HTMLElement);
      const next = event.shiftKey
        ? focusable[(index - 1 + focusable.length) % focusable.length]
        : focusable[(index + 1) % focusable.length];
      next.focus();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === backdrop) {
      resolve(false);
    }
  }

  cancelButton.addEventListener("click", () => resolve(false));
  confirmButton.addEventListener("click", () => resolve(true));
  backdrop.addEventListener("click", handleBackdropClick);
  backdrop.addEventListener("keydown", handleKeydown);

  return {
    element: backdrop,
    show() {
      if (visible) return new Promise<boolean>((r) => { resolver = r; });
      visible = true;
      // Always start collapsed so the concise summary is the default view.
      details.open = false;
      if (!backdrop.parentElement) document.body.appendChild(backdrop);
      // Force reflow so the CSS transition triggers
      void backdrop.offsetWidth;
      backdrop.classList.add("first-run-visible");
      trapFocus();
      return new Promise<boolean>((r) => { resolver = r; });
    },
    destroy() {
      resolve(false);
      backdrop.removeEventListener("click", handleBackdropClick);
      backdrop.removeEventListener("keydown", handleKeydown);
      backdrop.remove();
    },
  };
}

// --- Run gate ---

let warningModal: ReturnType<typeof createWarningModal> | null = null;
let gatePromise: Promise<boolean> | null = null;

/**
 * Returns true if Run should proceed.  Shows the safety-notice modal on the
 * first call for a given notice version; once acknowledged, subsequent calls
 * return true without prompting for any project.  There is no bypass parameter
 * — every call always queries the native acknowledgement store, and a failed
 * acknowledgement write fails closed (Run does not proceed).
 */
export async function gateFirstRun(
  noticeVersion: string = SAFETY_NOTICE_VERSION,
): Promise<boolean> {
  // Fast path: already acknowledged
  const already = await isAcknowledged(noticeVersion);
  if (already) return true;

  // Concurrency: reuse an in-flight gate promise so concurrent Run clicks
  // coalesce onto one modal rather than stacking dialogs.
  if (gatePromise) return gatePromise;

  if (!warningModal) {
    warningModal = createWarningModal();
  }

  gatePromise = (async () => {
    const confirmed = await warningModal!.show();
    if (!confirmed) return false;

    // Write acknowledgement — must succeed before Run proceeds
    await writeAcknowledgement(noticeVersion);
    return true;
  })().finally(() => {
    gatePromise = null;
  });

  return gatePromise;
}

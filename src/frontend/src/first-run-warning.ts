// First-run warning gate (Stage-2 security extraction of the product path
// formerly in the mixed issue37.ts).
//
// Gates every user-triggered Run behind a persistent acknowledgement keyed by a
// stable project identity, stored via Tauri commands in the app-data directory
// (inaccessible to the opaque preview iframe). The DOM modal discloses ADR
// 0003's unsupported non-yielding-code limitation; the acknowledgement is
// per-project identity. The built-in scratch buffer keeps a fixed identity;
// opened folder projects supply a SHA-256 identity derived from their canonical
// root (issue051.ts), so a different project re-prompts without persisting the
// user's filesystem path.
//
// This module is production-neutral: no proof markers, no auto-proof entry. The
// two-phase packaged first-run PROOF lives in the Stage-4 scenario suite
// `proof-project-lifecycle.ts`, which re-exports
// `gateFirstRun` / `SCRATCH_PROJECT_IDENTITY` from here.

// Stable identity for the built-in scratch buffer. Opened folder projects use
// their own path-redacted identities supplied by issue051.
export const SCRATCH_PROJECT_IDENTITY = "builtin-scratch-v1";

// --- Acknowledgement store (via Tauri IPC) ---

async function invokeChecked<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error("Tauri IPC is unavailable.");
  return invoke<T>(command, args);
}

export async function isAcknowledged(identity: string): Promise<boolean> {
  return invokeChecked<boolean>("first_run_check_acknowledgement", { identity });
}

export async function writeAcknowledgement(identity: string): Promise<void> {
  await invokeChecked<null>("first_run_write_acknowledgement", { identity });
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

  const desc = document.createElement("p");
  desc.id = "first-run-desc";
  desc.className = "first-run-desc";
  desc.textContent =
    "This application is intended primarily for running your own local code. " +
    "It provides defence-in-depth protections against accidental or opportunistic " +
    "access to desktop privileges, but it does not provide a complete sandbox " +
    "against deliberately malicious code. Synchronous code that never yields " +
    "(for example, an unbounded loop inside Update or Draw) can freeze both the " +
    "preview and editor and may require you to relaunch the application.";

  const note = document.createElement("p");
  note.className = "first-run-note";
  note.textContent =
    "You will not be asked again for this project unless its identity changes.";

  const actions = document.createElement("div");
  actions.className = "first-run-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "first-run-cancel";
  cancelButton.textContent = "Cancel";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "first-run-confirm";
  confirmButton.textContent = "I understand, run this project";

  actions.appendChild(cancelButton);
  actions.appendChild(confirmButton);
  dialog.appendChild(marker);
  dialog.appendChild(title);
  dialog.appendChild(desc);
  dialog.appendChild(note);
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

  // Focus trap: Tab cycles between cancel and confirm only
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
      const focusable = [cancelButton, confirmButton];
      const current = document.activeElement;
      const index = focusable.indexOf(current as HTMLButtonElement);
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
 * Returns true if Run should proceed.  Shows the warning modal on first call
 * for a given identity; subsequent calls for the same acknowledged identity
 * return true without prompting.  There is no bypass parameter — every call
 * always queries the native acknowledgement store.
 */
export async function gateFirstRun(
  identity: string = SCRATCH_PROJECT_IDENTITY,
): Promise<boolean> {
  // Fast path: already acknowledged
  const already = await isAcknowledged(identity);
  if (already) return true;

  // Concurrency: reuse an in-flight gate promise
  if (gatePromise) return gatePromise;

  if (!warningModal) {
    warningModal = createWarningModal();
  }

  gatePromise = (async () => {
    const confirmed = await warningModal!.show();
    if (!confirmed) return false;

    // Write acknowledgement — must succeed before Run proceeds
    await writeAcknowledgement(identity);
    return true;
  })().finally(() => {
    gatePromise = null;
  });

  return gatePromise;
}

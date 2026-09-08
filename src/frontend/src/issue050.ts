// Issue 050 — Save scratch project with atomic writes and dirty-state protection
//
// Tracks whether the Monaco editor's buffer differs from its last-saved
// (or initially-loaded default example) content, reflects this dirty state
// visibly in the toolbar, implements a Save As flow that writes the file
// atomically using the trusted Tauri shell's native save dialog, and gates
// New/Open/application-exit actions behind a confirmation prompt.
//
// PRD §8.6: New, Open, and application exit prompt before discarding
// unsaved changes; Save on a scratch project opens a Save As flow;
// project/manifest writes are atomic and preserve a backup.

// ----- Dirty state tracker -----

let isDirty = false;
let applicationDirty = false;
let lastSavedContent: string = "";
let currentFileName = "Game1.cs";

// ----- Confirmation dialog -----

function createConfirmationDialog(
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel: () => void,
): HTMLDialogElement {
  // Create modal dialog element
  const dialog = document.createElement("dialog");
  dialog.className = "confirmation-dialog";
  dialog.innerHTML = `
    <div class="dialog-content">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      <div class="dialog-buttons">
        <button class="btn-cancel">Cancel</button>
        <button class="btn-confirm">Discard</button>
      </div>
    </div>
  `;

  // Add event listeners
  const cancelButton = dialog.querySelector(".btn-cancel") as HTMLButtonElement;
  const confirmButton = dialog.querySelector(".btn-confirm") as HTMLButtonElement;

  cancelButton.addEventListener("click", () => {
    onCancel();
    dialog.remove();
  });

  confirmButton.addEventListener("click", () => {
    onConfirm();
    dialog.remove();
  });

  // Close on backdrop click
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      onCancel();
      dialog.remove();
    }
  });

  // Add to body
  document.body.appendChild(dialog);

  // Focus first button
  setTimeout(() => {
    cancelButton.focus();
  }, 0);

  return dialog;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ----- Dirty indicator -----

/**
 * Publish the dirty state for whichever workspace currently owns the editor.
 * Scratch files use the tracker below; folder projects call this through their
 * `setDirtyIndicator` hook. Keeping one application-level value ensures both
 * native close/quit handling and the browser fallback protect folder edits.
 */
export function setApplicationDirtyState(dirty: boolean): void {
  applicationDirty = dirty;

  // Mirror the current dirty state into the shell so the native window-close
  // handler can prompt before discarding unsaved changes (issue 050). Only the
  // trusted top-level frontend can reach this command (ACL-gated per issue 34);
  // it is absent in the sandboxed preview, where __TAURI_INTERNALS__ is never
  // injected, so the optional-chaining call simply no-ops there.
  (window as any).__TAURI_INTERNALS__?.invoke?.("issue050_set_dirty", { dirty });

  const indicator = document.getElementById("dirty-indicator-text");
  const indicatorDot = document.getElementById("dirty-indicator");
  if (!indicator && !indicatorDot) return;

  if (dirty) {
    if (indicator) indicator.textContent = "Unsaved changes";
    if (indicatorDot) {
      indicatorDot.textContent = " ●";
      indicatorDot.hidden = false;
    }
  } else {
    if (indicator) indicator.textContent = "";
    if (indicatorDot) {
      indicatorDot.textContent = "";
      indicatorDot.hidden = true;
    }
  }
}

/**
 * Initialise the dirty-state tracker. Must be called after the Monaco
 * editor is mounted (issue 047) and the default/example content is loaded.
 *
 * Returns an object with the public API for observing and changing dirty
 * state, plus the Save As and New-gating functions.
 */
export function installIssue050Tracker(
  getEditorValue: () => string,
  onEditorChange?: () => void,
): {
  /** Whether the current buffer has unsaved changes. */
  isDirty: () => boolean;
  /** Set the current file name (used in the dirty indicator). */
  setFileName: (name: string) => void;
  /** Save As flow: opens native dialog, writes atomically, clears dirty. */
  saveAs: () => Promise<boolean>;
  /** Save to the last-saved path (no-op until first Save As). */
  save: () => Promise<boolean>;
  /** Gating wrapper for the scratch buffer's own dirty state. */
  promptBeforeNew: () => Promise<boolean>;
  /**
   * Show the discard prompt for an explicitly supplied workspace dirty state.
   * Folder projects use this so they do not accidentally consult the separate
   * scratch-buffer tracker.
   */
  promptBeforeDiscard: (dirty: boolean) => Promise<boolean>;
  /** Get current buffer content. */
  getBuffer: () => string;
  /** Update dirty state from new buffer content. */
  setBuffer: (content: string) => void;
  /**
   * Adopt newly-loaded content (New/Open) as the clean baseline: records it
   * as the last-saved snapshot and clears the dirty flag.
   */
  loadBaseline: (content: string, fileName?: string) => void;
  /**
   * Open a file via the native open dialog. Returns the chosen file's name
   * and content, or null if the dialog was cancelled or failed.
   */
  openFile: () => Promise<{ fileName: string; content: string } | null>;
} {
  isDirty = false;
  lastSavedContent = getEditorValue();
  currentFileName = "Game1.cs";
  setApplicationDirtyState(false);

  const confirmDiscard = async (dirty: boolean): Promise<boolean> => {
    if (!dirty) return true;
    return new Promise<boolean>((resolve) => {
      const dialog = createConfirmationDialog(
        "Unsaved changes",
        "You have unsaved changes. Do you want to discard them?",
        () => resolve(true),
        () => resolve(false),
      );
      dialog.showModal();
    });
  };

  // Export the public API
  const api = {
    isDirty: () => isDirty,
    setFileName: (name: string) => {
      currentFileName = name;
      setApplicationDirtyState(isDirty);
    },
    saveAs: async () => {
      const content = api.getBuffer();
      const suggestedName = currentFileName;
      try {
        // Step 1: Show native save dialog via our approved application
        // command. The trusted webview may only invoke the app's own
        // registered commands (never plugin commands like
        // "plugin:dialog|save" directly), so issue050_save_dialog wraps the
        // dialog plugin on the Rust side and returns the chosen path.
        const result = await (window as any).__TAURI_INTERNALS__.invoke(
          "issue050_save_dialog",
          {
            defaultPath: suggestedName,
          },
        );

        // result is the selected path string (e.g. "/Users/.../Game1.cs")
        // or null/undefined if the user cancelled.
        if (!result) {
          // User cancelled
          return false;
        }

        const filePath = result as string;

        // Step 2: Write file atomically using our Rust command
        await (window as any).__TAURI_INTERNALS__.invoke(
          "issue050_write_file",
          {
            path: filePath,
            content: content,
          },
        );

        lastSavedContent = content;
        isDirty = false;
        setApplicationDirtyState(false);
        return true;
      } catch (error) {
        // Dialog cancelled or failed — dirty state unchanged
        console.error("Issue 050 save failed:", error);
        return false;
      }
    },
    save: async () => {
      if (lastSavedContent === "" || isDirty) {
        return api.saveAs();
      }
      return true; // Already clean, nothing to save
    },
    promptBeforeNew: () => confirmDiscard(isDirty),
    promptBeforeDiscard: (dirty: boolean) => confirmDiscard(dirty),
    getBuffer: () => getEditorValue(),
    setBuffer: (content: string) => {
      const wasDirty = isDirty;
      isDirty = content !== lastSavedContent;
      if (isDirty !== wasDirty) {
        setApplicationDirtyState(isDirty);
        onEditorChange?.();
      }
    },
    loadBaseline: (content: string, fileName?: string) => {
      lastSavedContent = content;
      isDirty = false;
      if (fileName !== undefined) {
        currentFileName = fileName;
      }
      setApplicationDirtyState(false);
    },
    openFile: async () => {
      try {
        // Show native open dialog via our approved application command.
        // Returns [path, content] or null if cancelled.
        const result = await (window as any).__TAURI_INTERNALS__.invoke(
          "issue050_open_dialog",
          {},
        );
        if (!result) {
          return null;
        }
        const [filePath, content] = result as [string, string];
        const fileName = filePath.split(/[\\/]/).pop() ?? "Game1.cs";
        return { fileName, content };
      } catch (error) {
        console.error("Issue 050 open failed:", error);
        return null;
      }
    },
  };

  return api;
}

// ----- Application exit handling -----
//
// The desktop (Tauri) application's close is gated natively: the frontend
// publishes its dirty state to the shell via `issue050_set_dirty` (see
// setApplicationDirtyState), and the shell's `CloseRequested` handler shows a
// native discard-confirmation dialog when dirty. In a plain browser context
// (no shell), fall back to the browser's own beforeunload confirmation.
window.addEventListener("beforeunload", (event) => {
  if (typeof (window as any).__TAURI_INTERNALS__ !== "undefined") {
    // Desktop app: the native CloseRequested handler owns the prompt.
    return;
  }

  // Browser context — show native confirmation
  if (applicationDirty) {
    event.preventDefault();
    // Required for some browsers to show the confirmation dialog
    (event as any).returnValue = true;
  }
});

// ----- Default export -----

// Default export is a factory function that must be called with the
// Monaco editor instance and default content.
export default installIssue050Tracker;

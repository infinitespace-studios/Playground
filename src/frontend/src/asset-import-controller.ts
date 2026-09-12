// Asset import controller — the DOM/UX layer over the pure `asset-import.ts`
// logic (issue 066). It exposes two entry points that both funnel through one
// confirmation-then-sequential-import path:
//
//   1. an unobtrusive "Import assets…" action (a native multi-file picker), and
//   2. the asset rail as an accessible OS-file drop target.
//
// Design boundaries:
//   - The clean file-explorer rail (issue 064) is preserved: this adds only an
//     "Import assets…" button in the Assets header and a drop-highlight class on
//     the rail. No tags, sizes, badges, or per-file metadata are introduced.
//   - Native OS drops are delivered by Rust (issue 066 `WindowEvent::DragDrop`)
//     to a fixed top-frame global hook — the sandboxed preview iframe never sees
//     a drop, so it cannot inject one. This controller installs that hook.
//   - Destinations are always CONFIRMED (and editable) before any write. The
//     confirmation step is injectable so the flow is testable without a browser
//     dialog; the default implementation builds a keyboard-accessible `<dialog>`.
//   - Imports run SEQUENTIALLY through `project_import_asset` (issue 065); the
//     rail is refreshed from disk once at the end; editor state is untouched.

import {
  classifySources,
  importSequentially,
  positionInRect,
  validateDestination,
  type ImportCandidate,
  type ImportPlan,
  type ImportRejection,
  type ImportRequest,
  type ImportSummary,
} from "./asset-import.ts";

/** The drag phases the Rust bridge may forward. Any other value is malformed. */
export const DRAG_DROP_PHASES = ["enter", "over", "drop", "leave"] as const;
export type DragDropPhase = (typeof DRAG_DROP_PHASES)[number];

/** Payload forwarded from the Rust drag/drop bridge (JSON-parsed). */
export interface DragDropPayload {
  phase: DragDropPhase;
  x?: number;
  y?: number;
  paths?: string[];
}

const KNOWN_PHASES: ReadonlySet<string> = new Set(DRAG_DROP_PHASES);

/**
 * Validate and normalize an untrusted, JSON-parsed drag/drop payload into a safe
 * `DragDropPayload`, or return null when it is malformed. This is the hard gate
 * between the native `eval`-delivered string and any pure logic: a bad `phase`,
 * non-finite coordinate, or a `paths` value that is not an array of strings can
 * neither throw nor reach `classifySources`.
 *
 *   - `phase` must be one of the four known phases (unknown → reject),
 *   - `x`/`y`, when present, must be FINITE numbers (NaN/Infinity → reject),
 *   - `paths`, when present, must be an array of strings (any non-string entry
 *     → reject the whole payload rather than silently importing a partial set).
 *
 * Pure; performs no IO and touches no DOM.
 */
export function sanitizeDragDropPayload(value: unknown): DragDropPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.phase !== "string" || !KNOWN_PHASES.has(raw.phase)) return null;
  const phase = raw.phase as DragDropPhase;

  const payload: DragDropPayload = { phase };

  if (raw.x !== undefined) {
    if (typeof raw.x !== "number" || !Number.isFinite(raw.x)) return null;
    payload.x = raw.x;
  }
  if (raw.y !== undefined) {
    if (typeof raw.y !== "number" || !Number.isFinite(raw.y)) return null;
    payload.y = raw.y;
  }

  if (raw.paths !== undefined) {
    if (!Array.isArray(raw.paths)) return null;
    for (const entry of raw.paths) {
      if (typeof entry !== "string") return null;
    }
    payload.paths = raw.paths as string[];
  }

  return payload;
}

/** Host capabilities the controller needs (all injected, so it is testable). */
export interface AssetImportHooks {
  /** Whether a folder project is currently open (imports need a Content root). */
  hasProject: () => boolean;
  /** Native multi-file picker → absolute source paths (or null when cancelled). */
  pickImportFiles: () => Promise<string[] | null>;
  /** Bounded native copy into the open project's Content/ (issue 065). */
  importAsset: (sourcePath: string, destination: string) => Promise<{
    status?: string;
    relativePath?: string;
    byteLength?: number;
    sha256?: string;
  }>;
  /** Re-read the project's Content/ inventory from disk and refresh the rail. */
  refreshContent: () => Promise<void>;
  /** Surface a modal error (no editor state is lost). */
  showError: (title: string, message: string) => void;
  /** Surface a non-blocking status/result summary. */
  showStatus?: (message: string) => void;
  /**
   * Confirm/edit the Content-relative destinations for a classified batch.
   * Resolves to the confirmed requests to import, or null when cancelled. The
   * default (production) implementation builds a keyboard-accessible dialog;
   * tests inject a deterministic override.
   */
  confirmDestinations?: (plan: ImportPlan) => Promise<ImportRequest[] | null>;
}

export interface AssetImportApi {
  /** Open the native multi-file picker and run the import flow. */
  openPicker: () => Promise<void>;
  /**
   * Handle a raw drag/drop payload from the Rust bridge. Exposed for tests; in
   * production the installed global hook calls this. `railRect`/`dpr` are read
   * live from the DOM in production, injected in tests.
   */
  handleDragDrop: (payload: DragDropPayload) => Promise<void>;
}

/** Minimal DOM slice used by the controller (real `document` satisfies it). */
interface HostDoc {
  getElementById(id: string): HostElement | null;
  createElement(tag: string): HostElement;
  body: HostElement;
}

interface HostElement {
  className: string;
  textContent: string;
  hidden: boolean;
  value: string;
  type: string;
  readonly dataset: Record<string, string>;
  setAttribute(name: string, value: string): void;
  append(...children: HostElement[]): void;
  appendChild(child: HostElement): HostElement;
  replaceChildren(...children: HostElement[]): void;
  addEventListener(type: string, handler: (event?: unknown) => void): void;
  removeEventListener?(type: string, handler: (event?: unknown) => void): void;
  querySelector(selector: string): HostElement | null;
  focus?(): void;
  showModal?(): void;
  close?(): void;
  remove(): void;
  getBoundingClientRect?(): { left: number; top: number; right: number; bottom: number };
}

/**
 * Build the default keyboard-accessible confirmation dialog for a classified
 * batch. Lists each importable candidate with an editable Content-relative
 * destination input, shows rejected entries as non-importable (read-only), and
 * offers Import / Cancel. Resolves to the confirmed requests, or null on cancel.
 *
 * Accessibility: a native `<dialog>` (showModal) traps focus and supports
 * Escape-to-cancel; each input has an associated label; invalid destinations
 * block Import and are announced inline.
 */
function buildDialogConfirm(doc: HostDoc) {
  return (plan: ImportPlan): Promise<ImportRequest[] | null> =>
    new Promise(resolve => {
      const dialog = doc.createElement("dialog");
      dialog.className = "confirmation-dialog asset-import-dialog";
      dialog.setAttribute("aria-labelledby", "asset-import-title");

      const title = doc.createElement("h3");
      title.setAttribute("id", "asset-import-title");
      title.textContent = "Import assets";
      dialog.appendChild(title);

      const intro = doc.createElement("p");
      intro.textContent =
        "Confirm or edit each file's destination under Content/. Existing files are never overwritten.";
      dialog.appendChild(intro);

      const rows: Array<{ candidate: ImportCandidate; input: HostElement; error: HostElement }> = [];
      const list = doc.createElement("ul");
      list.className = "asset-import-list";
      for (const candidate of plan.candidates) {
        const item = doc.createElement("li");
        item.className = "asset-import-row";

        const label = doc.createElement("label");
        label.className = "asset-import-label";
        label.textContent = candidate.fileName;

        const input = doc.createElement("input");
        input.type = "text";
        input.className = "asset-import-dest";
        input.value = candidate.defaultDestination;
        input.setAttribute("aria-label", `Destination for ${candidate.fileName}`);
        label.appendChild(input);
        item.appendChild(label);

        const error = doc.createElement("span");
        error.className = "asset-import-error";
        error.setAttribute("role", "alert");
        error.hidden = true;
        item.appendChild(error);

        rows.push({ candidate, input, error });
        list.appendChild(item);
      }
      dialog.appendChild(list);

      if (plan.rejections.length > 0) {
        const rejectedHeading = doc.createElement("p");
        rejectedHeading.className = "asset-import-rejected-heading";
        rejectedHeading.textContent = "Not imported:";
        dialog.appendChild(rejectedHeading);
        const rejectedList = doc.createElement("ul");
        rejectedList.className = "asset-import-rejected";
        for (const rejection of plan.rejections) {
          const item = doc.createElement("li");
          item.textContent = `${rejection.fileName} — ${rejection.reason}`;
          rejectedList.appendChild(item);
        }
        dialog.appendChild(rejectedList);
      }

      const buttons = doc.createElement("div");
      buttons.className = "dialog-buttons";
      const cancel = doc.createElement("button");
      cancel.type = "button";
      cancel.className = "btn-cancel";
      cancel.textContent = "Cancel";
      const confirm = doc.createElement("button");
      confirm.type = "button";
      confirm.className = "btn-confirm";
      confirm.textContent = "Import";
      if (plan.candidates.length === 0) confirm.setAttribute("disabled", "true");
      buttons.append(cancel, confirm);
      dialog.appendChild(buttons);

      const finish = (result: ImportRequest[] | null): void => {
        dialog.close?.();
        dialog.remove();
        resolve(result);
      };

      cancel.addEventListener("click", () => finish(null));
      dialog.addEventListener("cancel", () => finish(null)); // Escape key

      confirm.addEventListener("click", () => {
        const requests: ImportRequest[] = [];
        let valid = true;
        const seen = new Set<string>();
        for (const row of rows) {
          const destination = row.input.value.trim();
          const error = validateDestination(destination)
            ?? (seen.has(destination.toLowerCase())
              ? "Two files target the same destination."
              : null);
          if (error) {
            row.error.textContent = error;
            row.error.hidden = false;
            valid = false;
            continue;
          }
          row.error.hidden = true;
          seen.add(destination.toLowerCase());
          requests.push({
            sourcePath: row.candidate.sourcePath,
            fileName: row.candidate.fileName,
            destination,
          });
        }
        if (!valid) return; // keep the dialog open with inline errors
        finish(requests);
      });

      doc.body.appendChild(dialog);
      dialog.showModal?.();
      rows[0]?.input.focus?.();
    });
}

/**
 * Install the asset-import controller: wire the "Import assets…" action, install
 * the drag/drop bridge hook, and drive confirmation + sequential import. `doc`
 * is injectable for tests; production omits it. Returns the API (also used by
 * tests to drive the flow deterministically).
 */
export function installAssetImport(
  hooks: AssetImportHooks,
  doc: HostDoc = document as unknown as HostDoc,
  globalTarget: { __playgroundAssetDrop__?: (json: string) => void } =
    window as unknown as { __playgroundAssetDrop__?: (json: string) => void },
): AssetImportApi {
  const confirmDestinations = hooks.confirmDestinations ?? buildDialogConfirm(doc);

  // Wire the "Import assets…" action into the Assets header (unobtrusive; no
  // rail metadata is added). The button is appended into the header CONTAINER as
  // a SIBLING of the <h2> heading (never nested inside the heading, which would
  // corrupt heading semantics and the section's accessible name). It is disabled
  // off a folder project.
  const host = doc.getElementById("asset-browser");
  let importButton: HostElement | null = null;
  if (host) {
    const header = host.querySelector(".asset-browser-header");
    importButton = doc.createElement("button");
    importButton.type = "button";
    importButton.className = "asset-import-action";
    importButton.textContent = "Import assets…";
    importButton.setAttribute("aria-label", "Import assets into the project Content folder");
    importButton.addEventListener("click", () => {
      void api.openPicker();
    });
    // Prefer the dedicated header container so the button is a sibling of the
    // heading; fall back to the section host if the container is absent.
    if (header) header.appendChild(importButton);
    else host.appendChild(importButton);
  }

  const rail = host;

  /** Toggle the rail's drop-affordance highlight (non-color-only via class). */
  function setDropActive(active: boolean): void {
    if (!rail) return;
    if (active) rail.setAttribute("data-drop-active", "true");
    else rail.setAttribute("data-drop-active", "false");
  }

  /** Is a cursor (physical px) over the asset rail? Belt-and-suspenders gate. */
  function overRail(x: number | undefined, y: number | undefined): boolean {
    if (!rail || typeof x !== "number" || typeof y !== "number") return false;
    const rect = rail.getBoundingClientRect?.();
    if (!rect) return true; // no geometry available (tests) → accept
    const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    return positionInRect(x / dpr, y / dpr, rect);
  }

  /**
   * The shared tail: confirm destinations for a classified plan, import
   * sequentially, refresh the rail, and report an accurate summary. One failure
   * never misreports another file. Editor state is never touched.
   */
  async function confirmAndImport(paths: string[]): Promise<void> {
    if (!hooks.hasProject()) {
      hooks.showError(
        "No project open",
        "Open a folder project before importing assets into Content/.",
      );
      return;
    }
    const plan = classifySources(paths);
    if (plan.candidates.length === 0 && plan.rejections.length === 0) return;
    if (plan.candidates.length === 0) {
      hooks.showError(
        "Nothing to import",
        plan.rejections.map(r => `${r.fileName}: ${r.reason}`).join("\n"),
      );
      return;
    }

    const requests = await confirmDestinations(plan);
    if (requests === null || requests.length === 0) return; // cancelled

    let summary: ImportSummary;
    try {
      summary = await importSequentially(requests, req =>
        hooks.importAsset(req.sourcePath, req.destination),
      );
    } finally {
      // Always refresh from disk so the rail reflects whatever was written,
      // even on a partial/mixed batch. Editor buffers/active file untouched.
      await hooks.refreshContent();
    }

    reportSummary(summary, plan.rejections);
  }

  function reportSummary(summary: ImportSummary, rejections: ImportRejection[]): void {
    const parts: string[] = [];
    if (summary.imported > 0) parts.push(`${summary.imported} imported`);
    if (summary.conflicts > 0) parts.push(`${summary.conflicts} already existed`);
    if (summary.errors > 0) parts.push(`${summary.errors} failed`);
    if (rejections.length > 0) parts.push(`${rejections.length} unsupported`);

    if (summary.conflicts > 0 || summary.errors > 0) {
      const detail = summary.outcomes
        .filter(o => o.status !== "imported")
        .map(o =>
          o.status === "conflict"
            ? `${o.request.fileName}: already exists at ${o.relativePath} (not overwritten)`
            : `${o.request.fileName}: ${o.message}`,
        )
        .join("\n");
      hooks.showError("Import finished with issues", `${parts.join(", ")}.\n\n${detail}`);
    } else {
      hooks.showStatus?.(parts.length > 0 ? `Import: ${parts.join(", ")}.` : "Nothing imported.");
    }
  }

  const api: AssetImportApi = {
    openPicker: async () => {
      if (!hooks.hasProject()) {
        hooks.showError(
          "No project open",
          "Open a folder project before importing assets into Content/.",
        );
        return;
      }
      let paths: string[] | null;
      try {
        paths = await hooks.pickImportFiles();
      } catch (error) {
        hooks.showError(
          "Could not open the file picker",
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
      if (!paths || paths.length === 0) return; // cancelled
      await confirmAndImport(paths);
    },
    handleDragDrop: async payload => {
      switch (payload.phase) {
        case "enter":
        case "over":
          setDropActive(overRail(payload.x, payload.y));
          return;
        case "leave":
          setDropActive(false);
          return;
        case "drop": {
          setDropActive(false);
          if (!overRail(payload.x, payload.y)) return; // drop landed elsewhere
          // Defensive belt-and-suspenders: even though the global hook already
          // sanitizes, keep only string paths here so a direct caller can never
          // push a non-string into classifySources.
          const paths = (payload.paths ?? []).filter(
            (p): p is string => typeof p === "string",
          );
          if (paths.length === 0) return;
          await confirmAndImport(paths);
          return;
        }
      }
    },
  };

  // Install the fixed top-frame global hook the Rust bridge calls. It JSON-parses
  // the payload (a string literal Rust hands us) defensively, then hard-validates
  // it: a malformed payload (bad JSON, unknown phase, non-finite coordinate, or a
  // non-string-array `paths`) is ignored rather than throwing into the native
  // eval or reaching classifySources.
  globalTarget.__playgroundAssetDrop__ = (json: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return;
    }
    const payload = sanitizeDragDropPayload(parsed);
    if (!payload) return;
    void api.handleDragDrop(payload);
  };

  return api;
}

export default installAssetImport;

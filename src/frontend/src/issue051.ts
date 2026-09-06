// Issue 051 — Open folder, multi-file editing, and manifest persistence.
//
// Extends the single-scratch-file model (issues 47/50) into a folder-based
// project: a native folder picker (issue051_pick_folder), recursive .cs file
// discovery + manifest read (issue051_read_project), a file explorer, Monaco
// switching with per-file dirty tracking, Save All (atomic per file via
// issue050_write_file), and playground.json schema handling (create default /
// migrate older / reject newer).
//
// PRD §15: a project folder holds multiple .cs files + a playground.json
// manifest (name, schemaVersion, contentProfile, preview.width/height); the
// manifest is not required for a one-file scratch project; unsupported
// schemaVersions are rejected without modifying the project.

// Current manifest schema version this application understands.
export const ISSUE051_SCHEMA_VERSION = 1;

export interface Issue051Manifest {
  name: string;
  schemaVersion: number;
  contentProfile: string;
  preview: { width: number; height: number };
}

interface Issue051File {
  /** Path relative to the project root, forward-slashed (explorer label). */
  relativePath: string;
  /** Absolute path on disk (atomic Save All target). */
  absolutePath: string;
  /** Content as last saved to / loaded from disk. */
  savedContent: string;
  /** Current in-memory content (diverges from savedContent when dirty). */
  currentContent: string;
  dirty: boolean;
}

interface ProjectContentFile {
  relativePath: string;
  extension: string;
  byteLength: number;
  base64: string;
}

interface ProjectReadResult {
  root: string;
  folderName: string;
  csFiles: Array<{ relativePath: string; absolutePath: string; content: string }>;
  contentFiles?: ProjectContentFile[];
  manifestText: string | null;
}

// ----- Module state -----

let projectRoot: string | null = null;
let projectFolderName = "";
let files: Issue051File[] = [];
let activePath: string | null = null;
let manifest: Issue051Manifest | null = null;
/** Issue 052: raw Content/ assets discovered at Open (base64), for pre-Run mount. */
let contentFiles: ProjectContentFile[] = [];
/** True when the manifest existed on disk at Open (vs. created-on-first-Save). */
let manifestOnDisk = false;

function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke: (c: string, a?: Record<string, unknown>) => Promise<T> };
  }).__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    return Promise.reject(new Error("Tauri invoke is unavailable (folder features need the desktop shell)."));
  }
  return internals.invoke(command, args ?? {});
}

function defaultManifest(name: string): Issue051Manifest {
  return {
    name,
    schemaVersion: ISSUE051_SCHEMA_VERSION,
    contentProfile: "Web",
    preview: { width: 800, height: 480 },
  };
}

/**
 * Parse and validate a playground.json. Returns the manifest, or throws with a
 * clear message for a newer/unrecognized schemaVersion (so the caller can
 * reject the Open without touching disk). Older recognized versions are
 * migrated here (none exist yet: current schema is version 1).
 */
export function parseManifest(text: string, folderName: string): Issue051Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("playground.json is not valid JSON.");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("playground.json must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  const version = obj.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error(`playground.json has an invalid schemaVersion: ${String(version)}`);
  }
  if (version > ISSUE051_SCHEMA_VERSION) {
    throw new Error(
      `playground.json schemaVersion ${version} is newer than this application supports ` +
        `(max ${ISSUE051_SCHEMA_VERSION}). The project was not modified.`,
    );
  }
  // version === ISSUE051_SCHEMA_VERSION (1) today. Future: migrate older
  // recognized versions here before returning.
  const preview =
    typeof obj.preview === "object" && obj.preview !== null
      ? (obj.preview as Record<string, unknown>)
      : {};
  return {
    name: typeof obj.name === "string" ? obj.name : folderName,
    schemaVersion: ISSUE051_SCHEMA_VERSION,
    contentProfile: typeof obj.contentProfile === "string" ? obj.contentProfile : "Web",
    preview: {
      width: typeof preview.width === "number" ? preview.width : 800,
      height: typeof preview.height === "number" ? preview.height : 480,
    },
  };
}

/** Serialize the manifest for on-disk storage (stable, pretty-printed). */
export function serializeManifest(m: Issue051Manifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

// ----- Public API -----

export interface Issue051Hooks {
  /** Load content into Monaco (switching the visible file). */
  setEditorContent: (content: string) => void;
  /** Read the live Monaco buffer (current visible file's edits). */
  getEditorContent: () => string;
  /** Re-render the file explorer after the file list / active file changes. */
  renderExplorer: (files: ReadonlyArray<{ relativePath: string; dirty: boolean; active: boolean }>) => void;
  /** Update the global dirty indicator (any file dirty). */
  setDirtyIndicator: (anyDirty: boolean) => void;
  /** Show a modal error message (rejected Open, failed Save). */
  showError: (title: string, message: string) => void;
}

export interface Issue051Api {
  /** Native folder picker → read project → populate explorer + editor. */
  openFolder: () => Promise<boolean>;
  /** Switch the editor to a file by relative path (persists the current buffer first). */
  switchTo: (relativePath: string) => void;
  /** Persist the visible file's live buffer into module state + recompute dirty. */
  syncActiveBuffer: () => void;
  /** Save every dirty .cs file + playground.json atomically. */
  saveAll: () => Promise<boolean>;
  /** All open .cs files as compile sources (active file reflects live edits). */
  getSources: () => Array<{ path: string; text: string }>;
  /** Whether a folder project is currently open. */
  hasProject: () => boolean;
  /** Whether any open file has unsaved changes. */
  isDirty: () => boolean;
  /** The primary source path for compilation (Game1.cs if present, else first). */
  primarySourcePath: () => string | null;
  /**
   * Issue 052: the project's discovered Content/ assets + the manifest's
   * declared contentProfile, for pre-Run mounting. Returns null when no folder
   * project is open. `contentFiles` is the raw discovery (base64, disk paths);
   * preparation (base64 decode, .wav->.xnb rename) happens in issue052-content.
   */
  getContent: () => {
    contentProfile: string;
    contentFiles: ReadonlyArray<{ relativePath: string; extension: string; byteLength: number; base64: string }>;
  } | null;
}

export function installIssue051ProjectManager(hooks: Issue051Hooks): Issue051Api {
  function anyDirty(): boolean {
    return files.some(f => f.dirty);
  }

  function activeFile(): Issue051File | null {
    return files.find(f => f.relativePath === activePath) ?? null;
  }

  function renderExplorer(): void {
    hooks.renderExplorer(
      files.map(f => ({
        relativePath: f.relativePath,
        dirty: f.dirty,
        active: f.relativePath === activePath,
      })),
    );
  }

  function syncActiveBuffer(): void {
    const file = activeFile();
    if (!file) return;
    file.currentContent = hooks.getEditorContent();
    const wasDirty = file.dirty;
    file.dirty = file.currentContent !== file.savedContent;
    if (file.dirty !== wasDirty) {
      hooks.setDirtyIndicator(anyDirty());
      renderExplorer();
    }
  }

  function switchTo(relativePath: string): void {
    if (relativePath === activePath) return;
    // Persist the current buffer before switching away.
    syncActiveBuffer();
    const target = files.find(f => f.relativePath === relativePath);
    if (!target) return;
    activePath = relativePath;
    hooks.setEditorContent(target.currentContent);
    renderExplorer();
  }

  const api: Issue051Api = {
    hasProject: () => projectRoot !== null,
    isDirty: () => anyDirty(),
    getSources: () => {
      // Ensure the visible file's live edits are captured first.
      syncActiveBuffer();
      return files.map(f => ({ path: f.relativePath, text: f.currentContent }));
    },
    primarySourcePath: () => {
      if (files.length === 0) return null;
      const game = files.find(f => f.relativePath === "Game1.cs" || f.relativePath.endsWith("/Game1.cs"));
      return (game ?? files[0]).relativePath;
    },
    getContent: () => {
      if (projectRoot === null) return null;
      return {
        contentProfile: manifest?.contentProfile ?? "Web",
        contentFiles,
      };
    },
    syncActiveBuffer,
    switchTo,
    openFolder: async () => {
      const picked = await invoke<string | null>("issue051_pick_folder");
      if (!picked) return false;

      let project: ProjectReadResult;
      try {
        project = await invoke<ProjectReadResult>("issue051_read_project", { path: picked });
      } catch (error) {
        hooks.showError("Could not open folder", error instanceof Error ? error.message : String(error));
        return false;
      }

      if (project.csFiles.length === 0) {
        hooks.showError("No C# files", "The selected folder contains no .cs files.");
        return false;
      }

      // Parse manifest BEFORE mutating any module state, so a rejected
      // (newer/unrecognized) schemaVersion leaves everything untouched and
      // never writes to disk.
      let parsedManifest: Issue051Manifest;
      let existedOnDisk: boolean;
      if (project.manifestText !== null) {
        try {
          parsedManifest = parseManifest(project.manifestText, project.folderName);
          existedOnDisk = true;
        } catch (error) {
          hooks.showError(
            "Unsupported project",
            error instanceof Error ? error.message : String(error),
          );
          return false; // Nothing modified in the folder.
        }
      } else {
        parsedManifest = defaultManifest(project.folderName);
        existedOnDisk = false;
      }

      // Commit new project state.
      projectRoot = project.root;
      projectFolderName = project.folderName;
      manifest = parsedManifest;
      manifestOnDisk = existedOnDisk;
      contentFiles = project.contentFiles ?? [];
      files = project.csFiles.map(f => ({
        relativePath: f.relativePath,
        absolutePath: f.absolutePath,
        savedContent: f.content,
        currentContent: f.content,
        dirty: false,
      }));
      activePath = (api.primarySourcePath() ?? files[0].relativePath);
      const active = activeFile();
      if (active) hooks.setEditorContent(active.currentContent);
      hooks.setDirtyIndicator(false);
      renderExplorer();
      return true;
    },
    saveAll: async () => {
      if (projectRoot === null) return false;
      syncActiveBuffer();

      const dirtyFiles = files.filter(f => f.dirty);
      const manifestPath = `${projectRoot}/playground.json`;
      const manifestNeedsWrite = !manifestOnDisk;
      if (dirtyFiles.length === 0 && !manifestNeedsWrite) return true;

      // Write every dirty file, then the manifest. If any write throws, abort
      // and leave ALL dirty flags set (PRD 8.6 atomicity across Save All).
      try {
        for (const file of dirtyFiles) {
          await invoke("issue050_write_file", {
            path: file.absolutePath,
            content: file.currentContent,
          });
        }
        if (manifestNeedsWrite && manifest) {
          await invoke("issue050_write_file", {
            path: manifestPath,
            content: serializeManifest(manifest),
          });
        }
      } catch (error) {
        hooks.showError(
          "Save All failed",
          `${error instanceof Error ? error.message : String(error)} — no dirty flags were cleared.`,
        );
        return false;
      }

      // All writes succeeded: adopt current content as saved and clear dirty.
      for (const file of dirtyFiles) {
        file.savedContent = file.currentContent;
        file.dirty = false;
      }
      manifestOnDisk = true;
      hooks.setDirtyIndicator(false);
      renderExplorer();
      return true;
    },
  };

  return api;
}

export default installIssue051ProjectManager;

// Exposed for tests / debugging: reset module state.
export function __resetIssue051State(): void {
  projectRoot = null;
  projectFolderName = "";
  files = [];
  activePath = null;
  manifest = null;
  manifestOnDisk = false;
}

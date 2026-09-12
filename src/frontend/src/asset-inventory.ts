// Project asset inventory — the pure, DOM-free view model behind the file
// rail's asset browser (issue 064).
//
// It turns the project manager's discovered `Content/` inventory (the same
// bounded `project_read` result issue 051/052 already returns — no new binary
// channel or native command) into a conventional recursive file-explorer
// hierarchy: one `Content` root, arbitrarily nested folder/subfolder nodes, and
// leaf files identified by filename. It NEVER moves file bytes and it exposes
// NO per-file metadata (no kind tag, byte size, count, or profile/validation
// state) — only the folder/file structure, exactly like a plain file explorer.
//
// Ordering is deterministic: folders sort before files at every level, and both
// categories sort in a stable, locale-independent lexical order.
//
// The three "honest empty" states the issue requires are distinct here:
//   - `no-project`      — scratch mode, no folder open.
//   - `no-content-dir`  — a folder project without a `Content/` directory.
//   - `empty-content`   — a `Content/` directory with no discovered files.
// Only `contentRootExists` (added to `project_read` for issue 064) lets us tell
// the last two apart honestly.

/** One discovered content file, as returned by `project_read` (issue 051/052). */
export interface RawContentFile {
  /** Content-root-relative, forward-slashed path (e.g. "textures/player.png"). */
  relativePath: string;
}

/**
 * The project's content state, produced by the project manager. Structural on
 * purpose so `project-manager.ts` can satisfy it without importing this module
 * at runtime (it only imports the type).
 */
export interface ProjectContentSnapshot {
  /** Whether a folder project is currently open (false ⇒ scratch mode). */
  hasProject: boolean;
  /** Whether the project has a `Content/` directory on disk. */
  contentRootExists: boolean;
  /** The discovered files under `Content/`. */
  contentFiles: ReadonlyArray<RawContentFile>;
}

/** A leaf file node in the hierarchy (identified by filename only). */
export interface AssetFileNode {
  type: "file";
  /** Leaf file name (e.g. "player.png"). */
  name: string;
  /** Rooted display path (e.g. "Content/textures/player.png"), for uniqueness. */
  path: string;
}

/** A folder node in the hierarchy, holding nested folders and files. */
export interface AssetFolderNode {
  type: "folder";
  /** Folder name (the root's name is "Content"). */
  name: string;
  /** Rooted display path (e.g. "Content/textures"). */
  path: string;
  /**
   * Ordered children: all folders (lexical) first, then all files (lexical).
   * A conventional file-explorer ordering, applied at every level.
   */
  children: AssetNode[];
}

export type AssetNode = AssetFolderNode | AssetFileNode;

export type AssetInventory =
  | { state: "no-project" }
  | { state: "no-content-dir" }
  | { state: "empty-content" }
  | { state: "populated"; root: AssetFolderNode };

/** Locale-independent, stable comparator for deterministic ordering. */
function compareNames(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Split a Content-relative path into forward-slashed, non-empty segments. */
function pathSegments(relativePath: string): string[] {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(segment => segment.length > 0);
}

/** Mutable builder mirroring the final folder node while the tree is assembled. */
interface FolderBuilder {
  name: string;
  path: string;
  /** Child folders keyed by name (insertion order irrelevant; sorted on finalize). */
  folders: Map<string, FolderBuilder>;
  /** Child files (deduplicated by name; sorted on finalize). */
  files: Map<string, AssetFileNode>;
}

function newFolder(name: string, path: string): FolderBuilder {
  return { name, path, folders: new Map(), files: new Map() };
}

/** Freeze a folder builder into an ordered, immutable node (folders first). */
function finalizeFolder(builder: FolderBuilder): AssetFolderNode {
  const folders = [...builder.folders.values()]
    .sort((a, b) => compareNames(a.name, b.name))
    .map(finalizeFolder);
  const files = [...builder.files.values()].sort((a, b) => compareNames(a.name, b.name));
  return {
    type: "folder",
    name: builder.name,
    path: builder.path,
    children: [...folders, ...files],
  };
}

/**
 * Build the deterministic recursive `Content` hierarchy from a project content
 * snapshot. Pure: no DOM, no IO, no byte movement, no metadata.
 */
export function buildAssetInventory(snapshot: ProjectContentSnapshot): AssetInventory {
  if (!snapshot.hasProject) return { state: "no-project" };
  if (!snapshot.contentRootExists) return { state: "no-content-dir" };
  if (snapshot.contentFiles.length === 0) return { state: "empty-content" };

  const root = newFolder("Content", "Content");

  for (const file of snapshot.contentFiles) {
    const segments = pathSegments(file.relativePath);
    if (segments.length === 0) continue; // defensively skip a path with no leaf

    // Descend/create the folder chain (all segments but the last are folders).
    let folder = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i];
      let child = folder.folders.get(name);
      if (!child) {
        child = newFolder(name, `${folder.path}/${name}`);
        folder.folders.set(name, child);
      }
      folder = child;
    }

    const leaf = segments[segments.length - 1];
    folder.files.set(leaf, { type: "file", name: leaf, path: `${folder.path}/${leaf}` });
  }

  // A project whose files all normalise away (defensive) is still empty.
  if (root.folders.size === 0 && root.files.size === 0) return { state: "empty-content" };

  return { state: "populated", root: finalizeFolder(root) };
}

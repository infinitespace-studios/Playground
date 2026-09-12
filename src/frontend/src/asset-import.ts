// Asset import — the pure, DOM-free logic behind the picker and drag/drop
// import workflows (issue 066). It sits above the bounded native copy primitive
// `project_import_asset` (issue 065) and the asset rail (issue 064).
//
// Responsibilities (all pure and directly unit-testable):
//   - map a recognized source file to its visible default Content folder
//     (`Textures`, `Audio`, `Precompiled`) and a Content-relative destination,
//   - classify a batch of dropped/picked sources into importable candidates
//     (with an editable default destination) and rejected entries (unsupported
//     type, folders/URLs, or an unreadable name), keeping mixed batches honest,
//   - validate a user-edited Content-relative destination the same way the Rust
//     command does (so the confirmation dialog can reject before any write),
//   - drive a SEQUENTIAL import through an injected invoker and aggregate an
//     accurate per-file result (imported / conflict / error) where one failure
//     never misreports another file.
//
// It NEVER moves file bytes itself (the Rust command does), performs no IO, and
// touches no DOM. The controller (`asset-import-controller.ts`) owns the UI and
// the actual `__TAURI_INTERNALS__` invokes.

/** Supported source/destination extensions (mirrors the Rust allowlist). */
export const SUPPORTED_EXTENSIONS = ["png", "jpg", "jpeg", "bmp", "wav", "xnb"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/** The three visible default destination folders under `Content/`. */
export type DefaultFolder = "Textures" | "Audio" | "Precompiled";

/**
 * Map a lowercased supported extension to its visible default Content folder:
 *   png/jpg/jpeg/bmp → Textures, wav → Audio, xnb → Precompiled.
 * Returns null for an unsupported extension. Pure.
 */
export function defaultFolderForExtension(extension: string): DefaultFolder | null {
  switch (extension.toLowerCase()) {
    case "png":
    case "jpg":
    case "jpeg":
    case "bmp":
      return "Textures";
    case "wav":
      return "Audio";
    case "xnb":
      return "Precompiled";
    default:
      return null;
  }
}

/**
 * Extract the trailing path component from an OS path (Windows or POSIX style),
 * with no directory separators. Empty when the path ends in a separator (a
 * folder) or is empty. Pure.
 */
export function baseName(path: string): string {
  // Split on both separators; the last non-trivial segment is the file name.
  const parts = path.split(/[/\\]/);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

/**
 * The lowercased extension of a file name (without the dot), or null when there
 * is none (no dot, or a trailing/leading dot only). Pure.
 */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** A source that can be imported: its default editable destination is known. */
export interface ImportCandidate {
  /** Absolute source path as reported by the picker/drop payload. */
  sourcePath: string;
  /** The source file's display name (basename). */
  fileName: string;
  /** Lowercased supported extension. */
  extension: SupportedExtension;
  /** The default visible folder (Textures/Audio/Precompiled). */
  defaultFolder: DefaultFolder;
  /** Default Content-relative destination, e.g. "Textures/player.png". */
  defaultDestination: string;
}

/** A source that cannot be imported, with an honest human reason. */
export interface ImportRejection {
  sourcePath: string;
  fileName: string;
  reason: string;
}

/** The classification of a whole batch: importable candidates + rejections. */
export interface ImportPlan {
  candidates: ImportCandidate[];
  rejections: ImportRejection[];
}

/**
 * Classify a batch of source paths into importable candidates (each with a
 * default editable Content-relative destination) and rejections. Recognized
 * types are mapped to their default folder; folders/URLs/unsupported types are
 * rejected with a reason and write nothing. Order is preserved. Pure.
 *
 * A source that looks like a URL (has a scheme such as `http:` or `file:`) is
 * rejected: the desktop drop/picker only yields local file paths, and a URL is
 * never a local source to copy.
 */
export function classifySources(sourcePaths: ReadonlyArray<string>): ImportPlan {
  const candidates: ImportCandidate[] = [];
  const rejections: ImportRejection[] = [];

  for (const sourcePath of sourcePaths) {
    const fileName = baseName(sourcePath);

    // A URL (scheme://…) or a Windows/DOS URL scheme is not a local file path.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(sourcePath)) {
      rejections.push({
        sourcePath,
        fileName: fileName || sourcePath,
        reason: "URLs are not supported — drop or pick a local file.",
      });
      continue;
    }

    // A trailing separator (or empty basename) indicates a folder, not a file.
    if (fileName.length === 0) {
      rejections.push({
        sourcePath,
        fileName: sourcePath,
        reason: "Folders are not supported — import individual files.",
      });
      continue;
    }

    const extension = extensionOf(fileName);
    const folder = extension ? defaultFolderForExtension(extension) : null;
    if (!extension || !folder) {
      rejections.push({
        sourcePath,
        fileName,
        reason: extension
          ? `Unsupported type ".${extension}" — only images, .wav, and .xnb import.`
          : "Unsupported file — it has no recognized extension.",
      });
      continue;
    }

    candidates.push({
      sourcePath,
      fileName,
      extension: extension as SupportedExtension,
      defaultFolder: folder,
      defaultDestination: `${folder}/${fileName}`,
    });
  }

  return { candidates, rejections };
}

/**
 * Validate a user-edited Content-relative destination path, mirroring the Rust
 * command's rules so the confirmation dialog can reject before any write:
 * non-empty and ≤1024 bytes, relative (no leading slash, backslash, or drive
 * colon), no empty / `.` / `..` / hidden (dot-prefixed) segments, only
 * `[A-Za-z0-9._- ]` characters, no Windows-hostile segments (reserved device
 * stems, leading/trailing space, trailing dot), and a supported extension.
 * Returns null on success or a human error string. Pure.
 */
const WINDOWS_RESERVED_STEMS = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

export function validateDestination(destination: string): string | null {
  if (destination.length === 0) return "Destination must not be empty.";
  // Byte length (UTF-8) must not exceed 1024, matching the Rust bound.
  if (new TextEncoder().encode(destination).length > 1024) {
    return "Destination path is too long.";
  }
  if (
    destination.startsWith("/") ||
    destination.startsWith("\\") ||
    destination.includes(":")
  ) {
    return "Destination must be a relative path under Content/.";
  }
  const segments = destination.replaceAll("\\", "/").split("/");
  for (const segment of segments) {
    if (segment.length === 0) return "Destination must not contain empty segments.";
    if (segment === "." || segment === "..") {
      return "Destination must not contain '.' or '..'.";
    }
    if (segment.startsWith(".")) {
      return "Destination must not contain hidden (dot-prefixed) names.";
    }
    if (!/^[A-Za-z0-9._ -]+$/.test(segment)) {
      return "Destination contains an unsupported character.";
    }
    if (segment.startsWith(" ") || segment.endsWith(" ")) {
      return "Destination segment must not have leading or trailing spaces.";
    }
    if (segment.endsWith(".")) {
      return "Destination segment must not end with a dot.";
    }
    const stem = segment.split(".")[0].toLowerCase();
    if (WINDOWS_RESERVED_STEMS.has(stem)) {
      return `Destination uses a reserved device name: ${segment}`;
    }
  }
  const fileName = segments[segments.length - 1];
  const extension = extensionOf(fileName);
  if (!extension) return "Destination file must have an extension.";
  if (!SUPPORTED_EXTENSIONS.includes(extension as SupportedExtension)) {
    return `Unsupported content extension: ${extension}`;
  }
  return null;
}

/** One entry to import: a source path and the confirmed relative destination. */
export interface ImportRequest {
  sourcePath: string;
  fileName: string;
  destination: string;
}

/** The structured outcome of importing one file. */
export type ImportOutcome =
  | { status: "imported"; request: ImportRequest; relativePath: string; byteLength: number; sha256: string }
  | { status: "conflict"; request: ImportRequest; relativePath: string }
  | { status: "error"; request: ImportRequest; message: string };

/** The aggregate outcome of a whole sequential batch. */
export interface ImportSummary {
  outcomes: ImportOutcome[];
  imported: number;
  conflicts: number;
  errors: number;
}

/**
 * The native `project_import_asset` invoker, injected so the sequential driver
 * is testable without Tauri. Resolves to the Rust command's structured JSON,
 * rejects (throws) on a native error.
 */
export type ImportInvoker = (request: ImportRequest) => Promise<{
  status?: string;
  relativePath?: string;
  byteLength?: number;
  sha256?: string;
}>;

/**
 * Import a batch SEQUENTIALLY (one native call at a time), collecting an honest
 * per-file outcome. A rejected/failed file is recorded as `error` and does NOT
 * abort the batch or misreport any other file; a `conflict` result is recorded
 * distinctly (the command never overwrites). Pure control flow over the
 * injected invoker — no DOM, no direct IO. Returns the aggregate summary.
 */
export async function importSequentially(
  requests: ReadonlyArray<ImportRequest>,
  invoke: ImportInvoker,
): Promise<ImportSummary> {
  const outcomes: ImportOutcome[] = [];
  let imported = 0;
  let conflicts = 0;
  let errors = 0;

  for (const request of requests) {
    try {
      const result = await invoke(request);
      if (result?.status === "imported") {
        outcomes.push({
          status: "imported",
          request,
          relativePath: result.relativePath ?? request.destination,
          byteLength: typeof result.byteLength === "number" ? result.byteLength : 0,
          sha256: result.sha256 ?? "",
        });
        imported++;
      } else if (result?.status === "conflict") {
        outcomes.push({
          status: "conflict",
          request,
          relativePath: result.relativePath ?? request.destination,
        });
        conflicts++;
      } else {
        // An unrecognized native shape is an error for THIS file only.
        outcomes.push({
          status: "error",
          request,
          message: "Unexpected import result from the shell.",
        });
        errors++;
      }
    } catch (error) {
      outcomes.push({
        status: "error",
        request,
        message: error instanceof Error ? error.message : String(error),
      });
      errors++;
    }
  }

  return { outcomes, imported, conflicts, errors };
}

/**
 * Geometry hit-test for the drop affordance: whether a cursor position (in CSS
 * pixels) falls inside a rectangle. The native drag/drop payload carries
 * physical pixels; the controller divides by devicePixelRatio before calling
 * this. Pure. Used only to gate the visual highlight and to confirm a drop
 * landed on the asset rail (the real security boundary is the sandboxed preview
 * iframe, which can never receive a native drop).
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function positionInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

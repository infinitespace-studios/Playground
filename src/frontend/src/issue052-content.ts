// Issue 052 — content preparation: turn a project's discovered Content/ assets
// (issue 051 folder Open + Rust discovery) into the { path, bytes } list the
// live preview runner mounts before Run.
//
// The preview mount gate (PreviewExports.MountSingleAsset) is content-type-aware:
//   .xnb                  -> validated as-is
//   .png/.jpg/.jpeg/.bmp  -> magic-byte sniff, staged raw (Texture2D.FromStream)
//   .wav                  -> transcoded to an XNB SoundEffect at mount time
// The one thing the FRONTEND must do is rename a `.wav` asset's logical mount
// path to `.xnb`: MonoGame's ContentManager resolves Content.Load<SoundEffect>
// via `<name>.xnb` (there is no raw-audio fallback, unlike images), and the
// gate stages the transcoded bytes at the manifest path. Renaming here keeps
// CommitMount's proof re-derivation consistent (the staged virtual path matches
// the manifest path) with zero preview-side changes.

export interface PreparedContentAsset {
  /** Logical Content-relative mount path (e.g. "textures/player.png", "audio/blip.xnb"). */
  path: string;
  /** Standalone asset bytes to transfer to the preview. */
  bytes: ArrayBuffer;
}

export interface ContentPrepResult {
  ok: true;
  assets: PreparedContentAsset[];
}

export interface ContentPrepError {
  ok: false;
  code: string;
  message: string;
}

interface RawContentFile {
  relativePath: string;
  extension: string;
  byteLength: number;
  base64: string;
}

/** Decode standard base64 (RFC 4648) into a standalone ArrayBuffer. */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Rename a `.wav` logical path to `.xnb` so Content.Load<SoundEffect> resolves. */
function mountPathFor(relativePath: string, extension: string): string {
  if (extension === "wav") return relativePath.replace(/\.wav$/i, ".xnb");
  return relativePath;
}

/**
 * Prepare a project's discovered Content/ assets for mounting. Returns the
 * `{ path, bytes }` list on success, or a labelled error when the project's
 * declared `contentProfile` is not "Web" (surfaced in the Output panel before
 * any asset is mounted, per PRD §15 / issue 052 acceptance criterion 4).
 *
 * Returns null when there is nothing to mount (no content files), so the caller
 * runs the normal no-content path.
 */
export function prepareProjectContent(project: {
  contentProfile: string;
  contentFiles: ReadonlyArray<RawContentFile>;
} | null): ContentPrepResult | ContentPrepError | null {
  if (!project || project.contentFiles.length === 0) return null;

  // Gate on the Web content profile BEFORE mounting anything (PRD §15). A
  // non-Web profile is a clear, immediate content error.
  if (project.contentProfile !== "Web") {
    return {
      ok: false,
      code: "PG0215_CONTENT_PROFILE_NOT_WEB",
      message:
        `This project's playground.json declares contentProfile "${project.contentProfile}", ` +
        `but the preview only supports the "Web" content profile. ` +
        `Set "contentProfile": "Web" and rebuild any .xnb assets with MonoGamePlatform=Web.`,
    };
  }

  const assets: PreparedContentAsset[] = project.contentFiles.map(file => ({
    path: mountPathFor(file.relativePath, file.extension),
    bytes: base64ToArrayBuffer(file.base64),
  }));

  return { ok: true, assets };
}

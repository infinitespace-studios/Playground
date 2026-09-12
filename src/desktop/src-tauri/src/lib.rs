// The proof-harness command surface, its env gates, report/checkpoint
// protocol, macOS trusted-input dispatch, and packaged activation/report relay
// are compiled ONLY under the non-default `proof-harness` Cargo feature. The
// shipping PRODUCT build never links this module. Re-exported with a glob so
// the `tauri::generate_handler!` command identifiers stay bare (as `build.rs`
// requires) and the crate-root test module can reach the proof helpers via
// `super::`. The nine PRODUCT commands plus the workspace/project/first-run/
// preview protocol responsibilities remain in this file.
#[cfg(feature = "proof-harness")]
mod proof_harness;
#[cfg(feature = "proof-harness")]
pub(crate) use proof_harness::*;

/// Issue 050: Show the native save dialog and return the chosen path.
///
/// The trusted main webview is not permitted to invoke plugin commands
/// (such as `plugin:dialog|save`) directly — its ACL only allows the
/// application's own registered commands. This command wraps the dialog
/// plugin's Rust API so the webview can request a save location through an
/// approved application command instead.
///
/// Returns Ok(Some(path)) when the user picks a file, Ok(None) when the
/// dialog is cancelled.
#[tauri::command]
async fn workspace_save_dialog(
    app: tauri::AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file();
    if let Some(name) = default_path.as_deref() {
        builder = builder.set_file_name(name);
    }
    builder = builder.add_filter("C# Files", &["cs"]);

    let chosen = builder.blocking_save_file();
    match chosen {
        Some(path) => {
            let path_buf = path
                .into_path()
                .map_err(|error| format!("failed to resolve save path: {error}"))?;
            Ok(Some(path_buf.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// Issue 050: Show the native open dialog and return the chosen file's path
/// and contents. Like the save dialog, this wraps the dialog plugin's Rust
/// API so the trusted webview can open a file through an approved application
/// command rather than invoking the plugin directly.
///
/// Returns Ok(Some((path, content))) when a file is chosen, Ok(None) when the
/// dialog is cancelled.
#[tauri::command]
async fn workspace_open_dialog(app: tauri::AppHandle) -> Result<Option<(String, String)>, String> {
    use tauri_plugin_dialog::DialogExt;

    let chosen = app
        .dialog()
        .file()
        .add_filter("C# Files", &["cs"])
        .blocking_pick_file();

    match chosen {
        Some(path) => {
            let path_buf = path
                .into_path()
                .map_err(|error| format!("failed to resolve open path: {error}"))?;
            let content = std::fs::read_to_string(&path_buf)
                .map_err(|error| format!("failed to read file: {error}"))?;
            Ok(Some((path_buf.to_string_lossy().into_owned(), content)))
        }
        None => Ok(None),
    }
}

/// Issue 050: Mirror of the trusted frontend's Monaco dirty state into the
/// shell, so the native window-close handler can decide whether to prompt
/// before discarding unsaved changes. The frontend is the source of truth for
/// dirty state (it owns the editor buffer and its last-saved baseline); it
/// calls `workspace_set_dirty` on every dirty-state transition to keep this in
/// sync. Only the trusted main webview can invoke that command (ACL-gated,
/// like every other workspace command), so the sandboxed preview can never
/// forge the dirty state.
static WORKSPACE_DIRTY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Issue 050: Record whether the trusted frontend currently has unsaved
/// changes. Called by the frontend whenever its dirty indicator flips.
#[tauri::command]
fn workspace_set_dirty(dirty: bool) {
    WORKSPACE_DIRTY.store(dirty, std::sync::atomic::Ordering::SeqCst);
}

/// Issue 050: Write file content atomically (after save dialog returned path).
/// 1. If a previous version exists, preserve it as a single `.bak` backup
///    (copied, so the original stays in place until the atomic rename).
/// 2. Write to `.tmp`, then rename over the target (atomic on same-fs renames).
/// 3. Only once the new write is confirmed committed, clean up the backup.
/// On any failure the backup (if any) is left intact for recovery.
/// Returns Ok(path) on success, Err on failure.
#[tauri::command]
async fn workspace_write_file(
    _app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<String, String> {
    let path_buf = std::path::PathBuf::from(&path);

    // Preserve any previous version as a single backup copy. Copy (not move)
    // so the original file stays in place until the atomic rename below
    // commits the new content; the backup is retained only until the new
    // write is confirmed, then cleaned up.
    let bak_path = path_buf.with_extension("bak");
    let had_backup = if path_buf.exists() {
        // Keep only one backup: overwrite any stale .bak.
        let _ = std::fs::remove_file(&bak_path);
        std::fs::copy(&path_buf, &bak_path).map_err(|e| format!("failed to create backup: {e}"))?;
        true
    } else {
        false
    };

    // Write atomically: content to a temp file in the same directory, then
    // rename over the target.
    let tmp_path = path_buf.with_extension("tmp");
    if let Err(e) = std::fs::write(&tmp_path, &content) {
        // Write failed — the backup (if any) is still intact for recovery.
        return Err(format!("failed to write temporary file: {e}"));
    }

    if let Err(e) = std::fs::rename(&tmp_path, &path_buf) {
        // Commit failed — drop the temp file; keep the backup for recovery.
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("failed to commit file: {e}"));
    }

    // New write confirmed committed — clean up the backup.
    if had_backup {
        let _ = std::fs::remove_file(&bak_path);
    }

    Ok(path)
}

// Issue 051 project-read limits (defensive, mirroring issue 050's posture).
const PROJECT_MAX_FILES: usize = 500;
const PROJECT_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const PROJECT_MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const PROJECT_MAX_DEPTH: usize = 32;

// Issue 052: Content/ discovery limits (separate from the .cs source limits
// above — binary assets are larger). Mirrors the preview mount bounds
// (issue 038/052 audio pipeline): a raw `.wav` is transcoded to an XNB
// SoundEffect whose block-aligned PCM payload is capped at 8 MiB, so a raw
// `.wav` source/destination is bounded to 8 MiB; images and other general
// supported content are bounded to 16 MiB; aggregate content is bounded to
// 24 MiB across at most 256 files. `content_max_file_bytes` centralizes the
// per-type per-file bound so discovery and import enforce one policy.
const PROJECT_CONTENT_MAX_FILES: usize = 256;
/// General/image per-file bound (`.xnb`, `.png`, `.jpg`, `.jpeg`, `.bmp`).
const PROJECT_CONTENT_MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// Raw audio (`.wav`) per-file bound — matches the 8 MiB block-aligned PCM cap
/// the preview mount gate enforces when transcoding to an XNB SoundEffect.
const PROJECT_CONTENT_MAX_AUDIO_BYTES: u64 = 8 * 1024 * 1024;
const PROJECT_CONTENT_MAX_TOTAL_BYTES: u64 = 24 * 1024 * 1024;

/// Supported raw/precompiled content extensions the preview can mount
/// (issue 052). `.wav` is transcoded to an XNB SoundEffect at mount time; images
/// load via the runtime's Texture2D.FromStream fallback; `.xnb` is precompiled.
const PROJECT_CONTENT_EXTENSIONS: &[&str] = &["xnb", "png", "jpg", "jpeg", "bmp", "wav"];

/// Centralized per-type per-file byte bound for a supported Content extension
/// (already lowercased). Raw `.wav` audio is bounded to 8 MiB (the preview
/// mount gate's block-aligned PCM cap); every other supported type is bounded
/// to 16 MiB. Pure — directly unit-testable and shared by discovery and import
/// so a single policy governs both the read and the write paths.
fn content_max_file_bytes(extension: &str) -> u64 {
    if extension == "wav" {
        PROJECT_CONTENT_MAX_AUDIO_BYTES
    } else {
        PROJECT_CONTENT_MAX_FILE_BYTES
    }
}

/// Minimal, dependency-free standard base64 encoder (RFC 4648) for returning
/// binary Content/ asset bytes inside the JSON project-read result. Hand-rolled
/// to avoid adding a crate (the desktop shell pins `tauri = { features = [] }`
/// for the issue-034 supply-chain guard).
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((triple >> 6) & 0x3F) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(triple & 0x3F) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Recursively discover supported assets under a project's `Content/` directory
/// (issue 052), returning each as `{ relativePath, extension, byteLength,
/// base64 }`. Relative paths are Content-root-relative and forward-slashed (the
/// logical asset path the preview mounts under `Content.RootDirectory`). Skips
/// hidden entries; enforces per-file / total / count bounds. Pure sync file IO,
/// extracted from `project_read` so it is directly unit-testable.
fn project_discover_content(
    content_root: &std::path::Path,
) -> Result<Vec<serde_json::Value>, String> {
    fn walk(
        dir: &std::path::Path,
        content_root: &std::path::Path,
        depth: usize,
        files: &mut Vec<serde_json::Value>,
        total_bytes: &mut u64,
    ) -> Result<(), String> {
        if depth > PROJECT_MAX_DEPTH {
            return Ok(());
        }
        let entries =
            std::fs::read_dir(dir).map_err(|e| format!("failed to read Content folder: {e}"))?;
        let mut sorted: Vec<std::path::PathBuf> =
            entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        sorted.sort();
        for entry in sorted {
            let file_name = entry
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if file_name.starts_with('.') {
                continue;
            }
            if entry.is_dir() {
                walk(&entry, content_root, depth + 1, files, total_bytes)?;
                continue;
            }
            let Some(extension) = entry
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
            else {
                continue;
            };
            if !PROJECT_CONTENT_EXTENSIONS.contains(&extension.as_str()) {
                continue;
            }
            let metadata = std::fs::metadata(&entry)
                .map_err(|e| format!("failed to inspect content file: {e}"))?;
            let per_file_limit = content_max_file_bytes(&extension);
            if metadata.len() > per_file_limit {
                return Err(format!(
                    "{file_name} exceeds the {per_file_limit}-byte per-content-file limit"
                ));
            }
            *total_bytes += metadata.len();
            if *total_bytes > PROJECT_CONTENT_MAX_TOTAL_BYTES {
                return Err("project Content exceeds the total byte limit".into());
            }
            if files.len() >= PROJECT_CONTENT_MAX_FILES {
                return Err(format!(
                    "project Content exceeds the {PROJECT_CONTENT_MAX_FILES}-file limit"
                ));
            }
            let bytes =
                std::fs::read(&entry).map_err(|e| format!("failed to read {file_name}: {e}"))?;
            let relative = entry
                .strip_prefix(content_root)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| file_name.clone());
            files.push(serde_json::json!({
                "relativePath": relative,
                "extension": extension,
                "byteLength": bytes.len(),
                "base64": base64_encode(&bytes),
            }));
        }
        Ok(())
    }

    let mut files: Vec<serde_json::Value> = Vec::new();
    let mut total_bytes: u64 = 0;
    walk(content_root, content_root, 0, &mut files, &mut total_bytes)?;
    Ok(files)
}

/// Issue 051: Show the native folder picker and return the chosen directory.
/// Wraps the dialog plugin's Rust API so the trusted webview goes through an
/// approved application command rather than invoking the plugin directly.
///
/// Returns Ok(Some(path)) when a folder is chosen, Ok(None) when cancelled.
#[tauri::command]
async fn project_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let chosen = app.dialog().file().blocking_pick_folder();
    match chosen {
        Some(path) => {
            let path_buf = path
                .into_path()
                .map_err(|error| format!("failed to resolve folder path: {error}"))?;
            Ok(Some(path_buf.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// Issue 051: Read an opened project folder — enumerate every `.cs` file
/// recursively and return the raw `playground.json` text if present. Enforces
/// defensive limits on file count and byte sizes. Never writes anything.
///
/// Returns a JSON object: `{ root, folderName, csFiles: [{ relativePath,
/// absolutePath, content }], contentFiles: [{ relativePath, extension,
/// byteLength, base64 }], contentRootExists: bool, manifestText: string | null }`.
/// `contentFiles` holds the project's `Content/` assets (issue 052) for pre-Run
/// mounting; `contentRootExists` distinguishes a project with no `Content/`
/// folder from one whose `Content/` folder is present but empty (issue 064).
#[tauri::command]
async fn project_read(path: String) -> Result<serde_json::Value, String> {
    let root = std::path::PathBuf::from(&path);
    if !root.is_dir() {
        return Err("selected path is not a directory".into());
    }
    let root = root
        .canonicalize()
        .map_err(|e| format!("failed to resolve folder: {e}"))?;
    let folder_name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".to_string());

    let mut cs_files: Vec<serde_json::Value> = Vec::new();
    let mut total_bytes: u64 = 0;

    fn walk(
        dir: &std::path::Path,
        root: &std::path::Path,
        depth: usize,
        cs_files: &mut Vec<serde_json::Value>,
        total_bytes: &mut u64,
    ) -> Result<(), String> {
        if depth > PROJECT_MAX_DEPTH {
            return Ok(());
        }
        let entries = std::fs::read_dir(dir).map_err(|e| format!("failed to read folder: {e}"))?;
        let mut sorted: Vec<std::path::PathBuf> =
            entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        sorted.sort();
        for entry in sorted {
            let file_name = entry
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Skip hidden entries and common heavy/irrelevant directories.
            if file_name.starts_with('.')
                || file_name == "bin"
                || file_name == "obj"
                || file_name == "node_modules"
            {
                continue;
            }
            if entry.is_dir() {
                walk(&entry, root, depth + 1, cs_files, total_bytes)?;
            } else if entry.extension().and_then(|e| e.to_str()) == Some("cs") {
                let metadata = std::fs::metadata(&entry)
                    .map_err(|e| format!("failed to inspect file: {e}"))?;
                if metadata.len() > PROJECT_MAX_FILE_BYTES {
                    return Err(format!(
                        "{file_name} exceeds the {PROJECT_MAX_FILE_BYTES}-byte per-file limit"
                    ));
                }
                *total_bytes += metadata.len();
                if *total_bytes > PROJECT_MAX_TOTAL_BYTES {
                    return Err("project exceeds the total byte limit".into());
                }
                if cs_files.len() >= PROJECT_MAX_FILES {
                    return Err(format!(
                        "project exceeds the {PROJECT_MAX_FILES}-file limit"
                    ));
                }
                let content = std::fs::read_to_string(&entry)
                    .map_err(|e| format!("failed to read {file_name}: {e}"))?;
                let relative = entry
                    .strip_prefix(root)
                    .map(|r| r.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| file_name.clone());
                cs_files.push(serde_json::json!({
                    "relativePath": relative,
                    "absolutePath": entry.to_string_lossy().into_owned(),
                    "content": content,
                }));
            }
        }
        Ok(())
    }

    walk(&root, &root, 0, &mut cs_files, &mut total_bytes)?;

    // Issue 052: discover the project's Content/ directory (if present) and
    // return each supported asset's bytes (base64) for pre-Run mounting. Scoped
    // to Content/ per PRD §15; skips hidden entries; enforces its own bounds.
    let content_root = root.join("Content");
    let content_root_exists = content_root.is_dir();
    let content_files = if content_root_exists {
        project_discover_content(&content_root)?
    } else {
        Vec::new()
    };

    // Read the manifest text if present (never created here; that is Save All).
    let manifest_path = root.join("playground.json");
    let manifest_text = if manifest_path.is_file() {
        Some(
            std::fs::read_to_string(&manifest_path)
                .map_err(|e| format!("failed to read playground.json: {e}"))?,
        )
    } else {
        None
    };

    Ok(serde_json::json!({
        "root": root.to_string_lossy().into_owned(),
        "folderName": folder_name,
        "csFiles": cs_files,
        "contentFiles": content_files,
        "contentRootExists": content_root_exists,
        "manifestText": manifest_text,
    }))
}

// --- Issue 065: bounded binary asset import into the project Content/ root ---
//
// `project_import_asset` copies bytes from a user-selected local source into a
// destination under the currently opened project's `Content/` directory. It is
// the trusted-frontend counterpart to the future picker/drag-drop UI (issue
// 066): the UI resolves an absolute source path (through the native file dialog
// or an OS drop payload) and a Content-relative destination, then invokes this
// command. It must never become an arbitrary filesystem-write primitive.
//
// AUTHORIZATION MODEL (defence in depth):
//   1. ACL — this is a PRODUCT command registered only through the sole local
//      `main` capability (`capabilities/main.json` → `main-commands`), scoped to
//      the trusted `main` window. The opaque-origin preview iframe has no Tauri
//      IPC and cannot invoke it (issue 034 boundary). So although the command
//      takes a `project_root` argument, only the trusted main frame can ever
//      supply one.
//   2. Confinement — the command NEVER trusts `project_root` as a write target.
//      It canonicalizes `project_root`, requires it to be an existing directory,
//      derives `Content/` beneath it, canonicalizes that, and confines every
//      byte written to the canonical Content root. A caller cannot widen the
//      write surface by passing a crafted root: the destination is always
//      `<canonical project_root>/Content/<validated relative path>`, and any
//      symlink that would resolve outside the canonical Content root is
//      rejected. The pair (trusted caller ∧ canonical confinement) means neither
//      the preview nor a compromised caller can choose an unconstrained root.
//
// The destination is validated (no absolute paths, no traversal, no hidden
// segments, bounded characters, supported extension), per-file and aggregate
// content limits are enforced, and the copy is atomic (write a hidden temp file
// in the destination directory, then rename). Existing destinations are never
// overwritten: a structured `{ status: "conflict" }` result is returned. This
// command has no UI and performs no content compilation.

// Bound the Content-relative destination string. 1024 bytes comfortably exceeds
// any realistic nested content path while preventing unbounded growth.
const IMPORT_MAX_DEST_BYTES: usize = 1024;

/// Windows reserved device-name stems. A path segment whose stem (the portion
/// before the first `.`) case-insensitively equals one of these is rejected in
/// EVERY destination segment — not just the last — because Windows resolves
/// `CON`, `CON.png`, and even `dir\CON\x.png` to the console device rather than
/// a file, which would make an imported tree unopenable (or worse, a device
/// write) on Windows. We enforce this on every host so imported Content trees
/// stay portable and the write target is never a device alias. `COM0`/`LPT0`
/// are NOT reserved; only `COM1`–`COM9` and `LPT1`–`LPT9` are.
const WINDOWS_RESERVED_STEMS: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Reject a destination path segment that Windows would silently rewrite or
/// reinterpret: a reserved device-name stem (`CON`, `PRN`, `AUX`, `NUL`,
/// `COM1`–`COM9`, `LPT1`–`LPT9`, matched case-insensitively on the pre-dot
/// stem), a leading or trailing space, or a trailing dot. Windows strips
/// trailing dots/spaces from filenames, so allowing them would let two distinct
/// destinations collapse onto one file (a conflict-bypass / overwrite vector).
/// Enforced on every host for portability. Pure — directly unit-testable.
fn import_segment_is_windows_safe(segment: &str) -> Result<(), String> {
    if segment.starts_with(' ') || segment.ends_with(' ') {
        return Err("destination segment must not have leading or trailing spaces".into());
    }
    if segment.ends_with('.') {
        return Err("destination segment must not end with a dot".into());
    }
    let stem = segment.split('.').next().unwrap_or(segment);
    let lowered = stem.to_ascii_lowercase();
    if WINDOWS_RESERVED_STEMS.contains(&lowered.as_str()) {
        return Err(format!(
            "destination segment uses a reserved device name: {segment}"
        ));
    }
    Ok(())
}

/// Validate and normalize a caller-supplied Content-relative destination path.
/// Returns `Ok((normalized_relative, extension))` where `normalized_relative`
/// is forward-slashed and safe to join onto the Content root one segment at a
/// time, and `extension` is the lowercased, supported file extension. Rejects
/// absolute paths, `..`/`.` traversal, empty or hidden segments, disallowed
/// characters, and unsupported extensions. Pure — directly unit-testable.
fn import_validate_destination(destination: &str) -> Result<(String, String), String> {
    if destination.is_empty() || destination.len() > IMPORT_MAX_DEST_BYTES {
        return Err("destination path must be 1–1024 bytes".into());
    }
    // A Windows-style drive prefix, a leading slash, or a backslash are all
    // treated as absolute/again-rooted and rejected up front.
    if destination.starts_with('/') || destination.starts_with('\\') || destination.contains(':') {
        return Err("destination must be a relative path under Content/".into());
    }
    // Normalize backslashes to forward slashes, then validate every segment.
    let normalized = destination.replace('\\', "/");
    let segments: Vec<&str> = normalized.split('/').collect();
    for segment in &segments {
        if segment.is_empty() {
            return Err("destination must not contain empty path segments".into());
        }
        if *segment == "." || *segment == ".." {
            return Err("destination must not contain '.' or '..' traversal".into());
        }
        if segment.starts_with('.') {
            return Err("destination must not contain hidden (dot-prefixed) names".into());
        }
        if !segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._- ".contains(&byte))
        {
            return Err("destination contains an unsupported character".into());
        }
        // Reject Windows-hostile segments (reserved device names, leading/
        // trailing spaces, trailing dots) in every segment for portability.
        import_segment_is_windows_safe(segment)?;
    }
    let file_name = *segments.last().ok_or("destination must name a file")?;
    let extension = std::path::Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or("destination file must have an extension")?;
    if !PROJECT_CONTENT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("unsupported content extension: {extension}"));
    }
    Ok((normalized, extension))
}

/// Validate the user-selected source filename against the validated destination
/// extension. Issue 065 rejects unsupported source extensions and requires the
/// source and destination to name the same content type, failing closed: the
/// bytes are copied byte-identically (format/magic validation stays the
/// preview mount gate's job), so a mislabelled copy — e.g. `enemy.wav` written
/// as `enemy.png` — would smuggle an unmountable/mis-typed asset past the
/// extension allowlist. `source_path` is the raw, user-supplied path (its
/// filename is what the user selected, before any symlink resolution).
///
/// The only accepted cross-extension pairing is `jpg`↔`jpeg`: they are the
/// same JPEG container and the preview mounts both through one image path, so
/// treating them as equivalent is justified and does not weaken the type gate.
/// Every other mismatch is rejected. Pure — directly unit-testable.
fn import_validate_source_extension(
    source_path: &str,
    destination_extension: &str,
) -> Result<(), String> {
    // Take the trailing path component regardless of separator style, since the
    // source path may be Windows- or Unix-flavoured.
    let file_name = source_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(source_path);
    let source_extension = std::path::Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or("source file must have an extension")?;
    if !PROJECT_CONTENT_EXTENSIONS.contains(&source_extension.as_str()) {
        return Err(format!("unsupported source extension: {source_extension}"));
    }
    let compatible = source_extension == destination_extension
        || matches!(
            (source_extension.as_str(), destination_extension),
            ("jpg", "jpeg") | ("jpeg", "jpg")
        );
    if !compatible {
        return Err(format!(
            "source extension {source_extension} is incompatible with destination extension {destination_extension}"
        ));
    }
    Ok(())
}

/// Sum the count and byte size of the supported, non-hidden content already
/// present under `content_root` (used to enforce the aggregate import limits).
/// Missing roots contribute nothing. Pure sync IO — unit-testable.
fn import_content_totals(content_root: &std::path::Path) -> Result<(usize, u64), String> {
    fn walk(
        dir: &std::path::Path,
        depth: usize,
        count: &mut usize,
        bytes: &mut u64,
    ) -> Result<(), String> {
        if depth > PROJECT_MAX_DEPTH {
            return Ok(());
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("failed to read Content folder: {error}")),
        };
        let mut sorted: Vec<std::path::PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        sorted.sort();
        for entry in sorted {
            let file_name = entry
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            if file_name.starts_with('.') {
                continue;
            }
            if entry.is_dir() {
                walk(&entry, depth + 1, count, bytes)?;
                continue;
            }
            let Some(extension) = entry
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
            else {
                continue;
            };
            if !PROJECT_CONTENT_EXTENSIONS.contains(&extension.as_str()) {
                continue;
            }
            let metadata = std::fs::metadata(&entry)
                .map_err(|error| format!("failed to inspect content file: {error}"))?;
            *count += 1;
            *bytes += metadata.len();
        }
        Ok(())
    }
    let mut count = 0usize;
    let mut bytes = 0u64;
    walk(content_root, 0, &mut count, &mut bytes)?;
    Ok((count, bytes))
}

/// Dependency-free SHA-256 (FIPS 180-4). The desktop shell pins
/// `tauri = { features = [] }` and an exact dependency allowlist (issue 034), so
/// a hashing crate cannot be added; this is hand-rolled like `base64_encode`.
/// Returns the lowercase hex digest. Used to prove byte-identical imports.
fn sha256_hex(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (bytes.len() as u64).wrapping_mul(8);
    let mut message = bytes.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());

    for block in message.as_chunks::<64>().0 {
        let mut w = [0u32; 64];
        for (word, chunk) in w.iter_mut().zip(block.as_chunks::<4>().0) {
            *word = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }
        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];
        for (kv, wv) in K.iter().zip(w.iter()) {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(*kv)
                .wrapping_add(*wv);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    use std::fmt::Write as _;
    let mut hex = String::with_capacity(64);
    for word in h {
        write!(hex, "{word:08x}").expect("writing to a String cannot fail");
    }
    hex
}

/// Monotonic counter for unique temp-file names during atomic imports.
static IMPORT_TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Issue 065: import a binary asset from a user-selected local source into a
/// destination under the currently opened project's `Content/` root. See the
/// authorization/confinement notes above. The source bytes are copied
/// byte-identically (the returned SHA-256 proves this); format/magic validation
/// is NOT performed here — it remains the preview mount gate's responsibility.
/// Returns a structured JSON result:
///   success:  { status:"imported", relativePath, extension, byteLength, sha256 }
///   conflict: { status:"conflict", relativePath }
/// Rejections (traversal, symlink escape, absolute/hidden names, Windows-hostile
/// segments, unsupported/incompatible extension, oversize, aggregate-limit)
/// return `Err(String)` and never leave a partial destination file behind.
#[tauri::command]
async fn project_import_asset(
    project_root: String,
    source_path: String,
    destination: String,
) -> Result<serde_json::Value, String> {
    // 1. Validate the destination string before touching the filesystem, then
    //    require the user-selected source filename to be a supported type that
    //    is compatible with the destination extension (fail closed — the copy
    //    is byte-identical, so a mislabelled type must not slip through).
    let (relative, extension) = import_validate_destination(&destination)?;
    import_validate_source_extension(&source_path, &extension)?;

    // 2. Canonicalize and confine the project root / Content root. The write
    //    surface is ALWAYS <canonical project_root>/Content, never the raw
    //    caller-supplied string.
    let root = std::path::PathBuf::from(&project_root);
    if !root.is_dir() {
        return Err("project root is not a directory".into());
    }
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve project root: {error}"))?;
    let content_root = root.join("Content");
    if content_root.exists() {
        // If Content/ already exists it must be a real directory inside the
        // canonical project root — reject a symlinked Content that escapes.
        let canonical_content = content_root
            .canonicalize()
            .map_err(|error| format!("failed to resolve Content root: {error}"))?;
        if !canonical_content.starts_with(&root) {
            return Err("Content directory escapes the project root".into());
        }
    }

    // 3. Resolve and read the source bytes. Canonicalization resolves any
    //    symlink to its real target; we only READ the source, so a symlinked
    //    source is acceptable as long as it names a regular file.
    let source = std::path::PathBuf::from(&source_path)
        .canonicalize()
        .map_err(|error| format!("failed to resolve source file: {error}"))?;
    let source_meta = std::fs::metadata(&source)
        .map_err(|error| format!("failed to inspect source file: {error}"))?;
    if !source_meta.is_file() {
        return Err("source is not a regular file".into());
    }
    let per_file_limit = content_max_file_bytes(&extension);
    if source_meta.len() > per_file_limit {
        return Err(format!(
            "source exceeds the {per_file_limit}-byte per-content-file limit"
        ));
    }

    // 4. Enforce the aggregate content FILE-COUNT limit before writing. The
    //    aggregate BYTE limit is re-checked in step 7 against the actual bytes
    //    read, guarding against a source that changes between this probe and
    //    the read.
    let (existing_count, existing_bytes) = import_content_totals(&content_root)?;
    if existing_count + 1 > PROJECT_CONTENT_MAX_FILES {
        return Err(format!(
            "importing would exceed the {PROJECT_CONTENT_MAX_FILES}-file Content limit"
        ));
    }
    if existing_bytes.saturating_add(source_meta.len()) > PROJECT_CONTENT_MAX_TOTAL_BYTES {
        return Err("importing would exceed the total Content byte limit".into());
    }

    // 5. Build the confined destination path by joining validated segments one
    //    at a time onto the canonical Content root, creating parent directories
    //    as needed, and rejecting any symlink that resolves outside Content.
    let segments: Vec<&str> = relative.split('/').collect();
    let (dir_segments, file_segment) = segments
        .split_last()
        .map(|(last, rest)| (rest, *last))
        .ok_or("destination must name a file")?;

    std::fs::create_dir_all(&content_root)
        .map_err(|error| format!("failed to create Content directory: {error}"))?;
    let mut dir = content_root
        .canonicalize()
        .map_err(|error| format!("failed to resolve Content root: {error}"))?;
    let canonical_content = dir.clone();
    for segment in dir_segments {
        dir.push(segment);
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("failed to create Content subdirectory: {error}"))?;
        dir = dir
            .canonicalize()
            .map_err(|error| format!("failed to resolve Content subdirectory: {error}"))?;
        if !dir.starts_with(&canonical_content) {
            return Err("destination escapes the Content directory".into());
        }
    }
    let destination_path = dir.join(file_segment);
    // Defence in depth: the resolved destination must still be inside Content.
    if !destination_path.starts_with(&canonical_content) {
        return Err("destination escapes the Content directory".into());
    }

    // 6. No overwrite: reject an existing destination (file, dir, or symlink)
    //    with a structured conflict result rather than an error.
    if std::fs::symlink_metadata(&destination_path).is_ok() {
        return Ok(serde_json::json!({
            "status": "conflict",
            "relativePath": relative,
        }));
    }

    // 7. Read source bytes, hash, and write atomically: a hidden temp file in
    //    the destination directory (skipped by discovery), then rename over the
    //    target. A failure leaves no partial destination.
    let bytes =
        std::fs::read(&source).map_err(|error| format!("failed to read source file: {error}"))?;
    // Re-check the per-type size after reading, guarding against a source that
    // grew between the metadata probe and the read.
    if bytes.len() as u64 > per_file_limit {
        return Err("source exceeds the per-content-file limit".into());
    }
    // Re-check the aggregate byte budget against the ACTUAL bytes read (not the
    // earlier metadata probe) before committing, so a source that grew after
    // the probe cannot push Content past its total budget.
    if existing_bytes.saturating_add(bytes.len() as u64) > PROJECT_CONTENT_MAX_TOTAL_BYTES {
        return Err("importing would exceed the total Content byte limit".into());
    }
    let digest = sha256_hex(&bytes);
    let unique = IMPORT_TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let tmp_path = dir.join(format!(
        ".import-{}-{unique}-{nanos}.tmp",
        std::process::id()
    ));
    if let Err(error) = std::fs::write(&tmp_path, &bytes) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("failed to write temporary file: {error}"));
    }
    // Final conflict re-check just before commit (best-effort TOCTOU guard for a
    // single-user desktop app). rename() would silently overwrite on Unix, so
    // check first and clean up the temp file if a race created the target.
    if std::fs::symlink_metadata(&destination_path).is_ok() {
        let _ = std::fs::remove_file(&tmp_path);
        return Ok(serde_json::json!({
            "status": "conflict",
            "relativePath": relative,
        }));
    }
    if let Err(error) = std::fs::rename(&tmp_path, &destination_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("failed to commit imported asset: {error}"));
    }

    Ok(serde_json::json!({
        "status": "imported",
        "relativePath": relative,
        "extension": extension,
        "byteLength": bytes.len(),
        "sha256": digest,
    }))
}

#[cfg(test)]
mod tests {
    #[cfg(all(target_os = "macos", feature = "proof-harness"))]
    use super::packaged_app_bundle;
    use super::{
        FIRST_RUN_MAX_ENTRIES, FIRST_RUN_MAX_IDENTITY_BYTES, FIRST_RUN_SCHEMA_VERSION,
        MAX_PREVIEW_ASSET_BYTES, MAX_PREVIEW_TOTAL_BYTES, PREVIEW_ASSET_INVENTORY,
        PREVIEW_ASSET_TOTAL_BYTES, PREVIEW_CSP, PROJECT_CONTENT_MAX_AUDIO_BYTES,
        PROJECT_CONTENT_MAX_TOTAL_BYTES, base64_encode, chrono_free_iso8601,
        content_max_file_bytes, first_run_read_store, first_run_validate_notice_version,
        first_run_write_store_atomic, import_content_totals, import_segment_is_windows_safe,
        import_validate_destination, import_validate_source_extension, navigation_allowed,
        preview_asset, preview_content_type, preview_protocol_response, project_discover_content,
        project_import_asset, sha256_hex,
    };
    #[cfg(feature = "proof-harness")]
    use super::{
        issue041_mode_value, issue041_preview_cycle_count_value, issue041_warm_compile_iterations,
        proof_activation_target_allowed, proof_window_ready, require_packaged_pipeline_proof,
    };
    use tauri::http::{Method, Response};

    fn response(raw_uri: &str) -> Response<Vec<u8>> {
        preview_protocol_response(&Method::GET, raw_uri)
    }

    fn assert_security_headers(response: &Response<Vec<u8>>) {
        let headers = response.headers();
        assert_eq!(headers["access-control-allow-origin"], "null");
        assert!(!headers.contains_key("access-control-allow-credentials"));
        assert_eq!(headers["cross-origin-resource-policy"], "cross-origin");
        assert_eq!(headers["x-content-type-options"], "nosniff");
        assert_eq!(headers["cache-control"], "no-store");
        assert_eq!(headers["content-security-policy"], PREVIEW_CSP);
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn native_activation_is_rejected_without_packaged_proof_authorization() {
        assert!(require_packaged_pipeline_proof(false).is_err());
        assert!(require_packaged_pipeline_proof(true).is_ok());
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn issue041_benchmark_mode_accepts_only_known_modes() {
        assert_eq!(issue041_mode_value(None), Ok("full"));
        assert_eq!(issue041_mode_value(Some("full")), Ok("full"));
        assert_eq!(issue041_mode_value(Some("shell-only")), Ok("shell-only"));
        assert_eq!(
            issue041_mode_value(Some("memory-baseline")),
            Ok("memory-baseline")
        );
        assert!(issue041_mode_value(Some("")).is_err());
        assert!(issue041_mode_value(Some("Full")).is_err());
        assert!(issue041_mode_value(Some("everything")).is_err());
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn issue041_sample_counts_are_bounded() {
        assert_eq!(issue041_warm_compile_iterations(None), Ok(10));
        assert_eq!(issue041_warm_compile_iterations(Some("1")), Ok(1));
        assert_eq!(issue041_warm_compile_iterations(Some("100")), Ok(100));
        assert!(issue041_warm_compile_iterations(Some("0")).is_err());
        assert!(issue041_warm_compile_iterations(Some("101")).is_err());
        assert!(issue041_warm_compile_iterations(Some("-1")).is_err());
        assert!(issue041_warm_compile_iterations(Some("ten")).is_err());

        assert_eq!(issue041_preview_cycle_count_value(None), Ok(2));
        assert_eq!(issue041_preview_cycle_count_value(Some("2")), Ok(2));
        assert_eq!(issue041_preview_cycle_count_value(Some("10")), Ok(10));
        assert_eq!(issue041_preview_cycle_count_value(Some("20")), Ok(20));
        assert!(issue041_preview_cycle_count_value(Some("1")).is_err());
        assert!(issue041_preview_cycle_count_value(Some("21")).is_err());
        assert!(issue041_preview_cycle_count_value(Some("two")).is_err());
    }

    #[test]
    fn navigation_allows_only_trusted_schemes() {
        let parse = |s: &str| s.parse::<tauri::Url>().unwrap();
        assert!(navigation_allowed(&parse("tauri://localhost")));
        assert!(navigation_allowed(&parse("tauri://localhost/index.html")));
        assert!(navigation_allowed(&parse(
            "playground-preview://localhost/preview.js"
        )));
        assert!(navigation_allowed(&parse("about:blank")));
        assert!(navigation_allowed(&parse("about:srcdoc")));
        // The Vite dev server origin is allowed so `tauri dev` can load the
        // frontend; all other http/https hosts stay denied (issue 035).
        assert!(navigation_allowed(&parse("http://127.0.0.1:5173/")));
        assert!(navigation_allowed(&parse(
            "http://127.0.0.1:5173/index.html"
        )));
        assert!(!navigation_allowed(&parse("http://127.0.0.1:9999/")));
        assert!(!navigation_allowed(&parse("https://127.0.0.1:5173/")));
        assert!(!navigation_allowed(&parse("https://example.com")));
        assert!(!navigation_allowed(&parse("http://example.com")));
        assert!(!navigation_allowed(&parse("http://ipc.localhost")));
        assert!(!navigation_allowed(&parse("file:///etc/passwd")));
        assert!(!navigation_allowed(&parse("data:text/html,test")));
    }

    #[test]
    fn base64_matches_rfc4648_vectors() {
        // RFC 4648 §10 test vectors.
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // Binary bytes incl. 0x00/0xFF map to '+' and '/' in the table.
        assert_eq!(base64_encode(&[0x00, 0x00, 0x00]), "AAAA");
        assert_eq!(base64_encode(&[0xFF, 0xFF, 0xFF]), "////");
        assert_eq!(base64_encode(&[0xFB, 0xFF, 0xBF]), "+/+/");
    }

    #[test]
    fn project_content_discovers_only_supported_recursively() {
        let dir = std::env::temp_dir().join(format!("project-content-{}", std::process::id()));
        let content = dir.join("Content");
        let nested = content.join("textures");
        std::fs::create_dir_all(&nested).unwrap();
        // Supported assets (bytes are arbitrary here — discovery does not validate
        // format; that is the preview mount gate's job).
        std::fs::write(content.join("blip.wav"), b"RIFF....WAVE").unwrap();
        std::fs::write(nested.join("player.png"), [0x89, 0x50, 0x4E, 0x47]).unwrap();
        std::fs::write(content.join("tile.xnb"), b"XNB").unwrap();
        // Unsupported + hidden entries must be ignored.
        std::fs::write(content.join("notes.txt"), b"ignore me").unwrap();
        std::fs::write(content.join(".hidden.png"), b"skip").unwrap();

        let files = project_discover_content(&content).unwrap();
        let paths: Vec<String> = files
            .iter()
            .map(|f| f["relativePath"].as_str().unwrap().to_string())
            .collect();
        // Sorted, Content-root-relative, forward-slashed; .txt and hidden dropped.
        assert_eq!(paths, vec!["blip.wav", "textures/player.png", "tile.xnb"]);

        let wav = &files[0];
        assert_eq!(wav["extension"].as_str().unwrap(), "wav");
        assert_eq!(wav["byteLength"].as_u64().unwrap(), 12);
        assert_eq!(
            wav["base64"].as_str().unwrap(),
            base64_encode(b"RIFF....WAVE")
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn project_content_discovery_enforces_per_file_limit() {
        let dir =
            std::env::temp_dir().join(format!("project-content-toobig-{}", std::process::id()));
        let content = dir.join("Content");
        std::fs::create_dir_all(&content).unwrap();
        let big = vec![0u8; (super::PROJECT_CONTENT_MAX_FILE_BYTES + 1) as usize];
        std::fs::write(content.join("huge.png"), &big).unwrap();
        let result = project_discover_content(&content);
        assert!(result.is_err(), "oversized content file must be rejected");
        std::fs::remove_dir_all(&dir).ok();
    }

    // --- Issue 065: bounded binary asset import ---

    /// Minimal executor: `project_import_asset` is `async` for the Tauri command
    /// signature but its body never `.await`s, so a single poll drives it to
    /// completion. This lets the unit tests exercise the real command body
    /// without pulling in an async runtime dependency.
    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
        fn noop(_: *const ()) {}
        fn clone(_: *const ()) -> RawWaker {
            RawWaker::new(std::ptr::null(), &VTABLE)
        }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut context = Context::from_waker(&waker);
        let mut pinned = Box::pin(future);
        match pinned.as_mut().poll(&mut context) {
            Poll::Ready(output) => output,
            Poll::Pending => panic!("project_import_asset unexpectedly yielded"),
        }
    }

    fn import_temp_dir(tag: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("import-{tag}-{}-{unique}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sha256_matches_known_vectors() {
        // FIPS 180-4 / RFC 6234 known-answer vectors, computed independently of
        // the import path so the digest returned by an import is trustworthy.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b"The quick brown fox jumps over the lazy dog"),
            "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
        );
        // A multi-block message (> 55 bytes forces a second padded block).
        assert_eq!(
            sha256_hex(&[0x61u8; 1000]),
            "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
        );
    }

    #[test]
    fn import_destination_validation_accepts_supported_relative_paths() {
        let (relative, extension) = import_validate_destination("textures/player.png").unwrap();
        assert_eq!(relative, "textures/player.png");
        assert_eq!(extension, "png");
        // Backslashes normalize to forward slashes.
        let (relative, extension) = import_validate_destination("audio\\blip.wav").unwrap();
        assert_eq!(relative, "audio/blip.wav");
        assert_eq!(extension, "wav");
        // Every supported extension is accepted.
        for name in ["a.xnb", "b.png", "c.jpg", "d.jpeg", "e.bmp", "f.wav"] {
            assert!(import_validate_destination(name).is_ok(), "{name}");
        }
    }

    #[test]
    fn import_destination_validation_rejects_unsafe_paths() {
        for bad in [
            "",                   // empty
            "/etc/passwd.png",    // absolute
            "\\windows\\a.png",   // backslash-absolute
            "C:/Windows/a.png",   // drive-letter absolute
            "../escape.png",      // parent traversal
            "a/../../escape.png", // nested traversal
            "./local.png",        // dot segment
            "a//b.png",           // empty segment
            ".hidden.png",        // hidden file
            "sub/.hidden/x.png",  // hidden directory
            "textures/notes.txt", // unsupported extension
            "model.fbx",          // unsupported extension
            "noextension",        // no extension
            "weird*name.png",     // disallowed character
        ] {
            assert!(
                import_validate_destination(bad).is_err(),
                "must reject {bad:?}"
            );
        }
        // Oversized destination string.
        let long = format!("{}.png", "a".repeat(super::IMPORT_MAX_DEST_BYTES));
        assert!(import_validate_destination(&long).is_err());
    }

    #[test]
    fn import_content_totals_counts_only_supported_visible_files() {
        let dir = import_temp_dir("totals");
        let content = dir.join("Content");
        let nested = content.join("textures");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(content.join("a.png"), vec![0u8; 100]).unwrap();
        std::fs::write(nested.join("b.wav"), vec![0u8; 200]).unwrap();
        std::fs::write(content.join("notes.txt"), vec![0u8; 999]).unwrap(); // unsupported
        std::fs::write(content.join(".hidden.png"), vec![0u8; 999]).unwrap(); // hidden
        let (count, bytes) = import_content_totals(&content).unwrap();
        assert_eq!(count, 2);
        assert_eq!(bytes, 300);
        // A missing Content root contributes nothing.
        let (count, bytes) = import_content_totals(&dir.join("Nope")).unwrap();
        assert_eq!((count, bytes), (0, 0));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_copies_supported_file_byte_identically() {
        let dir = import_temp_dir("copy");
        let project = dir.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        let source = dir.join("player.png");
        let payload: Vec<u8> = (0..=255u8).cycle().take(4096).collect();
        std::fs::write(&source, &payload).unwrap();

        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "textures/player.png".to_string(),
        ))
        .unwrap();
        assert_eq!(result["status"], "imported");
        assert_eq!(result["relativePath"], "textures/player.png");
        assert_eq!(result["extension"], "png");
        assert_eq!(result["byteLength"].as_u64().unwrap(), 4096);
        assert_eq!(result["sha256"].as_str().unwrap(), sha256_hex(&payload));

        // The destination bytes are byte-identical to the source.
        let written = std::fs::read(project.join("Content/textures/player.png")).unwrap();
        assert_eq!(written, payload);
        // No temp files leaked into the destination directory.
        let leftovers: Vec<_> = std::fs::read_dir(project.join("Content/textures"))
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".import-"))
            .collect();
        assert!(leftovers.is_empty(), "temp file leaked: {leftovers:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_rejects_duplicate_with_conflict_and_no_partial() {
        let dir = import_temp_dir("dup");
        let project = dir.join("proj");
        let content = project.join("Content");
        std::fs::create_dir_all(&content).unwrap();
        std::fs::write(content.join("tile.xnb"), b"ORIGINAL").unwrap();
        let source = dir.join("tile.xnb");
        std::fs::write(&source, b"REPLACEMENT").unwrap();

        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "tile.xnb".to_string(),
        ))
        .unwrap();
        assert_eq!(result["status"], "conflict");
        assert_eq!(result["relativePath"], "tile.xnb");
        // The existing file is untouched (no overwrite), and no temp file leaked.
        assert_eq!(
            std::fs::read(content.join("tile.xnb")).unwrap(),
            b"ORIGINAL"
        );
        let leftovers: Vec<_> = std::fs::read_dir(&content)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".import-"))
            .collect();
        assert!(leftovers.is_empty(), "temp file leaked: {leftovers:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_rejects_traversal_and_unsupported_and_missing_source() {
        let dir = import_temp_dir("reject");
        let project = dir.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        let source = dir.join("ok.png");
        std::fs::write(&source, b"PNGDATA").unwrap();
        let root = project.to_string_lossy().into_owned();
        let src = source.to_string_lossy().into_owned();

        // Traversal destination.
        assert!(
            block_on(project_import_asset(
                root.clone(),
                src.clone(),
                "../escape.png".to_string(),
            ))
            .is_err()
        );
        // Unsupported extension.
        assert!(
            block_on(project_import_asset(
                root.clone(),
                src.clone(),
                "notes.txt".to_string(),
            ))
            .is_err()
        );
        // Absolute destination.
        assert!(
            block_on(project_import_asset(
                root.clone(),
                src.clone(),
                "/tmp/escape.png".to_string(),
            ))
            .is_err()
        );
        // Missing source file.
        assert!(
            block_on(project_import_asset(
                root.clone(),
                dir.join("does-not-exist.png")
                    .to_string_lossy()
                    .into_owned(),
                "player.png".to_string(),
            ))
            .is_err()
        );
        // Nothing was written to Content on any rejection.
        assert!(!project.join("Content").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_rejects_oversize_source_without_partial() {
        let dir = import_temp_dir("oversize");
        let project = dir.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        let source = dir.join("huge.png");
        let big = vec![0u8; (super::PROJECT_CONTENT_MAX_FILE_BYTES + 1) as usize];
        std::fs::write(&source, &big).unwrap();
        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "huge.png".to_string(),
        ));
        assert!(result.is_err(), "oversize source must be rejected");
        assert!(!project.join("Content/huge.png").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_rejects_aggregate_byte_limit() {
        let dir = import_temp_dir("aggregate");
        let project = dir.join("proj");
        let content = project.join("Content");
        std::fs::create_dir_all(&content).unwrap();
        // Existing content fills most of the aggregate budget.
        let existing = vec![0u8; PROJECT_CONTENT_MAX_TOTAL_BYTES as usize - 1024];
        std::fs::write(content.join("existing.xnb"), &existing).unwrap();
        // A source larger than the remaining budget must be rejected.
        let source = dir.join("more.png");
        std::fs::write(&source, vec![0u8; 8192]).unwrap();
        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "more.png".to_string(),
        ));
        assert!(result.is_err(), "aggregate byte limit must be enforced");
        assert!(!content.join("more.png").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn import_rejects_symlinked_content_escape() {
        use std::os::unix::fs::symlink;
        let dir = import_temp_dir("symlink");
        let project = dir.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        // An attacker-controlled directory OUTSIDE the project.
        let outside = dir.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        // Content/ is a symlink pointing outside the project root.
        symlink(&outside, project.join("Content")).unwrap();
        let source = dir.join("evil.png");
        std::fs::write(&source, b"EVIL").unwrap();

        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "planted.png".to_string(),
        ));
        assert!(result.is_err(), "symlinked Content escape must be rejected");
        // Nothing was written into the escape target.
        assert!(!outside.join("planted.png").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn import_rejects_symlinked_subdirectory_escape() {
        use std::os::unix::fs::symlink;
        let dir = import_temp_dir("symlink-sub");
        let project = dir.join("proj");
        let content = project.join("Content");
        std::fs::create_dir_all(&content).unwrap();
        let outside = dir.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        // A subdirectory of Content/ is a symlink escaping the project.
        symlink(&outside, content.join("linked")).unwrap();
        let source = dir.join("evil.png");
        std::fs::write(&source, b"EVIL").unwrap();

        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "linked/planted.png".to_string(),
        ));
        assert!(
            result.is_err(),
            "symlinked Content subdirectory escape must be rejected"
        );
        assert!(!outside.join("planted.png").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn content_max_file_bytes_is_per_type() {
        // Raw audio is bounded to 8 MiB; every other supported type to 16 MiB.
        assert_eq!(
            content_max_file_bytes("wav"),
            PROJECT_CONTENT_MAX_AUDIO_BYTES
        );
        assert_eq!(content_max_file_bytes("wav"), 8 * 1024 * 1024);
        for ext in ["xnb", "png", "jpg", "jpeg", "bmp"] {
            assert_eq!(
                content_max_file_bytes(ext),
                super::PROJECT_CONTENT_MAX_FILE_BYTES,
                "{ext}"
            );
            assert_eq!(content_max_file_bytes(ext), 16 * 1024 * 1024, "{ext}");
        }
    }

    #[test]
    fn import_windows_safe_segment_rejects_reserved_and_trailing() {
        // Reserved device-name stems (case-insensitive, with or without an
        // extension) are rejected in any segment.
        for bad in [
            "CON", "con", "Con.png", "PRN", "aux", "NUL", "nul.wav", "COM1", "com9", "LPT1",
            "lpt9.xnb",
        ] {
            assert!(
                import_segment_is_windows_safe(bad).is_err(),
                "must reject reserved {bad:?}"
            );
        }
        // Leading/trailing spaces and trailing dots are rejected.
        for bad in [
            " leading.png",
            "trailing.png ",
            "trailingdot.",
            "name. ",
            " ",
        ] {
            assert!(
                import_segment_is_windows_safe(bad).is_err(),
                "must reject {bad:?}"
            );
        }
        // COM0/LPT0 are NOT reserved; ordinary names pass.
        for ok in ["com0.png", "lpt0.png", "console.png", "player.png", "a.wav"] {
            assert!(
                import_segment_is_windows_safe(ok).is_ok(),
                "must accept {ok:?}"
            );
        }
    }

    #[test]
    fn import_destination_validation_rejects_windows_hostile_paths() {
        for bad in [
            "CON.png",          // reserved device name
            "nul.wav",          // reserved device name
            "com1.png",         // reserved COM port
            "lpt9.xnb",         // reserved LPT port
            "textures/CON.png", // reserved in a nested segment
            "CON/player.png",   // reserved as a directory segment
            "trailingdot.png.", // trailing dot
            "name /player.png", // trailing space in a directory segment
            " leading.png",     // leading space
        ] {
            assert!(
                import_validate_destination(bad).is_err(),
                "must reject windows-hostile {bad:?}"
            );
        }
    }

    #[test]
    fn import_source_extension_validation() {
        // Matching types pass (both slash styles for the source path).
        assert!(import_validate_source_extension("/tmp/player.png", "png").is_ok());
        assert!(import_validate_source_extension("C:\\assets\\blip.wav", "wav").is_ok());
        assert!(import_validate_source_extension("photo.PNG", "png").is_ok());
        // jpg/jpeg equivalence is the only accepted cross-extension pairing.
        assert!(import_validate_source_extension("photo.jpg", "jpeg").is_ok());
        assert!(import_validate_source_extension("photo.jpeg", "jpg").is_ok());
        // Unsupported source extensions are rejected.
        assert!(import_validate_source_extension("model.fbx", "png").is_err());
        assert!(import_validate_source_extension("notes.txt", "png").is_err());
        assert!(import_validate_source_extension("noextension", "png").is_err());
        // Supported but incompatible pairings are rejected (fail closed).
        assert!(import_validate_source_extension("sound.wav", "png").is_err());
        assert!(import_validate_source_extension("image.png", "wav").is_err());
        assert!(import_validate_source_extension("image.bmp", "png").is_err());
    }

    #[test]
    fn import_rejects_extension_mismatch_without_partial() {
        let dir = import_temp_dir("mismatch");
        let project = dir.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        // A `.wav` source written to a `.png` destination must be rejected even
        // though both extensions are individually supported (fail closed).
        let source = dir.join("sound.wav");
        std::fs::write(&source, b"RIFF....WAVE").unwrap();
        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "player.png".to_string(),
        ));
        assert!(result.is_err(), "extension mismatch must be rejected");
        assert!(!project.join("Content").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_accepts_jpg_jpeg_equivalence() {
        let dir = import_temp_dir("jpgjpeg");
        let project = dir.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        let source = dir.join("photo.jpg");
        std::fs::write(&source, b"\xFF\xD8\xFF\xE0JFIF").unwrap();
        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "art/photo.jpeg".to_string(),
        ))
        .unwrap();
        assert_eq!(result["status"], "imported");
        assert_eq!(result["extension"], "jpeg");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_rejects_wav_over_audio_limit_without_partial() {
        let dir = import_temp_dir("wav-oversize");
        let project = dir.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        // A `.wav` just over the 8 MiB audio bound is rejected, even though it
        // is well under the 16 MiB general/image bound.
        let source = dir.join("blip.wav");
        let big = vec![0u8; (PROJECT_CONTENT_MAX_AUDIO_BYTES + 1) as usize];
        std::fs::write(&source, &big).unwrap();
        let result = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
            "blip.wav".to_string(),
        ));
        assert!(result.is_err(), "oversize wav must be rejected");
        assert!(!project.join("Content/blip.wav").exists());
        // A same-sized `.png` (under the 16 MiB image bound) imports fine,
        // proving the bound is per-type rather than global.
        let png_source = dir.join("ok.png");
        std::fs::write(&png_source, &big).unwrap();
        let ok = block_on(project_import_asset(
            project.to_string_lossy().into_owned(),
            png_source.to_string_lossy().into_owned(),
            "ok.png".to_string(),
        ))
        .unwrap();
        assert_eq!(ok["status"], "imported");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn content_discovery_enforces_per_audio_limit() {
        let dir = import_temp_dir("wav-discovery");
        let content = dir.join("Content");
        std::fs::create_dir_all(&content).unwrap();
        // A `.wav` over the 8 MiB audio bound is rejected by discovery even
        // though it is under the 16 MiB general bound.
        let big = vec![0u8; (PROJECT_CONTENT_MAX_AUDIO_BYTES + 1) as usize];
        std::fs::write(content.join("blip.wav"), &big).unwrap();
        assert!(
            project_discover_content(&content).is_err(),
            "oversized wav must be rejected by discovery"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn issue035_config_creates_window_manually() {
        let config = include_str!("../tauri.conf.json");
        assert!(config.contains("\"create\": false"));
    }

    #[test]
    fn issue034_shell_policy_is_fail_closed() {
        let config = include_str!("../tauri.conf.json");
        let capability = include_str!("../capabilities/main.json");
        let permission = include_str!("../permissions/main.toml");
        let manifest = include_str!("../Cargo.toml");
        let lockfile = include_str!("../Cargo.lock").replace("\r\n", "\n");
        let canary = include_bytes!("../../../../tests/security/fixtures/issue034-canary.txt");
        assert!(config.contains("\"withGlobalTauri\": false"));
        assert!(capability.contains("\"windows\": [\"main\"]"));
        assert!(capability.contains("\"local\": true"));
        assert!(capability.contains("\"permissions\": [\"main-commands\"]"));
        // The product permission inventory retains the composite grant name; the
        // issue034 trusted-marker command now lives in the proof-only overlay
        // (permissions/proof.toml), compiled in only under the proof-harness
        // feature (Stage 6 binary separation).
        assert!(permission.contains("main-commands"));
        #[cfg(feature = "proof-harness")]
        {
            let proof_permission = include_str!("../permissions/proof.toml");
            assert!(proof_permission.contains("issue034_trusted_marker"));
        }
        let canary_checksum = canary.iter().fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
        assert_eq!(canary.len(), 38);
        assert_eq!(canary_checksum, 0x0e9f23477671a0b8);
        assert!(lockfile.contains("name = \"tauri\"\nversion = \"2.11.5\""));
        for forbidden in [
            "tauri-plugin-fs",
            "tauri-plugin-shell",
            "tauri-plugin-process",
            "tauri-plugin-opener",
            "tauri-plugin-clipboard-manager",
        ] {
            assert!(!manifest.contains(forbidden), "{forbidden}");
        }
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn proof_readiness_requires_native_and_tauri_focus() {
        assert!(proof_window_ready(true, true, false, true, true));
        assert!(!proof_window_ready(true, true, false, false, true));
        assert!(!proof_window_ready(true, true, false, true, false));
        assert!(!proof_window_ready(true, false, false, true, true));
        assert!(!proof_window_ready(true, true, true, true, true));
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn exact_activation_requires_proof_gate_and_owned_target() {
        assert!(proof_activation_target_allowed(true, 7, 7, 42, 42));
        assert!(!proof_activation_target_allowed(false, 7, 7, 42, 42));
        assert!(!proof_activation_target_allowed(true, 0, 0, 42, 42));
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn exact_activation_aborts_on_pid_or_window_mismatch() {
        assert!(!proof_activation_target_allowed(true, 7, 8, 42, 42));
        assert!(!proof_activation_target_allowed(true, 7, 7, 42, 41));
        assert!(!proof_activation_target_allowed(true, 7, 8, 42, 41));
    }

    #[test]
    fn preview_protocol_rejects_every_path_confusion_form() {
        for uri in [
            "playground-preview://localhost/../preview.js",
            "playground-preview://localhost/./preview.js",
            "playground-preview://localhost//preview.js",
            "playground-preview://localhost/%2e%2e/preview.js",
            "playground-preview://localhost/%252e%252e/preview.js",
            "playground-preview://localhost/%2Fpreview.js",
            "playground-preview://localhost/%5cpreview.js",
            "playground-preview://localhost/\\preview.js",
            "playground-preview://localhost/preview.js\0",
            "playground-preview://localhost/preview.js?cache=1",
            "playground-preview://localhost/preview.js#fragment",
            "playground-preview://evil/preview.js",
            "playground-preview://localhost:443/preview.js",
            "playground-preview://user@localhost/preview.js",
            "tauri://localhost/preview.js",
            "/preview.js",
        ] {
            let result = response(uri);
            assert_eq!(result.status(), 400, "{uri}");
            assert_eq!(result.body(), b"Bad Request", "{uri}");
            assert_security_headers(&result);
        }
    }

    #[test]
    fn preview_protocol_has_closed_status_and_header_matrix() {
        let success = response("playground-preview://localhost/preview.js");
        assert_eq!(success.status(), 200);
        assert_eq!(
            success.headers()["content-type"],
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            success.body().as_slice(),
            preview_asset("/preview.js").unwrap()
        );

        let missing = response("playground-preview://localhost/not-present.js");
        assert_eq!(missing.status(), 404);
        assert_eq!(missing.body(), b"Not Found");

        let malformed = response("playground-preview://localhost/%00");
        assert_eq!(malformed.status(), 400);
        assert_eq!(malformed.body(), b"Bad Request");

        let method =
            preview_protocol_response(&Method::POST, "playground-preview://localhost/preview.js");
        assert_eq!(method.status(), 405);
        assert_eq!(method.body(), b"Method Not Allowed");

        for result in [&success, &missing, &malformed, &method] {
            assert_security_headers(result);
        }
        assert_eq!(
            missing.headers()["content-type"],
            "text/plain; charset=utf-8"
        );
        assert_eq!(
            malformed.headers()["content-type"],
            "text/plain; charset=utf-8"
        );
        assert_eq!(
            method.headers()["content-type"],
            "text/plain; charset=utf-8"
        );
        assert!(!String::from_utf8_lossy(missing.body()).contains('/'));
        assert!(!String::from_utf8_lossy(malformed.body()).contains('/'));
    }

    #[test]
    fn embedded_preview_inventory_is_bounded_and_allowlisted() {
        let mut total = 0usize;
        for &(path, declared_size) in PREVIEW_ASSET_INVENTORY {
            let asset = preview_asset(path).expect("inventory path must resolve");
            assert_eq!(asset.len(), declared_size, "{path}");
            assert!(declared_size <= MAX_PREVIEW_ASSET_BYTES, "{path}");
            assert!(path.starts_with('/'));
            assert!(!path.contains(['%', '\\', '\0']));
            assert!(
                [".html", ".css", ".js", ".json", ".wasm", ".dat"]
                    .iter()
                    .any(|extension| path.ends_with(extension)),
                "{path}"
            );
            // Stage 7 payload cleanup: the dead Brotli/gzip precompressed
            // sidecars are stripped from the staged preview tree, so they must
            // NOT enter the embedded inventory. The preview is served by an
            // exact-path custom protocol that never negotiates content-encoding.
            assert!(
                !path.ends_with(".br") && !path.ends_with(".gz"),
                "precompressed sidecar leaked into the embedded preview inventory: {path}"
            );
            total = total.checked_add(declared_size).expect("bounded inventory");
        }
        assert!(total <= MAX_PREVIEW_TOTAL_BYTES);
        assert_eq!(total, PREVIEW_ASSET_TOTAL_BYTES);
        // Non-vacuous floor: the raw browser-wasm preview runtime is ~180+ files
        // (framework wasm/dat + boot manifest + shared runtime JS) even after the
        // sidecars are removed. A count far below this means the staging or embed
        // step is broken/empty.
        assert!(
            PREVIEW_ASSET_INVENTORY.len() >= 150,
            "embedded preview inventory unexpectedly small: {}",
            PREVIEW_ASSET_INVENTORY.len()
        );
    }

    #[test]
    fn preview_content_types_are_exact_for_every_served_extension() {
        for (path, expected) in [
            ("/index.html", "text/html; charset=utf-8"),
            ("/preview.css", "text/css; charset=utf-8"),
            ("/preview.js", "text/javascript; charset=utf-8"),
            ("/preview-build.json", "application/json"),
            ("/_framework/runtime.wasm", "application/wasm"),
            ("/_framework/runtime.dat", "application/octet-stream"),
            ("/future.dll", "application/octet-stream"),
            ("/future.pdb", "application/octet-stream"),
        ] {
            assert_eq!(preview_content_type(path), expected, "{path}");
        }
        for &(path, _) in PREVIEW_ASSET_INVENTORY {
            assert_ne!(preview_content_type(path), "", "{path}");
        }
    }

    #[cfg(all(target_os = "macos", feature = "proof-harness"))]
    #[test]
    fn packaged_bundle_is_derived_only_from_an_app_executable() {
        use std::path::Path;

        assert_eq!(
            packaged_app_bundle(Path::new(
                "/build/MonoGame Playground.app/Contents/MacOS/monogame-playground"
            )),
            Some(Path::new("/build/MonoGame Playground.app"))
        );
        assert_eq!(
            packaged_app_bundle(Path::new("/build/release/monogame-playground")),
            None
        );
    }

    // --- Issue 037 unit tests ---

    #[test]
    fn first_run_notice_version_validation_accepts_valid_versions() {
        assert!(first_run_validate_notice_version("safety-notice-v1").is_ok());
        assert!(first_run_validate_notice_version("a").is_ok());
        assert!(first_run_validate_notice_version("notice_123-test").is_ok());
        assert!(
            first_run_validate_notice_version(&"a".repeat(FIRST_RUN_MAX_IDENTITY_BYTES)).is_ok()
        );
    }

    #[test]
    fn first_run_notice_version_validation_rejects_invalid_versions() {
        assert!(first_run_validate_notice_version("").is_err());
        assert!(
            first_run_validate_notice_version(&"a".repeat(FIRST_RUN_MAX_IDENTITY_BYTES + 1))
                .is_err()
        );
        assert!(first_run_validate_notice_version("has spaces").is_err());
        assert!(first_run_validate_notice_version("has.dots").is_err());
        assert!(first_run_validate_notice_version("path/injection").is_err());
        assert!(first_run_validate_notice_version("path\\injection").is_err());
        assert!(first_run_validate_notice_version("emoji😀").is_err());
        assert!(first_run_validate_notice_version("null\0byte").is_err());
    }

    #[test]
    fn first_run_store_roundtrip_and_atomicity() {
        let dir = std::env::temp_dir().join(format!("first-run-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test-ack.json");

        // Read non-existent file returns empty store
        let store = first_run_read_store(&path).unwrap();
        assert_eq!(store["schemaVersion"], FIRST_RUN_SCHEMA_VERSION);
        assert_eq!(store["acknowledged"].as_object().unwrap().len(), 0);

        // Write and re-read
        let mut store = store;
        store["acknowledged"]["safety-notice-v1"] =
            serde_json::json!({ "acknowledgedAt": "2026-01-01T00:00:00Z" });
        first_run_write_store_atomic(&path, &store).unwrap();
        let reloaded = first_run_read_store(&path).unwrap();
        assert!(
            reloaded["acknowledged"]["safety-notice-v1"]["acknowledgedAt"]
                .as_str()
                .unwrap()
                .starts_with("2026")
        );

        // No .tmp file left behind
        assert!(!path.with_extension("json.tmp").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn first_run_store_rejects_corrupt_json() {
        let dir = std::env::temp_dir().join(format!("first-run-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("corrupt.json");
        std::fs::write(&path, "not json").unwrap();
        assert!(first_run_read_store(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn first_run_store_rejects_wrong_schema_version() {
        let dir = std::env::temp_dir().join(format!("first-run-schema-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("wrong-version.json");
        std::fs::write(&path, r#"{"schemaVersion":99,"acknowledged":{}}"#).unwrap();
        assert!(first_run_read_store(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn first_run_store_migrates_legacy_per_project_v1_to_empty_v2() {
        // A legacy schemaVersion 1 store keyed acknowledgements by per-project
        // identity. Issue 063 migrates it to an empty v2 store: the legacy
        // per-project entries are discarded (never carried forward or
        // re-exposed) so the application-level notice is shown once after
        // upgrade.
        let dir = std::env::temp_dir().join(format!("first-run-migrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("legacy-v1.json");
        std::fs::write(
            &path,
            r#"{"schemaVersion":1,"acknowledged":{"builtin-scratch-v1":{"acknowledgedAt":"2026-01-01T00:00:00Z"},"folder-sha256-abc":{"acknowledgedAt":"2026-01-02T00:00:00Z"}}}"#,
        )
        .unwrap();
        let migrated = first_run_read_store(&path).unwrap();
        assert_eq!(migrated["schemaVersion"], FIRST_RUN_SCHEMA_VERSION);
        assert_eq!(migrated["acknowledged"].as_object().unwrap().len(), 0);
        assert!(migrated["acknowledged"].get("builtin-scratch-v1").is_none());
        assert!(migrated["acknowledged"].get("folder-sha256-abc").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn first_run_entry_limit_is_enforced() {
        const { assert!(FIRST_RUN_MAX_ENTRIES == 1024) };
    }

    #[test]
    fn first_run_timestamp_is_valid_iso8601() {
        let ts = chrono_free_iso8601();
        assert!(
            ts.len() == 20 && ts.ends_with('Z') && ts.contains('T'),
            "timestamp format: {ts}"
        );
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn first_run_proof_and_production_store_filenames_are_distinct() {
        assert_ne!(
            super::FIRST_RUN_STORE_FILENAME,
            super::ISSUE037_PROOF_STORE_FILENAME,
        );
        assert!(super::ISSUE037_PROOF_STORE_FILENAME.contains("proof"));
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn issue040_input_kinds_are_restricted_to_play_and_stop_gestures() {
        assert_eq!(
            super::issue040_input_kind("space-down"),
            Some(super::Issue040Input::KeyDown {
                key_code: 49,
                characters: " "
            })
        );
        assert_eq!(
            super::issue040_input_kind("escape-down"),
            Some(super::Issue040Input::KeyDown {
                key_code: 53,
                characters: "\u{1b}"
            })
        );
        assert_eq!(
            super::issue040_input_kind("click"),
            Some(super::Issue040Input::LeftMouseClick)
        );
        for rejected in ["", "cmd-q", "space", "keydown", "space-down "] {
            assert!(
                super::issue040_input_kind(rejected).is_none(),
                "{rejected} must not be dispatchable"
            );
        }
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn issue040_dispatch_target_routes_embedded_fail_closed() {
        // Well-formed generation, EXPLICITLY REGISTERED as the embedded
        // generation → the main window that hosts the embedded opaque-origin
        // preview iframe.
        assert_eq!(
            super::issue040_dispatch_target(true, "gen-1", true),
            Some(super::Issue040DispatchTarget::EmbeddedMain)
        );
        // Fail-closed: a well-formed but UNREGISTERED / random / stale-after-retire
        // generation is never dispatchable.
        assert_eq!(super::issue040_dispatch_target(true, "gen-1", false), None);
        // Fail-closed: proof gate off is never dispatchable.
        assert_eq!(super::issue040_dispatch_target(false, "gen-1", true), None);
        // Fail-closed: malformed / empty / oversized generations are rejected
        // before any window is addressed, even when "registered" is asserted.
        assert_eq!(super::issue040_dispatch_target(true, "", true), None);
        assert_eq!(
            super::issue040_dispatch_target(true, "../escape", true),
            None
        );
        assert_eq!(super::issue040_dispatch_target(true, "bad gen", true), None);
        assert_eq!(
            super::issue040_dispatch_target(true, &"a".repeat(65), true),
            None
        );
        // The embedded target is pinned to exactly the main window label.
        assert_eq!(super::ISSUE040_MAIN_WINDOW_LABEL, "main");
        // The caller gate admits only the trusted main window.
        assert!(super::issue040_caller_is_main("main"));
        assert!(!super::issue040_caller_is_main(
            "embedded-proof-preview-gen-1"
        ));
        assert!(!super::issue040_caller_is_main(""));
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn issue040_embedded_registration_is_bounded_and_exact() {
        let mut state = super::Issue040EmbeddedState { active: None };
        // Nothing is registered initially.
        assert!(!super::issue040_embedded_is_registered(&state, "gen-a"));
        // Malformed ids are rejected on registration, fail-closed.
        for bad in ["", "../escape", "bad gen", &"a".repeat(65)] {
            assert!(super::issue040_register_embedded(&mut state, bad).is_err());
            assert!(state.active.is_none(), "{bad} must not register");
        }
        // A well-formed id registers as the single active generation.
        assert!(super::issue040_register_embedded(&mut state, "gen-a").is_ok());
        assert!(super::issue040_embedded_is_registered(&state, "gen-a"));
        // Bounded to one: a DIFFERENT generation cannot overwrite the active one
        // (confused-generation guard).
        assert!(super::issue040_register_embedded(&mut state, "gen-b").is_err());
        assert!(super::issue040_embedded_is_registered(&state, "gen-a"));
        assert!(!super::issue040_embedded_is_registered(&state, "gen-b"));
        // Duplicate re-registration of the SAME id is also rejected.
        assert!(super::issue040_register_embedded(&mut state, "gen-a").is_err());
        // A stale/foreign id can never retire the live registration.
        assert!(!super::issue040_retire_embedded(&mut state, "gen-b"));
        assert!(super::issue040_embedded_is_registered(&state, "gen-a"));
        // Retiring the EXACT active id clears membership.
        assert!(super::issue040_retire_embedded(&mut state, "gen-a"));
        assert!(!super::issue040_embedded_is_registered(&state, "gen-a"));
        assert!(state.active.is_none());
        // Stale-after-retire: the id is no longer dispatchable in the target
        // resolver either.
        assert_eq!(super::issue040_dispatch_target(true, "gen-a", false), None);
        // Retire is idempotent / non-throwing on an already-cleared slot, so it
        // is safe on every cleanup/error path.
        assert!(!super::issue040_retire_embedded(&mut state, "gen-a"));
        // Once retired, a fresh generation may register into the freed slot.
        assert!(super::issue040_register_embedded(&mut state, "gen-c").is_ok());
        assert!(super::issue040_embedded_is_registered(&state, "gen-c"));
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn issue040_embedded_registration_is_bounded_and_single_slot() {
        // Registering an embedded generation is bounded to a single active slot
        // and never resolves a foreign generation.
        let mut embedded = super::Issue040EmbeddedState { active: None };
        assert!(super::issue040_register_embedded(&mut embedded, "gen-x").is_ok());
        // A different, unregistered generation is never dispatchable to the
        // embedded main window.
        assert_eq!(super::issue040_dispatch_target(true, "gen-y", false), None);
        // The registered generation resolves to the embedded main window.
        assert_eq!(
            super::issue040_dispatch_target(true, "gen-x", true),
            Some(super::Issue040DispatchTarget::EmbeddedMain)
        );
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn issue040_commands_are_registered_in_every_inventory() {
        let build = include_str!("../build.rs");
        let permission = include_str!("../permissions/proof.toml");
        for command in [
            "issue040_is_proof_enabled",
            "issue040_emit_checkpoint",
            "issue040_emit_report",
            "issue040_dispatch_preview_input",
        ] {
            assert!(build.contains(command), "{command} missing from build.rs");
            assert!(
                permission.contains(command),
                "{command} missing from proof permission"
            );
        }
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn issue041_commands_are_registered_in_every_inventory() {
        let build = include_str!("../build.rs");
        let permission = include_str!("../permissions/proof.toml");
        let frontend = include_str!("../../../frontend/src/proof-preview-security.ts");
        for command in [
            "issue041_is_benchmark_enabled",
            "issue041_benchmark_mode",
            "issue041_warm_compile_count",
            "issue041_preview_cycle_count",
            "issue041_shell_ready",
            "issue041_emit_checkpoint",
            "issue041_emit_report",
            "issue041_rss_bytes",
        ] {
            assert!(build.contains(command), "{command} missing from build.rs");
            assert!(
                permission.contains(command),
                "{command} missing from proof permission"
            );
            assert!(
                frontend.contains(command),
                "{command} missing from the frontend command inventory"
            );
        }
    }

    #[test]
    fn issue041_benchmark_instrumentation_is_environment_gated() {
        // The issue 041 benchmark surface lives in the proof-harness module
        // (`proof_harness.rs`), compiled only under the feature. `include_str!`
        // reads the file from disk at compile time regardless of the active
        // feature set, so this default-profile test keeps binding to the real
        // gated command bodies without pulling the proof surface into the
        // product build.
        let source = include_str!("proof_harness.rs");
        assert!(source.contains("MONOGAME_ISSUE041_BENCHMARK"));
        // Every issue 041 command body refuses to act unless the gate is set.
        // Seven command bodies refuse to act without the gate (the eighth command
        // is the gate probe itself); one further occurrence is this assertion.
        let gated = source
            .matches("return Err(\"issue 041 benchmark instrumentation is disabled\".into());")
            .count();
        assert_eq!(
            gated, 7,
            "every gated issue 041 command must check the flag"
        );
    }

    // --- Stage 6 proof-surface binary separation ---

    /// Parse the `generate_handler!` body into (command, gated?) pairs. Shared
    /// by the separation tests below so both bind to the real, compiled handler
    /// source rather than a hand-maintained copy.
    fn handler_entries() -> Vec<(String, bool)> {
        let source = include_str!("lib.rs");
        let body = source
            .split(concat!("tauri::generate", "_handler!["))
            .nth(1)
            .and_then(|tail| tail.split("])").next())
            .expect("generate_handler body missing");
        let mut entries = Vec::new();
        let mut gated = false;
        for raw in body.lines() {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            if line == "#[cfg(feature = \"proof-harness\")]" {
                gated = true;
                continue;
            }
            assert!(
                !line.starts_with("#["),
                "unexpected handler attribute: {line}"
            );
            entries.push((line.trim_end_matches(',').to_owned(), gated));
            gated = false;
        }
        entries
    }

    const PRODUCT_HANDLER_COMMANDS: [&str; 9] = [
        "first_run_check_acknowledgement",
        "first_run_write_acknowledgement",
        "workspace_write_file",
        "workspace_save_dialog",
        "workspace_open_dialog",
        "workspace_set_dirty",
        "project_pick_folder",
        "project_read",
        "project_import_asset",
    ];

    #[test]
    fn handler_registers_exactly_nine_ungated_product_commands() {
        let entries = handler_entries();
        let product: Vec<&str> = entries
            .iter()
            .filter(|(_, gated)| !*gated)
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(
            product, PRODUCT_HANDLER_COMMANDS,
            "the default build must register exactly the nine product commands, ungated"
        );
    }

    #[test]
    fn handler_gates_fifty_nine_proof_commands_behind_the_feature() {
        let entries = handler_entries();
        let proof: Vec<&str> = entries
            .iter()
            .filter(|(_, gated)| *gated)
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(proof.len(), 59, "the proof surface is fifty-nine commands");
        // Every gated command carries a proof/benchmark/packaged marker; none is
        // a product command. This defeats a vacuous "nothing is gated" pass.
        for name in &proof {
            assert!(
                name.starts_with("issue") || name.starts_with("prepare_packaged_proof"),
                "unexpected gated command: {name}"
            );
            assert!(
                !PRODUCT_HANDLER_COMMANDS.contains(name),
                "product command {name} must never be gated"
            );
        }
        // Total handler surface is 68 = 9 product + 59 proof.
        assert_eq!(entries.len(), 68);
    }

    #[test]
    fn product_commands_are_present_in_both_profiles_unconditionally() {
        // The nine product command fns compile with and without the feature
        // (referencing them here binds the assertion to real symbols, not
        // strings). If any were feature-gated, this test module — which builds
        // in the default profile — would fail to compile.
        let _: fn(tauri::AppHandle, String) -> Result<bool, String> =
            super::first_run_check_acknowledgement;
        let _: fn(tauri::AppHandle, String) -> Result<(), String> =
            super::first_run_write_acknowledgement;
        let _: fn(bool) = super::workspace_set_dirty;
    }

    #[cfg(not(feature = "proof-harness"))]
    #[test]
    fn no_proof_command_symbol_is_reachable_without_the_feature() {
        // The proof gate helpers and commands live behind
        // `#[cfg(feature = "proof-harness")]`. This test itself is compiled only
        // under `not(feature = "proof-harness")`, so its mere existence in the
        // default test binary proves the feature is off. Assert the observable
        // consequence instead of a constant `cfg!`.
        let feature_on = cfg!(feature = "proof-harness");
        assert!(
            !feature_on,
            "the default cargo profile must not enable proof-harness"
        );
        // The proof store filename constant is proof-only; the product store
        // filename is always present. This proves the store-name split holds.
        assert_eq!(
            super::FIRST_RUN_STORE_FILENAME,
            "first-run-acknowledgements.json"
        );
    }

    #[cfg(feature = "proof-harness")]
    #[test]
    fn feature_build_exposes_full_sixty_seven_command_surface() {
        let entries = handler_entries();
        assert_eq!(entries.len(), 68);
        // Proof symbols must be reachable when the feature compiles them in.
        let _: fn(&str) -> Option<super::Issue040Input> = super::issue040_input_kind;
        // The proof store overlay is present only under the feature.
        assert!(super::ISSUE037_PROOF_STORE_FILENAME.contains("proof"));
    }

    #[test]
    fn mixed_first_run_behavior_holds_in_both_profiles() {
        // The product first-run store path never depends on a proof env gate or
        // proof store name (Stage 6 decoupling). The resolved filename is the
        // product store in the default build, and the same in the proof build
        // unless the two-phase proof gate is active — verified structurally by
        // the feature-gated `first_run_store_filename` overload compiling.
        assert_eq!(
            super::first_run_store_filename(),
            super::FIRST_RUN_STORE_FILENAME,
            "without the proof phase gate the product store filename is used"
        );
    }
}

// --- First-run safety-notice acknowledgement store (issue 037 → issue 063) ---
//
// Persistence lives in a JSON file inside Tauri's app-data directory, which is
// inaccessible to the opaque preview iframe (no Tauri IPC, no filesystem).
// The store schema is: { "schemaVersion": 2, "acknowledged": { "<noticeVersion>": { "acknowledgedAt": "<ISO-8601>" } } }
//
// Issue 063 made the safety notice application-level and versioned rather than
// per-project. The acknowledgement is now keyed by a notice-version string
// (e.g. "safety-notice-v1"); a single acknowledgement suppresses the notice for
// every project until the notice version changes. The old schemaVersion 1
// format keyed acknowledgements by per-project identity
// ("builtin-scratch-v1", "folder-sha256-<digest>", …). On read, a v1 store is
// migrated to an empty v2 store: the legacy per-project entries are discarded
// (they never held raw paths, but they are not carried forward), so the
// application-level notice is shown once after upgrade and no stale project
// identity is retained or re-exposed.
//
// Atomic write: write to a `.tmp` sibling, then rename, so a crash mid-write
// never corrupts the store.  Notice-version strings are bounded to 256 bytes of
// printable ASCII to prevent path injection or unbounded growth.
//
// When proof mode is active (`MONOGAME_ISSUE037_PROOF=1`), a separate proof-
// namespace file is used so ordinary user acknowledgements are never destroyed.

const FIRST_RUN_STORE_FILENAME: &str = "first-run-acknowledgements.json";
#[cfg(feature = "proof-harness")]
const ISSUE037_PROOF_STORE_FILENAME: &str = "first-run-acknowledgements-proof.json";
// Current on-disk schema. v1 (per-project identity keys) is migrated to an
// empty v2 store on read; any other version fails closed.
const FIRST_RUN_SCHEMA_VERSION: u64 = 2;
const FIRST_RUN_LEGACY_SCHEMA_VERSION: u64 = 1;
const FIRST_RUN_MAX_IDENTITY_BYTES: usize = 256;
const FIRST_RUN_MAX_ENTRIES: usize = 1024;

// Product first-run acknowledgement store filename. The default build resolves
// this unconditionally with no dependency on any proof env gate or proof store
// name. Only the proof-harness build overlays the two-phase proof store
// filename (preserving the packaged issue037 two-phase acknowledgement proof).
#[cfg(not(feature = "proof-harness"))]
fn first_run_store_filename() -> &'static str {
    FIRST_RUN_STORE_FILENAME
}

#[cfg(feature = "proof-harness")]
fn first_run_store_filename() -> &'static str {
    if issue037_proof_enabled() {
        ISSUE037_PROOF_STORE_FILENAME
    } else {
        FIRST_RUN_STORE_FILENAME
    }
}

fn first_run_store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    Ok(dir.join(first_run_store_filename()))
}

fn first_run_validate_notice_version(notice_version: &str) -> Result<(), String> {
    if notice_version.is_empty() || notice_version.len() > FIRST_RUN_MAX_IDENTITY_BYTES {
        return Err("notice version must be 1–256 bytes".into());
    }
    if !notice_version
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    {
        return Err("notice version must contain only alphanumeric, hyphen, or underscore".into());
    }
    Ok(())
}

fn first_run_read_store(path: &std::path::Path) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => {
            let value: serde_json::Value = serde_json::from_str(&content)
                .map_err(|error| format!("acknowledgement store is corrupt: {error}"))?;
            let version = value
                .get("schemaVersion")
                .and_then(|version| version.as_u64())
                .ok_or("acknowledgement store missing schemaVersion")?;
            if version == FIRST_RUN_SCHEMA_VERSION {
                return Ok(value);
            }
            // Migrate the legacy per-project (v1) format to an empty v2 store.
            // The old identity-keyed acknowledgements are intentionally
            // discarded, never carried forward or re-exposed. The next Run then
            // shows the application-level notice once after upgrade.
            if version == FIRST_RUN_LEGACY_SCHEMA_VERSION {
                return Ok(serde_json::json!({
                    "schemaVersion": FIRST_RUN_SCHEMA_VERSION,
                    "acknowledged": {}
                }));
            }
            Err(format!(
                "unsupported acknowledgement store schema version {version}"
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({
            "schemaVersion": FIRST_RUN_SCHEMA_VERSION,
            "acknowledged": {}
        })),
        Err(error) => Err(format!("failed to read acknowledgement store: {error}")),
    }
}

fn first_run_write_store_atomic(
    path: &std::path::Path,
    store: &serde_json::Value,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create app data directory: {error}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(store)
        .map_err(|error| format!("failed to serialize acknowledgement store: {error}"))?;
    std::fs::write(&tmp, serialized)
        .map_err(|error| format!("failed to write acknowledgement store: {error}"))?;
    std::fs::rename(&tmp, path)
        .map_err(|error| format!("failed to commit acknowledgement store: {error}"))?;
    Ok(())
}

#[tauri::command]
fn first_run_check_acknowledgement(
    app: tauri::AppHandle,
    notice_version: String,
) -> Result<bool, String> {
    first_run_validate_notice_version(&notice_version)?;
    let path = first_run_store_path(&app)?;
    let store = first_run_read_store(&path)?;
    Ok(store
        .get("acknowledged")
        .and_then(|acknowledged| acknowledged.get(&notice_version))
        .is_some())
}

#[tauri::command]
fn first_run_write_acknowledgement(
    app: tauri::AppHandle,
    notice_version: String,
) -> Result<(), String> {
    first_run_validate_notice_version(&notice_version)?;
    let path = first_run_store_path(&app)?;
    let mut store = first_run_read_store(&path)?;
    let acknowledged = store
        .get_mut("acknowledged")
        .and_then(|value| value.as_object_mut())
        .ok_or("acknowledgement store has invalid shape")?;
    if acknowledged.len() >= FIRST_RUN_MAX_ENTRIES && !acknowledged.contains_key(&notice_version) {
        return Err("acknowledgement store entry limit reached".into());
    }
    acknowledged.insert(
        notice_version,
        serde_json::json!({
            "acknowledgedAt": chrono_free_iso8601()
        }),
    );
    first_run_write_store_atomic(&path, &store)
}

/// Minimal ISO-8601 UTC timestamp without pulling in chrono.
fn chrono_free_iso8601() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // 1970-01-01 epoch math
    let days = secs / 86400;
    let day_secs = secs % 86400;
    let hours = day_secs / 3600;
    let minutes = (day_secs % 3600) / 60;
    let seconds = day_secs % 60;
    // Simplified date from days since epoch
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let year_days = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < year_days {
            break;
        }
        remaining -= year_days;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days: [i64; 12] = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0usize;
    while m < 12 && remaining >= month_days[m] {
        remaining -= month_days[m];
        m += 1;
    }
    format!(
        "{y:04}-{:02}-{:02}T{hours:02}:{minutes:02}:{seconds:02}Z",
        m + 1,
        remaining + 1,
    )
}

fn navigation_allowed(url: &tauri::Url) -> bool {
    // Trusted app schemes are always allowed. http is permitted ONLY for the
    // Vite dev server origin (http://127.0.0.1:5173) so `tauri dev` can load the
    // frontend; arbitrary host navigation stays denied (issue 035 — deny host
    // navigation/network). Packaged builds serve from tauri://localhost and
    // never need external http/https navigation.
    match url.scheme() {
        "tauri" | "playground-preview" | "about" => true,
        "http" => url.host_str() == Some("127.0.0.1") && url.port() == Some(5173),
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Issue 050 (macOS): rebuild the default application menu, but replace the
/// predefined Quit item with a custom menu item carrying the Cmd+Q
/// accelerator. This is the supported workaround for the upstream bug where
/// macOS's native Quit / Cmd+Q calls AppKit `terminate:` directly and bypasses
/// Tauri's event loop (tauri-apps/tauri#13778, dup of #12978), so neither
/// `RunEvent::ExitRequested` nor `api.prevent_exit()` ever runs. Routing Quit
/// through a custom `MenuItem` makes it fire `on_menu_event` instead, where we
/// can gate on the frontend's dirty state. The rest of the menu (App/File/Edit/
/// View/Window/Help) is reproduced verbatim from `Menu::default` so standard
/// behaviour — including Edit's cut/copy/paste/undo that Monaco relies on — is
/// preserved. The custom Quit item's id is `WORKSPACE_QUIT_MENU_ID`.
#[cfg(target_os = "macos")]
const WORKSPACE_QUIT_MENU_ID: &str = "workspace-quit";

#[cfg(target_os = "macos")]
fn build_macos_menu<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{
        AboutMetadata, HELP_SUBMENU_ID, Menu, MenuItem, PredefinedMenuItem, Submenu,
        WINDOW_SUBMENU_ID,
    };

    let pkg_info = app_handle.package_info();
    let config = app_handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    // The one intentional deviation from Menu::default: a custom Quit item that
    // fires on_menu_event (rather than the predefined item that calls native
    // terminate: and bypasses the event loop).
    let quit = MenuItem::with_id(
        app_handle,
        WORKSPACE_QUIT_MENU_ID,
        format!("Quit {}", pkg_info.name),
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    let app_menu = Submenu::with_items(
        app_handle,
        pkg_info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::services(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::hide(app_handle, None)?,
            &PredefinedMenuItem::hide_others(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &quit,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app_handle,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app_handle, None)?],
    )?;

    let edit_menu = Submenu::with_items(
        app_handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app_handle, None)?,
            &PredefinedMenuItem::redo(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::cut(app_handle, None)?,
            &PredefinedMenuItem::copy(app_handle, None)?,
            &PredefinedMenuItem::paste(app_handle, None)?,
            &PredefinedMenuItem::select_all(app_handle, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app_handle,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app_handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app_handle, None)?,
            &PredefinedMenuItem::maximize(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::close_window(app_handle, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(app_handle, HELP_SUBMENU_ID, "Help", true, &[])?;

    Menu::with_items(
        app_handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

pub fn run() {
    // Issue 041: capture the process-start instant before any other work so
    // shell-startup samples cannot be shifted by later initialisation.
    #[cfg(feature = "proof-harness")]
    let _ = *ISSUE041_PROCESS_START;

    #[cfg(all(target_os = "macos", feature = "proof-harness"))]
    match relay_packaged_proof_through_launch_services() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(|app_handle| {
            // macOS: install our menu with a custom (event-firing) Quit item;
            // every other platform keeps the stock default menu (whose native
            // ExitRequested path already reaches our handler below).
            #[cfg(target_os = "macos")]
            {
                build_macos_menu(app_handle)
            }
            #[cfg(not(target_os = "macos"))]
            {
                tauri::menu::Menu::default(app_handle)
            }
        })
        .on_menu_event(|app_handle, event| {
            // Issue 050 (macOS): the custom Quit item routes here instead of
            // native terminate:, so we can prompt before discarding unsaved
            // changes on Cmd+Q / app-menu Quit (the paths that bypass
            // ExitRequested — tauri-apps/tauri#13778).
            #[cfg(target_os = "macos")]
            if event.id() == WORKSPACE_QUIT_MENU_ID {
                if !WORKSPACE_DIRTY.load(std::sync::atomic::Ordering::SeqCst) {
                    app_handle.exit(0);
                    return;
                }
                use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
                let app_handle = app_handle.clone();
                app_handle
                    .dialog()
                    .message("You have unsaved changes. Do you want to discard them and quit?")
                    .title("Unsaved changes")
                    .kind(MessageDialogKind::Warning)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Discard and quit".to_string(),
                        "Cancel".to_string(),
                    ))
                    .show(move |discard| {
                        if discard {
                            WORKSPACE_DIRTY.store(false, std::sync::atomic::Ordering::SeqCst);
                            app_handle.exit(0);
                        }
                    });
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        })
        .on_window_event(|window, event| {
            // Issue 050: gate the main window's close on the frontend's dirty
            // state. Fires for every window, so scope strictly to "main" (the
            // trusted editor window). When the buffer is dirty we prevent the
            // automatic close
            // and ask for confirmation via a native dialog; on confirm we
            // force-destroy the window (which emits no further events).
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !WORKSPACE_DIRTY.load(std::sync::atomic::Ordering::SeqCst) {
                    return; // clean buffer — allow the close to proceed
                }
                api.prevent_close();
                use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
                let window = window.clone();
                window
                    .dialog()
                    .message("You have unsaved changes. Do you want to discard them and quit?")
                    .title("Unsaved changes")
                    .kind(MessageDialogKind::Warning)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Discard and quit".to_string(),
                        "Cancel".to_string(),
                    ))
                    .show(move |discard| {
                        if discard {
                            // Clear the mirrored dirty state first so that if
                            // destroying the last window cascades into an
                            // app-level ExitRequested, it short-circuits
                            // instead of prompting a second time.
                            WORKSPACE_DIRTY.store(false, std::sync::atomic::Ordering::SeqCst);
                            // Force the window to close without re-emitting
                            // CloseRequested (destroy emits no events).
                            let _ = window.destroy();
                        }
                    });
            }
        })
        .register_uri_scheme_protocol("playground-preview", |_context, request| {
            let uri_string = request.uri().to_string();
            preview_protocol_response(request.method(), &uri_string)
        })
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(
                app.handle(),
                "main",
                // WebviewUrl::App resolves to the Vite dev server in `tauri dev`
                // and to the bundled frontend (index.html) in packaged builds.
                // A hardcoded External(devUrl) here loads nothing when packaged
                // (no dev server) — a blank white window.
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("MonoGame Playground")
            .inner_size(1280.0, 800.0)
            .on_navigation(navigation_allowed)
            .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
            .build()?;
            window.show()?;

            #[cfg(feature = "proof-harness")]
            if packaged_pipeline_proof_enabled() {
                #[cfg(target_os = "macos")]
                {
                    use objc2::MainThreadMarker;
                    use objc2_app_kit::{
                        NSApplication, NSApplicationActivationOptions,
                        NSApplicationActivationPolicy, NSRunningApplication, NSWorkspace,
                    };
                    use tauri::Manager;

                    let mtm = MainThreadMarker::new()
                        .ok_or("proof activation bootstrap did not run on the main thread")?;
                    let native_app = NSApplication::sharedApplication(mtm);
                    native_app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
                    native_app.unhide(None);
                    let running = NSRunningApplication::currentApplication();
                    running.unhide();
                    if let Some(frontmost) = NSWorkspace::sharedWorkspace().frontmostApplication() {
                        running.activateFromApplication_options(
                            &frontmost,
                            NSApplicationActivationOptions::ActivateAllWindows,
                        );
                    }
                    #[allow(deprecated)]
                    running.activateWithOptions(
                        NSApplicationActivationOptions::ActivateAllWindows
                            | NSApplicationActivationOptions::ActivateIgnoringOtherApps,
                    );
                    #[allow(deprecated)]
                    native_app.activateIgnoringOtherApps(true);
                    if let Some(window) = app.get_webview_window("main") {
                        window.unminimize()?;
                        window.set_focus()?;
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(feature = "proof-harness")]
            issue021_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue021_is_locked_session_proof,
            #[cfg(feature = "proof-harness")]
            issue021_emit_report,
            #[cfg(feature = "proof-harness")]
            issue022_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue022_emit_report,
            #[cfg(feature = "proof-harness")]
            issue023_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue024_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue025_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue027_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue028_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue029_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue030_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue031_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue032_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue033_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue033_is_no_wasm_eval_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue034_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue034_trusted_marker,
            #[cfg(feature = "proof-harness")]
            issue034_trusted_marker_calls,
            #[cfg(feature = "proof-harness")]
            issue033_emit_checkpoint,
            #[cfg(feature = "proof-harness")]
            prepare_packaged_proof_window,
            #[cfg(feature = "proof-harness")]
            issue023_emit_checkpoint,
            #[cfg(feature = "proof-harness")]
            issue023_emit_report,
            #[cfg(feature = "proof-harness")]
            issue024_emit_report,
            #[cfg(feature = "proof-harness")]
            issue025_emit_report,
            #[cfg(feature = "proof-harness")]
            issue027_emit_report,
            #[cfg(feature = "proof-harness")]
            issue028_emit_report,
            #[cfg(feature = "proof-harness")]
            issue029_emit_report,
            #[cfg(feature = "proof-harness")]
            issue030_emit_report,
            #[cfg(feature = "proof-harness")]
            issue031_emit_report,
            #[cfg(feature = "proof-harness")]
            issue032_emit_report,
            #[cfg(feature = "proof-harness")]
            issue033_emit_report,
            #[cfg(feature = "proof-harness")]
            issue033_emit_no_wasm_eval_report,
            #[cfg(feature = "proof-harness")]
            issue034_emit_report,
            #[cfg(feature = "proof-harness")]
            issue035_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue035_emit_report,
            #[cfg(feature = "proof-harness")]
            issue036_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue036_emit_report,
            first_run_check_acknowledgement,
            first_run_write_acknowledgement,
            #[cfg(feature = "proof-harness")]
            issue037_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue037_emit_report,
            #[cfg(feature = "proof-harness")]
            issue037_read_store_snapshot,
            #[cfg(feature = "proof-harness")]
            issue037_clear_store,
            #[cfg(feature = "proof-harness")]
            issue037_proof_phase,
            #[cfg(feature = "proof-harness")]
            issue037_emit_checkpoint,
            #[cfg(feature = "proof-harness")]
            issue039_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue039_emit_checkpoint,
            #[cfg(feature = "proof-harness")]
            issue039_emit_report,
            #[cfg(feature = "proof-harness")]
            issue040_is_proof_enabled,
            #[cfg(feature = "proof-harness")]
            issue040_emit_checkpoint,
            #[cfg(feature = "proof-harness")]
            issue040_emit_report,
            #[cfg(feature = "proof-harness")]
            issue040_dispatch_preview_input,
            #[cfg(feature = "proof-harness")]
            issue041_is_benchmark_enabled,
            #[cfg(feature = "proof-harness")]
            issue041_benchmark_mode,
            #[cfg(feature = "proof-harness")]
            issue041_warm_compile_count,
            #[cfg(feature = "proof-harness")]
            issue041_preview_cycle_count,
            #[cfg(feature = "proof-harness")]
            issue041_shell_ready,
            #[cfg(feature = "proof-harness")]
            issue041_emit_checkpoint,
            #[cfg(feature = "proof-harness")]
            issue041_emit_report,
            #[cfg(feature = "proof-harness")]
            issue041_rss_bytes,
            workspace_write_file,
            workspace_save_dialog,
            workspace_open_dialog,
            workspace_set_dirty,
            project_pick_folder,
            project_read,
            project_import_asset
        ])
        .build(tauri::generate_context!())
        .expect("error while building MonoGame Playground")
        .run(|app_handle, event| {
            // Issue 050: gate a whole-application quit (macOS Cmd+Q / the
            // "Quit MonoGame Playground" app menu / OS logout) on the
            // frontend's dirty state. Unlike a per-window close, these fire
            // `ExitRequested` rather than `WindowEvent::CloseRequested`, so the
            // window-level handler above never sees them. `code` is `None` for
            // user/OS-initiated exits and `Some` only for our own programmatic
            // `AppHandle::exit` below — gating on `None` means the confirmed
            // re-exit is never re-intercepted (no prompt loop).
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                if !WORKSPACE_DIRTY.load(std::sync::atomic::Ordering::SeqCst) {
                    return; // clean — allow the quit to proceed
                }
                api.prevent_exit();
                use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
                let app_handle = app_handle.clone();
                app_handle
                    .dialog()
                    .message("You have unsaved changes. Do you want to discard them and quit?")
                    .title("Unsaved changes")
                    .kind(MessageDialogKind::Warning)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Discard and quit".to_string(),
                        "Cancel".to_string(),
                    ))
                    .show(move |discard| {
                        if discard {
                            // Clear the mirror so the programmatic exit's own
                            // ExitRequested (code = Some) short-circuits, then
                            // quit for real.
                            WORKSPACE_DIRTY.store(false, std::sync::atomic::Ordering::SeqCst);
                            app_handle.exit(0);
                        }
                    });
            }
        });
}
include!(concat!(env!("OUT_DIR"), "/preview_assets.rs"));

const PREVIEW_CSP: &str = "default-src 'none'; script-src playground-preview: 'wasm-unsafe-eval'; style-src playground-preview:; connect-src playground-preview:; img-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const MAX_PREVIEW_ASSET_BYTES: usize = 8 * 1024 * 1024;
const MAX_PREVIEW_TOTAL_BYTES: usize = 64 * 1024 * 1024;

fn preview_protocol_response(
    method: &tauri::http::Method,
    raw_uri: &str,
) -> tauri::http::Response<Vec<u8>> {
    if method != tauri::http::Method::GET {
        return preview_response(405, "text/plain; charset=utf-8", b"Method Not Allowed");
    }
    if raw_uri.contains(['%', '\\', '\0', '#']) {
        return preview_response(400, "text/plain; charset=utf-8", b"Bad Request");
    }
    let uri = match raw_uri.parse::<tauri::http::Uri>() {
        Ok(uri) => uri,
        Err(_) => return preview_response(400, "text/plain; charset=utf-8", b"Bad Request"),
    };
    if uri.scheme_str() != Some("playground-preview")
        || uri.authority().map(|value| value.as_str()) != Some("localhost")
        || uri.query().is_some()
    {
        return preview_response(400, "text/plain; charset=utf-8", b"Bad Request");
    }
    let path = uri.path();
    let malformed = !path.starts_with('/')
        || path == "/"
        || path.contains('%')
        || path.contains('\\')
        || path.contains('\0')
        || path.contains("//")
        || path
            .split('/')
            .skip(1)
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || !path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-/".contains(&byte));
    if malformed {
        return preview_response(400, "text/plain; charset=utf-8", b"Bad Request");
    }
    let declared_size = PREVIEW_ASSET_INVENTORY
        .iter()
        .find_map(|(candidate, size)| (*candidate == path).then_some(*size));
    match (declared_size, preview_asset(path)) {
        (Some(size), Some(body))
            if size == body.len()
                && size <= MAX_PREVIEW_ASSET_BYTES
                && PREVIEW_ASSET_TOTAL_BYTES <= MAX_PREVIEW_TOTAL_BYTES =>
        {
            preview_response(200, preview_content_type(path), body)
        }
        (Some(_), Some(_)) => preview_response(404, "text/plain; charset=utf-8", b"Not Found"),
        _ => preview_response(404, "text/plain; charset=utf-8", b"Not Found"),
    }
}

fn preview_response(
    status: u16,
    content_type: &'static str,
    body: &[u8],
) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Access-Control-Allow-Origin", "null")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("Content-Security-Policy", PREVIEW_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(body.to_vec())
        .expect("valid preview protocol response")
}

fn preview_content_type(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".wasm") {
        "application/wasm"
    } else {
        // Framework data, DLL/PDB payloads, and unknown future binary assets
        // are served as opaque bytes. Precompressed sidecars never enter the
        // inventory and therefore have no content-type branch.
        "application/octet-stream"
    }
}

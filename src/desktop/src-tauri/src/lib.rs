// The proof-harness command surface, its env gates, report/checkpoint
// protocol, macOS trusted-input dispatch, and packaged activation/report relay
// are compiled ONLY under the non-default `proof-harness` Cargo feature. The
// shipping PRODUCT build never links this module. Re-exported with a glob so
// the `tauri::generate_handler!` command identifiers stay bare (as `build.rs`
// requires) and the crate-root test module can reach the proof helpers via
// `super::`. The eight PRODUCT commands plus the workspace/project/first-run/
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
// above — binary assets are larger). Mirrors the preview mount bounds:
// per-image <= 16 MiB, per-audio <= 8 MiB, aggregate content <= 24 MiB.
const PROJECT_CONTENT_MAX_FILES: usize = 256;
const PROJECT_CONTENT_MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const PROJECT_CONTENT_MAX_TOTAL_BYTES: u64 = 24 * 1024 * 1024;

/// Supported raw/precompiled content extensions the preview can mount
/// (issue 052). `.wav` is transcoded to an XNB SoundEffect at mount time; images
/// load via the runtime's Texture2D.FromStream fallback; `.xnb` is precompiled.
const PROJECT_CONTENT_EXTENSIONS: &[&str] = &["xnb", "png", "jpg", "jpeg", "bmp", "wav"];

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
            if metadata.len() > PROJECT_CONTENT_MAX_FILE_BYTES {
                return Err(format!(
                    "{file_name} exceeds the {PROJECT_CONTENT_MAX_FILE_BYTES}-byte per-content-file limit"
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
/// byteLength, base64 }], manifestText: string | null }`. `contentFiles` holds
/// the project's `Content/` assets (issue 052) for pre-Run mounting.
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
    let content_files = if content_root.is_dir() {
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
        "manifestText": manifest_text,
    }))
}

#[cfg(test)]
mod tests {
    #[cfg(all(target_os = "macos", feature = "proof-harness"))]
    use super::packaged_app_bundle;
    use super::{
        FIRST_RUN_MAX_ENTRIES, FIRST_RUN_MAX_IDENTITY_BYTES, FIRST_RUN_SCHEMA_VERSION,
        MAX_PREVIEW_ASSET_BYTES, MAX_PREVIEW_TOTAL_BYTES, PREVIEW_ASSET_INVENTORY,
        PREVIEW_ASSET_TOTAL_BYTES, PREVIEW_CSP, base64_encode, chrono_free_iso8601,
        first_run_read_store, first_run_validate_identity, first_run_write_store_atomic,
        navigation_allowed, preview_asset, preview_content_type, preview_protocol_response,
        project_discover_content,
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
        let lockfile = include_str!("../Cargo.lock");
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
                [
                    ".html", ".css", ".js", ".json", ".wasm", ".dat", ".br", ".gz",
                ]
                .iter()
                .any(|extension| path.ends_with(extension)),
                "{path}"
            );
            total = total.checked_add(declared_size).expect("bounded inventory");
        }
        assert!(total <= MAX_PREVIEW_TOTAL_BYTES);
        assert_eq!(total, PREVIEW_ASSET_TOTAL_BYTES);
        assert!(PREVIEW_ASSET_INVENTORY.len() >= 300);
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
            ("/_framework/runtime.br", "application/octet-stream"),
            ("/_framework/runtime.gz", "application/gzip"),
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
    fn first_run_identity_validation_accepts_valid_identities() {
        assert!(first_run_validate_identity("builtin-scratch-v1").is_ok());
        assert!(first_run_validate_identity("a").is_ok());
        assert!(first_run_validate_identity("project_123-test").is_ok());
        assert!(first_run_validate_identity(&"a".repeat(FIRST_RUN_MAX_IDENTITY_BYTES)).is_ok());
    }

    #[test]
    fn first_run_identity_validation_rejects_invalid_identities() {
        assert!(first_run_validate_identity("").is_err());
        assert!(
            first_run_validate_identity(&"a".repeat(FIRST_RUN_MAX_IDENTITY_BYTES + 1)).is_err()
        );
        assert!(first_run_validate_identity("has spaces").is_err());
        assert!(first_run_validate_identity("has.dots").is_err());
        assert!(first_run_validate_identity("path/injection").is_err());
        assert!(first_run_validate_identity("path\\injection").is_err());
        assert!(first_run_validate_identity("emoji😀").is_err());
        assert!(first_run_validate_identity("null\0byte").is_err());
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
        store["acknowledged"]["builtin-scratch-v1"] =
            serde_json::json!({ "acknowledgedAt": "2026-01-01T00:00:00Z" });
        first_run_write_store_atomic(&path, &store).unwrap();
        let reloaded = first_run_read_store(&path).unwrap();
        assert!(
            reloaded["acknowledged"]["builtin-scratch-v1"]["acknowledgedAt"]
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

    const PRODUCT_HANDLER_COMMANDS: [&str; 8] = [
        "first_run_check_acknowledgement",
        "first_run_write_acknowledgement",
        "workspace_write_file",
        "workspace_save_dialog",
        "workspace_open_dialog",
        "workspace_set_dirty",
        "project_pick_folder",
        "project_read",
    ];

    #[test]
    fn handler_registers_exactly_eight_ungated_product_commands() {
        let entries = handler_entries();
        let product: Vec<&str> = entries
            .iter()
            .filter(|(_, gated)| !*gated)
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(
            product, PRODUCT_HANDLER_COMMANDS,
            "the default build must register exactly the eight product commands, ungated"
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
        // Total handler surface is 67 = 8 product + 59 proof.
        assert_eq!(entries.len(), 67);
    }

    #[test]
    fn product_commands_are_present_in_both_profiles_unconditionally() {
        // The eight product command fns compile with and without the feature
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
        assert_eq!(entries.len(), 67);
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

// --- Issue 037: first-run warning acknowledgement store ---
//
// Persistence lives in a JSON file inside Tauri's app-data directory, which is
// inaccessible to the opaque preview iframe (no Tauri IPC, no filesystem).
// The store schema is: { "schemaVersion": 1, "acknowledged": { "<identity>": { "acknowledgedAt": "<ISO-8601>" } } }
// The built-in scratch project uses "builtin-scratch-v1". Folder projects use
// a frontend-derived "folder-sha256-<digest>" identity based on the canonical
// root, so the persisted store never contains the user's filesystem path.
//
// Atomic write: write to a `.tmp` sibling, then rename, so a crash mid-write
// never corrupts the store.  Identity strings are bounded to 256 bytes of
// printable ASCII to prevent path injection or unbounded growth.
//
// When proof mode is active (`MONOGAME_ISSUE037_PROOF=1`), a separate proof-
// namespace file is used so ordinary user acknowledgements are never destroyed.

const FIRST_RUN_STORE_FILENAME: &str = "first-run-acknowledgements.json";
#[cfg(feature = "proof-harness")]
const ISSUE037_PROOF_STORE_FILENAME: &str = "first-run-acknowledgements-proof.json";
const FIRST_RUN_SCHEMA_VERSION: u64 = 1;
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

fn first_run_validate_identity(identity: &str) -> Result<(), String> {
    if identity.is_empty() || identity.len() > FIRST_RUN_MAX_IDENTITY_BYTES {
        return Err("identity must be 1–256 bytes".into());
    }
    if !identity
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    {
        return Err("identity must contain only alphanumeric, hyphen, or underscore".into());
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
            if version != FIRST_RUN_SCHEMA_VERSION {
                return Err(format!(
                    "unsupported acknowledgement store schema version {version}"
                ));
            }
            Ok(value)
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
    identity: String,
) -> Result<bool, String> {
    first_run_validate_identity(&identity)?;
    let path = first_run_store_path(&app)?;
    let store = first_run_read_store(&path)?;
    Ok(store
        .get("acknowledged")
        .and_then(|acknowledged| acknowledged.get(&identity))
        .is_some())
}

#[tauri::command]
fn first_run_write_acknowledgement(app: tauri::AppHandle, identity: String) -> Result<(), String> {
    first_run_validate_identity(&identity)?;
    let path = first_run_store_path(&app)?;
    let mut store = first_run_read_store(&path)?;
    let acknowledged = store
        .get_mut("acknowledged")
        .and_then(|value| value.as_object_mut())
        .ok_or("acknowledgement store has invalid shape")?;
    if acknowledged.len() >= FIRST_RUN_MAX_ENTRIES && !acknowledged.contains_key(&identity) {
        return Err("acknowledgement store entry limit reached".into());
    }
    acknowledged.insert(
        identity,
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
            project_read
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
    } else if [".dll", ".pdb", ".dat", ".br"]
        .iter()
        .any(|extension| path.ends_with(extension))
    {
        "application/octet-stream"
    } else if path.ends_with(".gz") {
        "application/gzip"
    } else {
        "application/octet-stream"
    }
}

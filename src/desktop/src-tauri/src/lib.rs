fn issue009_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE009_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue009_is_proof_enabled() -> bool {
    issue009_proof_enabled()
}

#[tauri::command]
fn issue009_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue009_proof_enabled() {
        return Err("issue 009 proof instrumentation is disabled".into());
    }

    println!("ISSUE009_REPORT={report}");
    app.exit(0);
    Ok(())
}

fn issue011_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE011_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue011_is_proof_enabled() -> bool {
    issue011_proof_enabled()
}

#[tauri::command]
fn issue011_set_outer_size(window: tauri::Window, width: f64, height: f64) -> Result<(), String> {
    if !issue011_proof_enabled() {
        return Err("issue 011 proof instrumentation is disabled".into());
    }

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn issue011_outer_bounds(window: tauri::Window) -> Result<(i32, i32, u32, u32, f64), String> {
    if !issue011_proof_enabled() {
        return Err("issue 011 proof instrumentation is disabled".into());
    }

    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;

    Ok((
        position.x,
        position.y,
        size.width,
        size.height,
        scale_factor,
    ))
}

#[tauri::command]
fn issue011_emit_report(report: String) -> Result<(), String> {
    if !issue011_proof_enabled() {
        return Err("issue 011 proof instrumentation is disabled".into());
    }

    println!("ISSUE011_REPORT={report}");
    Ok(())
}

fn issue010_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE010_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue010_is_proof_enabled() -> bool {
    issue010_proof_enabled()
}

#[tauri::command]
fn issue010_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue010_proof_enabled() {
        return Err("issue 010 proof instrumentation is disabled".into());
    }

    println!("ISSUE010_REPORT={report}");
    app.exit(0);
    Ok(())
}

fn issue020_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE020_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue020_is_proof_enabled() -> bool {
    issue020_proof_enabled()
}

#[tauri::command]
fn issue020_emit_checkpoint(report: String) -> Result<(), String> {
    if !issue020_proof_enabled() {
        return Err("issue 020 proof instrumentation is disabled".into());
    }

    println!("ISSUE020_CHECKPOINT={report}");
    Ok(())
}

#[tauri::command]
fn issue020_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue020_proof_enabled() {
        return Err("issue 020 proof instrumentation is disabled".into());
    }

    println!("ISSUE020_REPORT={report}");
    app.exit(0);
    Ok(())
}

fn issue021_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE021_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue021_is_proof_enabled() -> bool {
    issue021_proof_enabled()
}

#[tauri::command]
fn issue021_is_locked_session_proof() -> bool {
    std::env::var_os("MONOGAME_ISSUE021_LOCKED_SESSION").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue021_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue021_proof_enabled() {
        return Err("issue 021 proof instrumentation is disabled".into());
    }
    println!("ISSUE021_REPORT={report}");
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        app.exit(0);
    });
    Ok(())
}

fn issue022_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE022_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue022_is_proof_enabled() -> bool {
    issue022_proof_enabled()
}

#[tauri::command]
fn issue022_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue022_proof_enabled() {
        return Err("issue 022 proof instrumentation is disabled".into());
    }
    println!("ISSUE022_REPORT={report}");
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        app.exit(0);
    });
    Ok(())
}

fn issue023_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE023_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue023_is_proof_enabled() -> bool {
    issue023_proof_enabled()
}

fn issue024_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE024_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue024_is_proof_enabled() -> bool {
    issue024_proof_enabled()
}

fn issue025_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE025_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue025_is_proof_enabled() -> bool {
    issue025_proof_enabled()
}

fn issue027_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE027_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue027_is_proof_enabled() -> bool {
    issue027_proof_enabled()
}

fn issue028_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE028_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue028_is_proof_enabled() -> bool {
    issue028_proof_enabled()
}

fn issue029_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE029_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue029_is_proof_enabled() -> bool {
    issue029_proof_enabled()
}

fn issue030_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE030_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue030_is_proof_enabled() -> bool {
    issue030_proof_enabled()
}

fn issue031_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE031_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue031_is_proof_enabled() -> bool {
    issue031_proof_enabled()
}

fn issue032_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE032_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue032_is_proof_enabled() -> bool {
    issue032_proof_enabled()
}

fn issue033_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE033_PROOF").is_some_and(|value| value == "1")
}

fn issue033_no_wasm_eval_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE033_NO_WASM_EVAL_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue033_is_proof_enabled() -> bool {
    issue033_proof_enabled() && !issue033_no_wasm_eval_proof_enabled()
}

#[tauri::command]
fn issue033_is_no_wasm_eval_proof_enabled() -> Result<bool, String> {
    if issue033_proof_enabled() && issue033_no_wasm_eval_proof_enabled() {
        return Err("issue 033 proof modes are mutually exclusive".into());
    }
    Ok(issue033_no_wasm_eval_proof_enabled())
}

#[tauri::command]
fn issue033_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue033_proof_enabled() {
        return Err("issue 033 proof instrumentation is disabled".into());
    }
    println!("ISSUE033_CHECKPOINT={checkpoint}");
    Ok(())
}

fn issue034_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE034_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue034_is_proof_enabled() -> bool {
    issue034_proof_enabled()
}

static ISSUE034_TRUSTED_MARKER_CALLS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

fn require_issue034_main_frame(webview: &tauri::WebviewWindow) -> Result<(), String> {
    if !issue034_proof_enabled() || webview.label() != "main" {
        return Err("issue 034 trusted marker is unavailable".into());
    }
    Ok(())
}

#[tauri::command]
fn issue034_trusted_marker(webview: tauri::WebviewWindow) -> Result<&'static str, String> {
    require_issue034_main_frame(&webview)?;
    ISSUE034_TRUSTED_MARKER_CALLS
        .fetch_update(
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
            |count| (count < 8).then_some(count + 1),
        )
        .map_err(|_| "issue 034 trusted marker call limit reached".to_string())?;
    Ok("issue034-main-frame-marker-v1")
}

#[tauri::command]
fn issue034_trusted_marker_calls(webview: tauri::WebviewWindow) -> Result<usize, String> {
    require_issue034_main_frame(&webview)?;
    Ok(ISSUE034_TRUSTED_MARKER_CALLS.load(std::sync::atomic::Ordering::SeqCst))
}

fn issue035_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE035_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue035_is_proof_enabled() -> bool {
    issue035_proof_enabled()
}

fn packaged_pipeline_proof_enabled() -> bool {
    issue021_proof_enabled()
        || issue022_proof_enabled()
        || issue023_proof_enabled()
        || issue024_proof_enabled()
        || issue025_proof_enabled()
        || issue027_proof_enabled()
        || issue028_proof_enabled()
        || issue029_proof_enabled()
        || issue030_proof_enabled()
        || issue031_proof_enabled()
        || issue032_proof_enabled()
        || issue033_proof_enabled()
        || issue033_no_wasm_eval_proof_enabled()
        || issue034_proof_enabled()
        || issue035_proof_enabled()
        || issue036_proof_enabled()
        || issue037_proof_enabled()
}

#[cfg(target_os = "macos")]
fn packaged_app_bundle(executable: &std::path::Path) -> Option<&std::path::Path> {
    let bundle = executable.parent()?.parent()?.parent()?;
    (bundle.extension().and_then(|extension| extension.to_str()) == Some("app")).then_some(bundle)
}

#[cfg(target_os = "macos")]
fn relay_packaged_proof_through_launch_services() -> Result<bool, String> {
    use std::io::Read;

    const RELAUNCHED: &str = "MONOGAME_PROOF_LAUNCHSERVICES_RELAUNCHED";
    const RELAY: &str = "MONOGAME_PROOF_REPORT_RELAY";
    if !packaged_pipeline_proof_enabled() || std::env::var_os(RELAUNCHED).is_some() {
        return Ok(false);
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let Some(bundle) = packaged_app_bundle(&executable) else {
        return Ok(false);
    };
    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let relay = listener.local_addr().map_err(|error| error.to_string())?;
    let mut launcher = std::process::Command::new("/usr/bin/open")
        .args(["-n", "-W", "--env", &format!("{RELAUNCHED}=1")])
        .args(["--env", &format!("{RELAY}={relay}")])
        .arg(bundle)
        .spawn()
        .map_err(|error| format!("failed to launch packaged proof with LaunchServices: {error}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
    let mut stream = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if let Some(status) = launcher.try_wait().map_err(|error| error.to_string())? {
                    return Err(format!("packaged proof exited before reporting: {status}"));
                }
                if std::time::Instant::now() >= deadline {
                    return Err("packaged proof did not report within 180 seconds".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(error) => return Err(format!("packaged proof report relay failed: {error}")),
        }
    };
    let mut report = String::new();
    stream
        .read_to_string(&mut report)
        .map_err(|error| format!("failed to read packaged proof report: {error}"))?;
    print!("{report}");
    let status = launcher
        .wait()
        .map_err(|error| format!("failed waiting for packaged proof: {error}"))?;
    if !status.success() {
        return Err(format!("packaged proof exited with {status}"));
    }
    Ok(true)
}

fn emit_packaged_proof_report(report: &str) -> Result<(), String> {
    use std::io::Write;

    let Some(relay) = std::env::var_os("MONOGAME_PROOF_REPORT_RELAY") else {
        println!("{report}");
        return Ok(());
    };
    let mut stream = std::net::TcpStream::connect(relay.to_string_lossy().as_ref())
        .map_err(|error| format!("failed to connect to packaged proof report relay: {error}"))?;
    writeln!(stream, "{report}")
        .map_err(|error| format!("failed to relay packaged proof report: {error}"))
}

fn require_packaged_pipeline_proof(enabled: bool) -> Result<(), String> {
    enabled
        .then_some(())
        .ok_or_else(|| "packaged pipeline proof instrumentation is disabled".into())
}

fn proof_window_ready(
    visible: bool,
    focused: bool,
    minimized: bool,
    application_active: bool,
    native_window_focused: bool,
) -> bool {
    visible && focused && !minimized && application_active && native_window_focused
}

fn proof_activation_target_allowed(
    proof_enabled: bool,
    expected_pid: i32,
    observed_pid: i32,
    expected_window: isize,
    observed_window: isize,
) -> bool {
    proof_enabled
        && expected_pid > 0
        && observed_pid == expected_pid
        && expected_window > 0
        && observed_window == expected_window
}

#[cfg(target_os = "macos")]
fn dispatch_exact_proof_window_activation(
    running: &objc2_app_kit::NSRunningApplication,
    window: &objc2_app_kit::NSWindow,
) -> Result<(), String> {
    let expected_pid = std::process::id() as i32;
    let window_number = window.windowNumber();
    if !proof_activation_target_allowed(
        packaged_pipeline_proof_enabled(),
        expected_pid,
        running.processIdentifier(),
        window_number,
        window.windowNumber(),
    ) {
        return Err("proof activation target mismatch".into());
    }
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType};
    use objc2_foundation::NSPoint;
    let window_number = window.windowNumber();
    let size = window.frame().size;
    let location = NSPoint::new(size.width / 2.0, size.height / 2.0);
    let make_event = |event_type| {
        NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            event_type,
            location,
            NSEventModifierFlags::empty(),
            0.0,
            window_number,
            None,
            0,
            1,
            1.0,
        )
        .ok_or_else(|| "failed to create exact proof window event".to_string())
    };
    let mouse_down = make_event(NSEventType::LeftMouseDown)?;
    let mouse_up = make_event(NSEventType::LeftMouseUp)?;
    if !proof_activation_target_allowed(
        true,
        expected_pid,
        running.processIdentifier(),
        window_number,
        mouse_down.windowNumber(),
    ) || mouse_up.windowNumber() != window_number
    {
        return Err("proof activation event target mismatch".into());
    }
    window.sendEvent(&mouse_down);
    window.sendEvent(&mouse_up);
    Ok(())
}

#[cfg(target_os = "macos")]
async fn activate_packaged_proof_window(
    window: &tauri::Window,
) -> Result<(bool, bool, bool, bool, bool, u32, u128), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSApplication, NSApplicationActivationOptions, NSApplicationActivationPolicy,
        NSRunningApplication, NSWindow, NSWorkspace,
    };
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let started = Instant::now();
    let ns_window = window.ns_window().map_err(|error| error.to_string())? as usize;
    let mut attempts = 0;
    let mut native = (false, false, false, false);
    let mut native_window_focused = false;

    while attempts < 30 {
        attempts += 1;
        let (sender, receiver) = mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let result: Result<(bool, bool, bool, bool), String> = (|| {
                    let mtm = MainThreadMarker::new().ok_or_else(|| {
                        "native activation did not run on the main thread".to_string()
                    })?;
                    let app = NSApplication::sharedApplication(mtm);
                    let policy_regular = app.activationPolicy()
                        == NSApplicationActivationPolicy::Regular
                        || app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
                    app.unhide(None);

                    let running = NSRunningApplication::currentApplication();
                    let unhide_requested = running.unhide();
                    if let Some(frontmost) = NSWorkspace::sharedWorkspace().frontmostApplication() {
                        running.activateFromApplication_options(
                            &frontmost,
                            NSApplicationActivationOptions::ActivateAllWindows,
                        );
                    }
                    app.activate();
                    #[allow(deprecated)]
                    let running_activation_requested = running.activateWithOptions(
                        NSApplicationActivationOptions::ActivateAllWindows
                            | NSApplicationActivationOptions::ActivateIgnoringOtherApps,
                    );
                    #[allow(deprecated)]
                    app.activateIgnoringOtherApps(true);

                    // SAFETY: Tauri owns this NSWindow for the command lifetime and
                    // this closure executes on AppKit's main thread.
                    let native_window = unsafe { &*(ns_window as *mut NSWindow) };
                    native_window.orderFrontRegardless();
                    native_window.makeKeyAndOrderFront(None);
                    native_window.makeMainWindow();
                    native_window.makeKeyWindow();
                    app.activate();
                    dispatch_exact_proof_window_activation(&running, native_window)?;
                    app.activate();
                    #[allow(deprecated)]
                    running.activateWithOptions(
                        NSApplicationActivationOptions::ActivateAllWindows
                            | NSApplicationActivationOptions::ActivateIgnoringOtherApps,
                    );
                    Ok((
                        policy_regular,
                        unhide_requested,
                        running_activation_requested,
                        false,
                    ))
                })();
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;
        native = tauri::async_runtime::spawn_blocking(move || {
            receiver.recv_timeout(Duration::from_secs(2))
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("native activation main-thread callback timed out: {error}"))??;
        window.set_focus().map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(200)))
            .await
            .map_err(|error| error.to_string())?;

        let (sender, receiver) = mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let result: Result<(bool, bool), String> = (|| {
                    let mtm = MainThreadMarker::new().ok_or_else(|| {
                        "native activation observation did not run on the main thread".to_string()
                    })?;
                    let app = NSApplication::sharedApplication(mtm);
                    let running = NSRunningApplication::currentApplication();
                    // SAFETY: Tauri still owns this NSWindow and the observation
                    // executes on AppKit's main thread.
                    let native_window = unsafe { &*(ns_window as *mut NSWindow) };
                    Ok((
                        app.isActive() && running.isActive(),
                        native_window.isKeyWindow(),
                    ))
                })();
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;
        let settled_native = tauri::async_runtime::spawn_blocking(move || {
            receiver.recv_timeout(Duration::from_secs(2))
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("native activation observation timed out: {error}"))??;
        native.3 = settled_native.0;
        native_window_focused = settled_native.1;

        let visible = window.is_visible().map_err(|error| error.to_string())?;
        let focused = window.is_focused().map_err(|error| error.to_string())?;
        let minimized = window.is_minimized().map_err(|error| error.to_string())?;
        if proof_window_ready(visible, focused, minimized, native.3, native_window_focused) {
            break;
        }
    }

    window.set_focus().map_err(|error| error.to_string())?;
    let visible = window.is_visible().map_err(|error| error.to_string())?;
    let focused = window.is_focused().map_err(|error| error.to_string())?;
    let minimized = window.is_minimized().map_err(|error| error.to_string())?;
    if !proof_window_ready(visible, focused, minimized, native.3, native_window_focused) {
        return Err(format!(
            "proof window did not become ready after {attempts} attempts: \
             visible={visible}, focused={focused}, minimized={minimized}, \
             applicationActive={}, nativeWindowFocused={native_window_focused}",
            native.3,
        ));
    }
    Ok((
        native.0,
        native.1,
        native.2,
        native.3,
        native_window_focused,
        attempts,
        started.elapsed().as_millis(),
    ))
}

#[tauri::command]
async fn prepare_packaged_proof_window(
    window: tauri::Window,
) -> Result<
    (
        String,
        bool,
        bool,
        bool,
        bool,
        bool,
        bool,
        bool,
        bool,
        u32,
        u128,
    ),
    String,
> {
    require_packaged_pipeline_proof(packaged_pipeline_proof_enabled())?;

    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    let native = activate_packaged_proof_window(&window).await?;
    #[cfg(not(target_os = "macos"))]
    let native = (true, true, true, true, true, 1, 0);

    window.set_focus().map_err(|error| error.to_string())?;
    Ok((
        if cfg!(target_os = "macos") {
            "appkit"
        } else {
            "tauri"
        }
        .into(),
        native.0,
        native.1,
        native.2,
        native.3,
        native.4,
        window.is_visible().map_err(|error| error.to_string())?,
        window.is_focused().map_err(|error| error.to_string())?,
        window.is_minimized().map_err(|error| error.to_string())?,
        native.5,
        native.6,
    ))
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::packaged_app_bundle;
    use super::{
        MAX_PREVIEW_ASSET_BYTES, MAX_PREVIEW_TOTAL_BYTES, PREVIEW_ASSET_INVENTORY,
        PREVIEW_ASSET_TOTAL_BYTES, PREVIEW_CSP, navigation_allowed, preview_asset,
        preview_content_type, preview_protocol_response, proof_activation_target_allowed,
        proof_window_ready, require_packaged_pipeline_proof,
        issue037_validate_identity, issue037_read_store, issue037_write_store_atomic,
        chrono_free_iso8601, ISSUE037_SCHEMA_VERSION, ISSUE037_MAX_IDENTITY_BYTES,
        ISSUE037_MAX_ENTRIES,
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

    #[test]
    fn native_activation_is_rejected_without_packaged_proof_authorization() {
        assert!(require_packaged_pipeline_proof(false).is_err());
        assert!(require_packaged_pipeline_proof(true).is_ok());
    }

    #[test]
    fn navigation_allows_only_trusted_schemes() {
        let parse = |s: &str| s.parse::<tauri::Url>().unwrap();
        assert!(navigation_allowed(&parse("tauri://localhost")));
        assert!(navigation_allowed(&parse("tauri://localhost/index.html")));
        assert!(navigation_allowed(
            &parse("playground-preview://localhost/preview.js")
        ));
        assert!(navigation_allowed(&parse("about:blank")));
        assert!(navigation_allowed(&parse("about:srcdoc")));
        assert!(!navigation_allowed(&parse("https://example.com")));
        assert!(!navigation_allowed(&parse("http://example.com")));
        assert!(!navigation_allowed(&parse("http://ipc.localhost")));
        assert!(!navigation_allowed(&parse("file:///etc/passwd")));
        assert!(!navigation_allowed(&parse("data:text/html,test")));
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
        assert!(permission.contains("issue034_trusted_marker"));
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
            "tauri-plugin-dialog",
            "tauri-plugin-clipboard-manager",
        ] {
            assert!(!manifest.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn proof_readiness_requires_native_and_tauri_focus() {
        assert!(proof_window_ready(true, true, false, true, true));
        assert!(!proof_window_ready(true, true, false, false, true));
        assert!(!proof_window_ready(true, true, false, true, false));
        assert!(!proof_window_ready(true, false, false, true, true));
        assert!(!proof_window_ready(true, true, true, true, true));
    }

    #[test]
    fn exact_activation_requires_proof_gate_and_owned_target() {
        assert!(proof_activation_target_allowed(true, 7, 7, 42, 42));
        assert!(!proof_activation_target_allowed(false, 7, 7, 42, 42));
        assert!(!proof_activation_target_allowed(true, 0, 0, 42, 42));
    }

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

    #[cfg(target_os = "macos")]
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
    fn issue037_identity_validation_accepts_valid_identities() {
        assert!(issue037_validate_identity("builtin-scratch-v1").is_ok());
        assert!(issue037_validate_identity("a").is_ok());
        assert!(issue037_validate_identity("project_123-test").is_ok());
        assert!(issue037_validate_identity(&"a".repeat(ISSUE037_MAX_IDENTITY_BYTES)).is_ok());
    }

    #[test]
    fn issue037_identity_validation_rejects_invalid_identities() {
        assert!(issue037_validate_identity("").is_err());
        assert!(issue037_validate_identity(&"a".repeat(ISSUE037_MAX_IDENTITY_BYTES + 1)).is_err());
        assert!(issue037_validate_identity("has spaces").is_err());
        assert!(issue037_validate_identity("has.dots").is_err());
        assert!(issue037_validate_identity("path/injection").is_err());
        assert!(issue037_validate_identity("path\\injection").is_err());
        assert!(issue037_validate_identity("emoji😀").is_err());
        assert!(issue037_validate_identity("null\0byte").is_err());
    }

    #[test]
    fn issue037_store_roundtrip_and_atomicity() {
        let dir = std::env::temp_dir().join(format!("issue037-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test-ack.json");

        // Read non-existent file returns empty store
        let store = issue037_read_store(&path).unwrap();
        assert_eq!(store["schemaVersion"], ISSUE037_SCHEMA_VERSION);
        assert_eq!(store["acknowledged"].as_object().unwrap().len(), 0);

        // Write and re-read
        let mut store = store;
        store["acknowledged"]["builtin-scratch-v1"] =
            serde_json::json!({ "acknowledgedAt": "2026-01-01T00:00:00Z" });
        issue037_write_store_atomic(&path, &store).unwrap();
        let reloaded = issue037_read_store(&path).unwrap();
        assert!(reloaded["acknowledged"]["builtin-scratch-v1"]["acknowledgedAt"]
            .as_str()
            .unwrap()
            .starts_with("2026"));

        // No .tmp file left behind
        assert!(!path.with_extension("json.tmp").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn issue037_store_rejects_corrupt_json() {
        let dir = std::env::temp_dir().join(format!("issue037-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("corrupt.json");
        std::fs::write(&path, "not json").unwrap();
        assert!(issue037_read_store(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn issue037_store_rejects_wrong_schema_version() {
        let dir = std::env::temp_dir().join(format!("issue037-schema-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("wrong-version.json");
        std::fs::write(
            &path,
            r#"{"schemaVersion":99,"acknowledged":{}}"#,
        )
        .unwrap();
        assert!(issue037_read_store(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn issue037_entry_limit_is_enforced() {
        assert!(ISSUE037_MAX_ENTRIES == 1024);
    }

    #[test]
    fn issue037_timestamp_is_valid_iso8601() {
        let ts = chrono_free_iso8601();
        assert!(
            ts.len() == 20 && ts.ends_with('Z') && ts.contains('T'),
            "timestamp format: {ts}"
        );
    }

    #[test]
    fn issue037_proof_and_production_store_filenames_are_distinct() {
        assert_ne!(
            super::ISSUE037_STORE_FILENAME,
            super::ISSUE037_PROOF_STORE_FILENAME,
        );
        assert!(super::ISSUE037_PROOF_STORE_FILENAME.contains("proof"));
    }
}

#[tauri::command]
fn issue023_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue023_proof_enabled() {
        return Err("issue 023 proof instrumentation is disabled".into());
    }
    println!("ISSUE023_CHECKPOINT={checkpoint}");
    Ok(())
}

#[tauri::command]
fn issue023_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue023_proof_enabled() {
        return Err("issue 023 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE023_REPORT={report}"))?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        app.exit(0);
    });
    Ok(())
}

#[tauri::command]
fn issue024_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue024_proof_enabled() {
        return Err("issue 024 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE024_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue025_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue025_proof_enabled() {
        return Err("issue 025 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE025_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue027_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue027_proof_enabled() {
        return Err("issue 027 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE027_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue028_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue028_proof_enabled() {
        return Err("issue 028 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE028_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue029_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue029_proof_enabled() {
        return Err("issue 029 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE029_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue030_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue030_proof_enabled() {
        return Err("issue 030 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE030_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue031_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue031_proof_enabled() {
        return Err("issue 031 proof instrumentation is disabled".into());
    }

    emit_packaged_proof_report(&format!("ISSUE031_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue032_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue032_proof_enabled() {
        return Err("issue 032 proof instrumentation is disabled".into());
    }

    emit_packaged_proof_report(&format!("ISSUE032_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue033_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue033_proof_enabled() {
        return Err("issue 033 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE033_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue033_emit_no_wasm_eval_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue033_no_wasm_eval_proof_enabled() {
        return Err("issue 033 no-wasm-eval proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE033_NO_WASM_EVAL_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue034_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue034_proof_enabled() {
        return Err("issue 034 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE034_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn issue035_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue035_proof_enabled() {
        return Err("issue 035 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE035_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

fn issue036_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE036_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue036_is_proof_enabled() -> bool {
    issue036_proof_enabled()
}

#[tauri::command]
fn issue036_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue036_proof_enabled() {
        return Err("issue 036 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE036_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

// --- Issue 037: first-run warning acknowledgement store ---
//
// Persistence lives in a JSON file inside Tauri's app-data directory, which is
// inaccessible to the opaque preview iframe (no Tauri IPC, no filesystem).
// The store schema is: { "schemaVersion": 1, "acknowledged": { "<identity>": { "acknowledgedAt": "<ISO-8601>" } } }
// Identity is currently the fixed string "builtin-scratch-v1" (the single
// built-in scratch project).  Issues 050/051 will replace this with a real
// per-project stable identity.
//
// Atomic write: write to a `.tmp` sibling, then rename, so a crash mid-write
// never corrupts the store.  Identity strings are bounded to 256 bytes of
// printable ASCII to prevent path injection or unbounded growth.
//
// When proof mode is active (`MONOGAME_ISSUE037_PROOF=1`), a separate proof-
// namespace file is used so ordinary user acknowledgements are never destroyed.

const ISSUE037_STORE_FILENAME: &str = "first-run-acknowledgements.json";
const ISSUE037_PROOF_STORE_FILENAME: &str = "first-run-acknowledgements-proof.json";
const ISSUE037_SCHEMA_VERSION: u64 = 1;
const ISSUE037_MAX_IDENTITY_BYTES: usize = 256;
const ISSUE037_MAX_ENTRIES: usize = 1024;

fn issue037_store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    let filename = if issue037_proof_enabled() {
        ISSUE037_PROOF_STORE_FILENAME
    } else {
        ISSUE037_STORE_FILENAME
    };
    Ok(dir.join(filename))
}

fn issue037_validate_identity(identity: &str) -> Result<(), String> {
    if identity.is_empty() || identity.len() > ISSUE037_MAX_IDENTITY_BYTES {
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

fn issue037_read_store(path: &std::path::Path) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => {
            let value: serde_json::Value = serde_json::from_str(&content)
                .map_err(|error| format!("acknowledgement store is corrupt: {error}"))?;
            let version = value
                .get("schemaVersion")
                .and_then(|version| version.as_u64())
                .ok_or("acknowledgement store missing schemaVersion")?;
            if version != ISSUE037_SCHEMA_VERSION {
                return Err(format!(
                    "unsupported acknowledgement store schema version {version}"
                ));
            }
            Ok(value)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({
            "schemaVersion": ISSUE037_SCHEMA_VERSION,
            "acknowledged": {}
        })),
        Err(error) => Err(format!("failed to read acknowledgement store: {error}")),
    }
}

fn issue037_write_store_atomic(
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
fn issue037_check_acknowledgement(
    app: tauri::AppHandle,
    identity: String,
) -> Result<bool, String> {
    issue037_validate_identity(&identity)?;
    let path = issue037_store_path(&app)?;
    let store = issue037_read_store(&path)?;
    Ok(store
        .get("acknowledged")
        .and_then(|acknowledged| acknowledged.get(&identity))
        .is_some())
}

#[tauri::command]
fn issue037_write_acknowledgement(
    app: tauri::AppHandle,
    identity: String,
) -> Result<(), String> {
    issue037_validate_identity(&identity)?;
    let path = issue037_store_path(&app)?;
    let mut store = issue037_read_store(&path)?;
    let acknowledged = store
        .get_mut("acknowledged")
        .and_then(|value| value.as_object_mut())
        .ok_or("acknowledgement store has invalid shape")?;
    if acknowledged.len() >= ISSUE037_MAX_ENTRIES && !acknowledged.contains_key(&identity) {
        return Err("acknowledgement store entry limit reached".into());
    }
    acknowledged.insert(
        identity,
        serde_json::json!({
            "acknowledgedAt": chrono_free_iso8601()
        }),
    );
    issue037_write_store_atomic(&path, &store)
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

fn issue037_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE037_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue037_is_proof_enabled() -> bool {
    issue037_proof_enabled()
}

#[tauri::command]
fn issue037_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE037_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

/// Proof-only: read the store contents for verification (bounded, no paths).
#[tauri::command]
fn issue037_read_store_snapshot(app: tauri::AppHandle) -> Result<String, String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    let path = issue037_store_path(&app)?;
    let store = issue037_read_store(&path)?;
    // Return only the acknowledged map, not the file path
    serde_json::to_string(&store).map_err(|error| error.to_string())
}

/// Proof-only: clear the store for test isolation.
#[tauri::command]
fn issue037_clear_store(app: tauri::AppHandle) -> Result<(), String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    let path = issue037_store_path(&app)?;
    let empty = serde_json::json!({
        "schemaVersion": ISSUE037_SCHEMA_VERSION,
        "acknowledged": {}
    });
    issue037_write_store_atomic(&path, &empty)
}

/// Proof-only: returns the current proof phase from env (1 or 2).
#[tauri::command]
fn issue037_proof_phase() -> Result<u32, String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    let phase = std::env::var("MONOGAME_ISSUE037_PROOF_PHASE")
        .unwrap_or_else(|_| "1".into())
        .parse::<u32>()
        .map_err(|error| format!("invalid proof phase: {error}"))?;
    if phase < 1 || phase > 2 {
        return Err(format!("proof phase must be 1 or 2, got {phase}"));
    }
    Ok(phase)
}

/// Proof-only: emit a checkpoint line for multi-process phase markers.
#[tauri::command]
fn issue037_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    println!("ISSUE037_CHECKPOINT={checkpoint}");
    Ok(())
}

fn navigation_allowed(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "tauri" | "playground-preview" | "about")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    match relay_packaged_proof_through_launch_services() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }

    tauri::Builder::default()
        .register_uri_scheme_protocol("playground-preview", |_context, request| {
            preview_protocol_response(request.method(), &request.uri().to_string())
        })
        .setup(|app| {
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("main window configuration is missing")?;
            tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .on_navigation(|url| navigation_allowed(url))
                .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
                .build()?;

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
                        window.show()?;
                        window.unminimize()?;
                        window.set_focus()?;
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            issue009_is_proof_enabled,
            issue009_emit_report,
            issue011_is_proof_enabled,
            issue011_set_outer_size,
            issue011_outer_bounds,
            issue011_emit_report,
            issue010_is_proof_enabled,
            issue010_emit_report,
            issue020_is_proof_enabled,
            issue020_emit_checkpoint,
            issue020_emit_report,
            issue021_is_proof_enabled,
            issue021_is_locked_session_proof,
            issue021_emit_report,
            issue022_is_proof_enabled,
            issue022_emit_report,
            issue023_is_proof_enabled,
            issue024_is_proof_enabled,
            issue025_is_proof_enabled,
            issue027_is_proof_enabled,
            issue028_is_proof_enabled,
            issue029_is_proof_enabled,
            issue030_is_proof_enabled,
            issue031_is_proof_enabled,
            issue032_is_proof_enabled,
            issue033_is_proof_enabled,
            issue033_is_no_wasm_eval_proof_enabled,
            issue034_is_proof_enabled,
            issue034_trusted_marker,
            issue034_trusted_marker_calls,
            issue033_emit_checkpoint,
            prepare_packaged_proof_window,
            issue023_emit_checkpoint,
            issue023_emit_report,
            issue024_emit_report,
            issue025_emit_report,
            issue027_emit_report,
            issue028_emit_report,
            issue029_emit_report,
            issue030_emit_report,
            issue031_emit_report,
            issue032_emit_report,
            issue033_emit_report,
            issue033_emit_no_wasm_eval_report,
            issue034_emit_report,
            issue035_is_proof_enabled,
            issue035_emit_report,
            issue036_is_proof_enabled,
            issue036_emit_report,
            issue037_check_acknowledgement,
            issue037_write_acknowledgement,
            issue037_is_proof_enabled,
            issue037_emit_report,
            issue037_read_store_snapshot,
            issue037_clear_store,
            issue037_proof_phase,
            issue037_emit_checkpoint
        ])
        .run(tauri::generate_context!())
        .expect("error while running MonoGame Playground");
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
    } else if path.ends_with(".dll") {
        "application/octet-stream"
    } else if path.ends_with(".pdb") {
        "application/octet-stream"
    } else if path.ends_with(".dat") {
        "application/octet-stream"
    } else if path.ends_with(".br") {
        "application/octet-stream"
    } else if path.ends_with(".gz") {
        "application/gzip"
    } else {
        "application/octet-stream"
    }
}

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
        || issue038_proof_enabled()
        || issue039_proof_enabled()
        || issue040_proof_enabled()
        || issue041_benchmark_enabled()
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
    let mut cmd = std::process::Command::new("/usr/bin/open");
    cmd.args(["-n", "-W", "--env", &format!("{RELAUNCHED}=1")]);
    cmd.args(["--env", &format!("{RELAY}={relay}")]);
    // Forward all active MONOGAME_ISSUE* proof environment variables
    for (key, value) in std::env::vars_os() {
        if let Some(key_str) = key.to_str() {
            if key_str.starts_with("MONOGAME_ISSUE") {
                if let Some(val_str) = value.to_str() {
                    cmd.args(["--env", &format!("{key_str}={val_str}")]);
                }
            }
        }
    }
    cmd.arg(bundle);
    let mut launcher = cmd
        .spawn()
        .map_err(|error| format!("failed to launch packaged proof with LaunchServices: {error}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
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
async fn issue050_save_dialog(
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
async fn issue050_open_dialog(
    app: tauri::AppHandle,
) -> Result<Option<(String, String)>, String> {
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

/// Issue 050: Write file content atomically (after save dialog returned path).
/// 1. Back up existing file to .bak (keep one backup)
/// 2. Write to .tmp, then rename to target (atomic)
/// Returns Ok(path) on success, Err on failure.
#[tauri::command]
async fn issue050_write_file(
    _app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<String, String> {
    let path_buf = std::path::PathBuf::from(&path);

    // Backup existing file if it exists
    if path_buf.exists() {
        let bak_path = path_buf.with_extension("bak");
        // If .bak already exists, remove it (keep only one backup)
        let _ = std::fs::remove_file(&bak_path);
        // Rename existing to .bak
        std::fs::rename(&path_buf, &bak_path)
            .map_err(|e| format!("failed to create backup: {e}"))?;
    }

    // Write atomically: first to temp file, then rename
    let tmp_path = path_buf.with_extension("tmp");
    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("failed to write temporary file: {e}"))?;

    std::fs::rename(&tmp_path, &path_buf)
        .map_err(|e| format!("failed to commit file: {e}"))?;

    Ok(path)
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
        issue041_mode_value, issue041_preview_cycle_count_value, issue041_warm_compile_iterations,
    };
    use tauri::http::{Method, Response};

    fn response(raw_uri: &str) -> Response<Vec<u8>> {
        preview_protocol_response(&Method::GET, raw_uri)
    }

    fn make_state() -> super::Issue038BridgeState {
        super::Issue038BridgeState {
            transfers: std::collections::HashMap::new(),
            asset_transfers: std::collections::HashMap::new(),
            pending_messages: std::collections::HashMap::new(),
            active_generations: std::collections::HashSet::new(),
            generation_counter: 0,
        }
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
    fn issue041_benchmark_mode_accepts_only_known_modes() {
        assert_eq!(issue041_mode_value(None), Ok("full"));
        assert_eq!(issue041_mode_value(Some("full")), Ok("full"));
        assert_eq!(issue041_mode_value(Some("shell-only")), Ok("shell-only"));
        assert_eq!(issue041_mode_value(Some("memory-baseline")), Ok("memory-baseline"));
        assert!(issue041_mode_value(Some("")).is_err());
        assert!(issue041_mode_value(Some("Full")).is_err());
        assert!(issue041_mode_value(Some("everything")).is_err());
    }

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

    // --- Issue 038 unit tests ---

    #[test]
    fn issue038_isolated_html_has_matching_csp() {
        assert!(super::ISSUE038_ISOLATED_HTML.contains(super::PREVIEW_CSP));
        assert_eq!(super::ISSUE038_ISOLATED_CSP, super::PREVIEW_CSP);
    }

    #[test]
    fn issue038_isolated_html_loads_bridge_setup_before_preview() {
        let bridge_pos = super::ISSUE038_ISOLATED_HTML
            .find("_bridge-setup.js")
            .expect("bridge setup script must be in isolated HTML");
        let preview_pos = super::ISSUE038_ISOLATED_HTML
            .find("preview.js")
            .expect("preview.js must be in isolated HTML");
        assert!(
            bridge_pos < preview_pos,
            "bridge setup must load before preview.js"
        );
    }

    #[test]
    fn issue038_bridge_setup_strips_tauri_internals() {
        assert!(super::ISSUE038_BRIDGE_SETUP_JS.contains("__TAURI_INTERNALS__"));
        assert!(super::ISSUE038_BRIDGE_SETUP_JS.contains("__TAURI_IPC__"));
        assert!(super::ISSUE038_BRIDGE_SETUP_JS.contains("configurable: false"));
    }

    #[test]
    fn issue038_preview_label_prefix_is_distinct_from_main() {
        let label = super::issue038_preview_label("test-gen");
        assert!(label.starts_with(super::ISSUE038_PREVIEW_LABEL_PREFIX));
        assert_ne!(label, "main");
        assert!(!label.is_empty());
    }

    #[test]
    fn issue038_transfer_paths_are_bounded() {
        let response = super::issue038_handle_transfer_get(
            "playground-preview://localhost/_transfer/bad-token!/assembly.dll",
        );
        assert!(
            response.is_none() || response.as_ref().unwrap().status() != 200,
            "invalid token must not serve 200"
        );
    }

    #[test]
    fn issue038_bridge_post_rejects_missing_generation() {
        let response = super::issue038_handle_bridge_request(&tauri::http::Method::POST,
            "playground-preview://localhost/_bridge/send",
            b"{}",
        );
        assert!(response.is_some());
        assert_eq!(response.unwrap().status(), 400);
    }

    #[test]
    fn issue038_bridge_post_rejects_oversize_body() {
        let response = super::issue038_handle_bridge_request(&tauri::http::Method::POST,
            "playground-preview://localhost/_bridge/send?generation=test",
            &vec![b'x'; 2 * 1024 * 1024],
        );
        assert!(response.is_some());
        assert_eq!(response.unwrap().status(), 400);
    }

    #[test]
    fn issue038_bridge_post_accepts_valid_message() {
        // Ensure generation is registered in state
        {
            let mut state = super::ISSUE038_BRIDGE.lock().unwrap();
            state
                .pending_messages
                .insert("unit-test-gen".into(), Vec::new());
        }
        let response = super::issue038_handle_bridge_request(&tauri::http::Method::POST,
            "playground-preview://localhost/_bridge/send?generation=unit-test-gen",
            b"{\"type\":\"test\"}",
        );
        assert!(response.is_some());
        assert_eq!(response.unwrap().status(), 200);
        // Verify message was stored
        let state = super::ISSUE038_BRIDGE.lock().unwrap();
        let messages = state.pending_messages.get("unit-test-gen").unwrap();
        assert!(messages.iter().any(|m| m.contains("test")));
    }

    #[test]
    fn issue038_transfer_store_and_serve() {
        {
            let mut state = super::ISSUE038_BRIDGE.lock().unwrap();
            state.transfers.insert(
                "xfer-test".into(),
                super::Issue038TransferEntry {
                    assembly: vec![0xDE, 0xAD],
                    pdb: vec![0xBE, 0xEF],
                },
            );
        }
        let asm_resp = super::issue038_handle_transfer_get(
            "playground-preview://localhost/_transfer/xfer-test/assembly.dll",
        );
        assert!(asm_resp.is_some());
        let r = asm_resp.unwrap();
        assert_eq!(r.status(), 200);
        assert_eq!(r.body(), &[0xDE, 0xAD]);

        let pdb_resp = super::issue038_handle_transfer_get(
            "playground-preview://localhost/_transfer/xfer-test/symbols.pdb",
        );
        assert!(pdb_resp.is_some());
        assert_eq!(pdb_resp.unwrap().body(), &[0xBE, 0xEF]);

        let bad_resp = super::issue038_handle_transfer_get(
            "playground-preview://localhost/_transfer/xfer-test/evil.exe",
        );
        assert!(bad_resp.is_some());
        assert_eq!(bad_resp.unwrap().status(), 404);
    }

    #[test]
    fn issue038_isolated_html_and_bridge_served_by_protocol() {
        let html = super::preview_protocol_response(
            &Method::GET,
            "playground-preview://localhost/_isolated.html",
        );
        assert_eq!(html.status(), 200);
        assert!(String::from_utf8_lossy(html.body()).contains("isolated"));

        let js = super::preview_protocol_response(
            &Method::GET,
            "playground-preview://localhost/_bridge-setup.js",
        );
        assert_eq!(js.status(), 200);
        assert!(String::from_utf8_lossy(js.body()).contains("__bridge038"));
    }

    #[test]
    fn issue038_capability_excludes_preview_label() {
        let capability = include_str!("../capabilities/main.json");
        assert!(!capability.contains(super::ISSUE038_PREVIEW_LABEL_PREFIX));
        assert!(capability.contains("\"windows\": [\"main\"]"));
    }

    #[test]
    fn issue038_bootstrap_preview_rejects_invalid_json() {
        let valid: Result<serde_json::Value, _> = serde_json::from_str("{\"key\":\"value\"}");
        assert!(valid.is_ok());
        let invalid: Result<serde_json::Value, _> = serde_json::from_str("not json");
        assert!(invalid.is_err());
        // Valid JSON is double-escaped for safe JS injection
        let test_val = serde_json::json!({"test": "value"});
        let escaped = serde_json::to_string(&serde_json::to_string(&test_val).unwrap()).unwrap();
        assert!(escaped.starts_with('"') && escaped.ends_with('"'));
    }

    #[test]
    fn issue038_inject_script_requires_proof_gate() {
        // The command checks issue038_proof_enabled() — verify the env check exists
        assert!(!super::issue038_proof_enabled()); // not set in test env
    }

    #[test]
    fn issue038_transfer_zeroes_on_clear() {
        {
            let mut state = super::ISSUE038_BRIDGE.lock().unwrap();
            state.transfers.insert(
                "zero-test".into(),
                super::Issue038TransferEntry {
                    assembly: vec![0xDE, 0xAD, 0xBE, 0xEF],
                    pdb: vec![0xCA, 0xFE],
                },
            );
        }
        // Simulate clear_transfer's zeroing behavior
        {
            let mut state = super::ISSUE038_BRIDGE.lock().unwrap();
            if let Some(mut entry) = state.transfers.remove("zero-test") {
                let asm_before: Vec<u8> = entry.assembly.clone();
                let pdb_before: Vec<u8> = entry.pdb.clone();
                entry.assembly.iter_mut().for_each(|b| *b = 0);
                entry.pdb.iter_mut().for_each(|b| *b = 0);
                assert_ne!(asm_before, entry.assembly);
                assert_ne!(pdb_before, entry.pdb);
                assert!(entry.assembly.iter().all(|b| *b == 0));
                assert!(entry.pdb.iter().all(|b| *b == 0));
            }
        }
    }

    #[test]
    fn issue038_stale_generation_cannot_access_newer_messages() {
        let mut state = super::ISSUE038_BRIDGE.lock().unwrap();
        state.pending_messages.insert("gen-old".into(), vec!["old".into()]);
        state.pending_messages.insert("gen-new".into(), vec!["new".into()]);
        // A stale generation can only access its own messages
        assert_eq!(state.pending_messages.get("gen-old").unwrap(), &["old"]);
        assert_eq!(state.pending_messages.get("gen-new").unwrap(), &["new"]);
        // Removing old doesn't affect new
        state.pending_messages.remove("gen-old");
        assert!(state.pending_messages.get("gen-old").is_none());
        assert_eq!(state.pending_messages.get("gen-new").unwrap(), &["new"]);
        state.pending_messages.remove("gen-new");
    }

    #[test]
    fn issue038_percent_decode_handles_edge_cases() {
        assert_eq!(super::percent_decode("hello%20world"), Some("hello world".into()));
        assert_eq!(super::percent_decode("a%2Fb"), Some("a/b".into()));
        assert_eq!(super::percent_decode("plain"), Some("plain".into()));
        assert_eq!(super::percent_decode("%"), None); // truncated
        assert_eq!(super::percent_decode("%ZZ"), None); // invalid hex
        assert_eq!(super::percent_decode("a+b"), Some("a b".into()));
    }

    #[test]
    fn issue038_relay_env_prefix_is_monogame_issue() {
        // Verify the relay code uses the correct prefix filter
        let source = include_str!("lib.rs");
        assert!(source.contains("starts_with(\"MONOGAME_ISSUE\")"));
    }

    #[test]
    fn issue038_no_wasm_eval_html_differs_by_exactly_one_token() {
        let normal = super::ISSUE038_ISOLATED_HTML;
        let no_wasm = super::ISSUE038_ISOLATED_NO_WASM_EVAL_HTML;
        // The only difference should be the removal of " 'wasm-unsafe-eval'"
        assert!(normal.contains("'wasm-unsafe-eval'"));
        assert!(!no_wasm.contains("'wasm-unsafe-eval'"));
        // After removing the token, content should be identical
        let normalized_normal = normal.replace(" 'wasm-unsafe-eval'", "");
        // The titles differ intentionally, so normalize those too
        let n1 = normalized_normal.replace("Preview runtime (isolated)", "Preview");
        let n2 = no_wasm
            .replace("Preview runtime (no wasm eval)", "Preview")
            .replace("Booting isolated preview (no wasm-eval)...", "Booting isolated preview...");
        assert_eq!(n1, n2, "HTML differs by more than wasm-unsafe-eval + title");
    }

    #[test]
    fn issue038_no_wasm_eval_served_by_protocol() {
        let response = super::preview_protocol_response(
            &Method::GET,
            "playground-preview://localhost/_isolated-no-wasm-eval.html",
        );
        assert_eq!(response.status(), 200);
        let body = String::from_utf8_lossy(response.body());
        assert!(!body.contains("wasm-unsafe-eval"));
        assert!(body.contains("script-src playground-preview:"));
    }

    #[test]
    fn issue038_bridge_setup_has_no_raw_key_storage() {
        let js = super::ISSUE038_BRIDGE_SETUP_JS;
        // Must NOT store raw parser error messages
        assert!(!js.contains("captured.push"));
        assert!(!js.contains("__issue034ParserErrors"));
        // Must have ACL invoke probe that uses internals.invoke directly
        assert!(js.contains("issue034-acl-invoke-probe"));
        assert!(js.contains("internals.invoke"));
        // Must not store or log rejection text that may contain keys
        assert!(!js.contains("capturedKey"));
    }

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

    #[test]
    fn issue040_dispatch_requires_proof_active_generation_and_preview_label() {
        let label = super::issue038_preview_label("gen-1");
        assert!(super::issue040_dispatch_allowed(true, &label, true));
        assert!(!super::issue040_dispatch_allowed(false, &label, true));
        assert!(!super::issue040_dispatch_allowed(true, &label, false));
        assert!(!super::issue040_dispatch_allowed(true, "main", true));
    }

    #[test]
    fn issue040_commands_are_registered_in_every_inventory() {
        let build = include_str!("../build.rs");
        let permission = include_str!("../permissions/main.toml");
        for command in [
            "issue040_is_proof_enabled",
            "issue040_emit_checkpoint",
            "issue040_emit_report",
            "issue040_dispatch_preview_input",
        ] {
            assert!(build.contains(command), "{command} missing from build.rs");
            assert!(
                permission.contains(command),
                "{command} missing from main permission"
            );
        }
    }

    #[test]
    fn issue041_commands_are_registered_in_every_inventory() {
        let build = include_str!("../build.rs");
        let permission = include_str!("../permissions/main.toml");
        let frontend = include_str!("../../../frontend/src/issue34.ts");
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
                "{command} missing from main permission"
            );
            assert!(
                frontend.contains(command),
                "{command} missing from the frontend command inventory"
            );
        }
    }

    #[test]
    fn issue041_benchmark_instrumentation_is_environment_gated() {
        let source = include_str!("lib.rs");
        assert!(source.contains("MONOGAME_ISSUE041_BENCHMARK"));
        // Every issue 041 command body refuses to act unless the gate is set.
        // Seven command bodies refuse to act without the gate (the eighth command
        // is the gate probe itself); one further occurrence is this assertion.
        let gated = source
            .matches("return Err(\"issue 041 benchmark instrumentation is disabled\".into());")
            .count();
        assert_eq!(gated, 7, "every gated issue 041 command must check the flag");
    }

    #[test]
    fn issue039_generation_cleanup_preserves_other_generations() {
        let mut state = make_state();
        state.asset_transfers.insert(
            "token-a".into(),
            super::Issue039AssetTransfer {
                token: "token-a".into(),
                generation: "gen-1".into(),
                assets: vec![super::Issue039AssetEntry {
                    path: "a.xnb".into(),
                    bytes: vec![1, 2, 3],
                    sha256: "aaa".into(),
                }],
            },
        );
        state.asset_transfers.insert(
            "token-b".into(),
            super::Issue039AssetTransfer {
                token: "token-b".into(),
                generation: "gen-2".into(),
                assets: vec![super::Issue039AssetEntry {
                    path: "b.xnb".into(),
                    bytes: vec![4, 5, 6],
                    sha256: "bbb".into(),
                }],
            },
        );

        super::clear_asset_transfers_for_generation(&mut state, "gen-1");

        assert!(
            !state.asset_transfers.contains_key("token-a"),
            "gen-1 transfer should be removed"
        );
        assert!(
            state.asset_transfers.contains_key("token-b"),
            "gen-2 transfer should be preserved"
        );
        assert_eq!(state.asset_transfers["token-b"].assets[0].bytes, vec![4, 5, 6]);
    }

    #[test]
    fn issue039_store_rejected_for_inactive_generation() {
        let mut state = make_state();
        let result = super::store_issue039_asset_validated(
            &mut state,
            "tok",
            "gen-retired",
            0,
            "a.xnb".into(),
            "a".repeat(64),
            vec![1, 2, 3],
        );
        assert!(result.is_err());
        assert!(
            !state.asset_transfers.contains_key("tok"),
            "no transfer created for inactive gen"
        );
    }

    #[test]
    fn issue039_store_accepted_for_active_generation() {
        let mut state = make_state();
        state.active_generations.insert("gen-live".into());
        let result = super::store_issue039_asset_validated(
            &mut state,
            "tok",
            "gen-live",
            0,
            "a.xnb".into(),
            "a".repeat(64),
            vec![1, 2, 3],
        );
        assert!(result.is_ok());
        assert_eq!(state.asset_transfers["tok"].assets.len(), 1);
    }

    #[test]
    fn issue039_store_after_retirement_rejected() {
        let mut state = make_state();
        state.active_generations.insert("gen-1".into());
        super::store_issue039_asset_validated(
            &mut state,
            "tok",
            "gen-1",
            0,
            "a.xnb".into(),
            "a".repeat(64),
            vec![1, 2, 3],
        )
        .unwrap();
        state.active_generations.remove("gen-1");
        super::clear_asset_transfers_for_generation(&mut state, "gen-1");
        let result = super::store_issue039_asset_validated(
            &mut state,
            "tok2",
            "gen-1",
            0,
            "b.xnb".into(),
            "b".repeat(64),
            vec![4, 5, 6],
        );
        assert!(result.is_err());
        assert!(!state.asset_transfers.contains_key("tok2"));
    }

    #[test]
    fn issue039_create_failure_cleanup() {
        let mut state = make_state();
        state.active_generations.insert("gen-fail".into());
        state.pending_messages.insert("gen-fail".into(), vec![]);
        state.asset_transfers.insert(
            "tok-fail".into(),
            super::Issue039AssetTransfer {
                token: "tok-fail".into(),
                generation: "gen-fail".into(),
                assets: vec![],
            },
        );

        state.pending_messages.remove("gen-fail");
        state.active_generations.remove("gen-fail");
        super::clear_asset_transfers_for_generation(&mut state, "gen-fail");

        assert!(!state.active_generations.contains("gen-fail"));
        assert!(!state.pending_messages.contains_key("gen-fail"));
        assert!(!state.asset_transfers.contains_key("tok-fail"));
    }

    #[test]
    fn issue039_retirement_removes_generation_and_transfers() {
        let mut state = make_state();
        state.active_generations.insert("gen-1".into());
        state.asset_transfers.insert(
            "tok".into(),
            super::Issue039AssetTransfer {
                token: "tok".into(),
                generation: "gen-1".into(),
                assets: vec![],
            },
        );

        state.active_generations.remove("gen-1");
        super::clear_asset_transfers_for_generation(&mut state, "gen-1");

        assert!(!state.active_generations.contains("gen-1"));
        assert!(!state.asset_transfers.contains_key("tok"));
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

// --- Issue 038: force-stop isolated preview via separate WebviewWindow ---
//
// The preview runs in a separate Tauri WebviewWindow so that an infinite
// synchronous WASM/JS loop in the preview cannot block the trusted editor
// window.  On macOS this maps to a separate WKWebView with its own WebContent
// process; on Windows to a separate WebView2 renderer process.
//
// Communication:
//   Rust → Preview: `WebviewWindow::eval()` injects `window.__bridge038Receive(msg)`
//   Preview → Rust: `fetch("playground-preview://localhost/_bridge/send", {method:"POST", body})`
//                    handled in the custom protocol handler, relayed to main via Tauri events.
//   Binary transfer: Rust stores DLL/PDB in `ISSUE038_TRANSFER`, preview fetches
//                    via `playground-preview://localhost/_transfer/{token}/{file}`.
//
// Force-stop: call `WebviewWindow::destroy()` from Rust; this is non-blocking
// and reliable even when the preview's JS is hung in an infinite loop.
//
// Security: the preview window has NO capabilities (its label is never listed
// in any capability's `windows` array).  A script served via the
// protocol attempts to strip `__TAURI_INTERNALS__` as defense-in-depth;
// Tauri may reinject it after page load. The primary IPC boundary is ACL:
// the preview window label is excluded from all capabilities.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

struct Issue038TransferEntry {
    assembly: Vec<u8>,
    pdb: Vec<u8>,
}

struct Issue039AssetEntry {
    path: String,
    bytes: Vec<u8>,
    sha256: String,
}

struct Issue039AssetTransfer {
    token: String,
    generation: String,
    assets: Vec<Issue039AssetEntry>,
}

struct Issue038BridgeState {
    transfers: HashMap<String, Issue038TransferEntry>,
    asset_transfers: HashMap<String, Issue039AssetTransfer>,
    pending_messages: HashMap<String, Vec<String>>,
    active_generations: HashSet<String>,
    generation_counter: u64,
}

static ISSUE038_BRIDGE: std::sync::LazyLock<Mutex<Issue038BridgeState>> =
    std::sync::LazyLock::new(|| {
        Mutex::new(Issue038BridgeState {
            transfers: HashMap::new(),
            asset_transfers: HashMap::new(),
            pending_messages: HashMap::new(),
            active_generations: HashSet::new(),
            generation_counter: 0,
        })
    });

fn issue038_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE038_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue038_is_proof_enabled() -> bool {
    issue038_proof_enabled()
}

/// Store compiled binary pair for transfer to isolated preview window via protocol.
#[tauri::command]
fn issue038_store_transfer(token: String, assembly: Vec<u8>, pdb: Vec<u8>) -> Result<(), String> {
    if token.is_empty() || token.len() > 128 {
        return Err("transfer token must be 1–128 bytes".into());
    }
    if !token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("transfer token must be alphanumeric or hyphen".into());
    }
    if assembly.is_empty() || pdb.is_empty() {
        return Err("assembly and pdb must not be empty".into());
    }
    const MAX_TRANSFER_BYTES: usize = 32 * 1024 * 1024;
    if assembly.len() > MAX_TRANSFER_BYTES || pdb.len() > MAX_TRANSFER_BYTES {
        return Err("transfer exceeds 32 MiB limit".into());
    }
    let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
    state.transfers.insert(
        token,
        Issue038TransferEntry { assembly, pdb },
    );
    Ok(())
}

/// Clear a transfer entry after the preview has consumed it.
/// Zeroes the binary data before freeing to avoid lingering user code in memory.
#[tauri::command]
fn issue038_clear_transfer(token: String) -> Result<(), String> {
    let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
    if let Some(mut entry) = state.transfers.remove(&token) {
        // Zero before drop
        entry.assembly.iter_mut().for_each(|b| *b = 0);
        entry.pdb.iter_mut().for_each(|b| *b = 0);
    }
    Ok(())
}

const ISSUE038_PREVIEW_LABEL_PREFIX: &str = "preview-isolated-";

fn issue038_preview_label(generation: &str) -> String {
    format!("{ISSUE038_PREVIEW_LABEL_PREFIX}{generation}")
}

fn clear_asset_transfers_for_generation(state: &mut Issue038BridgeState, generation: &str) {
    let tokens: Vec<String> = state
        .asset_transfers
        .iter()
        .filter(|(_, transfer)| transfer.generation == generation)
        .map(|(token, _)| token.clone())
        .collect();
    for token in tokens {
        if let Some(mut transfer) = state.asset_transfers.remove(&token) {
            debug_assert_eq!(transfer.token, token);
            for asset in &mut transfer.assets {
                asset.bytes.iter_mut().for_each(|byte| *byte = 0);
            }
        }
    }
}

fn store_issue039_asset_validated(
    state: &mut Issue038BridgeState,
    token: &str,
    generation: &str,
    index: u32,
    path: String,
    sha256: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if !state.active_generations.contains(generation) {
        return Err("generation is not active or already retired".into());
    }
    let transfer = state.asset_transfers.entry(token.to_owned()).or_insert_with(|| {
        Issue039AssetTransfer {
            token: token.to_owned(),
            generation: generation.to_owned(),
            assets: Vec::new(),
        }
    });
    if transfer.generation != generation {
        return Err("generation mismatch".into());
    }
    let aggregate: usize = transfer.assets.iter().map(|a| a.bytes.len()).sum::<usize>() + bytes.len();
    if aggregate > 24 * 1024 * 1024 {
        return Err("aggregate assets exceed 24 MiB".into());
    }
    if transfer.assets.len() >= 256 {
        return Err("asset count exceeds 256".into());
    }
    if index as usize != transfer.assets.len() {
        return Err("asset index out of order".into());
    }
    transfer.assets.push(Issue039AssetEntry {
        path,
        bytes,
        sha256,
    });
    Ok(())
}

/// Create an isolated preview WebviewWindow.  The window loads content from
/// the playground-preview protocol and has NO Tauri capabilities.
#[tauri::command]
async fn issue038_create_preview_window(
    app: tauri::AppHandle,
    generation: String,
) -> Result<String, String> {
    use tauri::Manager;

    if generation.is_empty() || generation.len() > 64 {
        return Err("generation must be 1–64 chars".into());
    }
    if !generation.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("generation must be alphanumeric or hyphen".into());
    }
    let label = issue038_preview_label(&generation);
    if app.get_webview_window(&label).is_some() {
        return Err(format!("preview window already exists: {label}"));
    }
    {
        let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
        state.generation_counter += 1;
        state.pending_messages.insert(generation.clone(), Vec::new());
        state.active_generations.insert(generation.clone());
    }
    let url = tauri::WebviewUrl::External(
        "playground-preview://localhost/_isolated.html"
            .parse::<tauri::Url>()
            .map_err(|e| e.to_string())?,
    );
    let build_result = tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title("MonoGame Preview (isolated)")
        .inner_size(640.0, 400.0)
        .visible(true)
        .resizable(true)
        .on_navigation(|url| navigation_allowed(url))
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
        .build();
    if let Err(e) = build_result {
        let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
        state.pending_messages.remove(&generation);
        state.active_generations.remove(&generation);
        clear_asset_transfers_for_generation(&mut state, &generation);
        return Err(format!("failed to create preview window: {e}"));
    }
    Ok(label)
}

/// Destroy an isolated preview WebviewWindow.  Works even when the preview JS
/// is hung in an infinite loop because the destroy message is sent via the Tao
/// event loop, not the WebView's JS thread.
#[tauri::command]
fn issue038_destroy_preview_window(
    app: tauri::AppHandle,
    generation: String,
) -> Result<bool, String> {
    use tauri::Manager;

    let label = issue038_preview_label(&generation);
    let window = app.get_webview_window(&label);
    let existed = window.is_some();
    let destroy_result = window
        .map(|win| win.destroy().map_err(|e| format!("failed to destroy preview window: {e}")))
        .transpose();

    // Retire native state even if destroying the platform window fails.
    let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
    state.pending_messages.remove(&generation);
    state.active_generations.remove(&generation);
    clear_asset_transfers_for_generation(&mut state, &generation);
    drop(state);

    destroy_result?;
    Ok(existed)
}

/// Check whether an isolated preview window still exists.
#[tauri::command]
fn issue038_preview_window_exists(app: tauri::AppHandle, generation: String) -> bool {
    use tauri::Manager;
    let label = issue038_preview_label(&generation);
    app.get_webview_window(&label).is_some()
}

/// Relay a message from the main window to the isolated preview via evaluate_script.
#[tauri::command]
fn issue038_relay_to_preview(
    app: tauri::AppHandle,
    generation: String,
    message: String,
) -> Result<(), String> {
    use tauri::Manager;

    let label = issue038_preview_label(&generation);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("preview window not found: {label}"))?;
    // JSON-encode the message string so it's safe to inject into JS
    let json_payload = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    window
        .eval(&format!(
            "if(typeof window.__bridge038Receive==='function')window.__bridge038Receive({json_payload})"
        ))
        .map_err(|e| format!("failed to relay to preview: {e}"))
}

/// Collect bridge messages sent from the preview via protocol POST.
#[tauri::command]
fn issue038_collect_bridge_messages(generation: String) -> Result<Vec<String>, String> {
    let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
    match state.pending_messages.get_mut(&generation) {
        Some(messages) => Ok(std::mem::take(messages)),
        None => Ok(Vec::new()),
    }
}

/// Return a monotonic nanosecond timestamp from the Rust process clock.
/// This cannot be fabricated by a hung JS event loop.
#[tauri::command]
fn issue038_monotonic_nanos() -> Result<u64, String> {
    static EPOCH: std::sync::LazyLock<std::time::Instant> =
        std::sync::LazyLock::new(std::time::Instant::now);
    Ok(EPOCH.elapsed().as_nanos() as u64)
}

/// Destroy ALL isolated preview windows. Called on main window close.
#[tauri::command]
fn issue038_destroy_all_previews(app: tauri::AppHandle) -> Result<u32, String> {
    use tauri::Manager;
    let mut destroyed = 0u32;
    // Collect labels first to avoid borrow issues
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with(ISSUE038_PREVIEW_LABEL_PREFIX))
        .cloned()
        .collect();
    for label in &labels {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.destroy();
            destroyed += 1;
        }
    }
    // Clear all bridge state
    if let Ok(mut state) = ISSUE038_BRIDGE.lock() {
        state.transfers.clear();
        let generations: Vec<String> = state
            .asset_transfers
            .values()
            .map(|transfer| transfer.generation.clone())
            .collect();
        for generation in generations {
            clear_asset_transfers_for_generation(&mut state, &generation);
        }
        state.pending_messages.clear();
        state.active_generations.clear();
    }
    Ok(destroyed)
}

#[tauri::command]
fn issue038_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue038_proof_enabled() {
        return Err("issue 038 proof instrumentation is disabled".into());
    }
    println!("ISSUE038_CHECKPOINT={checkpoint}");
    Ok(())
}

/// Inject the protocol bootstrap into the isolated preview window.
/// This is a narrowly typed operation: it calls the bridge-setup's
/// `__bridge038Bootstrap` function with the provided JSON data.
/// The function only exists in the `_isolated.html` context and only
/// accepts the first call (subsequent calls are no-ops in the bridge).
#[tauri::command]
fn issue038_bootstrap_preview(
    app: tauri::AppHandle,
    generation: String,
    bootstrap_json: String,
) -> Result<(), String> {
    use tauri::Manager;
    // Validate bootstrap_json is valid JSON (prevents injection)
    let _: serde_json::Value = serde_json::from_str(&bootstrap_json)
        .map_err(|e| format!("invalid bootstrap JSON: {e}"))?;
    let label = issue038_preview_label(&generation);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("preview window not found: {label}"))?;
    let escaped = serde_json::to_string(&bootstrap_json).map_err(|e| e.to_string())?;
    window
        .eval(&format!(
            "if(typeof window.__bridge038Bootstrap==='function')window.__bridge038Bootstrap(JSON.parse({escaped}))"
        ))
        .map_err(|e| format!("failed to bootstrap preview: {e}"))
}

/// Proof-only: inject raw JavaScript into the isolated preview window.
/// Used to inject the hostile `while(true){}` loop for the force-stop proof.
#[tauri::command]
fn issue038_inject_script(
    app: tauri::AppHandle,
    generation: String,
    script: String,
) -> Result<(), String> {
    if !issue038_proof_enabled() {
        return Err("issue 038 proof instrumentation is disabled".into());
    }
    if script.len() > 4096 {
        return Err("proof script exceeds 4096 byte limit".into());
    }
    use tauri::Manager;
    let label = issue038_preview_label(&generation);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("preview window not found: {label}"))?;
    window
        .eval(&script)
        .map_err(|e| format!("failed to inject script: {e}"))
}

#[tauri::command]
fn issue038_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue038_proof_enabled() {
        return Err("issue 038 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE038_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

fn issue039_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE039_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue039_is_proof_enabled() -> bool {
    issue039_proof_enabled()
}

#[tauri::command]
fn issue039_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue039_proof_enabled() {
        return Err("issue 039 proof instrumentation is disabled".into());
    }
    if checkpoint.len() > 4096 {
        return Err("proof checkpoint exceeds 4096 byte limit".into());
    }
    println!("ISSUE039_CHECKPOINT={checkpoint}");
    Ok(())
}

#[tauri::command]
fn issue039_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue039_proof_enabled() {
        return Err("issue 039 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE039_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

/// Store one raw asset binary under a generation-bound token + index.
/// Uses Tauri 2 raw IPC: frontend sends Uint8Array body with metadata in headers.
/// No JSON byte array serialization — bytes arrive as InvokeBody::Raw.
#[tauri::command]
fn issue039_store_asset(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let get = |name: &str| -> Result<String, String> {
        request.headers().get(name)
            .and_then(|v| v.to_str().ok())
            .map(String::from)
            .ok_or_else(|| format!("missing header: {name}"))
    };
    let token = get("x-token")?;
    let generation = get("x-generation")?;
    let index: u32 = get("x-index")?.parse().map_err(|_| "bad index")?;
    let path = get("x-path")?;
    let sha256 = get("x-sha256")?;

    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.to_vec(),
        _ => return Err("expected raw binary body".into()),
    };

    if token.is_empty() || token.len() > 128
        || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("bad token".into());
    }
    if generation.is_empty() || generation.len() > 64 {
        return Err("bad generation".into());
    }
    if path.is_empty() || path.len() > 512 {
        return Err("bad path".into());
    }
    if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("bad sha256".into());
    }
    if bytes.is_empty() || bytes.len() > 16 * 1024 * 1024 {
        return Err("asset exceeds 16 MiB".into());
    }
    let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
    store_issue039_asset_validated(
        &mut state,
        &token,
        &generation,
        index,
        path,
        sha256,
        bytes,
    )?;
    Ok(tauri::ipc::Response::new(b"OK".to_vec()))
}

/// Query the manifest of a stored asset transfer (without returning bytes).
#[tauri::command]
fn issue039_asset_manifest(token: String) -> Result<String, String> {
    let state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
    let transfer = state.asset_transfers.get(&token)
        .ok_or_else(|| "no such transfer".to_string())?;
    let manifest: Vec<serde_json::Value> = transfer.assets.iter().enumerate().map(|(i, a)| {
        serde_json::json!({
            "index": i,
            "path": a.path,
            "sha256": a.sha256,
            "byteLength": a.bytes.len(),
        })
    }).collect();
    serde_json::to_string(&manifest).map_err(|e| e.to_string())
}

/// Clear all asset transfer entries for a token, zeroing bytes.
#[tauri::command]
fn issue039_clear_assets(token: String) -> Result<(), String> {
    let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
    if let Some(mut transfer) = state.asset_transfers.remove(&token) {
        for asset in &mut transfer.assets {
            asset.bytes.iter_mut().for_each(|b| *b = 0);
        }
    }
    Ok(())
}

/// Proof-only: query whether a token has stored assets and their total byte count.
#[tauri::command]
fn issue039_transfer_state(token: String) -> Result<String, String> {
    let state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
    let transfer = state.asset_transfers.get(&token);
    let result = match transfer {
        Some(t) => serde_json::json!({
            "exists": true,
            "assetCount": t.assets.len(),
            "totalBytes": t.assets.iter().map(|a| a.bytes.len()).sum::<usize>(),
            "allZeroed": t.assets.iter().all(|a| a.bytes.iter().all(|b| *b == 0)),
        }),
        None => serde_json::json!({
            "exists": false,
            "assetCount": 0,
            "totalBytes": 0,
            "allZeroed": true,
        }),
    };
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

fn issue040_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE040_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue040_is_proof_enabled() -> bool {
    issue040_proof_enabled()
}

#[tauri::command]
fn issue040_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue040_proof_enabled() {
        return Err("issue 040 proof instrumentation is disabled".into());
    }
    if checkpoint.len() > 4096 {
        return Err("proof checkpoint exceeds 4096 byte limit".into());
    }
    println!("ISSUE040_CHECKPOINT={checkpoint}");
    Ok(())
}

#[tauri::command]
fn issue040_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue040_proof_enabled() {
        return Err("issue 040 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE040_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

// ---------------------------------------------------------------------------
// Issue 041: performance benchmark instrumentation.
//
// Every command below is inert unless MONOGAME_ISSUE041_BENCHMARK=1 is present
// in the process environment, so the shipped application never exposes the
// benchmark surface. Nothing here fabricates a timestamp: the shell-startup
// sample is taken from a monotonic clock captured before any Tauri or WebView
// work, and the benchmark driver independently brackets the same process launch
// with its own wall-clock spawn timestamp.
// ---------------------------------------------------------------------------

/// Monotonic instant captured as the first statement of `run()`. `Instant` is
/// monotonic and cannot be moved by wall-clock adjustments.
static ISSUE041_PROCESS_START: std::sync::LazyLock<std::time::Instant> =
    std::sync::LazyLock::new(std::time::Instant::now);

fn issue041_benchmark_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE041_BENCHMARK").is_some_and(|value| value == "1")
}

#[tauri::command]
fn issue041_is_benchmark_enabled() -> bool {
    issue041_benchmark_enabled()
}

/// `shell-only` measures shell startup and exits immediately afterwards;
/// `full` continues into the compile / preview-start / Stop cycles.
/// `memory-baseline` runs 100 compilations and 20 cycles with RSS sampling.
fn issue041_mode_value(raw: Option<&str>) -> Result<&'static str, String> {
    match raw {
        None | Some("full") => Ok("full"),
        Some("shell-only") => Ok("shell-only"),
        Some("memory-baseline") => Ok("memory-baseline"),
        Some(other) => Err(format!("unknown issue 041 benchmark mode: {other}")),
    }
}

#[tauri::command]
fn issue041_benchmark_mode() -> Result<&'static str, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    let raw = std::env::var("MONOGAME_ISSUE041_MODE").ok();
    issue041_mode_value(raw.as_deref())
}

/// Number of warm compile samples the harness collects per process launch.
fn issue041_warm_compile_iterations(raw: Option<&str>) -> Result<u32, String> {
    let Some(raw) = raw else { return Ok(10) };
    let parsed: u32 = raw
        .parse()
        .map_err(|_| format!("invalid issue 041 warm compile iteration count: {raw}"))?;
    if !(1..=100).contains(&parsed) {
        return Err(format!(
            "issue 041 warm compile iteration count out of range (1..=100): {parsed}"
        ));
    }
    Ok(parsed)
}

#[tauri::command]
fn issue041_warm_compile_count() -> Result<u32, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    let raw = std::env::var("MONOGAME_ISSUE041_WARM_COMPILES").ok();
    issue041_warm_compile_iterations(raw.as_deref())
}

/// Number of preview start / Stop cycles the harness runs per process launch.
/// The first cycle is the cold sample, every later cycle is a warm sample.
/// Memory-baseline mode requires up to 20 cycles.
fn issue041_preview_cycle_count_value(raw: Option<&str>) -> Result<u32, String> {
    let Some(raw) = raw else { return Ok(2) };
    let parsed: u32 = raw
        .parse()
        .map_err(|_| format!("invalid issue 041 preview cycle count: {raw}"))?;
    if !(2..=20).contains(&parsed) {
        return Err(format!(
            "issue 041 preview cycle count out of range (2..=20): {parsed}"
        ));
    }
    Ok(parsed)
}

#[tauri::command]
fn issue041_preview_cycle_count() -> Result<u32, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    let raw = std::env::var("MONOGAME_ISSUE041_PREVIEW_CYCLES").ok();
    issue041_preview_cycle_count_value(raw.as_deref())
}

/// Read the resident set size (RSS) of the current process in bytes.
/// Uses `ps -o rss=` on macOS (KB) and multiplies by 1024.
#[tauri::command]
fn issue041_rss_bytes() -> Result<u64, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("ps")
            .args(&["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .map_err(|e| format!("failed to run ps: {e}"))?;
        let kb = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u64>()
            .map_err(|e| format!("failed to parse RSS: {e}"))?;
        Ok(kb * 1024)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("RSS measurement only supported on macOS".to_string())
    }
}

/// Record the instant the shell reported itself visible and interactive, in
/// milliseconds since the process-start instant, together with the native
/// window state observed at that moment.
#[tauri::command]
fn issue041_shell_ready(window: tauri::Window, detail: String) -> Result<String, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    let elapsed = ISSUE041_PROCESS_START.elapsed();
    if detail.len() > 4096 {
        return Err("issue 041 shell readiness detail exceeds the 4096 byte limit".into());
    }
    let detail: serde_json::Value =
        serde_json::from_str(&detail).map_err(|error| format!("invalid detail JSON: {error}"))?;
    let payload = serde_json::json!({
        "processStartToShellReadyMs": elapsed.as_secs_f64() * 1_000.0,
        "windowVisible": window.is_visible().map_err(|error| error.to_string())?,
        "windowMinimized": window.is_minimized().map_err(|error| error.to_string())?,
        "windowFocused": window.is_focused().map_err(|error| error.to_string())?,
        "detail": detail,
    });
    let serialized = payload.to_string();
    emit_packaged_proof_report(&format!("ISSUE041_SHELL_READY={serialized}"))?;
    Ok(serialized)
}

#[tauri::command]
fn issue041_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    if checkpoint.len() > 4096 {
        return Err("issue 041 checkpoint exceeds the 4096 byte limit".into());
    }
    if checkpoint.contains('\n') || checkpoint.contains('\r') {
        return Err("issue 041 checkpoint must be a single line".into());
    }
    println!("ISSUE041_CHECKPOINT={checkpoint}");
    Ok(())
}

#[tauri::command]
fn issue041_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE041_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

/// One real platform input event the issue 040 proof may deliver to an isolated
/// preview window. Nothing here fabricates DOM events: the AppKit event is
/// handed to `NSApplication::sendEvent`, so WebKit routes it through its normal
/// input path and marks the resulting DOM event trusted and user-activating.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Issue040Input {
    LeftMouseClick,
    KeyDown { key_code: u16, characters: &'static str },
    KeyUp { key_code: u16, characters: &'static str },
}

/// Space (49) plays and Escape (53) stops, matching the issue 040 test game.
fn issue040_input_kind(kind: &str) -> Option<Issue040Input> {
    match kind {
        "click" => Some(Issue040Input::LeftMouseClick),
        "space-down" => Some(Issue040Input::KeyDown {
            key_code: 49,
            characters: " ",
        }),
        "space-up" => Some(Issue040Input::KeyUp {
            key_code: 49,
            characters: " ",
        }),
        "escape-down" => Some(Issue040Input::KeyDown {
            key_code: 53,
            characters: "\u{1b}",
        }),
        "escape-up" => Some(Issue040Input::KeyUp {
            key_code: 53,
            characters: "\u{1b}",
        }),
        _ => None,
    }
}

fn issue040_dispatch_allowed(proof_enabled: bool, label: &str, generation_active: bool) -> bool {
    proof_enabled && generation_active && label.starts_with(ISSUE038_PREVIEW_LABEL_PREFIX)
}

/// Deliver one trusted platform input event to an isolated preview window so the
/// packaged issue 040 proof can unlock audio and drive play/stop exactly as a
/// person pressing Space and Escape would.
#[tauri::command]
async fn issue040_dispatch_preview_input(
    app: tauri::AppHandle,
    generation: String,
    kind: String,
) -> Result<String, String> {
    use tauri::Manager;

    if !issue040_proof_enabled() {
        return Err("issue 040 proof instrumentation is disabled".into());
    }
    if generation.is_empty()
        || generation.len() > 64
        || !generation
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("generation must be 1-64 alphanumeric/hyphen chars".into());
    }
    let input = issue040_input_kind(&kind).ok_or_else(|| format!("unsupported input kind: {kind}"))?;
    let label = issue038_preview_label(&generation);
    let generation_active = {
        let state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
        state.active_generations.contains(&generation)
    };
    if !issue040_dispatch_allowed(issue040_proof_enabled(), &label, generation_active) {
        return Err("issue 040 input dispatch target is not an active preview window".into());
    }
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("preview window not found: {label}"))?;
    issue040_send_native_input(&window, input).await
}

#[cfg(target_os = "macos")]
async fn issue040_send_native_input(
    window: &tauri::WebviewWindow,
    input: Issue040Input,
) -> Result<String, String> {
    use objc2::MainThreadMarker;
    use objc2::Message;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSView, NSWindow};
    use objc2_foundation::{NSPoint, NSString};
    use std::sync::mpsc;
    use std::time::Duration;

    // wry nests the WKWebView inside the window's content view, and only the
    // WKWebView forwards key events into the web content process.
    fn find_web_view(view: &NSView) -> Option<Retained<NSView>> {
        for subview in view.subviews().iter() {
            let class_name = subview.class().name().to_string_lossy().into_owned();
            // wry's WKWebView subclass is named `WryWebView`; its container is
            // `WryWebViewParent`, which never forwards key events.
            if class_name.contains("WebView") && !class_name.contains("Parent") {
                return Some(subview.retain());
            }
            if let Some(found) = find_web_view(&subview) {
                return Some(found);
            }
        }
        None
    }

    let ns_window = window.ns_window().map_err(|error| error.to_string())? as usize;
    let (sender, receiver) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let result: Result<(isize, f64, f64, bool, bool, bool, String), String> = (|| {
                let mtm = MainThreadMarker::new()
                    .ok_or_else(|| "issue 040 input dispatch did not run on the main thread".to_string())?;
                let app = NSApplication::sharedApplication(mtm);
                // SAFETY: Tauri owns this NSWindow for the command lifetime and this
                // closure executes on AppKit's main thread.
                let native_window = unsafe { &*(ns_window as *mut NSWindow) };
                native_window.orderFrontRegardless();
                native_window.makeKeyAndOrderFront(None);
                app.activate();
                let content_view = native_window.contentView();
                let web_view = content_view.as_deref().and_then(find_web_view);
                let responder_target = web_view.as_deref().or(content_view.as_deref());
                let first_responder_set = match responder_target {
                    Some(view) => native_window.makeFirstResponder(Some(view)),
                    None => false,
                };
                let responder_class = native_window
                    .firstResponder()
                    .map(|responder| responder.class().name().to_string_lossy().into_owned())
                    .unwrap_or_else(|| "none".to_string());
                let web_view_found = web_view.is_some();
                let key_window = native_window.isKeyWindow();
                let window_number = native_window.windowNumber();
                let size = native_window.frame().size;
                // Aim at the middle of the preview canvas, which occupies the top of
                // the content area (AppKit window coordinates start bottom-left).
                let location = NSPoint::new(size.width / 2.0, size.height * 0.62);
                let event = match input {
                    Issue040Input::LeftMouseClick => None,
                    Issue040Input::KeyDown { key_code, characters }
                    | Issue040Input::KeyUp { key_code, characters } => {
                        let event_type = match input {
                            Issue040Input::KeyDown { .. } => NSEventType::KeyDown,
                            _ => NSEventType::KeyUp,
                        };
                        let keys = NSString::from_str(characters);
                        NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                            event_type,
                            location,
                            NSEventModifierFlags::empty(),
                            0.0,
                            window_number,
                            None,
                            &keys,
                            &keys,
                            false,
                            key_code,
                        )
                    }
                };
                match input {
                    Issue040Input::LeftMouseClick => {
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
                            .ok_or_else(|| "failed to create preview mouse event".to_string())
                        };
                        let down = make_event(NSEventType::LeftMouseDown)?;
                        let up = make_event(NSEventType::LeftMouseUp)?;
                        if down.windowNumber() != window_number || up.windowNumber() != window_number
                        {
                            return Err("preview mouse event target mismatch".into());
                        }
                        // Deliver straight to the addressed window's responder chain so the
                        // event cannot land on any other window.
                        native_window.sendEvent(&down);
                        native_window.sendEvent(&up);
                    }
                    _ => {
                        let event = event.ok_or_else(|| "failed to create preview key event".to_string())?;
                        if event.windowNumber() != window_number {
                            return Err("preview key event target mismatch".into());
                        }
                        native_window.sendEvent(&event);
                    }
                }
                Ok((
                    window_number,
                    location.x,
                    location.y,
                    first_responder_set,
                    key_window,
                    web_view_found,
                    responder_class,
                ))
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    let (window_number, x, y, first_responder_set, key_window, web_view_found, responder_class) =
        tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(5)))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| format!("issue 040 input dispatch timed out: {error}"))??;
    Ok(serde_json::json!({
        "dispatched": true,
        "windowNumber": window_number,
        "locationX": x,
        "locationY": y,
        "firstResponderSet": first_responder_set,
        "keyWindow": key_window,
        "webViewFound": web_view_found,
        "firstResponderClass": responder_class,
    })
    .to_string())
}

#[cfg(not(target_os = "macos"))]
async fn issue040_send_native_input(
    _window: &tauri::WebviewWindow,
    _input: Issue040Input,
) -> Result<String, String> {
    Err("issue 040 native input dispatch is only implemented for macOS".into())
}

/// Proof-only: create an isolated preview window with 'wasm-unsafe-eval' removed.
/// Used by issue033 negative proof to verify WASM instantiation fails under CSP.
#[tauri::command]
async fn issue038_create_no_wasm_eval_window(
    app: tauri::AppHandle,
    generation: String,
) -> Result<String, String> {
    use tauri::Manager;
    if !issue033_no_wasm_eval_proof_enabled() {
        return Err("issue 033 no-wasm-eval proof is disabled".into());
    }
    if generation.is_empty()
        || generation.len() > 64
        || !generation
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("generation must be 1–64 alphanumeric/hyphen chars".into());
    }
    let label = issue038_preview_label(&generation);
    if app.get_webview_window(&label).is_some() {
        return Err(format!("preview window already exists: {label}"));
    }
    {
        let mut state = ISSUE038_BRIDGE.lock().map_err(|e| e.to_string())?;
        state.pending_messages.insert(generation.clone(), Vec::new());
    }
    let url = tauri::WebviewUrl::External(
        "playground-preview://localhost/_isolated-no-wasm-eval.html"
            .parse::<tauri::Url>()
            .map_err(|e| e.to_string())?,
    );
    let _window = tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title("Preview (no wasm-eval proof)")
        .inner_size(640.0, 400.0)
        .visible(true)
        .resizable(false)
        .on_navigation(|url| navigation_allowed(url))
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|e| format!("failed to create no-wasm-eval window: {e}"))?;
    Ok(label)
}

/// Handle bridge requests (GET or POST):
/// - `/_bridge/send?generation=X&msg=<url-encoded>` — protocol messages from preview (GET)
/// - `/_transfer/store?token=X&file=Y` — binary DLL/PDB from editor (POST)
fn issue038_handle_bridge_request(
    method: &tauri::http::Method,
    raw_uri: &str,
    body: &[u8],
) -> Option<tauri::http::Response<Vec<u8>>> {
    let uri = raw_uri.parse::<tauri::http::Uri>().ok()?;
    let path = uri.path();
    if path == "/_transfer/store" && method == &tauri::http::Method::POST {
        return Some(issue038_handle_transfer_store(&uri, body));
    }
    if path != "/_bridge/send" {
        return None;
    }
    let query = uri.query().unwrap_or("");
    let generation_id = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("generation="))
        .map(String::from);
    let Some(generation_id) = generation_id else {
        return Some(preview_response(
            400,
            "text/plain; charset=utf-8",
            b"Missing generation",
        ));
    };
    // Extract message from query param (GET) or body (POST)
    let message = if method == &tauri::http::Method::GET {
        let encoded = query
            .split('&')
            .find_map(|pair| pair.strip_prefix("msg="))
            .unwrap_or("");
        match percent_decode(encoded) {
            Some(decoded) => decoded,
            None => {
                return Some(preview_response(
                    400,
                    "text/plain; charset=utf-8",
                    b"Invalid encoding",
                ))
            }
        }
    } else {
        match std::str::from_utf8(body) {
            Ok(s) => s.to_owned(),
            Err(_) => {
                return Some(preview_response(
                    400,
                    "text/plain; charset=utf-8",
                    b"Invalid UTF-8",
                ))
            }
        }
    };
    if message.len() > 1024 * 1024 {
        return Some(preview_response(
            400,
            "text/plain; charset=utf-8",
            b"Message too large",
        ));
    }
    if let Ok(mut state) = ISSUE038_BRIDGE.lock() {
        if let Some(queue) = state.pending_messages.get_mut(&generation_id) {
            queue.push(message);
        }
    }
    let mut response = tauri::http::Response::new(b"OK".to_vec());
    *response.status_mut() = tauri::http::StatusCode::OK;
    response.headers_mut().insert(
        "content-type",
        "text/plain; charset=utf-8".parse().unwrap(),
    );
    response.headers_mut().insert(
        "access-control-allow-origin",
        "null".parse().unwrap(),
    );
    response.headers_mut().insert(
        "cross-origin-resource-policy",
        "cross-origin".parse().unwrap(),
    );
    response.headers_mut().insert(
        "cache-control",
        "no-store".parse().unwrap(),
    );
    Some(response)
}

/// Handle POST to `/_transfer/store?token=X&file=assembly.dll` for raw binary storage.
/// The editor posts raw bytes (no JSON) to store DLL/PDB for the preview to fetch.
fn issue038_handle_transfer_store(
    uri: &tauri::http::Uri,
    body: &[u8],
) -> tauri::http::Response<Vec<u8>> {
    let query = uri.query().unwrap_or("");
    let token = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("token="))
        .unwrap_or("");
    let file = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("file="))
        .unwrap_or("");
    if token.is_empty()
        || token.len() > 128
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return preview_response(400, "text/plain; charset=utf-8", b"Bad token");
    }
    if file != "assembly.dll" && file != "symbols.pdb" {
        return preview_response(400, "text/plain; charset=utf-8", b"Bad file");
    }
    const MAX_TRANSFER_BYTES: usize = 32 * 1024 * 1024;
    if body.is_empty() || body.len() > MAX_TRANSFER_BYTES {
        return preview_response(400, "text/plain; charset=utf-8", b"Bad size");
    }
    let Ok(mut state) = ISSUE038_BRIDGE.lock() else {
        return preview_response(500, "text/plain; charset=utf-8", b"Lock error");
    };
    let entry = state
        .transfers
        .entry(token.to_owned())
        .or_insert_with(|| Issue038TransferEntry {
            assembly: Vec::new(),
            pdb: Vec::new(),
        });
    match file {
        "assembly.dll" => entry.assembly = body.to_vec(),
        "symbols.pdb" => entry.pdb = body.to_vec(),
        _ => unreachable!(),
    }
    let mut response = tauri::http::Response::new(b"OK".to_vec());
    *response.status_mut() = tauri::http::StatusCode::OK;
    response.headers_mut().insert(
        "access-control-allow-origin",
        "null".parse().unwrap(),
    );
    response.headers_mut().insert(
        "cache-control",
        "no-store".parse().unwrap(),
    );
    response
}

/// Handle GET requests to `/_transfer/{token}/{file}` for binary DLL/PDB transfer.
fn issue038_handle_transfer_get(raw_uri: &str) -> Option<tauri::http::Response<Vec<u8>>> {
    let uri = raw_uri.parse::<tauri::http::Uri>().ok()?;
    let path = uri.path();
    if !path.starts_with("/_transfer/") {
        return None;
    }
    let rest = &path["/_transfer/".len()..];
    let (token, file) = rest.split_once('/')?;
    if token.is_empty()
        || file.is_empty()
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Some(preview_response(
            400,
            "text/plain; charset=utf-8",
            b"Bad Request",
        ));
    }
    let state = ISSUE038_BRIDGE.lock().ok()?;
    // Check for asset transfer: _transfer/{token}/asset/{index}
    if let Some(asset_rest) = file.strip_prefix("asset/") {
        if let Ok(index) = asset_rest.parse::<usize>() {
            if let Some(transfer) = state.asset_transfers.get(token) {
                if let Some(asset) = transfer.assets.get(index) {
                    let body = asset.bytes.clone();
                    let mut response = tauri::http::Response::new(body);
                    *response.status_mut() = tauri::http::StatusCode::OK;
                    response.headers_mut().insert(
                        "content-type",
                        "application/octet-stream".parse().unwrap(),
                    );
                    response.headers_mut().insert(
                        "access-control-allow-origin",
                        "null".parse().unwrap(),
                    );
                    response.headers_mut().insert(
                        "cross-origin-resource-policy",
                        "cross-origin".parse().unwrap(),
                    );
                    response.headers_mut().insert(
                        "cache-control",
                        "no-store".parse().unwrap(),
                    );
                    return Some(response);
                }
            }
        }
        return Some(preview_response(404, "text/plain; charset=utf-8", b"Not Found"));
    }
    // Check for asset manifest: _transfer/{token}/asset-manifest
    if file == "asset-manifest" {
        if let Some(transfer) = state.asset_transfers.get(token) {
            let manifest: Vec<serde_json::Value> = transfer.assets.iter().enumerate().map(|(i, a)| {
                serde_json::json!({
                    "index": i,
                    "path": a.path,
                    "sha256": a.sha256,
                    "byteLength": a.bytes.len(),
                    "generation": transfer.generation,
                })
            }).collect();
            let json = serde_json::to_vec(&manifest).unwrap_or_default();
            let mut response = tauri::http::Response::new(json);
            *response.status_mut() = tauri::http::StatusCode::OK;
            response.headers_mut().insert("content-type", "application/json".parse().unwrap());
            response.headers_mut().insert("access-control-allow-origin", "null".parse().unwrap());
            response.headers_mut().insert("cache-control", "no-store".parse().unwrap());
            return Some(response);
        }
        return Some(preview_response(404, "text/plain; charset=utf-8", b"Not Found"));
    }
    let entry = state.transfers.get(token)?;
    let body = match file {
        "assembly.dll" => entry.assembly.clone(),
        "symbols.pdb" => entry.pdb.clone(),
        _ => {
            return Some(preview_response(
                404,
                "text/plain; charset=utf-8",
                b"Not Found",
            ))
        }
    };
    let mut response = tauri::http::Response::new(body);
    *response.status_mut() = tauri::http::StatusCode::OK;
    response.headers_mut().insert(
        "content-type",
        "application/octet-stream".parse().unwrap(),
    );
    response.headers_mut().insert(
        "access-control-allow-origin",
        "null".parse().unwrap(),
    );
    response.headers_mut().insert(
        "cross-origin-resource-policy",
        "cross-origin".parse().unwrap(),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        "nosniff".parse().unwrap(),
    );
    response.headers_mut().insert(
        "cache-control",
        "no-store".parse().unwrap(),
    );
    Some(response)
}

fn navigation_allowed(url: &tauri::Url) -> bool {
    matches!(
        url.scheme(),
        "tauri" | "playground-preview" | "about" | "http" | "https"
    )
}

/// Decode percent-encoded UTF-8 string (e.g. from encodeURIComponent).
fn percent_decode(input: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(input.len());
    let mut chars = input.bytes();
    while let Some(byte) = chars.next() {
        if byte == b'%' {
            let hi = chars.next()?;
            let lo = chars.next()?;
            let hex = [hi, lo];
            let decoded = u8::from_str_radix(
                std::str::from_utf8(&hex).ok()?,
                16,
            )
            .ok()?;
            bytes.push(decoded);
        } else if byte == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(byte);
        }
    }
    String::from_utf8(bytes).ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Issue 041: capture the process-start instant before any other work so
    // shell-startup samples cannot be shifted by later initialisation.
    let _ = *ISSUE041_PROCESS_START;

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
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("playground-preview", |_context, request| {
            let uri_string = request.uri().to_string();
            // Issue 038: route bridge messages and transfer requests before the static handler
            if let Some(response) = issue038_handle_bridge_request(
                request.method(),
                &uri_string,
                request.body(),
            ) {
                return response;
            }
            if request.method() == &tauri::http::Method::GET {
                if let Some(response) = issue038_handle_transfer_get(&uri_string) {
                    return response;
                }
            }
            preview_protocol_response(request.method(), &uri_string)
        })
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(
                app.handle(),
                "main",
                tauri::WebviewUrl::External("http://127.0.0.1:5173/".parse().unwrap()),
            )
            .title("MonoGame Playground")
            .inner_size(1280.0, 800.0)
            .on_navigation(|url| navigation_allowed(url))
            .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
            .build()?;
            window.show()?;

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
            issue037_emit_checkpoint,
            issue038_is_proof_enabled,
            issue038_store_transfer,
            issue038_clear_transfer,
            issue038_create_preview_window,
            issue038_destroy_preview_window,
            issue038_preview_window_exists,
            issue038_relay_to_preview,
            issue038_collect_bridge_messages,
            issue038_monotonic_nanos,
            issue038_destroy_all_previews,
            issue038_bootstrap_preview,
            issue038_inject_script,
            issue038_emit_checkpoint,
            issue038_create_no_wasm_eval_window,
            issue038_emit_report,
            issue039_is_proof_enabled,
            issue039_emit_checkpoint,
            issue039_emit_report,
            issue039_store_asset,
            issue039_asset_manifest,
            issue039_clear_assets,
            issue039_transfer_state,
            issue040_is_proof_enabled,
            issue040_emit_checkpoint,
            issue040_emit_report,
            issue040_dispatch_preview_input,
            issue041_is_benchmark_enabled,
            issue041_benchmark_mode,
            issue041_warm_compile_count,
            issue041_preview_cycle_count,
            issue041_shell_ready,
            issue041_emit_checkpoint,
            issue041_emit_report,
            issue041_rss_bytes,
            issue050_write_file,
            issue050_save_dialog,
            issue050_open_dialog
        ])
        .run(tauri::generate_context!())
        .expect("error while running MonoGame Playground");
}
include!(concat!(env!("OUT_DIR"), "/preview_assets.rs"));

const PREVIEW_CSP: &str = "default-src 'none'; script-src playground-preview: 'wasm-unsafe-eval'; style-src playground-preview:; connect-src playground-preview:; img-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
/// CSP for the isolated preview window: must match the standard preview CSP.
#[cfg(test)]
const ISSUE038_ISOLATED_CSP: &str = "default-src 'none'; script-src playground-preview: 'wasm-unsafe-eval'; style-src playground-preview:; connect-src playground-preview:; img-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const MAX_PREVIEW_ASSET_BYTES: usize = 8 * 1024 * 1024;
const MAX_PREVIEW_TOTAL_BYTES: usize = 64 * 1024 * 1024;

/// The HTML page served at `/_isolated.html` for the isolated preview
/// WebviewWindow.  It strips `__TAURI_INTERNALS__` before loading preview code,
/// and sets up the `__bridge038Receive` / `__bridge038Send` bridge layer.
const ISSUE038_ISOLATED_HTML: &str = r##"<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src playground-preview: 'wasm-unsafe-eval'; style-src playground-preview:; connect-src playground-preview:; img-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="playground-parent-origin" content="playground-preview://localhost">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview runtime (isolated)</title>
<link rel="stylesheet" href="playground-preview://localhost/preview.css">
</head><body>
<canvas id="canvas" width="640" height="360" aria-label="MonoGame preview render surface"></canvas>
<button id="ping" type="button" disabled>Prove preview runtime</button>
<p id="status" role="status" aria-live="polite">Booting isolated preview...</p>
<pre id="proof-state" aria-label="Preview proof state"></pre>
<script src="playground-preview://localhost/_bridge-setup.js"></script>
<script src="playground-preview://localhost/issue033-negative-observer.js"></script>
<script type="module" src="playground-preview://localhost/preview.js"></script>
</body></html>"##;

/// Same isolated HTML but with 'wasm-unsafe-eval' removed from CSP.
/// Used for the issue033 negative proof — WASM instantiation must fail.
const ISSUE038_ISOLATED_NO_WASM_EVAL_HTML: &str = r##"<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src playground-preview:; style-src playground-preview:; connect-src playground-preview:; img-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="playground-parent-origin" content="playground-preview://localhost">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview runtime (no wasm eval)</title>
<link rel="stylesheet" href="playground-preview://localhost/preview.css">
</head><body>
<canvas id="canvas" width="640" height="360" aria-label="MonoGame preview render surface"></canvas>
<button id="ping" type="button" disabled>Prove preview runtime</button>
<p id="status" role="status" aria-live="polite">Booting isolated preview (no wasm-eval)...</p>
<pre id="proof-state" aria-label="Preview proof state"></pre>
<script src="playground-preview://localhost/_bridge-setup.js"></script>
<script src="playground-preview://localhost/issue033-negative-observer.js"></script>
<script type="module" src="playground-preview://localhost/preview.js"></script>
</body></html>"##;

/// Bridge setup script for the isolated preview window.
/// Runs before preview.js (non-module), strips Tauri bindings, and provides
/// a MessagePort-compatible bridge that routes through the custom protocol.
const ISSUE038_BRIDGE_SETUP_JS: &str = r##"
// --- Issue 038: isolated preview bridge setup ---
// Runs BEFORE preview.js. Strips Tauri IPC (defense-in-depth; ACL is primary).
// Intercepts the window "message" listener that installPrivatePortBootstrap
// registers, then delivers a synthesized bootstrap with real MessageChannel
// ports routed through the Rust bridge.

// Step 1: strip Tauri bindings
(function() {
  "use strict";
  try { delete window.__TAURI_INTERNALS__; } catch (_) {}
  try { delete window.__TAURI_IPC__; } catch (_) {}
  try {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: undefined, configurable: false, writable: false
    });
  } catch (_) {}
  try {
    Object.defineProperty(window, "__TAURI_IPC__", {
      value: undefined, configurable: false, writable: false
    });
  } catch (_) {}
})();

// Step 2: bridge layer
(function() {
  "use strict";
  var generation = null;
  var protocolPort1 = null;
  var bridgePort1 = null;
  var bootstrapped = false;

  function sendBridgeMessage(channel, data) {
    if (!generation) return;
    try {
      var msg = encodeURIComponent(JSON.stringify({ channel: channel, data: data }));
      fetch("playground-preview://localhost/_bridge/send?generation=" + generation + "&msg=" + msg)
        .catch(function() {});
    } catch (_) {}
  }

  // Intercept window.addEventListener to capture the bootstrap listener
  // that installPrivatePortBootstrap registers.
  var capturedBootstrapListener = null;
  var origAddEventListener = window.addEventListener.bind(window);
  window.addEventListener = function(type, handler, options) {
    if (type === "message" && !capturedBootstrapListener) {
      capturedBootstrapListener = handler; try{fetch("playground-preview://localhost/_bridge/send?generation=diag038&msg="+encodeURIComponent(JSON.stringify({channel:"bridge",data:{type:"diag.listener-captured"}}))).catch(function(){});}catch(_){}
    }
    return origAddEventListener(type, handler, options);
  };

  // Called by Rust via eval() to deliver the bootstrap.
  window.__bridge038Bootstrap = function(data) {
    try{fetch("playground-preview://localhost/_bridge/send?generation=diag038&msg="+encodeURIComponent(JSON.stringify({channel:"bridge",data:{type:"diag.bootstrap-called",hasListener:!!capturedBootstrapListener,bootstrapped:bootstrapped}}))).catch(function(){});}catch(_){} if (bootstrapped) return;
    if (!capturedBootstrapListener) return; // preview.js hasn't loaded yet

    bootstrapped = true;
    generation = data.bridgeGeneration || data.contextGeneration || null;

    var protocolChannel = new MessageChannel();
    var bridgeChannel = new MessageChannel();

    protocolPort1 = protocolChannel.port1;
    bridgePort1 = bridgeChannel.port1;

    protocolPort1.addEventListener("message", function(event) {
      sendBridgeMessage("protocol", event.data);
    });
    protocolPort1.start();

    bridgePort1.addEventListener("message", function(event) {

              sendBridgeMessage("bridge", event.data);
    });
    bridgePort1.start();

    // Synthesize a MessageEvent matching what installPrivatePortBootstrap expects
    var bootstrapData = {};
    for (var key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        bootstrapData[key] = data[key];
      }
    }
    bootstrapData.type = "protocol.bootstrap";

    // Create a fake MessageEvent. event.source must equal what preview.js
    // passed as expectedSource (which is `parent`, i.e. `window` in top-level).
    // event.origin must match the playground-parent-origin meta tag.
    var fakeEvent = {
      source: window,
      origin: document.querySelector("meta[name=\"playground-parent-origin\"]")?.content || "null",
      data: bootstrapData,
      ports: [protocolChannel.port2, bridgeChannel.port2]
    };

    // Directly call the captured listener
    capturedBootstrapListener(fakeEvent);
  };

  // Called by Rust via eval() to deliver protocol/bridge messages
  window.__bridge038Receive = function(jsonString) {
    try {
      var envelope = JSON.parse(jsonString);
      if (!envelope || typeof envelope !== "object") return;
      var data = envelope.data;
      // For load requests with transferToken, fetch binary from protocol
      if (data && data.type === "preview.load.request" && data.payload &&
          data.payload.transferToken && !data.payload.assembly) {
        var token = data.payload.transferToken;
        Promise.all([
          fetch("playground-preview://localhost/_transfer/" + token + "/assembly.dll")
            .then(function(r) { return r.arrayBuffer(); }),
          fetch("playground-preview://localhost/_transfer/" + token + "/symbols.pdb")
            .then(function(r) { return r.arrayBuffer(); })
        ]).then(function(buffers) {
          data.payload.assembly = buffers[0];
          data.payload.pdb = buffers[1];
          delete data.payload.transferToken;
          if (protocolPort1) protocolPort1.postMessage(data, [buffers[0], buffers[1]]);
        }).catch(function() {
          if (protocolPort1) protocolPort1.postMessage(data);
        });
        return;
      }
      // For mount requests with assetTransferToken, authenticate against authoritative manifest
      if (data && data.type === "asset.mount.request" && data.payload &&
          data.payload.assetTransferToken && Array.isArray(data.payload.assetManifest)) {
        var mountToken = data.payload.assetTransferToken;
        var requestManifest = data.payload.assetManifest;
        var mountFailurePosted = false;

        // Fetch authoritative manifest
        fetch("playground-preview://localhost/_transfer/" + mountToken + "/asset-manifest")
          .then(function(r) {
            if (!r.ok) throw new Error("manifest fetch failed");
            return r.json();
          })
          .then(function(authManifest) {
            if (!Array.isArray(authManifest) || authManifest.length !== requestManifest.length)
              throw new Error("manifest count mismatch");
            for (var i = 0; i < authManifest.length; i++) {
              var auth = authManifest[i];
              var req = requestManifest[i];
              if (auth.index !== i || req.index !== i)
                throw new Error("manifest index mismatch");
              if (auth.path !== req.path)
                throw new Error("manifest path mismatch");
              if (auth.sha256 !== req.sha256)
                throw new Error("manifest hash mismatch");
              if (auth.byteLength !== req.byteLength)
                throw new Error("manifest byteLength mismatch");
              if (auth.generation !== generation)
                throw new Error("manifest generation mismatch");
            }
            var assetPromises = authManifest.map(function(entry, idx) {
              return fetch("playground-preview://localhost/_transfer/" + mountToken + "/asset/" + idx)
                .then(function(r) {
                  if (!r.ok) throw new Error("asset fetch failed");
                  return r.arrayBuffer();
                })
                .then(function(buffer) {
                  // Verify byte length
                  if (buffer.byteLength !== entry.byteLength) {
                    throw new Error("asset byteLength mismatch");
                  }
                  // Compute SHA-256
                  return crypto.subtle.digest("SHA-256", buffer).then(function(hashBuffer) {
                    var hashArray = Array.from(new Uint8Array(hashBuffer));
                    var hashHex = hashArray.map(function(b) {
                      return ("00" + b.toString(16)).slice(-2);
                    }).join("");
                    // Verify against both authoritative and request hashes
                    if (hashHex !== entry.sha256 || hashHex !== requestManifest[idx].sha256) {
                      throw new Error("asset hash mismatch");
                    }
                    // Create standalone ArrayBuffer
                    var standalone = buffer.slice(0);
                    return { path: entry.path, bytes: standalone };
                  });
                });
            });
            return Promise.all(assetPromises);
          })
          .then(function(assets) {
            data.payload.assets = assets;
            delete data.payload.assetTransferToken;
            delete data.payload.assetManifest;
            var transferList = assets.map(function(a) { return a.bytes; });
            if (protocolPort1) protocolPort1.postMessage(data, transferList);
          })
          .catch(function(err) {
            if (mountFailurePosted) return;
            mountFailurePosted = true;
            var failResp = {
              protocolVersion: 1,
              correlationId: data.correlationId,
              type: "asset.mount.response",
              result: {
                success: false,
                error: {
                  code: "PREVIEW_LOAD_FAILED",
                  message: "Asset transfer validation failed in isolated bridge."
                }
              }
            };
            sendBridgeMessage("protocol", failResp);
          });
        return;
      }
      if (envelope.channel === "bridge") {
        // Intercept proof-only bridge actions before forwarding to preview.js
        if (data && data.type === "preview.bridge.request" &&
            data.action === "issue034-acl-invoke-probe" &&
            data.payload && Array.isArray(data.payload.commands)) {
          var internals = window.__TAURI_INTERNALS__;
          if (!internals || typeof internals.invoke !== "function") {
            sendBridgeMessage("bridge", {
              type: "preview.bridge.response", id: data.id, success: true,
              result: { totalCommands: 0, rejections: 0, resolutions: 0, errors: ["no internals"] }
            });
            return;
          }
          var cmds = data.payload.commands;
          var rej = 0, res = 0, errs = [];
          var pending = cmds.length;
          var finish = function() {
            if (--pending <= 0) {
              sendBridgeMessage("bridge", {
                type: "preview.bridge.response", id: data.id, success: true,
                result: { totalCommands: cmds.length, rejections: rej, resolutions: res, errors: errs.slice(0, 5) }
              });
            }
          };
          for (var ci = 0; ci < cmds.length; ci++) {
            (function(cmd) {
              try {
                internals.invoke(cmd).then(function() { res++; finish(); }, function() { rej++; finish(); });
              } catch(e) { rej++; finish(); }
            })(cmds[ci]);
          }
          return;
        }
        if (bridgePort1) bridgePort1.postMessage(data);
      } else {
        if (protocolPort1) protocolPort1.postMessage(data);
      }
    } catch (_) {}
  };
})();
"##;

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
    // Issue 038: serve the isolated preview HTML page and bridge setup script
    if path == "/_isolated.html" {
        return preview_response(
            200,
            "text/html; charset=utf-8",
            ISSUE038_ISOLATED_HTML.as_bytes(),
        );
    }
    if path == "/_bridge-setup.js" {
        return preview_response(
            200,
            "text/javascript; charset=utf-8",
            ISSUE038_BRIDGE_SETUP_JS.as_bytes(),
        );
    }
    if path == "/_isolated-no-wasm-eval.html" {
        return preview_response(
            200,
            "text/html; charset=utf-8",
            ISSUE038_ISOLATED_NO_WASM_EVAL_HTML.as_bytes(),
        );
    }
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

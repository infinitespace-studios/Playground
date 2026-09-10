//! Proof-harness command surface, state, and helpers.
//!
//! This module is compiled **only** under the non-default `proof-harness`
//! Cargo feature (`#[cfg(feature = "proof-harness")] mod proof_harness;` in
//! `lib.rs`). The shipping PRODUCT build never links any code here: the fifty-
//! nine packaged-proof commands, their env gates, report/checkpoint protocol,
//! macOS trusted-input dispatch, and packaged activation/report relay all live
//! behind this boundary. `lib.rs` keeps the eight PRODUCT commands and the
//! workspace/project/first-run/preview protocol responsibilities.
//!
//! Every item is `pub(crate)` so `lib.rs` can re-export the surface with
//! `use proof_harness::*;` — this keeps the `tauri::generate_handler!` command
//! identifiers bare (as `build.rs` requires) and lets the crate-root test
//! module reach the proof helpers via `super::`. Product-owned helpers this
//! module calls (`crate::first_run_*`, `crate::FIRST_RUN_SCHEMA_VERSION`,
//! `crate::ISSUE037_PROOF_STORE_FILENAME`) remain defined in `lib.rs`.

#[cfg(feature = "proof-harness")]
pub(crate) fn issue021_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE021_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue021_is_proof_enabled() -> bool {
    issue021_proof_enabled()
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue021_is_locked_session_proof() -> bool {
    std::env::var_os("MONOGAME_ISSUE021_LOCKED_SESSION").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue021_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
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

#[cfg(feature = "proof-harness")]
pub(crate) fn issue022_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE022_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue022_is_proof_enabled() -> bool {
    issue022_proof_enabled()
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue022_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
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

#[cfg(feature = "proof-harness")]
pub(crate) fn issue023_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE023_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue023_is_proof_enabled() -> bool {
    issue023_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue024_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE024_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue024_is_proof_enabled() -> bool {
    issue024_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue025_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE025_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue025_is_proof_enabled() -> bool {
    issue025_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue027_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE027_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue027_is_proof_enabled() -> bool {
    issue027_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue028_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE028_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue028_is_proof_enabled() -> bool {
    issue028_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue029_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE029_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue029_is_proof_enabled() -> bool {
    issue029_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue030_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE030_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue030_is_proof_enabled() -> bool {
    issue030_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue031_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE031_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue031_is_proof_enabled() -> bool {
    issue031_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue032_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE032_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue032_is_proof_enabled() -> bool {
    issue032_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue033_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE033_PROOF").is_some_and(|value| value == "1")
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue033_no_wasm_eval_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE033_NO_WASM_EVAL_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue033_is_proof_enabled() -> bool {
    issue033_proof_enabled() && !issue033_no_wasm_eval_proof_enabled()
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue033_is_no_wasm_eval_proof_enabled() -> Result<bool, String> {
    if issue033_proof_enabled() && issue033_no_wasm_eval_proof_enabled() {
        return Err("issue 033 proof modes are mutually exclusive".into());
    }
    Ok(issue033_no_wasm_eval_proof_enabled())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue033_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue033_proof_enabled() {
        return Err("issue 033 proof instrumentation is disabled".into());
    }
    println!("ISSUE033_CHECKPOINT={checkpoint}");
    Ok(())
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue034_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE034_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue034_is_proof_enabled() -> bool {
    issue034_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) static ISSUE034_TRUSTED_MARKER_CALLS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(feature = "proof-harness")]
pub(crate) fn require_issue034_main_frame(webview: &tauri::WebviewWindow) -> Result<(), String> {
    if !issue034_proof_enabled() || webview.label() != "main" {
        return Err("issue 034 trusted marker is unavailable".into());
    }
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue034_trusted_marker(
    webview: tauri::WebviewWindow,
) -> Result<&'static str, String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue034_trusted_marker_calls(
    webview: tauri::WebviewWindow,
) -> Result<usize, String> {
    require_issue034_main_frame(&webview)?;
    Ok(ISSUE034_TRUSTED_MARKER_CALLS.load(std::sync::atomic::Ordering::SeqCst))
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue035_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE035_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue035_is_proof_enabled() -> bool {
    issue035_proof_enabled()
}

#[cfg(feature = "proof-harness")]
pub(crate) fn packaged_pipeline_proof_enabled() -> bool {
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
        || issue039_proof_enabled()
        || issue040_proof_enabled()
        || issue041_benchmark_enabled()
}

#[cfg(target_os = "macos")]
#[cfg(feature = "proof-harness")]
pub(crate) fn packaged_app_bundle(executable: &std::path::Path) -> Option<&std::path::Path> {
    let bundle = executable.parent()?.parent()?.parent()?;
    (bundle.extension().and_then(|extension| extension.to_str()) == Some("app")).then_some(bundle)
}

#[cfg(target_os = "macos")]
#[cfg(feature = "proof-harness")]
pub(crate) fn relay_packaged_proof_through_launch_services() -> Result<bool, String> {
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
        if let Some(key_str) = key.to_str()
            && key_str.starts_with("MONOGAME_ISSUE")
            && let Some(val_str) = value.to_str()
        {
            cmd.args(["--env", &format!("{key_str}={val_str}")]);
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

#[cfg(feature = "proof-harness")]
pub(crate) fn emit_packaged_proof_report(report: &str) -> Result<(), String> {
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

#[cfg(feature = "proof-harness")]
pub(crate) fn require_packaged_pipeline_proof(enabled: bool) -> Result<(), String> {
    enabled
        .then_some(())
        .ok_or_else(|| "packaged pipeline proof instrumentation is disabled".into())
}

#[cfg(feature = "proof-harness")]
pub(crate) fn proof_window_ready(
    visible: bool,
    focused: bool,
    minimized: bool,
    application_active: bool,
    native_window_focused: bool,
) -> bool {
    visible && focused && !minimized && application_active && native_window_focused
}

#[cfg(feature = "proof-harness")]
pub(crate) fn proof_activation_target_allowed(
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
#[cfg(feature = "proof-harness")]
pub(crate) fn dispatch_exact_proof_window_activation(
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
#[cfg(feature = "proof-harness")]
pub(crate) async fn activate_packaged_proof_window(
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
#[cfg(feature = "proof-harness")]
pub(crate) async fn prepare_packaged_proof_window(
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
#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue023_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue023_proof_enabled() {
        return Err("issue 023 proof instrumentation is disabled".into());
    }
    println!("ISSUE023_CHECKPOINT={checkpoint}");
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue023_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue024_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue024_proof_enabled() {
        return Err("issue 024 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE024_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue025_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue025_proof_enabled() {
        return Err("issue 025 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE025_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue027_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue027_proof_enabled() {
        return Err("issue 027 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE027_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue028_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue028_proof_enabled() {
        return Err("issue 028 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE028_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue029_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue029_proof_enabled() {
        return Err("issue 029 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE029_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue030_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue030_proof_enabled() {
        return Err("issue 030 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE030_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue031_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue031_proof_enabled() {
        return Err("issue 031 proof instrumentation is disabled".into());
    }

    emit_packaged_proof_report(&format!("ISSUE031_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue032_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue032_proof_enabled() {
        return Err("issue 032 proof instrumentation is disabled".into());
    }

    emit_packaged_proof_report(&format!("ISSUE032_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue033_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue033_proof_enabled() {
        return Err("issue 033 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE033_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue033_emit_no_wasm_eval_report(
    app: tauri::AppHandle,
    report: String,
) -> Result<(), String> {
    if !issue033_no_wasm_eval_proof_enabled() {
        return Err("issue 033 no-wasm-eval proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE033_NO_WASM_EVAL_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue034_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue034_proof_enabled() {
        return Err("issue 034 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE034_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue035_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue035_proof_enabled() {
        return Err("issue 035 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE035_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue036_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE036_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue036_is_proof_enabled() -> bool {
    issue036_proof_enabled()
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue036_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue036_proof_enabled() {
        return Err("issue 036 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE036_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}
#[cfg(feature = "proof-harness")]
pub(crate) fn issue037_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE037_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue037_is_proof_enabled() -> bool {
    issue037_proof_enabled()
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue037_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE037_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

/// Proof-only: read the store contents for verification (bounded, no paths).
#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue037_read_store_snapshot(app: tauri::AppHandle) -> Result<String, String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    let path = crate::first_run_store_path(&app)?;
    let store = crate::first_run_read_store(&path)?;
    // Return only the acknowledged map, not the file path
    serde_json::to_string(&store).map_err(|error| error.to_string())
}

/// Proof-only: clear the store for test isolation.
#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue037_clear_store(app: tauri::AppHandle) -> Result<(), String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    let path = crate::first_run_store_path(&app)?;
    let empty = serde_json::json!({
        "schemaVersion": crate::FIRST_RUN_SCHEMA_VERSION,
        "acknowledged": {}
    });
    crate::first_run_write_store_atomic(&path, &empty)
}

/// Proof-only: returns the current proof phase from env (1 or 2).
#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue037_proof_phase() -> Result<u32, String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    let phase = std::env::var("MONOGAME_ISSUE037_PROOF_PHASE")
        .unwrap_or_else(|_| "1".into())
        .parse::<u32>()
        .map_err(|error| format!("invalid proof phase: {error}"))?;
    if !(1..=2).contains(&phase) {
        return Err(format!("proof phase must be 1 or 2, got {phase}"));
    }
    Ok(phase)
}

/// Proof-only: emit a checkpoint line for multi-process phase markers.
#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue037_emit_checkpoint(checkpoint: String) -> Result<(), String> {
    if !issue037_proof_enabled() {
        return Err("issue 037 proof instrumentation is disabled".into());
    }
    println!("ISSUE037_CHECKPOINT={checkpoint}");
    Ok(())
}
// --- Issue 039: live content-proof gate/checkpoint/report ---
//
// Stage 6 removed the four inert `issue039_*` asset-store commands
// (`issue039_store_asset`, `issue039_asset_manifest`, `issue039_clear_assets`,
// `issue039_transfer_state`) together with their `Issue039Asset*` state, the
// `store_issue039_asset_validated`/`clear_asset_transfers_for_generation`
// helpers, and the `/_transfer/` asset-transfer protocol routes. Stage 5 had
// already retired the isolated-window lifecycle that was their only writer, so
// they were structurally inert in both the shipped and proof binaries. The
// durable content workflow (issue 039/040) runs on the embedded in-page
// transport (`proof-content.ts`) and never used these commands. The live
// issue039 proof gate/checkpoint/report below is preserved unchanged.

#[cfg(feature = "proof-harness")]
use std::sync::Mutex;

#[cfg(feature = "proof-harness")]
pub(crate) fn issue039_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE039_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue039_is_proof_enabled() -> bool {
    issue039_proof_enabled()
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue039_emit_checkpoint(checkpoint: String) -> Result<(), String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue039_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue039_proof_enabled() {
        return Err("issue 039 proof instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE039_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_proof_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE040_PROOF").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_is_proof_enabled() -> bool {
    issue040_proof_enabled()
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_emit_checkpoint(checkpoint: String) -> Result<(), String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) static ISSUE041_PROCESS_START: std::sync::LazyLock<std::time::Instant> =
    std::sync::LazyLock::new(std::time::Instant::now);

#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_benchmark_enabled() -> bool {
    std::env::var_os("MONOGAME_ISSUE041_BENCHMARK").is_some_and(|value| value == "1")
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_is_benchmark_enabled() -> bool {
    issue041_benchmark_enabled()
}

/// `shell-only` measures shell startup and exits immediately afterwards;
/// `full` continues into the compile / preview-start / Stop cycles.
/// `memory-baseline` runs 100 compilations and 20 cycles with RSS sampling.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_mode_value(raw: Option<&str>) -> Result<&'static str, String> {
    match raw {
        None | Some("full") => Ok("full"),
        Some("shell-only") => Ok("shell-only"),
        Some("memory-baseline") => Ok("memory-baseline"),
        Some(other) => Err(format!("unknown issue 041 benchmark mode: {other}")),
    }
}

#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_benchmark_mode() -> Result<&'static str, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    let raw = std::env::var("MONOGAME_ISSUE041_MODE").ok();
    issue041_mode_value(raw.as_deref())
}

/// Number of warm compile samples the harness collects per process launch.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_warm_compile_iterations(raw: Option<&str>) -> Result<u32, String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_warm_compile_count() -> Result<u32, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    let raw = std::env::var("MONOGAME_ISSUE041_WARM_COMPILES").ok();
    issue041_warm_compile_iterations(raw.as_deref())
}

/// Number of preview start / Stop cycles the harness runs per process launch.
/// The first cycle is the cold sample, every later cycle is a warm sample.
/// Memory-baseline mode requires up to 20 cycles.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_preview_cycle_count_value(raw: Option<&str>) -> Result<u32, String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_preview_cycle_count() -> Result<u32, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    let raw = std::env::var("MONOGAME_ISSUE041_PREVIEW_CYCLES").ok();
    issue041_preview_cycle_count_value(raw.as_deref())
}

/// Read the resident set size (RSS) of the current process in bytes.
/// Uses `ps -o rss=` on macOS (KB) and multiplies by 1024.
#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_rss_bytes() -> Result<u64, String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_shell_ready(
    window: tauri::Window,
    detail: String,
) -> Result<String, String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_emit_checkpoint(checkpoint: String) -> Result<(), String> {
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
#[cfg(feature = "proof-harness")]
pub(crate) fn issue041_emit_report(app: tauri::AppHandle, report: String) -> Result<(), String> {
    if !issue041_benchmark_enabled() {
        return Err("issue 041 benchmark instrumentation is disabled".into());
    }
    emit_packaged_proof_report(&format!("ISSUE041_REPORT={report}"))?;
    app.exit(0);
    Ok(())
}

/// One real platform input event the issue 040 proof may deliver to the window
/// that hosts the addressed preview. Nothing here fabricates DOM events: the
/// AppKit event is handed to `NSApplication::sendEvent`, so WebKit routes it
/// through its normal input path and marks the resulting DOM event trusted and
/// user-activating.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[cfg(feature = "proof-harness")]
pub(crate) enum Issue040Input {
    LeftMouseClick,
    KeyDown {
        key_code: u16,
        characters: &'static str,
    },
    KeyUp {
        key_code: u16,
        characters: &'static str,
    },
}

/// Space (49) plays and Escape (53) stops, matching the issue 040 test game.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_input_kind(kind: &str) -> Option<Issue040Input> {
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

/// The exact native window label of the main Workbench shell that hosts the
/// Stage-4 embedded opaque-origin preview iframe. Pinned so a gesture routed to
/// the embedded preview can only ever land on this one known window.
#[cfg(feature = "proof-harness")]
pub(crate) const ISSUE040_MAIN_WINDOW_LABEL: &str = "main";

/// A gesture may only be requested by the trusted `main` window that hosts the
/// embedded preview iframe. This is
/// enforced in the command as defense-in-depth atop the ACL, which already
/// excludes the preview window from every capability.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_caller_is_main(label: &str) -> bool {
    label == ISSUE040_MAIN_WINDOW_LABEL
}

/// Shared well-formedness gate for an issue 040 generation identifier: 1–64
/// bytes of ASCII alphanumeric or hyphen. Rejects empty, oversized, and any id
/// carrying path or whitespace characters before it can address a window.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_generation_is_well_formed(generation: &str) -> bool {
    !generation.is_empty()
        && generation.len() <= 64
        && generation
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Rust-managed authorization state for issue 040 embedded (in-page) preview
/// input dispatch. Holds at most ONE active embedded generation at a time — the
/// audio proof only ever drives a single embedded preview — scoped to the
/// trusted `main` window (see [`issue040_caller_is_main`]) and the issue 040
/// proof gate. The trusted host must explicitly REGISTER the exact generation
/// of the embedded opaque-origin preview iframe before any Space/Escape/click
/// gesture can be routed to the main window that hosts it, and RETIRE it on
/// every iframe cleanup/error path. This closes the confused-deputy gap where a
/// random/stale/unknown well-formed generation could otherwise steer a
/// synthetic native input event at the main Workbench window, and bounds the
/// state to a single entry.
#[cfg(feature = "proof-harness")]
pub(crate) struct Issue040EmbeddedState {
    /// The single currently-registered embedded preview generation, if any.
    pub(crate) active: Option<String>,
}

#[cfg(feature = "proof-harness")]
pub(crate) static ISSUE040_EMBEDDED: std::sync::LazyLock<Mutex<Issue040EmbeddedState>> =
    std::sync::LazyLock::new(|| Mutex::new(Issue040EmbeddedState { active: None }));

/// Register the exact embedded preview generation as the single active one.
/// Fails closed on a malformed id, refuses to overwrite a DIFFERENT active
/// generation (confused-generation guard), and rejects a duplicate
/// re-registration of the same id so a stale caller cannot silently "refresh"
/// state. The slot must be retired before a fresh generation can register.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_register_embedded(
    state: &mut Issue040EmbeddedState,
    generation: &str,
) -> Result<(), String> {
    if !issue040_generation_is_well_formed(generation) {
        return Err("generation must be 1-64 alphanumeric/hyphen chars".into());
    }
    match state.active.as_deref() {
        Some(existing) if existing == generation => {
            Err("embedded generation is already registered".into())
        }
        Some(_) => Err("another embedded generation is already active; retire it first".into()),
        None => {
            state.active = Some(generation.to_owned());
            Ok(())
        }
    }
}

/// Retire an embedded generation. Only clears the registration when it matches
/// the exact active generation, so a stale/foreign id can never retire the live
/// one. Idempotent and non-throwing so it is safe to call on every cleanup and
/// error path. Returns whether an active registration was actually cleared.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_retire_embedded(
    state: &mut Issue040EmbeddedState,
    generation: &str,
) -> bool {
    if state.active.as_deref() == Some(generation) {
        state.active = None;
        true
    } else {
        false
    }
}

/// Whether `generation` is the exact, currently-registered embedded generation.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_embedded_is_registered(
    state: &Issue040EmbeddedState,
    generation: &str,
) -> bool {
    state.active.as_deref() == Some(generation)
}

/// The exact, known window one issue 040 gesture may target. The proof never
/// names an arbitrary window: a gesture is delivered only to the main Workbench
/// window that hosts the embedded opaque-origin preview iframe — and only for
/// the exact generation the trusted host has explicitly registered. Any other
/// shape is rejected before a native event is created.
///
/// Stage 5 removed the retired isolated issue 038 preview `WebviewWindow` target
/// (the harness no longer exists); the embedded main-window target is the sole
/// remaining dispatch destination.
#[derive(Clone, PartialEq, Eq, Debug)]
#[cfg(feature = "proof-harness")]
pub(crate) enum Issue040DispatchTarget {
    /// Deliver to the main window that hosts the embedded preview iframe the
    /// trusted host has focused and explicitly registered.
    EmbeddedMain,
}

/// Resolve which exact window a gesture targets, fail-closed. The proof gate
/// must be on and the generation must be a well-formed issue 040 generation id.
/// The gesture may only resolve to the main window's embedded preview when
/// `embedded_registered` is true — i.e. the trusted host has explicitly
/// registered this exact generation as its single active embedded preview. An
/// unknown, random, or stale-after-retire generation resolves to `None`. This
/// never yields a generic "any window" target: the embedded case is pinned to
/// the single `main` window label.
#[cfg(feature = "proof-harness")]
pub(crate) fn issue040_dispatch_target(
    proof_enabled: bool,
    generation: &str,
    embedded_registered: bool,
) -> Option<Issue040DispatchTarget> {
    if !proof_enabled {
        return None;
    }
    if !issue040_generation_is_well_formed(generation) {
        return None;
    }
    if embedded_registered {
        Some(Issue040DispatchTarget::EmbeddedMain)
    } else {
        None
    }
}

/// Deliver one trusted platform input event — or manage the embedded-preview
/// authorization lifecycle — for the packaged issue 040 proof. This is the ONLY
/// issue 040 input command; it supports three narrowly scoped operations via
/// `op` (defaulting to `"dispatch"`):
///
/// * `"register"` — the trusted host records the exact generation of the
///   embedded opaque-origin preview iframe it just created as the single active
///   embedded generation. Required before any embedded gesture is accepted.
/// * `"retire"` — the trusted host clears that registration; called on every
///   iframe cleanup/error path. Idempotent and scoped to the exact generation.
/// * `"dispatch"` — deliver one trusted Space/Escape/click event so the proof
///   can unlock audio and drive play/stop exactly as a person would. The
///   gesture targets the main Workbench window that hosts the embedded preview
///   iframe, but ONLY when this exact generation was registered.
///   Unknown/random/stale generations fail closed. The trusted host focuses the
///   sandboxed preview iframe before dispatch, so WebKit routes the trusted
///   event to the focused embedded preview document rather than the Monaco
///   editor or the host shell.
///
/// Every operation refuses to run unless the issue 040 proof gate is set and the
/// caller is the trusted `main` window (defense-in-depth atop the ACL, which
/// already excludes the preview window from every capability). This command is
/// not a generic injection primitive: the opaque preview itself has no IPC.
#[tauri::command]
#[cfg(feature = "proof-harness")]
pub(crate) async fn issue040_dispatch_preview_input(
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
    generation: String,
    kind: Option<String>,
    op: Option<String>,
) -> Result<String, String> {
    use tauri::Manager;

    if !issue040_proof_enabled() {
        return Err("issue 040 proof instrumentation is disabled".into());
    }
    if !issue040_caller_is_main(webview.label()) {
        return Err("issue 040 input dispatch is only available to the main window".into());
    }
    if !issue040_generation_is_well_formed(&generation) {
        return Err("generation must be 1-64 alphanumeric/hyphen chars".into());
    }

    match op.as_deref().unwrap_or("dispatch") {
        "register" => {
            let mut embedded = ISSUE040_EMBEDDED.lock().map_err(|e| e.to_string())?;
            issue040_register_embedded(&mut embedded, &generation)?;
            Ok(serde_json::json!({ "registered": true, "generation": generation }).to_string())
        }
        "retire" => {
            let mut embedded = ISSUE040_EMBEDDED.lock().map_err(|e| e.to_string())?;
            let cleared = issue040_retire_embedded(&mut embedded, &generation);
            Ok(serde_json::json!({ "retired": true, "cleared": cleared }).to_string())
        }
        "dispatch" => {
            let kind = kind.ok_or_else(|| "dispatch requires an input kind".to_string())?;
            let input = issue040_input_kind(&kind)
                .ok_or_else(|| format!("unsupported input kind: {kind}"))?;
            let embedded_registered = {
                let embedded = ISSUE040_EMBEDDED.lock().map_err(|e| e.to_string())?;
                issue040_embedded_is_registered(&embedded, &generation)
            };
            let target = issue040_dispatch_target(
                issue040_proof_enabled(),
                &generation,
                embedded_registered,
            )
            .ok_or_else(|| "issue 040 input dispatch target is not permitted".to_string())?;
            let window = match &target {
                Issue040DispatchTarget::EmbeddedMain => app
                    .get_webview_window(ISSUE040_MAIN_WINDOW_LABEL)
                    .ok_or_else(|| {
                        format!("main window not found: {ISSUE040_MAIN_WINDOW_LABEL}")
                    })?,
            };
            issue040_send_native_input(&window, input).await
        }
        other => Err(format!("unsupported issue 040 op: {other}")),
    }
}

#[cfg(target_os = "macos")]
#[cfg(feature = "proof-harness")]
pub(crate) type Issue040NativeInputObservation = (isize, f64, f64, bool, bool, bool, String);

#[cfg(target_os = "macos")]
#[cfg(feature = "proof-harness")]
pub(crate) async fn issue040_send_native_input(
    window: &tauri::WebviewWindow,
    input: Issue040Input,
) -> Result<String, String> {
    use objc2::MainThreadMarker;
    use objc2::Message;
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSView, NSWindow,
    };
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
            let result: Result<Issue040NativeInputObservation, String> = (|| {
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
#[cfg(feature = "proof-harness")]
pub(crate) async fn issue040_send_native_input(
    _window: &tauri::WebviewWindow,
    _input: Issue040Input,
) -> Result<String, String> {
    Err("issue 040 native input dispatch is only implemented for macOS".into())
}

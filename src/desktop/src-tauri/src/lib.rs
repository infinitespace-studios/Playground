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

fn packaged_pipeline_proof_enabled() -> bool {
    issue021_proof_enabled()
        || issue022_proof_enabled()
        || issue023_proof_enabled()
        || issue024_proof_enabled()
        || issue025_proof_enabled()
        || issue027_proof_enabled()
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
        proof_activation_target_allowed, proof_window_ready, require_packaged_pipeline_proof,
    };

    #[test]
    fn native_activation_is_rejected_without_packaged_proof_authorization() {
        assert!(require_packaged_pipeline_proof(false).is_err());
        assert!(require_packaged_pipeline_proof(true).is_ok());
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
        .setup(|app| {
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
            prepare_packaged_proof_window,
            issue023_emit_checkpoint,
            issue023_emit_report,
            issue024_emit_report,
            issue025_emit_report,
            issue027_emit_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running MonoGame Playground");
}

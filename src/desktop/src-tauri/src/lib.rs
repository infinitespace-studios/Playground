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

fn packaged_pipeline_proof_enabled() -> bool {
    issue021_proof_enabled() || issue022_proof_enabled() || issue023_proof_enabled()
}

fn require_packaged_pipeline_proof(enabled: bool) -> Result<(), String> {
    enabled
        .then_some(())
        .ok_or_else(|| "packaged pipeline proof instrumentation is disabled".into())
}

#[cfg(target_os = "macos")]
async fn activate_packaged_proof_window(
    window: &tauri::Window,
) -> Result<(bool, bool, bool, bool, bool, u32, u128), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSApplication, NSApplicationActivationOptions, NSApplicationActivationPolicy,
        NSRunningApplication, NSWindow,
    };
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let started = Instant::now();
    let ns_window = window.ns_window().map_err(|error| error.to_string())? as usize;
    let mut attempts = 0;
    let mut native = (false, false, false, false);
    let mut native_window_focused = false;

    while attempts < 3 {
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
                    app.activate();
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
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(100)))
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

        if window.is_visible().map_err(|error| error.to_string())?
            && window.is_focused().map_err(|error| error.to_string())?
            && !window.is_minimized().map_err(|error| error.to_string())?
        {
            break;
        }
    }

    window.set_focus().map_err(|error| error.to_string())?;
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
    use super::require_packaged_pipeline_proof;

    #[test]
    fn native_activation_is_rejected_without_packaged_proof_authorization() {
        assert!(require_packaged_pipeline_proof(false).is_err());
        assert!(require_packaged_pipeline_proof(true).is_ok());
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
    println!("ISSUE023_REPORT={report}");
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        app.exit(0);
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            prepare_packaged_proof_window,
            issue023_emit_checkpoint,
            issue023_emit_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running MonoGame Playground");
}

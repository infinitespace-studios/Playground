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
            issue021_emit_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running MonoGame Playground");
}

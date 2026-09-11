#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn configure_linux_webkit_renderer() {
    const VARIABLE: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(VARIABLE).is_none() {
        // SAFETY: this is the first operation in main, before Tauri/WebKitGTK or
        // any application thread is initialized. Tauri recommends disabling the
        // DMA-BUF renderer for Linux graphics-driver conflicts that otherwise
        // produce blank or corrupted initial WebKitGTK surfaces. Preserve an
        // explicit caller value so the workaround remains diagnosable.
        unsafe { std::env::set_var(VARIABLE, "1") };
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_linux_webkit_renderer();

    monogame_playground_lib::run();
}

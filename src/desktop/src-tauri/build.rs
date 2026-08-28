use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn collect_files(root: &Path, directory: &Path, output: &mut Vec<(String, PathBuf)>) {
    for entry in fs::read_dir(directory).expect("failed to read staged preview directory") {
        let path = entry.expect("failed to read staged preview entry").path();
        if path.is_dir() {
            collect_files(root, &path, output);
        } else {
            let relative = path
                .strip_prefix(root)
                .expect("preview asset escaped its root");
            output.push((
                format!("/{}", relative.to_string_lossy().replace('\\', "/")),
                path,
            ));
        }
    }
}

fn main() {
    let preview_root = Path::new("../../frontend/dist/preview")
        .canonicalize()
        .expect("frontend preview assets must be staged before the Rust build");
    println!("cargo:rerun-if-changed={}", preview_root.display());
    let mut files = Vec::new();
    collect_files(&preview_root, &preview_root, &mut files);
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let sizes = files
        .iter()
        .map(|(_, path)| {
            fs::metadata(path)
                .expect("failed to inspect staged preview asset")
                .len() as usize
        })
        .collect::<Vec<_>>();
    assert!(
        sizes.iter().all(|size| *size <= 8 * 1024 * 1024),
        "a staged preview asset exceeds the 8 MiB product limit"
    );
    let total_size = sizes.iter().sum::<usize>();
    assert!(
        total_size <= 64 * 1024 * 1024,
        "staged preview assets exceed the 64 MiB product limit"
    );
    let mut generated =
        String::from("fn preview_asset(path: &str) -> Option<&'static [u8]> {\n    match path {\n");
    for (route, path) in &files {
        generated.push_str(&format!(
            "        {route:?} => Some(include_bytes!({path:?})),\n",
        ));
    }
    generated.push_str("        _ => None,\n    }\n}\n");
    generated.push_str("const PREVIEW_ASSET_INVENTORY: &[(&str, usize)] = &[\n");
    for ((route, _), size) in files.iter().zip(&sizes) {
        generated.push_str(&format!("    ({route:?}, {size}),\n"));
    }
    generated.push_str("];\n");
    generated.push_str(&format!(
        "const PREVIEW_ASSET_TOTAL_BYTES: usize = {total_size};\n"
    ));
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is missing"))
        .join("preview_assets.rs");
    fs::write(output, generated).expect("failed to generate embedded preview asset map");
    tauri_build::build()
}

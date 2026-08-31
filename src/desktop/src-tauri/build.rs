use std::{
    env, fs,
    path::{Path, PathBuf},
};

const APP_COMMANDS: &[&str] = &[
    "issue009_is_proof_enabled",
    "issue009_emit_report",
    "issue011_is_proof_enabled",
    "issue011_set_outer_size",
    "issue011_outer_bounds",
    "issue011_emit_report",
    "issue010_is_proof_enabled",
    "issue010_emit_report",
    "issue020_is_proof_enabled",
    "issue020_emit_checkpoint",
    "issue020_emit_report",
    "issue021_is_proof_enabled",
    "issue021_is_locked_session_proof",
    "issue021_emit_report",
    "issue022_is_proof_enabled",
    "issue022_emit_report",
    "issue023_is_proof_enabled",
    "issue024_is_proof_enabled",
    "issue025_is_proof_enabled",
    "issue027_is_proof_enabled",
    "issue028_is_proof_enabled",
    "issue029_is_proof_enabled",
    "issue030_is_proof_enabled",
    "issue031_is_proof_enabled",
    "issue032_is_proof_enabled",
    "issue033_is_proof_enabled",
    "issue033_is_no_wasm_eval_proof_enabled",
    "issue034_is_proof_enabled",
    "issue034_trusted_marker",
    "issue034_trusted_marker_calls",
    "issue033_emit_checkpoint",
    "prepare_packaged_proof_window",
    "issue023_emit_checkpoint",
    "issue023_emit_report",
    "issue024_emit_report",
    "issue025_emit_report",
    "issue027_emit_report",
    "issue028_emit_report",
    "issue029_emit_report",
    "issue030_emit_report",
    "issue031_emit_report",
    "issue032_emit_report",
    "issue033_emit_report",
    "issue033_emit_no_wasm_eval_report",
    "issue034_emit_report",
    "issue035_is_proof_enabled",
    "issue035_emit_report",
    "issue036_is_proof_enabled",
    "issue036_emit_report",
    "issue037_check_acknowledgement",
    "issue037_write_acknowledgement",
    "issue037_is_proof_enabled",
    "issue037_emit_report",
    "issue037_read_store_snapshot",
    "issue037_clear_store",
    "issue037_proof_phase",
    "issue037_emit_checkpoint",
    "issue038_is_proof_enabled",
    "issue038_store_transfer",
    "issue038_clear_transfer",
    "issue038_create_preview_window",
    "issue038_destroy_preview_window",
    "issue038_preview_window_exists",
    "issue038_relay_to_preview",
    "issue038_collect_bridge_messages",
    "issue038_monotonic_nanos",
    "issue038_destroy_all_previews",
    "issue038_bootstrap_preview",
    "issue038_inject_script",
    "issue038_emit_checkpoint",
    "issue038_create_no_wasm_eval_window",
    "issue038_emit_report",
    "issue039_is_proof_enabled",
    "issue039_emit_checkpoint",
    "issue039_emit_report",
    "issue039_store_asset",
    "issue039_asset_manifest",
    "issue039_clear_assets",
    "issue039_transfer_state",
    "issue040_is_proof_enabled",
    "issue040_emit_checkpoint",
    "issue040_emit_report",
    "issue040_dispatch_preview_input",
];

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

fn quoted_values(block: &str) -> Vec<String> {
    block
        .split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

fn regular_files(directory: &Path) -> Vec<PathBuf> {
    let mut files = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", directory.display()))
        .filter_map(|entry| {
            let path = entry.expect("failed to read ACL directory entry").path();
            path.is_file().then_some(path)
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn validate_permission(permission: &str) -> Result<(), String> {
    let document = permission
        .parse::<toml::Value>()
        .map_err(|error| format!("main permission must be valid TOML: {error}"))?;
    let root = document
        .as_table()
        .ok_or("main permission root must be a table")?;
    if root.keys().map(String::as_str).collect::<Vec<_>>() != ["permission"] {
        return Err("main permission must contain only [[permission]]".into());
    }
    let permissions = root["permission"]
        .as_array()
        .ok_or("permission must be an array of tables")?;
    if permissions.len() != 1 {
        return Err("exactly one permission table is required".into());
    }
    let table = permissions[0]
        .as_table()
        .ok_or("permission entry must be a table")?;
    let mut keys = table.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    if keys != ["commands", "description", "identifier"] {
        return Err("permission contains an unapproved field or grant".into());
    }
    if table["identifier"].as_str() != Some("main-commands")
        || table["description"].as_str()
            != Some(
                "Allows the trusted main webview to invoke the application's registered commands.",
            )
    {
        return Err("permission identity or description drifted".into());
    }
    let commands = table["commands"]
        .as_table()
        .ok_or("commands must be a table")?;
    if commands.keys().map(String::as_str).collect::<Vec<_>>() != ["allow"] {
        return Err("commands must contain only commands.allow".into());
    }
    let allow = commands["allow"]
        .as_array()
        .ok_or("commands.allow must be an array")?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or("commands.allow values must be strings")
        })
        .collect::<Result<Vec<_>, _>>()?;
    if allow.iter().map(String::as_str).collect::<Vec<_>>() != APP_COMMANDS {
        return Err("main permission command inventory drifted".into());
    }
    Ok(())
}

fn validate_cargo_manifest(manifest: &str) -> Result<(), String> {
    let actual = manifest
        .parse::<toml::Value>()
        .map_err(|error| format!("Cargo manifest must be valid TOML: {error}"))?;
    let expected_dependencies = r#"
[build-dependencies]
serde_json = "1"
tauri-build = { version = "2", features = [] }
toml = "0.8"

[dependencies]
serde_json = "1"
tauri = { version = "2", features = [] }

[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "=0.6.4"
objc2-app-kit = { version = "=0.3.2", features = [
  "NSApplication",
  "NSEvent",
  "NSGraphicsContext",
  "NSResponder",
  "NSRunningApplication",
  "NSWindow",
] }
objc2-foundation = { version = "=0.3.2", features = ["NSGeometry", "NSString"] }
"#
    .parse::<toml::Value>()
    .expect("expected dependency policy must be valid TOML");
    let root = actual
        .as_table()
        .ok_or("Cargo manifest root must be a table")?;
    let mut root_keys = root.keys().map(String::as_str).collect::<Vec<_>>();
    root_keys.sort_unstable();
    if root_keys
        != [
            "build-dependencies",
            "dependencies",
            "lib",
            "package",
            "target",
        ]
    {
        return Err("Cargo manifest contains an unapproved root section".into());
    }
    for section in ["build-dependencies", "dependencies", "target"] {
        if actual.get(section) != expected_dependencies.get(section) {
            return Err(format!(
                "Cargo {section} names, versions, or features drifted"
            ));
        }
    }
    Ok(())
}

fn runtime_rust_sources(root: &Path) -> Vec<(PathBuf, String)> {
    fn visit(directory: &Path, output: &mut Vec<(PathBuf, String)>) {
        for entry in fs::read_dir(directory).expect("failed to enumerate desktop Rust source") {
            let path = entry
                .expect("failed to read desktop Rust source entry")
                .path();
            if path.is_dir() {
                visit(&path, output);
            } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
                output.push((
                    path.clone(),
                    fs::read_to_string(&path).expect("failed to read desktop Rust source"),
                ));
            }
        }
    }
    let mut output = Vec::new();
    visit(&root.join("src"), &mut output);
    output.sort_by(|left, right| left.0.cmp(&right.0));
    output
}

fn validate_runtime_rust(sources: &[String]) -> Result<(), String> {
    let compact = sources
        .join("\n")
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    for forbidden in [
        ".plugin",
        ".initialization_script",
        "append_invoke_initialization_script",
        "js_init_script_on_all_frames",
        "InitializationScript{",
        "for_main_frame_only:false",
        "for_main_frame_only(false)",
    ] {
        if compact.contains(forbidden) {
            return Err(format!(
                "forbidden desktop initialization surface: {forbidden}"
            ));
        }
    }
    if compact.matches("tauri::generate_handler![").count() != 1 {
        return Err("exactly one tauri::generate_handler! occurrence is required".into());
    }
    if compact.matches(".invoke_handler(").count() != 1 {
        return Err("exactly one invoke_handler registration is required".into());
    }
    Ok(())
}

fn validate_frontend_command_inventory(source: &str) -> Result<(), String> {
    let block = source
        .split("ISSUE034_APPROVED_COMMANDS = [")
        .nth(1)
        .and_then(|tail| tail.split("] as const").next())
        .ok_or("frontend command inventory is missing")?;
    if quoted_values(block) != APP_COMMANDS {
        return Err("frontend command inventory drifted".into());
    }
    Ok(())
}

fn validate_negative_fixtures(permission: &str, cargo: &str, rust: &[String]) {
    let appended_permission =
        format!("{permission}\n[[permission]]\nidentifier = \"extra\"\ncommands.allow = []\n");
    assert!(validate_permission(&appended_permission).is_err());

    for injected in [
        "\nfn injected(builder: tauri::Builder) { let _ = builder.plugin(dangerous()); }\n",
        "\nfn injected(builder: tauri::Builder) { let _ = builder.js_init_script_on_all_frames(\"x\"); }\n",
        "\nfn injected() { let _ = tauri::generate_handler![issue034_emit_report]; }\n",
    ] {
        let mut mutated = rust.to_vec();
        mutated.push(injected.into());
        assert!(validate_runtime_rust(&mutated).is_err());
    }

    let extra_dependency =
        cargo.replace("[dependencies]\n", "[dependencies]\nunapproved = \"1\"\n");
    assert!(validate_cargo_manifest(&extra_dependency).is_err());
    let changed_feature = cargo.replacen(
        "tauri = { version = \"2\", features = [] }",
        "tauri = { version = \"2\", features = [\"protocol-asset\"] }",
        1,
    );
    assert!(validate_cargo_manifest(&changed_feature).is_err());
    let dangerous_plugin = cargo.replace(
        "[dependencies]\n",
        "[dependencies]\ntauri-plugin-shell = \"2\"\n",
    );
    assert!(validate_cargo_manifest(&dangerous_plugin).is_err());
    let extra_build_dependency = cargo.replace(
        "[build-dependencies]\n",
        "[build-dependencies]\nunapproved-build = \"1\"\n",
    );
    assert!(validate_cargo_manifest(&extra_build_dependency).is_err());
}

fn validate_acl_source(root: &Path) {
    println!("cargo:rerun-if-env-changed=MONOGAME_ISSUE034_POLICY_MATRIX");
    for relative in [
        "capabilities",
        "permissions",
        "tauri.conf.json",
        "Cargo.toml",
        "src",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(relative).display());
    }
    let frontend_inventory = root.join("../../frontend/src/issue34.ts");
    println!("cargo:rerun-if-changed={}", frontend_inventory.display());
    println!(
        "cargo:rerun-if-changed={}",
        root.join("../../../tests/security/fixtures/issue034-canary.txt")
            .display()
    );
    let capability_directory = root.join("capabilities");
    let capability_entries = fs::read_dir(&capability_directory)
        .expect("failed to read capabilities")
        .map(|entry| entry.expect("failed to read capability entry").path())
        .collect::<Vec<_>>();
    let capability_files = regular_files(&capability_directory);
    assert_eq!(
        capability_entries.len(),
        1,
        "capabilities must not contain additional files or directories"
    );
    assert_eq!(
        capability_files,
        [root.join("capabilities/main.json")],
        "exactly one capability file named main.json is permitted"
    );
    let capability: serde_json::Value = serde_json::from_slice(
        &fs::read(&capability_files[0]).expect("failed to read main capability"),
    )
    .expect("main capability must be valid JSON");
    let object = capability
        .as_object()
        .expect("main capability must be an object");
    let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort();
    assert_eq!(
        keys,
        [
            "$schema",
            "description",
            "identifier",
            "local",
            "permissions",
            "windows"
        ],
        "main capability contains an unapproved field"
    );
    assert_eq!(capability["identifier"], "main");
    assert_eq!(capability["local"], true);
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    assert_eq!(
        capability["permissions"],
        serde_json::json!(["main-commands"])
    );
    assert!(capability.get("remote").is_none());
    assert!(capability.get("webviews").is_none());

    let permission_directory = root.join("permissions");
    let permission_entries = fs::read_dir(&permission_directory)
        .expect("failed to read permissions")
        .map(|entry| entry.expect("failed to read permission entry").path())
        .collect::<Vec<_>>();
    assert!(
        permission_entries.iter().all(|path| {
            path == &root.join("permissions/main.toml")
                || path == &root.join("permissions/autogenerated") && path.is_dir()
        }),
        "permissions contains an unapproved file or directory"
    );
    let permission_files = regular_files(&permission_directory);
    assert_eq!(
        permission_files,
        [root.join("permissions/main.toml")],
        "only the main permission source file is permitted"
    );
    let permission =
        fs::read_to_string(&permission_files[0]).expect("failed to read main permission");
    validate_permission(&permission).unwrap_or_else(|error| panic!("{error}"));

    let config: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("tauri.conf.json")).expect("failed to read Tauri config"),
    )
    .expect("Tauri config must be valid JSON");
    assert_eq!(config["app"]["withGlobalTauri"], false);
    assert_eq!(config["app"]["windows"][0]["label"], "main");
    let cargo = fs::read_to_string(root.join("Cargo.toml")).expect("failed to read Cargo manifest");
    validate_cargo_manifest(&cargo).unwrap_or_else(|error| panic!("{error}"));
    let rust_files = runtime_rust_sources(root);
    let rust_sources = rust_files
        .iter()
        .map(|(_, source)| source.clone())
        .collect::<Vec<_>>();
    validate_runtime_rust(&rust_sources).unwrap_or_else(|error| panic!("{error}"));
    validate_negative_fixtures(&permission, &cargo, &rust_sources);
    if env::var_os("MONOGAME_ISSUE034_POLICY_MATRIX").as_deref() == Some(std::ffi::OsStr::new("1"))
    {
        println!(
            "cargo:warning=issue 034 negative policy matrix passed: appended permission, plugin init, all-frame init, second handler macro, extra dependency, changed feature, dangerous plugin dependency, extra build dependency"
        );
    }
    let library = rust_sources.join("\n");
    let handler = library
        .split("tauri::generate_handler![")
        .nth(1)
        .and_then(|tail| tail.split("])").next())
        .expect("generate_handler command list is missing");
    let handler_commands = handler
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| line.trim_end_matches(',').to_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        handler_commands, APP_COMMANDS,
        "generate_handler command inventory drifted"
    );
    let frontend =
        fs::read_to_string(frontend_inventory).expect("failed to read frontend command inventory");
    validate_frontend_command_inventory(&frontend).unwrap_or_else(|error| panic!("{error}"));
}

fn validate_generated_acl(root: &Path) {
    let generated = root.join("permissions/autogenerated");
    let generated_files = regular_files(&generated);
    let generated_entries = fs::read_dir(&generated)
        .expect("failed to read generated permissions")
        .map(|entry| {
            entry
                .expect("failed to read generated permission entry")
                .path()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        generated_entries.len(),
        generated_files.len(),
        "generated permissions must contain files only"
    );
    assert_eq!(
        generated_files.len(),
        APP_COMMANDS.len(),
        "generated command permission count drifted"
    );
    for command in APP_COMMANDS {
        let path = generated.join(format!("{command}.toml"));
        assert!(
            generated_files.contains(&path),
            "missing {}",
            path.display()
        );
        let content = fs::read_to_string(path).expect("failed to read generated permission");
        let kebab = command.replace('_', "-");
        assert!(content.contains(&format!("identifier = \"allow-{kebab}\"")));
        assert!(content.contains(&format!("identifier = \"deny-{kebab}\"")));
        assert!(content.matches(&format!("[\"{command}\"]")).count() == 2);
    }
    assert_eq!(
        1 + 1 + generated_files.len(),
        85,
        "effective ACL must contain one capability, one composite permission, and 83 generated permissions"
    );
}

fn main() {
    let manifest_root = Path::new(".");
    validate_acl_source(manifest_root);
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
    let canary = fs::read("../../../tests/security/fixtures/issue034-canary.txt")
        .expect("issue 034 canary fixture is missing");
    let package_root = Path::new("../../frontend/dist")
        .canonicalize()
        .expect("frontend package must exist before the Rust build");
    let mut package_files = Vec::new();
    collect_files(&package_root, &package_root, &mut package_files);
    assert!(
        package_files.iter().all(|(route, path)| {
            !route.contains("issue034-canary")
                && !fs::read(path)
                    .expect("failed to scan packaged frontend asset")
                    .windows(canary.len())
                    .any(|window| window == canary)
        }),
        "the issue 034 canary fixture leaked into packaged frontend assets"
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
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to build Tauri context");
    validate_generated_acl(manifest_root);
}

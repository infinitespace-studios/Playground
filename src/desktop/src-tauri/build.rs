use std::{
    env, fs,
    path::{Path, PathBuf},
};

// Stage 6 proof-surface binary separation.
//
// The shipping PRODUCT build compiles only the eight domain-named product
// commands. The proof build (`--features proof-harness`) additionally compiles
// the fifty-nine packaged-proof commands. `build.rs` sees the full handler source
// either way (it reads `lib.rs` as text), so the three inventories below are the
// build-time source of truth:
//
//   * `HANDLER_ORDER`   — all 67 command identifiers, in `generate_handler!`
//                         order. Every proof identifier is gated by a per-line
//                         `#[cfg(feature = "proof-harness")]`; the eight product
//                         identifiers are unconditional. `validate_runtime_rust`
//                         enforces exactly that gating so neither list can drift
//                         nor a proof command silently lose its gate.
//   * `PRODUCT_COMMANDS` — the eight commands compiled into every build.
//   * `PROOF_COMMANDS`   — the fifty-nine commands compiled only under the feature.
//
// The *effective* command set handed to `tauri_build` (and therefore the
// generated per-command permissions) is `PRODUCT_COMMANDS` by default and the
// full `HANDLER_ORDER` under the feature. The committed ACL is split to match:
// `permissions/main.toml` + `capabilities/main.json` grant the eight product
// commands (selected by every build); `permissions/proof.toml` +
// `capabilities/proof.json` grant the fifty-nine proof commands (selected only by
// `tauri.proof.conf.json`).
const HANDLER_ORDER: &[&str] = &[
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
    "first_run_check_acknowledgement",
    "first_run_write_acknowledgement",
    "issue037_is_proof_enabled",
    "issue037_emit_report",
    "issue037_read_store_snapshot",
    "issue037_clear_store",
    "issue037_proof_phase",
    "issue037_emit_checkpoint",
    "issue039_is_proof_enabled",
    "issue039_emit_checkpoint",
    "issue039_emit_report",
    "issue040_is_proof_enabled",
    "issue040_emit_checkpoint",
    "issue040_emit_report",
    "issue040_dispatch_preview_input",
    "issue041_is_benchmark_enabled",
    "issue041_benchmark_mode",
    "issue041_warm_compile_count",
    "issue041_preview_cycle_count",
    "issue041_shell_ready",
    "issue041_emit_checkpoint",
    "issue041_emit_report",
    "issue041_rss_bytes",
    "workspace_write_file",
    "workspace_save_dialog",
    "workspace_open_dialog",
    "workspace_set_dirty",
    "project_pick_folder",
    "project_read",
];

const PRODUCT_COMMANDS: &[&str] = &[
    "first_run_check_acknowledgement",
    "first_run_write_acknowledgement",
    "workspace_write_file",
    "workspace_save_dialog",
    "workspace_open_dialog",
    "workspace_set_dirty",
    "project_pick_folder",
    "project_read",
];

const PROOF_COMMANDS: &[&str] = &[
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
    "issue037_is_proof_enabled",
    "issue037_emit_report",
    "issue037_read_store_snapshot",
    "issue037_clear_store",
    "issue037_proof_phase",
    "issue037_emit_checkpoint",
    "issue039_is_proof_enabled",
    "issue039_emit_checkpoint",
    "issue039_emit_report",
    "issue040_is_proof_enabled",
    "issue040_emit_checkpoint",
    "issue040_emit_report",
    "issue040_dispatch_preview_input",
    "issue041_is_benchmark_enabled",
    "issue041_benchmark_mode",
    "issue041_warm_compile_count",
    "issue041_preview_cycle_count",
    "issue041_shell_ready",
    "issue041_emit_checkpoint",
    "issue041_emit_report",
    "issue041_rss_bytes",
];

/// True when Cargo compiled the crate with `--features proof-harness`. Cargo
/// exports `CARGO_FEATURE_<NAME>` (uppercased, `-` → `_`) to the build script
/// for every enabled feature, so this reflects exactly what `lib.rs` compiled.
fn proof_harness_enabled() -> bool {
    env::var_os("CARGO_FEATURE_PROOF_HARNESS").is_some()
}

/// The command set actually compiled into this build: the eight product
/// commands by default, or all 67 under the proof-harness feature.
fn effective_commands() -> &'static [&'static str] {
    if proof_harness_enabled() {
        HANDLER_ORDER
    } else {
        PRODUCT_COMMANDS
    }
}

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

fn validate_permission(
    permission: &str,
    expected_identifier: &str,
    expected_description: &str,
    expected_commands: &[&str],
) -> Result<(), String> {
    let document = permission
        .parse::<toml::Value>()
        .map_err(|error| format!("{expected_identifier} permission must be valid TOML: {error}"))?;
    let root = document
        .as_table()
        .ok_or("permission root must be a table")?;
    if root.keys().map(String::as_str).collect::<Vec<_>>() != ["permission"] {
        return Err("permission must contain only [[permission]]".into());
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
    if table["identifier"].as_str() != Some(expected_identifier)
        || table["description"].as_str() != Some(expected_description)
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
    if allow.iter().map(String::as_str).collect::<Vec<_>>() != expected_commands {
        return Err("permission command inventory drifted".into());
    }
    Ok(())
}

const MAIN_PERMISSION_DESCRIPTION: &str =
    "Allows the trusted main webview to invoke the application's registered commands.";
const PROOF_PERMISSION_DESCRIPTION: &str =
    "Allows the trusted main webview to invoke the packaged proof-harness commands.";

fn validate_main_permission(permission: &str) -> Result<(), String> {
    validate_permission(
        permission,
        "main-commands",
        MAIN_PERMISSION_DESCRIPTION,
        PRODUCT_COMMANDS,
    )
}

fn validate_proof_permission(permission: &str) -> Result<(), String> {
    validate_permission(
        permission,
        "proof-commands",
        PROOF_PERMISSION_DESCRIPTION,
        PROOF_COMMANDS,
    )
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
tauri-plugin-dialog = "2"

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
    let expected_features = r#"
[features]
default = []
proof-harness = []
"#
    .parse::<toml::Value>()
    .expect("expected feature policy must be valid TOML");
    let root = actual
        .as_table()
        .ok_or("Cargo manifest root must be a table")?;
    let mut root_keys = root.keys().map(String::as_str).collect::<Vec<_>>();
    root_keys.sort_unstable();
    if root_keys
        != [
            "build-dependencies",
            "dependencies",
            "features",
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
    // The proof-harness feature must remain non-default and carry no implied
    // dependencies, or it could leak the proof surface into the product binary.
    if actual.get("features") != expected_features.get("features") {
        return Err(
            "Cargo [features] table drifted from `default = []; proof-harness = []`".into(),
        );
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
    // The proof-only security scenario ships the full 67-command inventory in
    // every profile's source (it is a proof module; the product graph never
    // imports it). Bind it to the complete handler order so it cannot drift.
    if quoted_values(block) != HANDLER_ORDER {
        return Err("frontend command inventory drifted".into());
    }
    Ok(())
}

fn inject_toml_entry(cargo: &str, section: &str, entry: &str) -> String {
    let newline = if cargo.contains("\r\n") { "\r\n" } else { "\n" };
    let header = format!("[{section}]{newline}");
    assert!(
        cargo.contains(&header),
        "Cargo manifest is missing the [{section}] table used by the negative fixture"
    );
    cargo.replacen(&header, &format!("{header}{entry}{newline}"), 1)
}

fn validate_negative_fixtures(permission: &str, cargo: &str, rust: &[String]) {
    let appended_permission =
        format!("{permission}\n[[permission]]\nidentifier = \"extra\"\ncommands.allow = []\n");
    assert!(validate_main_permission(&appended_permission).is_err());

    for injected in [
        "\nfn injected(builder: tauri::Builder) { let _ = builder.js_init_script_on_all_frames(\"x\"); }\n",
        "\nfn injected() { let _ = tauri::generate_handler![issue034_emit_report]; }\n",
    ] {
        let mut mutated = rust.to_vec();
        mutated.push(injected.into());
        assert!(validate_runtime_rust(&mutated).is_err());
    }

    let extra_dependency = inject_toml_entry(cargo, "dependencies", "unapproved = \"1\"");
    assert!(validate_cargo_manifest(&extra_dependency).is_err());
    let changed_feature = cargo.replacen(
        "tauri = { version = \"2\", features = [] }",
        "tauri = { version = \"2\", features = [\"protocol-asset\"] }",
        1,
    );
    assert!(validate_cargo_manifest(&changed_feature).is_err());
    let dangerous_plugin = inject_toml_entry(cargo, "dependencies", "tauri-plugin-shell = \"2\"");
    assert!(validate_cargo_manifest(&dangerous_plugin).is_err());
    let extra_build_dependency =
        inject_toml_entry(cargo, "build-dependencies", "unapproved-build = \"1\"");
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
    // Stage-4 consolidation: the issue034 ACL rejection inventory
    // (ISSUE034_APPROVED_COMMANDS) moved from issue34.ts into the durable
    // embedded-preview security scenario suite. The marker strings and array
    // shape are unchanged, so the split-based parse below still binds.
    let frontend_inventory = root.join("../../frontend/src/proof-preview-security.ts");
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
        2,
        "capabilities must contain exactly the main and proof capability files"
    );
    assert_eq!(
        capability_files,
        [
            root.join("capabilities/main.json"),
            root.join("capabilities/proof.json")
        ],
        "exactly the main.json and proof.json capability files are permitted"
    );
    validate_capability(
        &capability_files[0],
        "main",
        "main-commands",
        "main capability",
    );
    validate_capability(
        &capability_files[1],
        "proof",
        "proof-commands",
        "proof capability",
    );

    let permission_directory = root.join("permissions");
    let permission_entries = fs::read_dir(&permission_directory)
        .expect("failed to read permissions")
        .map(|entry| entry.expect("failed to read permission entry").path())
        .collect::<Vec<_>>();
    assert!(
        permission_entries.iter().all(|path| {
            path == &root.join("permissions/main.toml")
                || path == &root.join("permissions/proof.toml")
                || path == &root.join("permissions/autogenerated") && path.is_dir()
        }),
        "permissions contains an unapproved file or directory"
    );
    let permission_files = regular_files(&permission_directory);
    assert_eq!(
        permission_files,
        [
            root.join("permissions/main.toml"),
            root.join("permissions/proof.toml")
        ],
        "only the main and proof permission source files are permitted"
    );
    let permission =
        fs::read_to_string(&permission_files[0]).expect("failed to read main permission");
    validate_main_permission(&permission).unwrap_or_else(|error| panic!("{error}"));
    let proof_permission =
        fs::read_to_string(&permission_files[1]).expect("failed to read proof permission");
    validate_proof_permission(&proof_permission).unwrap_or_else(|error| panic!("{error}"));

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
    // Parse the handler body line by line. Each proof command identifier must be
    // immediately preceded by a per-line `#[cfg(feature = "proof-harness")]`;
    // each product command must NOT be. This makes the gating structurally
    // non-vacuous: dropping a proof command's gate, or gating a product command,
    // fails the build.
    const PROOF_GATE: &str = "#[cfg(feature = \"proof-harness\")]";
    let mut handler_commands = Vec::new();
    let mut pending_gate = false;
    for raw in handler.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line == PROOF_GATE {
            pending_gate = true;
            continue;
        }
        assert!(
            !line.starts_with("#["),
            "unexpected attribute inside generate_handler!: {line}"
        );
        let command = line.trim_end_matches(',').to_owned();
        let is_proof = PROOF_COMMANDS.contains(&command.as_str());
        let is_product = PRODUCT_COMMANDS.contains(&command.as_str());
        assert!(
            is_proof ^ is_product,
            "handler command {command} is not classified in exactly one inventory"
        );
        if is_proof {
            assert!(
                pending_gate,
                "proof command {command} is missing its #[cfg(feature = \"proof-harness\")] gate"
            );
        } else {
            assert!(
                !pending_gate,
                "product command {command} must not be gated behind proof-harness"
            );
        }
        pending_gate = false;
        handler_commands.push(command);
    }
    assert!(
        !pending_gate,
        "dangling #[cfg(feature = \"proof-harness\")] at end of generate_handler!"
    );
    assert_eq!(
        handler_commands, HANDLER_ORDER,
        "generate_handler command inventory drifted"
    );
    let frontend =
        fs::read_to_string(frontend_inventory).expect("failed to read frontend command inventory");
    validate_frontend_command_inventory(&frontend).unwrap_or_else(|error| panic!("{error}"));
}

/// Validate a committed capability file: exact field set, identifier, main-only
/// local scope, and that it grants exactly its one composite permission. The
/// product build selects only `main`; the proof build (`tauri.proof.conf.json`)
/// additionally selects `proof`, so neither capability's command strings can
/// leak into the other profile's resolved ACL.
fn validate_capability(path: &Path, identifier: &str, permission: &str, label: &str) {
    let capability: serde_json::Value = serde_json::from_slice(
        &fs::read(path).unwrap_or_else(|_| panic!("failed to read {label}")),
    )
    .unwrap_or_else(|_| panic!("{label} must be valid JSON"));
    let object = capability
        .as_object()
        .unwrap_or_else(|| panic!("{label} must be an object"));
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
        "{label} contains an unapproved field"
    );
    assert_eq!(capability["identifier"], identifier, "{label} identifier");
    assert_eq!(capability["local"], true, "{label} must be local");
    assert_eq!(
        capability["windows"],
        serde_json::json!(["main"]),
        "{label} must scope to the main window"
    );
    assert_eq!(
        capability["permissions"],
        serde_json::json!([permission]),
        "{label} must grant exactly its composite permission"
    );
    assert!(capability.get("remote").is_none(), "{label} remote");
    assert!(capability.get("webviews").is_none(), "{label} webviews");
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
    // `tauri_build` regenerates this directory from the effective command set,
    // so it is the profile-correct floor: 8 files by default, 67 under the
    // feature. This is the *effective grant* count (distinct from the committed
    // permission definitions, which always describe all 67 across the two
    // permission files).
    let effective = effective_commands();
    assert_eq!(
        generated_files.len(),
        effective.len(),
        "generated command permission count drifted from the effective command set"
    );
    for command in effective {
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
    // Effective ACL entries actually resolved into this profile's binary:
    //   product: 1 capability (main) + 1 composite permission (main-commands)
    //            + 8 generated permissions            = 10
    //   proof:   2 capabilities (main + proof)
    //            + 2 composite permissions            + 67 generated = 71
    let (capabilities, composites, expected_total) = if proof_harness_enabled() {
        (2, 2, 71)
    } else {
        (1, 1, 10)
    };
    assert_eq!(
        capabilities + composites + generated_files.len(),
        expected_total,
        "effective ACL entry count drifted for this build profile"
    );
}

fn main() {
    let manifest_root = Path::new(".");
    validate_acl_source(manifest_root);
    // Embed the profile-correct staged preview: the PRODUCT build (default
    // features) embeds the `dist/preview` runtime staged by `build`; the PROOF
    // build (`--features proof-harness`) embeds the `dist-proof/preview` runtime
    // staged by `build:proof`, which alone carries the proof extension/observer.
    let (package_dir, profile_label) = if proof_harness_enabled() {
        ("../../frontend/dist-proof", "proof")
    } else {
        ("../../frontend/dist", "product")
    };
    let preview_root = Path::new(package_dir)
        .join("preview")
        .canonicalize()
        .expect("frontend preview assets must be staged before the Rust build");
    println!("cargo:rerun-if-changed={}", preview_root.display());
    let mut files = Vec::new();
    collect_files(&preview_root, &preview_root, &mut files);
    files.sort_by(|left, right| left.0.cmp(&right.0));
    // Non-vacuous proof-surface scan of the staged preview.js. The PRODUCT build
    // must embed a preview runtime that contains a known product symbol
    // (positive floor, so a failed/empty read cannot pass) and NONE of the proof
    // export/dispatch symbols. The PROOF build must embed one that carries the
    // proof extension surface.
    let staged_preview_js = fs::read_to_string(preview_root.join("preview.js"))
        .expect("staged preview.js must exist for the embedded-preview proof scan");
    assert!(
        staged_preview_js.contains("createPreviewEndpoint")
            && staged_preview_js.contains("verifyRuntimeAsset"),
        "staged preview.js is missing product runtime symbols (scan would be vacuous)"
    );
    let forbidden_product_preview_symbols = [
        "previewIssue",
        "installIssue040AudioProbe",
        "createProofExpectationRegistry",
        "QueryIssue039State",
        "QueryIssue040AudioState",
        "QueryStoppedGameProof",
        "Issue034FileSystemProbe",
        "RunAtomicMountSelfTest",
    ];
    let proof_extension = preview_root.join("preview-proof-extension.js");
    // Stage 7: the proof extension was split by domain into four proof-only
    // sibling modules the entry imports. All are proof-only staged assets.
    let proof_modules = [
        ("preview-proof-extension.js", "__playgroundPreviewExtension"),
        ("preview-proof-state.js", "createProofExpectationRegistry"),
        ("preview-proof-audio.js", "installIssue040AudioProbe"),
        ("preview-proof-bridge.js", "Issue034FileSystemProbe"),
        ("preview-proof-lifecycle.js", "QueryStoppedGameProof"),
    ];
    if proof_harness_enabled() {
        assert!(
            proof_extension.exists(),
            "the PROOF build must embed the staged preview proof extension"
        );
        // Non-vacuous: every split proof module must be embedded AND carry its
        // required proof symbol (a failed/empty read cannot pass).
        for (module, symbol) in proof_modules {
            let path = preview_root.join(module);
            assert!(
                path.exists(),
                "the PROOF build must embed the staged preview proof module {module:?}"
            );
            let text = fs::read_to_string(&path)
                .unwrap_or_else(|_| panic!("staged proof module {module:?} must be readable"));
            assert!(
                text.contains(symbol),
                "staged proof module {module:?} is missing required proof symbol {symbol:?}"
            );
        }
    } else {
        for symbol in forbidden_product_preview_symbols {
            assert!(
                !staged_preview_js.contains(symbol),
                "the PRODUCT-embedded preview.js leaked proof symbol {symbol:?}"
            );
        }
        // The shared product stop runtime must not reference the stopped-game
        // proof export: the quiescence observation moved behind the proof-only
        // preview extension's neutral `onStopObservation` hook (Stage 6
        // remediation). Non-vacuous: assert the product floor is present first.
        let staged_stop_runtime = fs::read_to_string(preview_root.join("PreviewStopRuntime.js"))
            .expect("staged PreviewStopRuntime.js must exist for the proof-surface scan");
        assert!(
            staged_stop_runtime.contains("createPreviewStopExecutor")
                && staged_stop_runtime.contains("observeStopped"),
            "staged PreviewStopRuntime.js is missing product symbols (scan would be vacuous)"
        );
        assert!(
            !staged_stop_runtime.contains("QueryStoppedGameProof"),
            "the PRODUCT-staged PreviewStopRuntime.js leaked proof symbol QueryStoppedGameProof"
        );
        assert!(
            !proof_extension.exists(),
            "the PRODUCT build embedded a proof-only preview extension asset"
        );
        // Every split proof module must be absent from the PRODUCT-embedded tree.
        for (module, _symbol) in proof_modules {
            assert!(
                !preview_root.join(module).exists(),
                "the PRODUCT build embedded a proof-only preview module {module:?}"
            );
        }
    }
    let _ = profile_label;
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
    let package_root = Path::new(package_dir)
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
    // Non-vacuous proof-surface scan of the staged compiler harness. The compiler
    // ships as a normal frontend asset under `<package>/compiler` (not embedded
    // via `preview_asset`), so scan the profile-correct staged tree directly. The
    // PRODUCT build must contain a known product symbol (positive floor) and NONE
    // of the proof globals/handshake/extension; the PROOF build must carry the
    // proof extension + shared proof endpoints module.
    let compiler_root = package_root.join("compiler");
    let staged_compiler_harness = fs::read_to_string(compiler_root.join("compiler-harness.js"))
        .expect("staged compiler-harness.js must exist for the embedded-compiler proof scan");
    assert!(
        staged_compiler_harness.contains("createCompilerEndpoint")
            && staged_compiler_harness.contains("CompileAndRetain"),
        "staged compiler-harness.js is missing product runtime symbols (scan would be vacuous)"
    );
    let forbidden_product_compiler_symbols = [
        "compilerProof",
        "compilerIssue21Proof",
        "initializeCompilerProofMode",
        "createProofExpectationRegistry",
        "AuthorizeRetentionProof",
        "CompleteRetentionProof",
        "GetRetentionState",
        "runRetentionBehaviorProof",
        "proof-state",
    ];
    let compiler_proof_extension = compiler_root.join("compiler-proof-extension.js");
    let compiler_proof_endpoints = compiler_root.join("ProtocolEndpointsProof.js");
    if proof_harness_enabled() {
        assert!(
            compiler_proof_extension.exists() && compiler_proof_endpoints.exists(),
            "the PROOF build must stage the compiler proof extension + shared proof endpoints"
        );
    } else {
        for symbol in forbidden_product_compiler_symbols {
            assert!(
                !staged_compiler_harness.contains(symbol),
                "the PRODUCT-staged compiler-harness.js leaked proof symbol {symbol:?}"
            );
        }
        assert!(
            !compiler_proof_extension.exists() && !compiler_proof_endpoints.exists(),
            "the PRODUCT build staged a proof-only compiler asset"
        );
    }
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
    // The autogenerated per-command permission directory is a gitignored build
    // artifact that `tauri_build` regenerates from the effective command set but
    // never prunes. Switching profiles (product ↔ proof) would otherwise leave
    // stale files and desync the effective-ACL count, so wipe it first and let
    // `tauri_build` repopulate exactly the profile-correct set.
    let autogenerated = manifest_root.join("permissions/autogenerated");
    if autogenerated.exists() {
        for entry in fs::read_dir(&autogenerated).expect("failed to read autogenerated permissions")
        {
            let path = entry
                .expect("failed to read autogenerated permission entry")
                .path();
            if path.extension().and_then(|value| value.to_str()) == Some("toml") {
                fs::remove_file(&path).expect("failed to prune stale autogenerated permission");
            }
        }
    }
    // Profile-scope which committed ACL files `tauri_build` reads into the
    // embedded manifest. The product build reads ONLY main.toml / main.json, so
    // the proof composite permission and the fifty-nine proof command name strings
    // never enter the product binary's ACL manifest (a raw `strings` scan of the
    // release binary confirms their absence). The proof build widens both globs
    // to include the proof overlay. The `default = []` feature keeps the product
    // scoping as the fail-safe default.
    let (permissions_pattern, capabilities_pattern) = if proof_harness_enabled() {
        ("./permissions/*.toml", "./capabilities/*.json")
    } else {
        ("./permissions/main.toml", "./capabilities/main.json")
    };
    println!("cargo:rerun-if-changed=permissions");
    println!("cargo:rerun-if-changed=capabilities");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .capabilities_path_pattern(capabilities_pattern)
            .app_manifest(
                tauri_build::AppManifest::new()
                    .commands(effective_commands())
                    .permissions_path_pattern(permissions_pattern),
            ),
    )
    .expect("failed to build Tauri context");
    validate_generated_acl(manifest_root);
}

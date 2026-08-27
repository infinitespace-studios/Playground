#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


def read_json(path, description):
    try:
        with path.open(encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        fail(f"Unable to read {description} {path}: {error}")


def safe_relative_path(value, description):
    if not isinstance(value, str) or not value:
        fail(f"{description} must be a non-empty relative path.")
    parsed = PurePosixPath(value)
    if parsed.is_absolute() or parsed.as_posix() != value or "\\" in value or ".." in parsed.parts:
        fail(f"{description} contains path traversal or is not canonical: {value!r}.")
    return parsed


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_contract(manifest, toolchain, assets):
    if manifest.get("schemaVersion") != 1:
        fail("Unsupported reference allowlist schemaVersion; expected 1.")

    commit_sha = manifest.get("monogameCommitSha")
    if not isinstance(commit_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
        fail("reference allowlist monogameCommitSha must be a lowercase 40-character SHA.")
    if toolchain.get("monogame", {}).get("commitSha") != commit_sha:
        fail("Reference allowlist MonoGame SHA has drifted from docs/toolchain-manifest.json.")

    target = manifest.get("target")
    compiler = toolchain.get("compiler", {})
    if not isinstance(target, dict):
        fail("Reference allowlist target must be an object.")
    framework = target.get("framework")
    runtime = target.get("runtimeIdentifier")
    if framework != compiler.get("targetFramework") or runtime != compiler.get("runtimeIdentifier"):
        fail("Reference allowlist target has drifted from docs/toolchain-manifest.json.")
    if f"{framework}/{runtime}" not in assets.get("targets", {}):
        fail(f"Compiler restore assets do not contain the exact target {framework}/{runtime}.")

    pack = target.get("referencePack")
    if not isinstance(pack, dict) or pack.get("name") != "Microsoft.NETCore.App.Ref":
        fail("Reference allowlist must identify Microsoft.NETCore.App.Ref.")
    pack_version = pack.get("version")
    if not isinstance(pack_version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", pack_version):
        fail("Reference pack version must be an exact three-part version.")
    if pack.get("referenceFramework") != framework:
        fail("Reference pack framework must match the compiler target framework.")
    if compiler.get("referencePack") != {
        "name": pack["name"],
        "version": pack_version,
    }:
        fail("Reference pack identity has drifted from docs/toolchain-manifest.json.")
    if (
        f"Microsoft.NET.Sdk.WebAssembly.Pack/{compiler.get('wasmSdkPackVersion')}"
        not in assets.get("libraries", {})
    ):
        fail("WebAssembly SDK pack has drifted from docs/toolchain-manifest.json.")

    framework_data = assets.get("project", {}).get("frameworks", {}).get(framework, {})
    downloads = framework_data.get("downloadDependencies", [])
    expected_range = f"[{pack_version}, {pack_version}]"
    if not any(
        item.get("name") == pack["name"] and item.get("version") == expected_range
        for item in downloads
        if isinstance(item, dict)
    ):
        fail(
            f"Compiler restore assets do not resolve exact reference pack "
            f"{pack['name']} {pack_version}."
        )

    assemblies = manifest.get("assemblies")
    if not isinstance(assemblies, list) or not assemblies:
        fail("Reference allowlist assemblies must be a non-empty array.")

    names = []
    capabilities = []
    for index, assembly in enumerate(assemblies):
        if not isinstance(assembly, dict):
            fail(f"assemblies[{index}] must be an object.")
        name = assembly.get("simpleName")
        version = assembly.get("version")
        token = assembly.get("publicKeyToken")
        digest = assembly.get("sha256")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9.]+", name):
            fail(f"assemblies[{index}].simpleName is invalid.")
        if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", version):
            fail(f"assemblies[{index}].version is invalid.")
        if token is not None and (
            not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{16}", token)
        ):
            fail(f"assemblies[{index}].publicKeyToken must be null or 16 lowercase hex digits.")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            fail(f"assemblies[{index}].sha256 must be 64 lowercase hex digits.")
        source = assembly.get("source")
        if not isinstance(source, dict):
            fail(f"assemblies[{index}].source must be an object.")
        safe_relative_path(source.get("path"), f"assemblies[{index}].source.path")
        entry_capabilities = assembly.get("capabilities")
        if not isinstance(entry_capabilities, list) or not entry_capabilities or not all(
            isinstance(item, str) and item for item in entry_capabilities
        ):
            fail(f"assemblies[{index}].capabilities must be a non-empty string array.")
        names.append(name)
        capabilities.extend(entry_capabilities)

        if source.get("kind") == "dotnet-reference-pack":
            if source.get("version") != pack_version or source.get("path") != f"{name}.dll":
                fail(f"Reference-pack source metadata is inconsistent for {name}.")
        elif source.get("kind") == "monogame-submodule-build-output":
            expected = {
                "path": "external/MonoGame/Artifacts/MonoGame.Framework/Native/Release/MonoGame.Framework.dll",
                "version": commit_sha,
                "informationalVersion": f"{version}+{commit_sha}",
                "project": "MonoGame.Framework/MonoGame.Framework.Native.csproj",
                "profile": "Native",
                "configuration": "Release",
            }
            if name != "MonoGame.Framework" or any(source.get(key) != value for key, value in expected.items()):
                fail("MonoGame source metadata must identify the Native Release project output.")
        else:
            fail(f"Unsupported source kind for {name}: {source.get('kind')!r}.")

    if len(names) != len(set(names)):
        fail("Reference allowlist contains duplicate physical assembly names.")
    if len(capabilities) != len(set(capabilities)):
        fail("Reference allowlist contains duplicate capabilities.")

    required_capabilities = {
        "core-runtime-types",
        "System.Runtime",
        "System.Console",
        "System.Collections",
        "System.Linq",
        "System.Numerics",
        "System.Numerics.Vectors",
        "System.Threading",
        "System.Threading.Tasks",
        "System.Runtime.InteropServices",
        "System.Memory",
        "System.Diagnostics.Debug",
        "netstandard",
        "MonoGame.Framework.Native",
    }
    if set(capabilities) != required_capabilities:
        missing = sorted(required_capabilities - set(capabilities))
        extra = sorted(set(capabilities) - required_capabilities)
        fail(f"Reference capability drift; missing={missing}, extra={extra}.")

    return assemblies, commit_sha, pack


def verify_submodule(repo_root, expected_sha):
    submodule = repo_root / "external/MonoGame"
    try:
        actual = subprocess.run(
            ["git", "-C", str(submodule), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        fail(f"Unable to inspect the MonoGame submodule: {error}")
    if actual != expected_sha:
        fail(f"MonoGame submodule HEAD mismatch: expected {expected_sha}, found {actual}.")


def verify_dotnet_sdk(toolchain, compiler_dir):
    expected = toolchain.get("compiler", {}).get("sdkVersion")
    try:
        actual = subprocess.run(
            ["dotnet", "--version"],
            check=True,
            capture_output=True,
            text=True,
            cwd=compiler_dir,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        fail(f"Unable to inspect the .NET SDK: {error}")
    if actual != expected:
        fail(f"Compiler .NET SDK mismatch: expected {expected}, found {actual}.")


def reject_symlinks(path, description):
    path = path.absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if current.is_symlink():
            fail(f"{description} must not contain symlinks: {current}")


def reject_destination_surprises(path):
    if not path.exists():
        return
    if not path.is_dir():
        fail(f"Compiler references destination must be a directory: {path}")
    for child in path.iterdir():
        if child.is_symlink():
            fail(f"Compiler references destination contains a symlink: {child.name}.")


def resolve_reference_pack(assets, pack, framework):
    candidates = []
    relative = Path("microsoft.netcore.app.ref") / pack["version"] / "ref" / framework
    for package_folder in assets.get("packageFolders", {}):
        candidate = Path(package_folder) / relative
        reject_symlinks(candidate, "Reference pack path")
        if candidate.is_dir():
            candidates.append(candidate.resolve())
    candidates = sorted(set(candidates))
    if len(candidates) != 1:
        fail(
            f"Expected exactly one restored {pack['name']} {pack['version']} ref/{framework} "
            f"directory from project.assets.json packageFolders; found {len(candidates)}."
        )
    return candidates[0]


def inspect_identities(repo_root, compiler_dir, paths):
    command = [
        "dotnet",
        "run",
        "--project",
        str(repo_root / "scripts/ReferenceIdentity/ReferenceIdentity.csproj"),
        "--configuration",
        "Release",
        "--",
        *[str(path) for path in paths],
    ]
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            cwd=compiler_dir,
        )
    except FileNotFoundError:
        fail("dotnet is required to inspect reference assembly identities.")
    except subprocess.CalledProcessError as error:
        sys.stderr.write(error.stdout)
        sys.stderr.write(error.stderr)
        fail("Reference assembly identity inspection failed.")
    identities = []
    for line in result.stdout.splitlines():
        if line.startswith("{"):
            try:
                identities.append(json.loads(line))
            except json.JSONDecodeError:
                fail(f"Identity inspector returned invalid JSON: {line}")
    if len(identities) != len(paths):
        fail("Identity inspector did not return one identity for every source assembly.")
    return identities


def verify_destination(references_dir, assemblies):
    reject_symlinks(references_dir, "Compiler references directory")
    expected_files = {f"{entry['simpleName']}.dll" for entry in assemblies}
    if not references_dir.is_dir():
        fail(f"Compiler references directory is missing: {references_dir}")
    children = list(references_dir.iterdir())
    for path in children:
        if path.is_symlink():
            fail(f"Compiler references directory contains a symlink: {path.name}.")
    actual_files = {path.name for path in children}
    missing = sorted(expected_files - actual_files)
    extra = sorted(actual_files - expected_files)
    if missing or extra:
        fail(f"Compiler reference inventory mismatch; missing={missing}, extra={extra}.")
    for entry in assemblies:
        path = references_dir / f"{entry['simpleName']}.dll"
        actual_hash = sha256(path)
        if actual_hash != entry["sha256"]:
            fail(
                f"Compiler reference hash mismatch for {path.name}: "
                f"expected {entry['sha256']}, found {actual_hash}."
            )


def verify_identities(assemblies, identities, paths, context):
    seen_identities = set()
    for entry, identity, path in zip(assemblies, identities, paths):
        expected = {
            "simpleName": entry["simpleName"],
            "version": entry["version"],
            "publicKeyToken": entry["publicKeyToken"],
            "sha256": entry["sha256"],
        }
        actual = {key: identity.get(key) for key in expected}
        if actual != expected:
            fail(
                f"{context} identity/hash mismatch for {path}: "
                f"expected {expected}, found {actual}."
            )
        if (
            entry["source"]["kind"] == "monogame-submodule-build-output"
            and identity.get("informationalVersion")
            != entry["source"]["informationalVersion"]
        ):
            fail(
                f"{context} MonoGame informational version mismatch for {path}: expected "
                f"{entry['source']['informationalVersion']!r}, found "
                f"{identity.get('informationalVersion')!r}."
            )
        identity_key = (
            identity["simpleName"],
            identity["version"],
            identity["publicKeyToken"],
        )
        if identity_key in seen_identities:
            fail(f"Duplicate {context.lower()} assembly identity: {identity_key}.")
        seen_identities.add(identity_key)


def main():
    parser = argparse.ArgumentParser(
        description="Collect or verify the compiler's pinned raw metadata references."
    )
    parser.add_argument("--verify", action="store_true", help="verify without modifying references")
    parser.add_argument("--manifest", type=Path, help="override manifest path for isolated tests")
    parser.add_argument("--references-dir", type=Path, help="override destination for isolated tests")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    compiler_dir = repo_root / "src/compiler"
    if not args.verify and (args.manifest is not None or args.references_dir is not None):
        fail("--manifest and --references-dir overrides are only valid with --verify.")

    production_manifest = repo_root / "docs/reference-allowlist.json"
    production_references = repo_root / "src/compiler/References"
    manifest_input = args.manifest or production_manifest
    references_input = args.references_dir or production_references
    reject_symlinks(manifest_input, "Reference allowlist path")
    reject_symlinks(references_input, "Compiler references directory")
    manifest_path = manifest_input.resolve()
    references_dir = references_input.resolve()
    if not args.verify and references_dir != production_references.resolve():
        fail("Collection destination must be exactly src/compiler/References.")
    if not args.verify:
        reject_destination_surprises(references_dir)
    toolchain = read_json(repo_root / "docs/toolchain-manifest.json", "toolchain manifest")
    compiler_global = read_json(compiler_dir / "global.json", "compiler SDK manifest")
    manifest = read_json(manifest_path, "reference allowlist")
    assets = read_json(repo_root / "src/compiler/obj/project.assets.json", "compiler restore assets")
    assemblies, commit_sha, pack = validate_contract(manifest, toolchain, assets)
    expected_sdk = toolchain.get("compiler", {}).get("sdkVersion")
    if compiler_global.get("sdk") != {
        "version": expected_sdk,
        "rollForward": "disable",
        "allowPrerelease": False,
    }:
        fail("src/compiler/global.json has drifted from the compiler SDK pin.")
    verify_dotnet_sdk(toolchain, compiler_dir)
    verify_submodule(repo_root, commit_sha)

    if args.verify:
        verify_destination(references_dir, assemblies)
        destination_paths = [
            references_dir / f"{entry['simpleName']}.dll"
            for entry in assemblies
        ]
        destination_identities = inspect_identities(
            repo_root,
            compiler_dir,
            destination_paths,
        )
        verify_identities(
            assemblies,
            destination_identities,
            destination_paths,
            "Destination",
        )
        print(f"Verified {len(assemblies)} compiler references in {references_dir}.")
        return

    reference_pack = resolve_reference_pack(assets, pack, manifest["target"]["framework"])
    sources = []
    for entry in assemblies:
        source = entry["source"]
        if source["kind"] == "dotnet-reference-pack":
            path = reference_pack / source["path"]
        else:
            path = repo_root.joinpath(*PurePosixPath(source["path"]).parts)
        reject_symlinks(path, f"Source assembly path for {entry['simpleName']}")
        if not path.is_file():
            fail(
                f"Required source assembly is missing: {path}. "
                "Collection never rebuilds MonoGame; provide the pinned Native Release output."
            )
        sources.append(path)

    identities = inspect_identities(repo_root, compiler_dir, sources)
    verify_identities(assemblies, identities, sources, "Source")

    staging = references_dir.with_name(f"{references_dir.name}.new")
    backup = references_dir.with_name(f"{references_dir.name}.backup")
    if staging.exists():
        fail(f"Refusing to replace unexpected existing staging path: {staging}")
    if staging.is_symlink():
        fail(f"Refusing symlink staging path: {staging}")
    if backup.exists() or backup.is_symlink():
        fail(f"Refusing to replace unexpected existing backup path: {backup}")
    staging.mkdir(parents=True)
    staging_created = True
    backup_created = False
    try:
        for entry, source_path in zip(assemblies, sources):
            shutil.copyfile(source_path, staging / f"{entry['simpleName']}.dll")
        verify_destination(staging, assemblies)
        staging_paths = [
            staging / f"{entry['simpleName']}.dll"
            for entry in assemblies
        ]
        staging_identities = inspect_identities(repo_root, compiler_dir, staging_paths)
        verify_identities(assemblies, staging_identities, staging_paths, "Staging")
        if references_dir.exists():
            os.replace(references_dir, backup)
            backup_created = True
        try:
            os.replace(staging, references_dir)
            staging_created = False
        except BaseException:
            if backup_created and not references_dir.exists():
                os.replace(backup, references_dir)
                backup_created = False
            raise
        if backup_created:
            shutil.rmtree(backup)
            backup_created = False
    finally:
        if staging_created and staging.exists() and not staging.is_symlink():
            shutil.rmtree(staging)
        if backup_created and backup.exists() and not references_dir.exists():
            os.replace(backup, references_dir)

    print(
        f"Collected and verified {len(assemblies)} compiler references from "
        f"{pack['name']} {pack['version']} and MonoGame {commit_sha}."
    )


if __name__ == "__main__":
    main()

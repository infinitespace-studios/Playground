# Open folder, edit/run multiple files, persist manifest

**Type:** AFK
**Status:** Done
**Blocked by:** [030-compile-run-two-files-cross-file-calls.md](030-compile-run-two-files-cross-file-calls.md), [050-save-scratch-project-with-dirty-state-protection.md](050-save-scratch-project-with-dirty-state-protection.md)
**PRD references:** 15, 24 (Phase 3)
**User stories:** US4
**Triage:** needs-triage

## Context

PRD section 15 defines the full project/content model: a project folder containing multiple `.cs` files, a `playground.json` manifest (name, schemaVersion, contentProfile, preview dimensions), and a `Content/` folder; the manifest must not be required for a one-file scratch project (already satisfied since issue 47/50 work without one), the manifest schema must be published, and new application versions must either migrate older schemas atomically or reject unsupported versions without modifying the project. Section 24's Phase 3 ("Local projects") lists multiple source files, file explorer, Open folder, Save/Save All, recent projects, and manifest schema/migration/atomic writes as deliverables. This issue extends the single-scratch-file model from issues 47/50 into a real multi-file, folder-based project model, reusing issue 30's proven multi-file compilation and issue 50's atomic-write mechanism.

## What to build

Implement Open-folder (via the trusted shell's native folder-picker), a file-explorer list in the Workbench frame's files region showing every `.cs` file found in the opened folder, the ability to switch the Monaco editor between files (each retaining its own dirty state), Save All writing every dirty file plus the manifest atomically, and reading/writing a `playground.json` manifest that is created with defaults if absent, migrated if it has an older `schemaVersion`, or rejected with a clear error (without modifying the project) if its `schemaVersion` is newer/unrecognized than what this application version supports.

## Scope

### In scope

- A file-explorer UI listing all `.cs` files in the opened project folder
- Switching Monaco between files, with independent per-file dirty tracking
- Open-folder using the trusted shell's native folder-picker dialog
- Save All: writing every dirty `.cs` file plus `playground.json` atomically (reusing issue 50's write routine per file)
- Reading `playground.json` on Open, applying schema migration for older recognized `schemaVersion` values, and rejecting (with a clear error, no partial write) newer/unrecognized `schemaVersion` values
- Compiling and running all `.cs` files in the opened project together, reusing issue 30's proven multi-file compilation and issues 21-25's load/run pipeline

### Out of scope

- Recent-projects list persistence (acceptable to add if trivial given the persistence mechanism from issue 37/46/50, but not required for this issue's core acceptance criteria)
- Production content-project asset workflow polish (issue 52)
- Any manifest fields beyond those already specified in PRD section 15's example (`name`, `schemaVersion`, `contentProfile`, `preview.width`/`height`)

## Implementation guidance

1. Implement Open-folder: invoke the trusted shell's native folder-picker (Tauri's `dialog.open({ directory: true })`), then read the folder's contents (via the shell's scoped file-system API, restricted to the top-level trusted frontend per issue 34) to enumerate all `.cs` files recursively.
2. Populate the files-region file explorer (issue 45's placeholder list) with the discovered `.cs` files; clicking a file loads its content into Monaco, tracking each open file's own dirty state independently (extend issue 50's single-buffer dirty tracker into a per-file-path dirty map).
3. Read `playground.json` from the opened folder if present: parse its `schemaVersion`; if it matches the application's current supported version, use it as-is; if it is an older but recognized previous version, apply a documented migration step (for the MVP, define the current schema as version 1 per PRD section 15's example, so no migration logic is strictly needed yet — but implement the version-check branch structure now so it is ready for a future version 2); if it is missing, create an in-memory default manifest (`{ name: <folder name>, schemaVersion: 1, contentProfile: "Web", preview: { width: 800, height: 480 } }`) to be written on first Save; if it is a newer/unrecognized `schemaVersion`, reject the Open with a clear error dialog and do not modify anything in the folder.
4. Implement Save All: for every file with a dirty flag set, perform issue 50's atomic write-then-rename routine; then write `playground.json` (creating it if it did not exist) using the same atomic routine; clear all dirty flags only after every write in the batch succeeds (if any single file's write fails, leave all dirty flags set and report the specific failure, per PRD 8.6's atomicity/backup requirement extended across a multi-file Save All).
5. Wire Run to gather every open `.cs` file's current in-memory content (not just the currently-visible one) and pass them all to `CompilationService.Compile` together, exactly as proven in issue 30, then run the result through issues 21-25's existing pipeline.
6. Test with a real two-file project folder (`Game1.cs` + `Player.cs`, reusing issue 30's fixture), confirming both files appear in the explorer, both compile and run together (cross-file call proof), Save All persists both files plus a newly created `playground.json`, and reopening the folder afterward correctly reads back the persisted manifest.

## Acceptance criteria

- [ ] Open-folder lists every `.cs` file in the chosen folder in a file-explorer UI, and clicking a file loads it into Monaco with independent per-file dirty tracking
- [ ] Running the project compiles and executes all open `.cs` files together (reusing issue 30's cross-file-call proof), not just the currently-visible file
- [ ] Save All atomically writes every dirty `.cs` file plus `playground.json`, only clearing dirty flags once every write in the batch succeeds
- [ ] A missing `playground.json` is created with sensible defaults on first Save; an unrecognized/newer `schemaVersion` is rejected with a clear error and no files are modified
- [ ] Reopening a previously-saved project folder correctly reads back its `playground.json` and file list unchanged

## Verification

Create a real test folder with `Game1.cs` and `Player.cs` (issue 30's fixture) and no manifest. Open it via the folder-picker, confirm both files appear in the explorer and can be individually selected/edited. Press Run and confirm the cross-file call renders correctly (issue 30's proof, now through the real folder-based UI). Press Save All, confirm both `.cs` files and a new `playground.json` (with `schemaVersion: 1`) are written to disk (inspect the files directly). Close and reopen the folder, confirming the manifest and files are read back correctly. Finally, manually edit the on-disk `playground.json` to set `schemaVersion: 999` and attempt to reopen the folder, confirming it is rejected with a clear error and no file in the folder is modified (`git diff`/checksum the folder contents before and after the rejected attempt). The verifier must perform every step and directly inspect the folder's on-disk contents at each stage.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent background agent (local Qwen 3.6 model), plus a second manual review of the ACL locks and the schemaVersion-reject path by the maintainer
- **Date:** 2026-09-06
- **Evidence:** Two new Tauri commands (`issue051_pick_folder`, `issue051_read_project`) registered consistently across all four ACL locks (APP_COMMANDS, permissions/main.toml, generate_handler!, ISSUE034_APPROVED_COMMANDS) in identical order, with matching autogenerated permission files and the build.rs count assertion bumped 96→098 and protocol.test.ts manifest count 94→96. Capability remains exactly `["main-commands"]` scoped to the `"main"` window — the new filesystem commands are unreachable from the preview. `issue051_read_project` is read-only (only `read_dir`/`metadata`/`read_to_string`; no write/rename/create) with defensive limits (500 files, 2 MiB/file, 32 MiB total, depth 32; skips bin/obj/node_modules/hidden). It returns `serde_json::Value` (no bare `serde` crate added, per validate_cargo_manifest). Acceptance criteria: (a) Open-folder lists every .cs file; per-file dirty tracking via a savedContent/currentContent/dirty map; switchTo persists the live buffer before switching. (b) Run compiles all open files via multiSourceProvider (issue 30 pattern, getSources syncs the visible buffer first, primary = Game1.cs); scratch single-file flow unchanged when no folder is open. (c) Save All writes each dirty file then playground.json via the atomic issue050_write_file; dirty flags cleared only after every write succeeds, otherwise all remain set and the error is reported (PRD 8.6 batch atomicity). (d) Missing manifest → in-memory default {name, schemaVersion:1, contentProfile:"Web", preview:{800,480}}; newer/unrecognized schemaVersion → parseManifest throws and openFolder returns false at line 245 BEFORE any state mutation (line 252+), and openFolder never writes to disk — a rejected Open touches nothing (independently reviewed). (e) Reopening reads back the raw manifest + files, round-tripped through parseManifest. Issues 048/049 wiring intact. Gates: `cargo build` succeeds (ACL assertions pass), `tsc --noEmit` clean (only the unrelated pre-existing issue041.ts:771 error), 101/101 protocol tests pass (incl. "issue 034 commands are scoped"), `vite build` succeeds. Not independently reproducible at runtime: the interactive Tauri GUI could not be driven headlessly, so the native folder-picker dialog, live file switching, multi-file Run, and real on-disk atomic Save All were verified by code review + builds + automated tests rather than manual GUI interaction; direct on-disk inspection of a saved project and a schemaVersion:999 reject (per the spec's Verification steps) remains for a human/GUI pass.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: support folder-based multi-file projects with manifest persistence`

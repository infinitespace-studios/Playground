# Add installer, signing policy, notices, and SBOM

**Type:** AFK
**Status:** Parked
**Blocked by:** [053-github-actions-native-desktop-packages.md](053-github-actions-native-desktop-packages.md)
**PRD references:** 22.5, 24 (Phase 5)
**User stories:** US7, US8
**Triage:** parked by product owner — installer/release hardening deferred while feature development resumes

## Context

PRD section 22.5 requires packaging tests to verify installer artifact integrity, code-signing policy, install/launch/upgrade/uninstall/clean-removal behavior, bundled third-party notices and SBOM, no external runtime URLs in the built output, and no undeclared dependency on repository or developer-machine files. Section 24's Phase 5 lists installer hardening and signing automation as deliverables. Issue 53 established CI-based release automation that produces each platform's native bundle (macOS `.dmg`/`.app`, Windows `.msi`/NSIS `.exe`, Linux `.deb`/`.AppImage`) via the Tauri bundler. This issue hardens that output for release: a documented code-signing policy (even if actual signing requires a certificate not available in this environment, the policy and process must be documented and the build must be structured to support it), bundled third-party license notices, and a software bill of materials (SBOM). Where the bundler's default installer output needs additional metadata or configuration to be release-grade, that configuration also belongs here.

## What to build

Ensure the selected shell's per-OS installers (Tauri's built-in `.msi`/NSIS on Windows, `.dmg` on macOS, `.deb`/`.AppImage` on Linux, produced by issue 53's workflow) carry release-grade metadata, write a documented code-signing policy describing what must be signed and how (even if actual signing is deferred pending certificate acquisition), generate a third-party notices file covering every bundled dependency's license, and generate an SBOM (e.g. via `syft`, `cyclonedx`, or a hand-maintained inventory if no SBOM tool is available in this environment) listing every bundled component and its version.

## Scope

### In scope

- Configuring the shell's native Windows installer output (MSI for Tauri's default bundler, or the equivalent for Electron)
- `docs/signing-policy.md`: what must be signed (the installer and/or the main executable), the certificate type required, and the process to apply it (documented even if the actual signing step cannot be executed in this environment due to lacking a certificate — mark it clearly as "pending certificate acquisition" if so)
- `THIRD-PARTY-NOTICES.md` (or equivalent) listing every bundled third-party dependency (Monaco, Roslyn/Microsoft.CodeAnalysis, MonoGame, Emscripten runtime components, any npm/Cargo dependencies bundled into the shipped product) and its license
- An SBOM file (e.g. `docs/sbom.json` or `docs/sbom.cdx.json`) enumerating bundled components and versions
- Verifying install/launch/upgrade/uninstall/clean-removal behavior of the produced installer

### Out of scope

- Actually obtaining/purchasing a code-signing certificate (outside this issue's automatable scope; document the policy and leave the signing step as a documented manual gap if no certificate is available)
- The full clean-machine verification pass (issue 55, which re-verifies this installer end-to-end on a pristine machine)

## Implementation guidance

1. Configure the shell's installer bundler: for Tauri, set `bundle.targets` in `tauri.conf.json` to include `msi` (and/or `nsis`), providing required metadata (publisher name, product name/version, icons); for Electron, configure `electron-builder`'s `win.target` to `msi`/`nsis`.
2. Build the installer and confirm it is produced by issue 53's workflow (or locally via `tauri build`).
3. Write `docs/signing-policy.md`: state that Windows executables/installers must be signed with an Authenticode code-signing certificate before public release, describe the intended signing step (e.g. `signtool sign /fd SHA256 /a <path>`) to be run as part of the release pipeline once a certificate is available, and explicitly mark the current status (signed / not yet signed pending certificate) for this specific build.
4. Generate `THIRD-PARTY-NOTICES.md`: enumerate every bundled dependency identified while building issues 6/16/20/45-52 (Monaco Editor, Microsoft.CodeAnalysis.CSharp/Roslyn, MonoGame.Framework.Native and its own third-party components, the Tauri/Electron runtime itself, any Emscripten-produced runtime files, and any npm packages bundled into the shipped frontend) with each one's license type (MIT/Apache-2.0/BSD/etc., checked from each dependency's own license file/package metadata) and a link/reference to its full license text.
5. Generate an SBOM: if a tool such as `syft` or `cyclonedx-cli`/`@cyclonedx/cyclonedx-npm` is available in this environment, run it against the final packaged output and the `.csproj`/`package.json` dependency graphs and save the result to `docs/sbom.cdx.json`; if no such tool is available, hand-author a structured JSON/Markdown inventory listing every bundled component, its version, and its source (npm/NuGet/vendored), clearly noting it was hand-maintained rather than tool-generated.
6. Test the installer: install it (in a VM or disposable environment), confirm the application launches correctly and matches issue 53's packaged build behavior, then uninstall it and confirm no leftover files/registry entries remain in the default install location (a full clean-removal audit is repeated more rigorously in issue 55, but a first pass belongs here).

## Acceptance criteria

- [ ] A Windows installer (MSI and/or NSIS) carries release-grade metadata via the selected shell's native bundler (produced by issue 53's workflow)
- [ ] `docs/signing-policy.md` documents the required signing process and certificate type, and states the current signed/unsigned status of this specific build honestly
- [ ] `THIRD-PARTY-NOTICES.md` lists every bundled third-party dependency identified across the project with its license type
- [ ] An SBOM file exists (`docs/sbom.cdx.json` or a clearly-labeled hand-maintained equivalent) enumerating bundled components and versions
- [ ] Installing, launching, and uninstalling the produced installer leaves no leftover files/registry entries in the default location, confirmed by a before/after comparison

## Verification

Install the produced installer in a VM or disposable environment, confirm the application launches and behaves identically to issue 53's packaged build (spot-check the default example Run/Stop). Uninstall it and compare a directory/registry listing of the install location before install and after uninstall, confirming no leftover artifacts. Inspect `docs/signing-policy.md`, `THIRD-PARTY-NOTICES.md`, and the SBOM file for completeness against the actual bundled dependencies (spot-check at least five bundled components appear correctly in both the notices file and the SBOM). The verifier must perform the install/uninstall cycle personally and record the before/after comparison.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `release: add Windows installer, signing policy, notices, and SBOM`

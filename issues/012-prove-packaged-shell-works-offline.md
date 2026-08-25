# Prove packaged shell works with network disabled

**Type:** AFK
**Status:** Done
**Blocked by:** [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md)
**PRD references:** 18, 19, 22.5
**User stories:** US7
**Triage:** needs-triage

## Context

PRD section 18 requires the installed application to work without an internet connection and prohibits loading any runtime dependency from a CDN. Critical feasibility questions 2 and 3 (section 19) ask whether the shell works without a development server and whether it works offline. Section 22.5 requires packaging tests on a machine with networking disabled. This issue proves the packaged Tauri build from issues 6-8 launches and renders correctly with all networking disabled at the OS level, which is a mandatory Phase 1 gate criterion before issue 14's ADR can be approved.

## What to build

Launch the packaged Release build of the Tauri shell under an OS-enforced deny-all network policy and confirm the MonoGame example still renders and responds to input exactly as it does with networking enabled. On macOS, process-level `sandbox-exec` isolation is acceptable because it denies network system calls for the app and its children without disconnecting unrelated processes.

## Scope

### In scope

- Denying networking at the OS level using Wi-Fi/Ethernet shutdown, firewall rules, or a process sandbox inherited by the packaged binary and its children
- A reusable macOS proof script that first confirms its deny-all network policy is effective
- Confirming the app still launches, renders, and (if practical) accepts input under these conditions
- Confirming via devtools Network panel (if available) that no requests fail due to being blocked (i.e. no requests were being made to the network in the first place)

### Out of scope

- Full clean-machine packaging tests with no .NET/Node/repo present (that is issue 55, a much later full release verification)
- Product/runtime changes; the reusable proof script is test tooling only

## Implementation guidance

1. Build the Release Tauri bundle per issue 8's state (`cd src/desktop && npm run tauri build`).
2. Disable networking. On macOS, prefer `scripts/prove-packaged-offline-macos.sh`, which validates `(deny network*)` using a socket-bind probe before launching the packaged binary and all descendants under the same sandbox profile. Turning off Wi-Fi/Ethernet or using `pfctl` remains acceptable for a later human release test.
3. Launch the packaged binary directly (not via `npm run tauri dev`, which may depend on a local dev server).
4. Confirm the MonoGame example renders identically to the networked case (issue 7/8's proof).
5. If devtools are available, open the Network panel and confirm there are zero outbound requests (all assets loaded from the bundled/local protocol).
6. End the sandboxed process or re-enable networking afterward and confirm normal operation resumes. Process-level sandboxing does not alter system network configuration.

## Acceptance criteria

- [x] The packaged Release binary launches and renders the MonoGame example while an OS-enforced policy denies all network operations to it and its children
- [x] No failed network request appears in devtools (because no network request is attempted for any bundled asset)
- [x] The deny-all policy is independently shown effective before launch, then removed without changing system networking
- [x] The exact method used to disable networking is documented in the verification evidence

## Verification

Independently run `scripts/prove-packaged-offline-macos.sh` and confirm its socket probe fails specifically because the sandbox denies network operations. Confirm the packaged app and WebView inherit the same profile, reach `rendering`, produce changing non-black frames, and report no JS/WebGL errors. Inspect the packaged frontend for external HTTP/CDN dependencies and check the launched process tree for network sockets. Then run the packaged binary normally to confirm no regression. The verifier must reproduce the test rather than accept the implementer's or user's report. No full-screen capture or interaction with unrelated windows is permitted.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Issue 012 Verifier (`426b699e-a464-4676-8e1c-aa225640f0bc`)
- **Date:** 2026-08-25
- **Evidence:** Independently syntax-checked and ran `scripts/prove-packaged-offline-macos.sh --skip-build`. A normal loopback socket bind succeeded, while the identical operation under `(deny network*)` failed with `PermissionError: [Errno 1] Operation not permitted`. The packaged app and its WebKit GPU, Networking, and WebContent descendants then ran under that policy with no TCP/UDP sockets. All three structured samples reported `runtimeState=rendering`; six frames were fully non-black, hashes changed at every size, 1,255-1,359 pixels changed materially, and all GL errors, context-loss events, console errors, and unhandled errors were zero. The release contained 219 bundled assets and loaded its runtime from local paths; inspected HTTP strings were documentation, diagnostics, build-only configuration, or Tauri IPC rather than runtime network dependencies. A normal ungated rerun also rendered without errors. Pre/post `external/MonoGame` status was byte-identical at 1,469 bytes with SHA-256 `a7b1efe8a369acc7db0ddf476841eea2a72870be5e72b7669531fba0c7f3257f`. This proves OS-enforced process-level network isolation, not a physical Wi-Fi/Ethernet-off test; the latter remains appropriate for the later clean-machine release verification.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record proof of offline operation with networking disabled`

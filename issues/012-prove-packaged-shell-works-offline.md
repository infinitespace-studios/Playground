# Prove packaged shell works with network disabled

**Type:** AFK
**Status:** Ready
**Blocked by:** [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md)
**PRD references:** 18, 19, 22.5
**User stories:** US7
**Triage:** needs-triage

## Context

PRD section 18 requires the installed application to work without an internet connection and prohibits loading any runtime dependency from a CDN. Critical feasibility questions 2 and 3 (section 19) ask whether the shell works without a development server and whether it works offline. Section 22.5 requires packaging tests on a machine with networking disabled. This issue proves the packaged Tauri build from issues 6-8 launches and renders correctly with all networking disabled at the OS level, which is a mandatory Phase 1 gate criterion before issue 14's ADR can be approved.

## What to build

Launch the packaged Release build of the Tauri shell with the machine's network interfaces disabled (or firewalled to deny all outbound connections) and confirm the MonoGame example still renders and responds to input exactly as it does with networking enabled.

## Scope

### In scope

- Disabling networking at the OS level (Wi-Fi/Ethernet off, or a firewall rule denying all outbound traffic for the packaged binary) before launch
- Confirming the app still launches, renders, and (if practical) accepts input under these conditions
- Confirming via devtools Network panel (if available) that no requests fail due to being blocked (i.e. no requests were being made to the network in the first place)

### Out of scope

- Full clean-machine packaging tests with no .NET/Node/repo present (that is issue 55, a much later full release verification)
- Any code changes — this is a proof-only issue

## Implementation guidance

1. Build the Release Tauri bundle per issue 8's state (`cd src/desktop && npm run tauri build`).
2. Disable networking: on macOS, turn off Wi-Fi (`networksetup -setairportpower en0 off`, adjust interface name as needed) and disconnect Ethernet if present; alternatively use `pfctl`/firewall rules to block all outbound traffic for the test process if disabling hardware networking is not practical in this environment. Record exactly which method was used.
3. Launch the packaged binary directly (not via `npm run tauri dev`, which may depend on a local dev server).
4. Confirm the MonoGame example renders identically to the networked case (issue 7/8's proof).
5. If devtools are available, open the Network panel and confirm there are zero outbound requests (all assets loaded from the bundled/local protocol).
6. Re-enable networking afterward and confirm normal operation resumes (regression check, and to leave the test machine in its normal state).

## Acceptance criteria

- [ ] The packaged Release binary launches and renders the MonoGame example with all network interfaces disabled
- [ ] No failed network request appears in devtools (because no network request is attempted for any bundled asset)
- [ ] Networking is re-enabled afterward and the app is confirmed to still work normally
- [ ] The exact method used to disable networking is documented in the verification evidence

## Verification

Follow the implementation steps above exactly, capturing: the command(s) used to disable networking, a screenshot or description confirming rendering while offline, and (if devtools are accessible) a Network-panel screenshot showing zero requests. The verifier must personally reproduce this test (disabling their own network, launching the binary, confirming rendering, re-enabling network) rather than accept a written claim, since this is a mandatory Phase 1 gate criterion feeding directly into issue 14.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record proof of offline operation with networking disabled`

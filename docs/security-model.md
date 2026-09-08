# Preview security model

## Version 2 (issues 033–035)

Every production game-preview iframe is created with exactly:

```text
sandbox="allow-scripts"
```

`allow-same-origin` is deliberately absent. The frame therefore has the
serialized origin `null`, cannot read the editor DOM, and cannot expose its DOM
or JavaScript objects to the editor. The editor configures the sandbox before
assigning `src` or inserting/replacing the frame.

The production document is a parent-authored `srcdoc`, so it retains an opaque
origin under the sandbox. Its first active policy is a CSP meta element before
any stylesheet or script:

```text
default-src 'none'; script-src playground-preview: 'wasm-unsafe-eval'; style-src playground-preview:; connect-src playground-preview:; img-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

Preview assets are embedded in the desktop executable and served by the
`playground-preview:` application protocol; asset responses repeat the CSP as
defense in depth. The scheme is the only script, stylesheet, and fetch source.
Images, fonts, media, workers, nested frames, and objects have no source.
Packaged testing with `wasm-unsafe-eval` removed prevents the .NET WebAssembly
runtime from booting; it is therefore the sole evaluation relaxation and does
not permit JavaScript `eval`. No HTTP(S), wildcard, `data:`, `blob:`, inline
script/style, JavaScript `unsafe-eval`, base, or form destination is allowed.
The trusted editor CSP permits only the immutable `playground-preview:` assets
needed by its inherited `srcdoc` policy.

The packaged probe requires `securitypolicyviolation` evidence for inline
script/style, external connect, nested frame, object, and `base-uri`. It also
attempts a `_self` form submission. WebKit's `allow-scripts`-only sandbox blocks
that submission before CSP evaluation and emits no `form-action` violation, so
the report records the observed submit event, unchanged document, absent CSP
event, and `form-action 'none'` policy assertion as separate layers. Popup
denial is likewise attributed to the sandbox, not CSP. JavaScript `eval`
throws under CSP, although this WebKit version emits no violation event for it.

Opaque-origin module and fetch requests carry `Origin: null`. The private asset
protocol responds with `Access-Control-Allow-Origin: null`,
`Cross-Origin-Resource-Policy: cross-origin`, `X-Content-Type-Options:
nosniff`, and `Cache-Control: no-store`. It deliberately omits
`Access-Control-Allow-Credentials`; the preview's .NET resource loader
explicitly uses `credentials: "omit"` for every fetched boot resource.
The same headers and CSP are returned for generic 400, 404, and 405 responses,
which never include paths or filesystem details. Routes require GET, the exact
`playground-preview://localhost` authority, no query, fragment, encoding, or
path normalization, and an exact embedded-asset path. Each asset is limited to
8 MiB and the generated inventory to 64 MiB. Browser boot-resource caching is
disabled because Cache Storage is unavailable to an opaque sandbox.

The need for `'wasm-unsafe-eval'` is checked by a fail-closed packaged negative
proof:

```sh
MONOGAME_ISSUE033_NO_WASM_EVAL_PROOF=1 \
  "src/desktop/src-tauri/target/release/bundle/macos/MonoGame Playground.app/Contents/MacOS/monogame-playground"
```

That exact environment flag makes the production iframe factory omit only
`'wasm-unsafe-eval'`; it cannot add or replace policy tokens and preview code
cannot select the mode. An identical bundled observer is loaded before the normal runtime bootstrap in
both documents. It remains inert when the canonical policy token is present
and records the runtime startup error only when that token is absent. There is
no synthetic violation probe in the negative document. The proof requires the
runtime's direct WebAssembly instantiate denial naming both `unsafe-eval` and
`wasm-unsafe-eval`, no private bridge readiness within the bounded startup
interval, and complete frame/port retirement. This WebKit version reports the
WebAssembly denial as an unhandled rejection rather than a
`securitypolicyviolation`; the report records that limitation without claiming
an event the browser did not emit. The canonical policy remains unconditional
in every normal build and run.

## Trust and ownership

The editor creates a one-shot bootstrap directed at the exact iframe
`contentWindow`. The child accepts it only from `parent`, with the configured
editor origin, valid generation/preview identifiers, and exactly two
transferred ports. One port carries the validated preview protocol; the second
is a narrowly whitelisted test/runtime observation bridge needed because the
opaque boundary forbids DOM inspection. Stop, failure, and retirement close
ports and remove the old iframe; a restart creates a fresh opaque realm.

The compiler iframe is not a game preview and is outside issue 033.
`frame-ancestors` cannot be enforced by an HTML meta policy and is omitted
because the preview must be embedded by the editor. The
custom protocol is registered only inside the desktop webview.

## Desktop IPC and filesystem boundary

The desktop uses pinned Tauri `2.11.5`. Its core initialization, invoke,
metadata, IPC, event, isolation, and optional global-API scripts are created as
`InitializationScript { for_main_frame_only: true }`. Therefore they execute
in the trusted top-level `main` frame and not in nested preview frames.
`app.withGlobalTauri` is explicitly `false`. There are no plugin initialization
scripts and no `tauri-plugin-fs`, shell, process, opener, dialog, or clipboard
dependency.
The frontend has no `@tauri-apps/api` dependency or imported transport; the
trusted code uses Tauri's injected, non-global `__TAURI_INTERNALS__.invoke`
transport directly.

Custom application commands are opted into Tauri's runtime authority through
`AppManifest::commands`. The sole local capability is
`capabilities/main.json`: identifier `main`, `local: true`, window `main`, and
permission `main-commands`. It has no remote URL grant. The exact command
inventory is maintained and cross-checked in four places:
`build.rs`, `permissions/main.toml`, `generate_handler!`, and the packaged
proof inventory. It consists of
the issue 009–037 proof enable/checkpoint/report commands,
`prepare_packaged_proof_window`, the issue-034 marker commands, and the
issue-038 isolated preview window management commands. No
filesystem, shell, process, opener, dialog, clipboard, arbitrary read, or
arbitrary command-forwarding command is registered.
The structured policy validator requires exactly one permission table with
only the expected identifier, description, and exact `commands.allow`; extra
tables, fields, and grants fail the build. It recursively checks desktop Rust
sources for exactly one handler macro/registration and rejects plugin or
all-frame initialization APIs. Cargo's exact allowlist is: runtime `tauri`
with no features; build-time `serde_json`, `toml`, and featureless
`tauri-build`; and macOS-only `objc2`, `objc2-app-kit`, and
`objc2-foundation` at the documented exact versions/features in `Cargo.toml`.
All other dependency names, target sections, or feature changes require a
deliberate validator/documentation update. The executable build-time negative
matrix covers appended permission tables, plugin/all-frame initialization,
second handler macros, extra runtime/build/plugin dependencies, and dependency
feature drift. Protocol tests cover second/remote/wildcard capabilities,
`webviews`, `local: false`, and extra permissions. It also validates all
generated files. The effective 74-file ACL scope is exactly one capability,
one composite `main-commands` permission, and 72 Tauri-generated per-command
allow/deny permission files. The generated directory is intentionally ignored
by Git: `tauri_build` reproducibly creates it from `APP_COMMANDS`, then
`build.rs` rejects missing, extra, renamed, non-file, or malformed entries.

`issue034_trusted_marker` is harmless and proof-gated. It accepts no user
argument, validates that Tauri identified the invoking webview-window as
`main`, returns only `issue034-main-frame-marker-v1`, and increments an
eight-call maximum process-local counter. The packaged proof invokes it once
from the top level and verifies the counter remains exactly one after two
preview generations and forged transport attempts.

The production preview evaluates and records these expressions:

```text
typeof window.__TAURI__
typeof window.__TAURI_INTERNALS__
typeof window.isTauri
typeof window.__TAURI_INTERNALS__?.invoke
typeof window.__TAURI_INTERNALS__?.transformCallback
typeof window.__TAURI_INTERNALS__?.convertFileSrc
Object.keys(window.__TAURI_INTERNALS__ ?? {})
Object.getOwnPropertyNames(window.webkit?.messageHandlers ?? {})
```

The trusted top level must observe `__TAURI_INTERNALS__` as an object,
`invoke` and `transformCallback` as functions, `isTauri` as a boolean, and
metadata label `main`; `window.__TAURI__` remains undefined. On the pinned
macOS WebKit runtime, the top-level enumerable internals are only `plugins`
(the callable and metadata properties are non-enumerable). The opaque preview
observes every Tauri global/function above as undefined and no enumerable
message-handler names. WebKit does expose a dynamic
`window.webkit.messageHandlers.ipc.postMessage` proxy to the nested frame even
though no Tauri initialization script ran there. The proof installs bounded
one-shot callback/error IDs in the trusted observer, passes only those numeric
IDs to the preview, and submits NSString JSON envelopes through the raw proxy.
Every envelope matches Tauri 2.11.5's postMessage fallback shape:
`cmd`, `callback`, `error`, `options` (including headers and
`customProtocolIpcBlocked`), `payload`, and optionally
`__TAURI_INVOKE_KEY__`. All 57 registered commands receive missing-key,
deliberately-wrong-key, and replayed-wrong-key variants (72 ACL invoke rejections,
72 commands tested).

Missing-key strings produce Tauri's concrete native parser diagnostic
`JSON error: missing field` naming `__TAURI_INVOKE_KEY__`; exactly 72 are
rejected by ACL.
Wrong and replayed keys are silently dropped at invoke-key authentication:
no success/error callback runs during the bounded ten-second observation, all
342 callback IDs are then removed, the window dimensions and marker counter
remain unchanged, and the app completes a fresh preview restart. Tauri does
not return an authentication error callback for this transport. ACL evaluation
is **not** claimed: the wrong-key requests are rejected before runtime
authority evaluates the `main` capability. Thus denial is not inferred from
missing globals or from merely submitting an object to Wry.
The random invoke key and callback transforms are never copied across the
private preview port or included in reports.

The preview also attempts both Fetch and XMLHttpRequest GET/POST through `file:`, `tauri:`, `asset:`,
`ipc:`, `http://ipc.localhost`, and an encoded traversal of
`playground-preview:`. All non-preview transports must reject before content
is returned. The custom IPC POSTs use the real command URL, `{}` JSON body,
`Content-Type`, numeric `Tauri-Callback`/`Tauri-Error`, and a deliberately
wrong `Tauri-Invoke-Key`; CSP blocks those URL transports before Tauri parsing,
so they are not described as ACL or authentication results. The direct WebKit
NSString transport supplies the native parser/authentication evidence. The
preview protocol traversal must return only generic
`400 Bad Request`. A repository-controlled non-secret canary at
`tests/security/fixtures/issue034-canary.txt` establishes a trusted checksum
and SHA-256 expectation. Its literal content is absent from production source,
preview reports, and packaged resources. The preview reports only bounded body
lengths and SHA-256 digests; the trusted controller proves none equals the
canary digest. A managed
probe separately attempts `File.ReadAllText` against plausible virtual/project
paths and must report no successful read. This distinguishes browser/.NET
virtual filesystems from the unavailable host filesystem without probing any
private user file.

Capability labels cannot distinguish an iframe from its containing webview:
both belong to `main`. The nested-frame boundary therefore additionally
depends on Tauri's supported main-frame-only initialization behavior, the
unavailable invoke key/transforms, opaque-origin sandbox, CSP, and the absence
of plugin scripts. Issue 034 does not claim arbitrary-code OS isolation;
those remain issues 036–038.

## Navigation and network denial (issue 035)

The preview iframe cannot navigate the trusted top-level window, open new
windows/tabs, or make arbitrary outbound network requests. Three independent
enforcement layers provide this:

### Layer 1: iframe sandbox

The `sandbox="allow-scripts"` attribute intentionally omits
`allow-top-navigation`, `allow-top-navigation-by-user-activation`, and
`allow-popups`. Assigning `parent.location.href` or calling
`window.open(url, "_top")` from within the preview iframe throws a
`SecurityError`. Popup `window.open()` calls return `null`.

### Layer 2: Content Security Policy

The preview CSP restricts `connect-src` to `playground-preview:` only. Any
`fetch()` or `XMLHttpRequest` to an `https:`, `http:`, or any other scheme
triggers a `securitypolicyviolation` event with `effectiveDirective` beginning
with `connect-src`. The request never reaches the network.

### Layer 3: Shell-level Tauri hooks

The main window is created programmatically in Tauri's `setup` hook with
`"create": false` in `tauri.conf.json` (preventing auto-construction) so that
`on_navigation` and `on_new_window` hooks can be installed:

- **`on_navigation`** allows only URLs with scheme `tauri`,
  `playground-preview`, or `about` (needed for `srcdoc` iframe initialization).
  All other schemes (including `https`, `http`, `data`, `file`) return `false`
  and are rejected by Wry before the webview navigates.
- **`on_new_window`** unconditionally returns `Deny`, preventing any new
  browser window from being opened regardless of the request source.

These shell hooks operate at the Wry/webview level and apply to the entire
`main` webview, including its embedded iframes. They are defense-in-depth: the
sandbox and CSP independently block the same attack vectors from the preview
iframe. The shell hooks would also block a hypothetical bypass of the sandbox
layer.

### Packaged proof evidence

The packaged proof (`MONOGAME_ISSUE035_PROOF=1`) runs inside two sequential
preview iframe generations and verifies:

1. `fetch("https://example.com/issue035-probe")` throws a network error and
   produces a `securitypolicyviolation` event with `connect-src` as the
   effective directive — establishing CSP policy denial, not DNS/offline
   coincidence.
2. `parent.location.href = "https://example.com/issue035-top-nav"` throws a
   `SecurityError` and the trusted top-level window's URL and title remain
   unchanged.
3. `window.open("https://example.com/...", "_blank")` and
   `window.open("https://example.com/...", "_top")` both return `null`,
   confirming sandbox popup denial.
4. The preview still successfully loads its bundled `playground-preview:`
   assets and renders CornflowerBlue at the expected WebGL pixel values —
   regression check against issue 023.
5. All assertions are repeated in a second preview generation to confirm
   isolation survives iframe restart.
6. The top-level trusted window URL is sampled before the first probe, between
   probes, and after the second generation; all three observations are
   identical.

### Limitations

The `on_navigation` and `on_new_window` hooks operate on the webview container
and do not distinguish the top-level page from its nested iframes at the Tauri
capability level. The iframe's own sandbox and CSP are the primary enforcement
for preview isolation. The shell hooks are a second layer that would catch a
sandbox bypass but cannot independently attribute denial to a specific iframe
origin. Issue 034's observation that Tauri capability labels do not distinguish
an iframe from its containing webview remains true.

## Limits and follow-up

Sandbox, CSP, shell navigation hooks, API analyzers, opaque origin, and
private ports are defense-in-depth product boundaries, not a complete security
sandbox for arbitrary hostile code. They do not by themselves provide process,
OS, CPU, or memory isolation. Issues 037–038 add process boundary, resource
limits, and further adversarial validation. No claim here supersedes those
remaining controls.

## Protocol message validation (issue 036)

Every protocol message receiver validates inputs before side effects. The
bootstrap `window.postMessage` receiver validates `event.source`,
`event.origin`, data shape, `contextGeneration` UUIDv4, port count, and
`type === "protocol.bootstrap"`. After bootstrap, all traffic uses the private
`MessagePort`; `event.origin` and `event.source` are unavailable on port
messages and are not fabricated.

Private-port receivers enforce Protocol.md section 4 validation order:
`protocolVersion` presence and exact v1 support, canonical UUIDv4 correlation,
known message type, route authorization, payload schema, field types, UTF-8
scalar validity, buffer identity/size, path canonicalization, and aggregate
limits. Size enforcement uses actual `ArrayBuffer.byteLength` and
overflow-safe integer addition, not JSON serialization approximations.

Rejected messages receive exactly one bounded structured response
(`protocol.error` for envelope-level failures, terminal `success: false` for
payload-level failures). Rejections do not crash handlers, do not load
assemblies, do not start games, and do not mutate protocol state. Invalid
`protocol.error` messages are discarded without reply to prevent amplification
loops. Duplicate correlation IDs are rejected without executing the request
again.

Post-bootstrap `window.postMessage` from the expected source closes the
accepted port as a defense against confused-deputy replay. Messages from
unexpected sources are silently discarded.

The packaged proof (`MONOGAME_ISSUE036_PROOF=1`) exercises live `postMessage`
attacks against a running preview iframe's `contentWindow` during active game
rendering and verifies before/after runtime state identity, continued
CornflowerBlue pixel rendering, no assembly load, and clean stop. Unit tests
cover every structural rejection class from Protocol.md sections 2–5 and 8–9.

Browsers cannot synthesize arbitrary `event.source` or `event.origin` on
`postMessage`, so origin-spoofing is validated by direct unit test of
`installPrivatePortBootstrap` with simulated event properties, not by live
browser proof. This distinction is documented honestly in the test suite.

## First-run warning and acknowledgement persistence (issue 037)

Before any user-triggered compile+Run proceeds for a project identity that has
not been previously acknowledged, a blocking modal warns that this application
is intended primarily for running the user's own local code, provides
defence-in-depth protections against accidental or opportunistic desktop
privilege access, but does not provide a complete sandbox against deliberately
malicious code.  The user must explicitly confirm before the first compilation
begins.  Cancel or Escape dismisses the modal without side effects.

### Storage ownership and isolation

Acknowledgements are persisted in a JSON file
(`first-run-acknowledgements.json`) in Tauri's app-data directory
(`AppHandle::path().app_data_dir()`).  This directory is owned by the trusted
desktop process and is inaccessible to the opaque preview iframe, which has no
Tauri IPC transport, no filesystem access, and no `localStorage` (opaque
origin).  Writes use atomic rename (`write` to `.tmp`, then `rename`) so a
crash mid-write never corrupts the store.

### Schema

```json
{
  "schemaVersion": 1,
  "acknowledged": {
    "<identity>": { "acknowledgedAt": "2026-08-28T19:30:00Z" }
  }
}
```

Identity strings are bounded to 256 bytes of printable alphanumeric plus
hyphen/underscore.  The entry limit is 1024.

### Identity and invalidation

The built-in scratch project uses the fixed identity `"builtin-scratch-v1"`.
An opened folder project uses `folder-sha256-<digest>`, where the digest is
SHA-256 over the shell-canonicalized project root (with Windows separators and
drive-path casing normalized). The raw project path is never written to the
acknowledgement store. Identity is not keyed on mutable source content, so
editing code does not reprompt; opening a different folder does. Clearing or
deleting the store file also causes the warning to reappear.

### Proof namespace isolation

When proof mode is active (`MONOGAME_ISSUE037_PROOF=1`), all acknowledgement
commands operate on a separate proof-namespace file
(`first-run-acknowledgements-proof.json`) so ordinary user acknowledgements
are never read, modified, or destroyed by proof runs.

### Proof bypass

The packaged proof auto-run calls `compileLoadStartIssue23` directly,
bypassing `gateFirstRun`.  The `gateFirstRun` export has no bypass parameter;
every call through it always queries the native store.  Proof-only Tauri
commands (`issue037_clear_store`, `issue037_read_store_snapshot`,
`issue037_proof_phase`, `issue037_emit_checkpoint`) are gated by the
`MONOGAME_ISSUE037_PROOF=1` environment variable, which is set only by the
proof orchestrator and cannot be forged by preview iframe code (no IPC
transport).  The multi-process proof orchestrates two sequential app-bundle
launches via the existing LaunchServices relay, proving persistence across
genuinely separate OS processes.

### Limitations

The acknowledgement is advisory: it does not enforce OS-level isolation.
A user who has acknowledged the warning may still run code that attempts to
access desktop privileges; the defence-in-depth layers (sandbox, CSP, shell
hooks, IPC boundary) are the actual mitigation. The warning is not a consent
gate for data collection or telemetry — no data leaves the device. Standalone
scratch-file opens currently retain the built-in scratch identity; folder
projects receive distinct identities.

### Commands

Eight Tauri commands are added to the `main` capability:

| Command | Purpose | Proof-only |
|---|---|---|
| `issue037_check_acknowledgement` | Check if an identity is acknowledged | No |
| `issue037_write_acknowledgement` | Persist acknowledgement for an identity | No |
| `issue037_is_proof_enabled` | Check proof env gate | No |
| `issue037_emit_report` | Emit packaged proof report | Yes |
| `issue037_read_store_snapshot` | Read store contents (bounded, no paths) | Yes |
| `issue037_clear_store` | Clear store for test isolation | Yes |
| `issue037_proof_phase` | Return current multi-process proof phase | Yes |
| `issue037_emit_checkpoint` | Emit proof phase checkpoint line | Yes |

All eight are registered in `generate_handler!`, `APP_COMMANDS`, `main.toml`,
and `ISSUE034_APPROVED_COMMANDS`.  They are inaccessible from the opaque
preview under the existing ACL/invoke-key boundary.

## Issue 038: isolated preview WebviewWindow (force-stop)

### Architecture

When a preview runs user-compiled WASM code that may contain a deliberately
or accidentally infinite synchronous loop (`while(true){}`), the in-page
iframe architecture cannot force-stop it because:

1. On macOS/WKWebView, iframes share the parent window's WebContent process.
   A blocking WASM/JS loop blocks the shared JS thread, making the entire
   main-window UI unresponsive (DOM frozen, event handlers undeliverable).
2. `evaluate_script` on a hung WKWebView is queued but never executes.
3. DOM removal of the iframe requires JS cooperation (which is blocked).
4. The only recovery is destroying the entire WKWebView (and with it the editor).

Issue 038 solves this by hosting the preview in a **separate Tauri
WebviewWindow** (`preview-isolated-{generation}`). On macOS this maps to a
separate WKWebView with its own WebContent process; on Windows to a separate
WebView2 renderer process.

- **Rust → Preview**: `WebviewWindow::eval()` injects calls to
  `window.__bridge038Receive(jsonString)`.
- **Preview → Rust**: `fetch("playground-preview://localhost/_bridge/send",
  {method:"POST", body})` handled in the custom protocol handler.
- **Binary transfer**: Compiled DLL/PDB binaries are stored in Rust-side
  memory (`ISSUE038_BRIDGE.transfers`); the preview fetches them via
  `playground-preview://localhost/_transfer/{token}/assembly.dll` and
  `playground-preview://localhost/_transfer/{token}/symbols.pdb`.
- **Force-stop**: `WebviewWindow::destroy()` from Rust — non-blocking, reliable
  even when the preview's JS is hung.

### Security of the isolated window

| Property | Guarantee |
|---|---|
| Tauri capabilities | None — label `preview-isolated-*` never appears in any capability's `windows` array |
| `__TAURI_INTERNALS__` | Stripping attempted by `_bridge-setup.js`; Tauri may reinject. ACL is primary boundary (loaded before `preview.js`) using `delete` + `Object.defineProperty(configurable:false)` |
| CSP | Same as iframe preview: `script-src playground-preview: 'wasm-unsafe-eval'` only |
| Navigation | Same `on_navigation` filter as main window: only `tauri:`, `playground-preview:`, `about:` |
| New windows | Denied via `on_new_window` |
| Asset access | Same `playground-preview:` protocol (embedded assets only) |
| Bridge authentication | Generation token (UUID-based) scoped to each preview lifecycle |

### Platform guarantees and limitations

**macOS (WKWebView):**
- Each WebviewWindow gets its own WebContent process (Apple may consolidate
  under extreme memory pressure with 8+ WebViews, but two is reliable).
- `WKWebView.removeFromSuperview()` + ARC deallocation triggers WebKit to
  terminate the WebContent process.
- Main thread (UIProcess/Tao event loop) remains fully responsive during a
  WebContent process hang.

**Windows (WebView2):**
- Each WebviewWindow gets a separate renderer process when using separate
  `ICoreWebView2Environment` instances.
- `ICoreWebView2Controller::Close()` usually terminates the renderer. Known
  edge-case bugs in WebView2 runtime can cause `Close()` to hang (see
  MicrosoftEdge/WebView2Feedback#3140, #4817). Mitigation: bounded timeout
  and fallback OS process kill if `Close()` does not complete.
- Browser process is shared per user data folder but renderer isolation
  remains per-origin.

### Issue 038 commands

| Command | Purpose | Proof-gated |
|---|---|---|
| `issue038_is_proof_enabled` | Check proof env gate | No |
| `issue038_store_transfer` | Store DLL/PDB for protocol transfer | No |
| `issue038_clear_transfer` | Clear consumed transfer entry | No |
| `issue038_create_preview_window` | Create isolated preview WebviewWindow | No |
| `issue038_destroy_preview_window` | Force-destroy preview (works when JS hung) | No |
| `issue038_preview_window_exists` | Check if preview window still exists | No |
| `issue038_relay_to_preview` | Relay bridge message via evaluate_script | No |
| `issue038_collect_bridge_messages` | Collect protocol POST messages from preview | No |
| `issue038_monotonic_nanos` | Native monotonic timestamp (unforgeable) | No |
| `issue038_destroy_all_previews` | Destroy all preview windows on exit | No |
| `issue038_bootstrap_preview` | Inject typed bootstrap data into preview | No |
| `issue038_inject_script` | Inject raw JS into preview (proof-only, 4KB limit) | Yes |
| `issue038_emit_checkpoint` | Emit proof checkpoint line | Yes |
| `issue038_emit_report` | Emit packaged proof report | Yes |
| `issue039_is_proof_enabled` | Check proof env gate | No |
| `issue039_emit_checkpoint` | Emit proof checkpoint line (4KB limit) | Yes |
| `issue039_emit_report` | Emit packaged proof report and exit | Yes |
| `issue040_is_proof_enabled` | Check proof env gate | No |
| `issue040_emit_checkpoint` | Emit proof checkpoint line (4KB limit) | Yes |
| `issue040_emit_report` | Emit packaged proof report and exit | Yes |
| `issue040_dispatch_preview_input` | Deliver one trusted Space/Escape/click AppKit event to an active isolated preview window | Yes |

All twenty-one are registered in `generate_handler!`, `APP_COMMANDS`, `main.toml`,
and `ISSUE034_APPROVED_COMMANDS`.  They are accessible only from the trusted
`main` window and inaccessible from the isolated preview.

`issue040_dispatch_preview_input` is the only command that synthesises input.
It refuses to run unless `MONOGAME_ISSUE040_PROOF=1` is set, only accepts the
five fixed gestures the audio proof needs (`click`, `space-down`, `space-up`,
`escape-down`, `escape-up`), and only addresses a window whose label carries the
isolated-preview prefix for a generation that is still active. The event is
handed to that window's AppKit responder chain, so WebKit routes it through its
normal trusted-input path; nothing fabricates DOM events or bypasses the
autoplay policy.

## Content asset validation (issues 039 and 040)

Asset `.xnb` files sent via `asset.mount.request` are validated before
mounting to the virtual filesystem:

1. **XNB header validation**: Magic bytes (`XNB`), platform marker (`b` for
   Web), format version (4 or 5), compression flags (must be 0), declared
   size consistency, and reader metadata integrity.

2. **Platform enforcement**: Non-Web platform markers are rejected with
   `PG0010_CONTENT_PLATFORM_MISMATCH`, explicitly instructing the user to
   rebuild with `MonoGamePlatform=Web`. The diagnostic is issued before any
   game construction or runtime start.

3. **Content type restriction**: Only `Texture2DReader` and `SoundEffectReader`
   content is accepted in the initial subset (PRD section 15). Unsupported
   reader types are rejected with `PG0206_CONTENT_UNSUPPORTED_TYPE`.
   `SoundEffect` payloads must additionally be uncompressed PCM
   (`wFormatTag` 1) with the pinned 18-byte WAVEFORMATEX header, 1–2 channels,
   8 or 16 bits per sample, 8,000–48,000 Hz, matching block alignment and
   average bytes per second, block-aligned data of at most 8 MiB, in-range loop
   points, a duration consistent with the sample count, and no trailing bytes.
   Anything else fails closed with `PG0206_CONTENT_UNSUPPORTED_TYPE` or
   `PG0205_CONTENT_MALFORMED_READERS` before the game is started.

4. **Path normalization**: Asset paths follow Protocol.md section 8 rules
   (no absolute paths, traversal, backslashes, NUL/percent/controls). Paths
   are written to the MEMFS virtual filesystem under the configured
   `Content.RootDirectory`.

5. **Isolation guarantees**: Mounted content is not accessible from the host
   filesystem. All paths are confined to the virtual filesystem. Content is
   cleaned on preview retirement.

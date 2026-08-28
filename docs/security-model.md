# Preview security model

## Version 1 (issues 033–034)

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
the issue 009–034 proof enable/checkpoint/report commands,
`prepare_packaged_proof_window`, and the issue-034 marker commands. No
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
generated files. The effective 47-file ACL scope is exactly one capability,
one composite `main-commands` permission, and 45 Tauri-generated per-command
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
`__TAURI_INVOKE_KEY__`. All 45 registered commands receive missing-key,
deliberately-wrong-key, and replayed-wrong-key variants (180 native messages,
135 logical probes).

Missing-key strings produce Tauri's concrete native parser diagnostic
`JSON error: missing field` naming `__TAURI_INVOKE_KEY__`; exactly 45 are
observed.
Wrong and replayed keys are silently dropped at invoke-key authentication:
no success/error callback runs during the bounded ten-second observation, all
270 callback IDs are then removed, the window dimensions and marker counter
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
of plugin scripts. Issue 034 does not claim arbitrary-code OS isolation or
network/navigation denial; those remain issues 035–038.

## Limits and follow-up

Sandbox, CSP, API analyzers, opaque origin, and private ports are
defense-in-depth product boundaries, not a complete security sandbox for arbitrary
hostile code. They do not by themselves provide process, OS, CPU, or memory
isolation. Issues 035–038 add process boundary, protocol hardening, network
denial, resource limits, and adversarial validation. No claim here supersedes
those remaining controls.

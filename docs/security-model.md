# Preview security model

## Version 1 (issue 033)

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

## Limits and follow-up

Sandbox, CSP, API analyzers, opaque origin, and private ports are
defense-in-depth product boundaries, not a security sandbox for arbitrary
hostile code. They do not by themselves provide process, OS, CPU, or memory
isolation. Issues 034–038 add process boundary, protocol hardening, network
denial, resource limits, and adversarial validation. No claim here supersedes
those remaining controls.

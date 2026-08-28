# Supported API policy

**Policy version:** 1.0.0

**Protocol version:** 1

**Reference manifest:** [`reference-allowlist.json`](reference-allowlist.json),
schema version 1

**MonoGame source revision:**
`ecf06ee240dcc5524e82b656b4682e22b4c91175`

This policy defines the API boundary supported by the MonoGame Playground
compiler and preview. The manifest is authoritative for files and SHA-256
digests; the assembly identity table below must change whenever that manifest
changes.

## Allowed assembly identities

Only the following exact metadata references are supplied to user compilation.
An identity is the simple name, assembly version, and public-key token (`none`
means an unsigned assembly). A listed assembly does not make every API useful
or supported in the browser.

| Assembly | Version | Public-key token |
| --- | --- | --- |
| `System.Runtime` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `System.Console` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `System.Collections` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `System.Linq` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `System.Numerics` | `4.0.0.0` | `b77a5c561934e089` |
| `System.Numerics.Vectors` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `System.Threading` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `System.Threading.Tasks` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `System.Runtime.InteropServices` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `System.Memory` | `9.0.0.0` | `cc7b13ffcd2ddd51` |
| `System.Diagnostics.Debug` | `9.0.0.0` | `b03f5f7f11d50a3a` |
| `netstandard` | `2.1.0.0` | `cc7b13ffcd2ddd51` |
| `MonoGame.Framework` | `3.8.5.1` | none |

The .NET references come from `Microsoft.NETCore.App.Ref` 9.0.19 for
`net9.0`. `MonoGame.Framework` is the Native-profile artifact identified and
hashed by the manifest. The compiler verifies the embedded files against all
manifest identities and hashes before accepting requests.

## Supported surface

User code may use public managed APIs exposed by the exact references above,
subject to the prohibitions below and browser-WASM runtime availability. This
includes the exposed `System`, collections, LINQ, numerics, memory,
threading/task, console/debug, netstandard, and
`Microsoft.Xna.Framework` namespaces. It does **not** mean arbitrary
`System.*` assemblies, desktop-only MonoGame backends, operating-system APIs,
native libraries, JavaScript host bindings, or APIs absent from the allowlist
are supported.

The product does not install NuGet packages or resolve arbitrary assembly
references. APIs that require unavailable browser facilities may still fail at
runtime even when their containing reference is listed.

## Prohibited constructs

| Construct | Diagnostic | Enforcement in policy 1.0.0 |
| --- | --- | --- |
| `DllImportAttribute` on any legal target | `PG0101` | Semantic attribute identity; compilation fails |
| `UnmanagedCallersOnlyAttribute` on any legal target | `PG0102` | Semantic attribute identity; compilation fails |
| Explicit unsafe syntax: `unsafe` modifiers/blocks, ordinary pointer types, `fixed`, or `stackalloc` | `PG0103` | Syntax plus fixed `allowUnsafe: false`; compilation fails |
| Direct namespace, type, member, alias, or static-using reference under `System.Runtime.InteropServices.JavaScript` | `PG0104` | Semantic identity where resolvable, conservative unresolved canonical-name handling; compilation fails |
| `System.Runtime.InteropServices.Marshal` native-memory/delegate operations | `PG0105` | Prohibited; category-specific analyzer enforcement is scheduled for issue 032 |
| Unmanaged indirect calls, including `delegate* unmanaged<...>` declaration or invocation | `PG0106` | Prohibited, but not currently assigned `PG0103`; category-specific analyzer enforcement is deferred to issue 032 |

No usable DLL or PDB is emitted when a policy diagnostic is present. Policy
and Roslyn diagnostics are merged and sorted by canonical logical path, line,
column, severity, and ID. Protocol v1 exposes the start of the offending span
as 1-based UTF-16 line and column; the Roslyn location retains the exact source
span during analysis.

The JavaScript interop implementation assembly is deliberately absent from the
user reference allowlist. `System.Runtime.InteropServices` remains listed for
ordinary managed interop types, but the constructs above are not supported.

## Reflection and dynamic behavior

Reflection over user assemblies and available MonoGame/runtime types is
supported where the browser runtime preserves the requested metadata. The
preview currently sets `PublishTrimmed=false`, so its managed metadata is not
selectively removed by the linker. Future trimming must derive roots and
Release compatibility fixtures from this policy before changing that setting.
This is a compatibility expectation, not a promise that private implementation
details remain stable.

The analyzer recognizes syntax and semantic symbols available during
compilation. It does **not** prove the meaning of strings, interpret reflection,
execute user code, or generally resolve behavior hidden behind `dynamic`.
String-built type names, reflection, generated IL, malformed/unresolved code,
and runtime behavior can therefore exceed static-analysis coverage. The
analyzer must not be described as blocking reflection, string, or dynamic
bypasses.

## Boundary and isolation

The allowlist and analyzer are a supported-product boundary and
defense-in-depth. They are **not a security sandbox** and are not sufficient
for safely running deliberately malicious code. They complement, but do not
replace, the PRD's mandatory isolation model: an untrusted compiler/preview
context, opaque or distinct origin, no trusted shell/filesystem/process IPC,
restrictive CSP/navigation/network policy, authenticated bounded protocol
messages, and process-level containment supplied by the desktop WebView/OS.
Until those isolation requirements are implemented and verified, policy
diagnostics alone must not be treated as a hostile-code boundary.

## Compatibility and versioning

- Policy changes use semantic versions. Removing an allowed assembly/API or
  newly rejecting source is a breaking policy change.
- Adding a reference or diagnostic is an additive policy change only when it
  does not alter existing source behavior.
- Assembly versions, tokens, reference-pack version, MonoGame revision, and
  hashes remain pinned by `reference-allowlist.json`; drift is a build error.
- Diagnostic IDs are stable once published. Messages may become clearer, but
  tooling should key on the ID and source location.
- Aliases, `global::` qualification, attribute suffix omission, and static
  imports do not change semantic policy identity. User-defined lookalike
  symbols are not prohibited merely because their names resemble framework
  symbols.

## Known enforcement limits

Roslyn's own diagnostics may accompany policy diagnostics, especially for
unsafe or unavailable-reference syntax. Incomplete source is analyzed without
throwing, but unresolved names cannot always have a trusted semantic identity.
The `PG0104` fallback is limited to the exact canonical JavaScript-interop
namespace and aliases declared from it; it is not general string matching.
Marshal and unmanaged function-pointer analysis, including emission of
`PG0105` and `PG0106`, remain the explicit issue-032 work described above.

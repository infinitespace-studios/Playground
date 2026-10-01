# Curated managed dependency-pack policy

**Policy version:** 1.0.0

**Status:** Policy defined; no user-selectable managed dependency pack is approved for shipping.

**Applies to:** Product project manifests and compile/preview builds.
**Related contracts:** [`reference-allowlist.json`](reference-allowlist.json), [`supported-api-policy.md`](supported-api-policy.md), [`toolchain-manifest.json`](toolchain-manifest.json), [`Protocol.md`](../src/shared/Protocol.md), and [`release-support-matrix.md`](release-support-matrix.md).

## 1. Purpose and current boundary

Managed dependency packs are a curated, offline way to make selected managed libraries available to user projects. They are not a package manager, a general NuGet restore feature, or a way to add runtime capabilities to the desktop application. Arbitrary NuGet package installation and arbitrary assembly references remain unsupported, as required by the PRD.

The current application has no approved project dependency packs. The compiler's 13 physical metadata references are pinned in `docs/reference-allowlist.json`; its Roslyn NuGet dependencies are application build dependencies, not libraries selectable by a user's project. The preview is published with the pinned MonoGame Native framework and browser runtime. User code is currently compiled against the compiler's fixed metadata references and loaded as one DLL/PDB pair. There is no project dependency-pack manifest field, arbitrary runtime assembly resolver, or protocol route for shipping user-selected package binaries. Nothing in this policy alone enables those features.

The preview is also deliberately a constrained browser runtime, not a general CLR on a desktop. Any pack must be demonstrated on the pinned browser-WASM/.NET interpreter and MonoGame runtime before it can be approved. A library that compiles for desktop .NET is not thereby compatible with this product.

## 2. Terminology and approval levels

- **Package:** One exact NuGet package ID and version, identified by the exact `.nupkg` bytes and their SHA-256 digest.
- **Pack:** A product-owned, named, versioned selection of one or more exact packages and their complete transitive dependency closure, together with the selected compile-reference and runtime-implementation files.
- **Compile reference:** A metadata-only assembly used by Roslyn to compile the user's project. It does not prove that a corresponding implementation is present in the preview.
- **Runtime implementation:** The exact managed assembly that the browser-WASM preview resolves when user code uses a package API.
- **Candidate:** A package used by a feasibility experiment. Candidate status confers no product or manifest approval.
- **Approved pack:** An immutable catalog entry that passed the policy review and the evidence gates in section 10, and is present in the product's pinned catalog.

Only product maintainers may curate or publish pack definitions. Projects select a product pack ID and exact product pack version; they do not supply package IDs, versions, feed URLs, hashes, DLL paths, or restore settings.

## 3. Eligibility rules

A package and its entire transitive closure are eligible only when all of the following hold:

1. **Browser compatibility:** The package's selected managed implementation runs on the exact pinned `net9.0` `browser-wasm` target, the product's .NET 9 interpreter configuration, and the shipped MonoGame runtime. Compatibility must be demonstrated by a packaged or equivalently pinned preview test, not inferred from NuGet framework labels alone.
2. **Managed-only by default:** Every selected implementation is ordinary managed IL. No native DLL, `.so`, `.dylib`, native WebAssembly module, native NuGet runtime asset, COM server, or platform-specific runtime component may be introduced. A native or JavaScript-interoperating component is ineligible unless a separate product decision and independently verified browser-WASM integration explicitly approve that capability; it is not an exception that can be granted by editing a pack entry.
3. **No prohibited interop:** The package closure must not depend on P/Invoke, `DllImport`, `UnmanagedCallersOnly`, unmanaged function pointers, direct JavaScript interop, framework `Marshal` functionality, or other constructs rejected by `supported-api-policy.md`. Managed APIs which merely contain interop metadata do not become acceptable because their calls are believed to be dormant.
4. **Finite, closed dependency graph:** All direct and transitive packages resolve to exact, reviewed versions. Floating versions, ranges, wildcards, prereleases, unpinned Git dependencies, runtime discovery of additional packages, and unbounded or optional dependency graphs are not allowed. Every graph edge and every selected asset is recorded.
5. **Compatible identities:** The package's compile references and runtime implementations have compatible assembly identities. A pack must not silently replace or shadow an existing framework, MonoGame, or other approved pack identity. Selecting packs with conflicting assembly identities or incompatible versions fails before compilation; there is no “highest version wins” rule.
6. **No executable restore/build hooks:** Package-provided MSBuild targets, tasks, analyzers, source generators, install scripts, native build steps, or other package code are not executed as part of restoring or staging a pack. Any exception requires an explicit separate review and verified build-time threat analysis; package presence is not consent to execute its hooks.
7. **Reviewable contents:** Every package archive and selected asset can be hashed, inspected, and attributed to a source, repository, license, and version. Unreviewable, opaque, or license-incompatible dependencies are excluded.
8. **Size-bounded:** Closure and staged files obey the hard limits in section 7, and each supported release artifact continues to pass the release package-size gate.

These are cumulative gates. A package failing any one gate is rejected, even if its top-level assembly is itself small or pure managed.

## 4. Catalog and identity model

The shipping catalog is closed and product-owned. A catalog entry must define, at minimum:

- A stable lowercase product `packId` matching `[a-z0-9][a-z0-9-]{0,63}`.
- An immutable semantic `packVersion` (three numeric components; no range or floating version).
- A short display name and a concise purpose statement.
- The supported target framework/runtime contract and the pinned product/compiler/runtime compatibility identity.
- Every root and transitive NuGet package ID, exact NuGet version, package source, repository/source revision where available, exact `.nupkg` SHA-256, and declared license identifier plus the evidence used to establish it.
- The full dependency graph and the selected compile-reference and runtime-implementation assets, each with a canonical package-relative path, assembly identity where applicable, and SHA-256.
- Any excluded assets and why they are excluded; in particular, native/RID-specific assets and package-provided build tools must not disappear from review without explanation.
- The approved supported API-policy version and review record, package-size contribution, and test evidence.

Package source is a controlled build-time acquisition input, not a runtime capability. The reviewed `.nupkg` bytes and lock data are the inputs to builds; package ID/version or a feed response alone is not sufficient provenance. Builds must verify archive and selected-file digests before use. Package metadata is untrusted input and is parsed with bounded archive/path handling; archive traversal, duplicate normalized paths, links, malformed archives, and digest/identity mismatch fail closed.

A product pack version freezes the complete transitive closure and selected assets. Updating any package version, package bytes, asset selection, or dependency edge creates a new immutable pack version and repeats the review. Published entries are never edited in place. A security removal may revoke an entry, but it must fail closed for affected projects with a clear diagnostic rather than silently substituting another version.

The initial approved catalog is **empty**. In particular, the feasibility candidate named in section 11 is not an approved catalog entry.

## 5. Compile-reference/runtime split

Compile-time and run-time inventories are separate, explicit lists; neither is derived by blindly adding every DLL in a `.nupkg` to both stages.

### Compile references

- Select the package's metadata/reference assembly from its compatible `ref/<tfm>/` group when present.
- If a reference assembly is absent, a runtime assembly may be used for compilation only when its identity and public API are verified and the catalog explicitly records that choice.
- Compiler references are materialized only from verified pack assets. They become part of an immutable compiler reference set alongside the base `reference-allowlist.json` set.
- Build failure, an unavailable pack, an identity collision, or a missing/corrupt compile-reference asset must not fall back to an ambient SDK, host path, feed, or developer machine.

### Runtime implementations

- The catalog separately identifies the exact managed implementation for each compile-time assembly identity. Compile success must never imply runtime availability.
- Implementations must be staged from trusted, hash-verified product inputs into the fresh preview's bounded runtime dependency set. They must not be resolved from project directories, arbitrary local DLL paths, current working directories, or user-controlled URLs.
- No package or implementation is fetched at preview start. No package archive is transferred in a protocol message, and no protocol binary field is reinterpreted as an arbitrary dependency bundle.
- The current preview loads a single user DLL/PDB using `Assembly.Load` and has no general pack resolver. Therefore a pack is not runtime-usable until a later implementation proves deterministic resolution and staging for the full selected closure in a fresh preview, without changing the current trust boundary by implication.

An approved selection must include exactly the implementations required by the approved compile references. Missing implementations, assembly-name/version conflicts, and unresolved dependencies are deterministic errors before the game starts. No ambient probing, dependency download, or silent framework substitution is permitted.

## 6. Project manifest and compatibility behavior

The current `playground.json` schema is version 1 and contains `name`, `schemaVersion`, and `contentProfile`; its parser reconstructs that known shape and ignores unknown fields. Dependency selection must **not** be added to a schema-1 manifest: a schema-1 open/save cycle could discard an unrecognized field. A future implementation must introduce and document a new manifest schema version before persisting selections.

The proposed representation for that future schema is an optional `dependencyPacks` array containing product pack IDs and exact product pack versions only, for example:

```json
{
  "name": "My Game",
  "schemaVersion": 2,
  "contentProfile": "Web",
  "dependencyPacks": [
    { "id": "approved-product-pack", "version": "1.0.0" }
  ]
}
```

This is a format proposal, not a currently accepted manifest or an assertion that the example pack exists. The project must not name arbitrary NuGet packages in this field. An absent field or empty array means no additional packs; the base references remain unchanged. Entries must be unique, sorted deterministically for serialization, and resolve to exact catalog versions.

Future parser and UI behavior must be:

- **Supported old schema:** Migrate explicitly and atomically. A schema-1 project selects no packs; the application must not infer dependencies from source `using` directives.
- **Unknown pack ID, unavailable/revoked pack, or unsupported pack version:** Keep the project source available for inspection/editing, block compilation/Run with a stable, actionable diagnostic naming the product pack identity, and never fetch, guess, upgrade, or silently omit it. Saving unrelated source changes must preserve the declared dependency selection.
- **Newer project schema:** Reject opening for mutation with the existing fail-safe behavior; do not rewrite or downgrade the manifest. The user may use a compatible newer application.
- **Malformed, duplicate, or conflicting selection:** Reject the manifest/project operation before compilation. Do not partially apply a selection.
- **No network:** Missing local catalog assets or cache data are an offline build/runtime error. There is no online recovery path.

Changing this proposal or the project schema requires updating the owning manifest contract and its migration tests in the implementation issue. Until then, schema version 1 remains the only supported schema and has no dependency-pack field.

## 7. Transitive closure, deterministic staging, and budgets

Every approved pack's graph is resolved at curation time and frozen. The resolver must use a committed lock/catalog record, not rerun “latest compatible” resolution on developer or user machines. Runtime builds select only the catalogued asset group for the pinned target. Restore order, asset selection, package IDs, and emitted reference/implementation inventories are deterministic.

Hard per-pack ceilings for the first implementation are:

- At most **16 NuGet packages** in the complete closure, including the root.
- At most **32 managed runtime implementation assemblies**.
- At most **16 MiB** aggregate uncompressed runtime-implementation bytes.
- At most **5 MiB** incremental compressed product-package contribution per pack, including its compiler reference and preview runtime assets.
- At most **32 MiB** aggregate uncompressed implementation bytes across the project-selected packs.

All byte additions must be overflow-safe. Exceeding any limit rejects the pack/selection rather than truncating it or deferring the error to runtime. These are policy ceilings, not size targets: the actual Release packages must still pass the existing per-artifact 100 MiB gate. The 50 MiB goal remains a stretch goal, and no pack waives either measurement.

Staging and cache rules:

- Cache keys include the pack ID/version, catalog/policy schema versions, target framework and browser-WASM runtime identity, pinned SDK/Roslyn/runtime identity, every package ID/version/hash, full dependency graph, and every selected asset path/hash. A partial key based only on a package ID or version is invalid.
- Cache entries are immutable after verification, content-addressed, and contain no host absolute paths in project metadata. A cache hit is re-hashed/identity-checked before consumption; corrupt or stale entries are removed or quarantined and rebuilt only from locally available verified package inputs.
- Writes are staged privately and atomically published only after the entire closure validates. Failure leaves no partly visible compiler reference set or preview dependency set.
- The cache is an optimization, not a source of authority. Removing the cache must not change selected versions or build output, and a clean offline build from the packaged/repository-pinned inputs must produce the same effective inventory.
- Cache eviction may remove derived cache entries but must not delete or rewrite project source/manifests. No filesystem path from a manifest is used as a DLL load path.

## 8. API, IL, and security review

The base compiler reference allowlist and [`supported-api-policy.md`](supported-api-policy.md) remain authoritative. Approval of a pack is an explicit widening of the APIs available to user code and needs a policy review; it is not an implicit policy exception. Review the full public surface and transitive identities, decide which namespaces/types/members become usable, account for reflection metadata and trimming, and update policy versioning/diagnostics where required before shipping. A package that is merely present in a compiler reference may still be unsupported by the browser runtime.

Before approval, inspect every selected managed implementation (root and transitive) with a deterministic metadata/IL analysis pass for at least:

- Assembly references and type/member signatures, including unresolved or unexpected dependencies.
- P/Invoke/`ImplMap`, native entry points, unmanaged exports, and native method implementations.
- References to `System.Runtime.InteropServices.JavaScript`, framework `Marshal`, `DllImport`, `UnmanagedCallersOnly`, unmanaged function pointers, and other current policy-prohibited forms.
- Native/RID-specific package assets, executable package build hooks, and hidden or dynamically discovered dependencies.
- Reflection, dynamic loading, generated code, and other behavior that needs manual source/API review or a bounded runtime proof.

The scanner must be fail-closed for malformed metadata and unknown native/interoperability constructs. It is a review aid, not a proof that a library is safe: static IL scanning cannot generally prove behavior hidden behind reflection, strings, dynamic dispatch, or runtime-generated code. The application does not claim a complete hostile-code sandbox; the existing opaque-origin/CSP/protocol boundary and published limitations continue to apply.

All user-generated compile references remain selected by trusted product catalog data. The user may not provide an assembly name/path/URI, file path, package archive, source, feed, resolver callback, or protocol message that can expand the selected closure. The application must not expose filesystem, shell, process, native, or network capabilities to a package or preview.

## 9. Licensing, provenance, release size, and lifecycle

For each package in the entire closure, maintain reviewable provenance including exact archive hash, package/source/repository identity, version, license identifier, the license text or authoritative text reference and its digest, and any required attribution/notice obligations. Review license compatibility for the complete closure, not just the root package. Record SPDX identifiers where authoritative; otherwise record `NOASSERTION` with the reason and do not approve shipping until resolved. License review must not infer “permissive” from package metadata alone.

Pack approval does not satisfy the broader release-notice/SBOM requirements. The pack's complete transitive inventory and notices must appear in the product third-party notices and SBOM required by PRD section 22.5. Signing/notarization, installer verification, and the separate release-hardening work remain out of scope for this policy.

For every release package format and supported platform, measure the incremental and total compressed size using the existing release-size gate. Report the pack contribution and prove each resulting product package remains at or below 100 MiB; do not compare only one small platform or discard a larger supported package. Maintain offline operation: installed builds must not contact a package feed, CDN, or repository to compile, resolve, or run a project.

Catalog lifecycle is explicit:

- **Add:** Review complete closure, API-policy changes, compatibility and evidence; increment catalog/policy version as needed; publish an immutable pack version.
- **Update:** Create a new pack version with a fresh exact lock, hashes, compatibility/security/license review, size result, and tests. Never rewrite a version already used by a project.
- **Deprecate:** Stop offering new selection while preserving existing exact-version resolution for supported app versions when possible. Communicate a migration path; never auto-upgrade projects.
- **Remove/revoke:** For unavailability, legal/security issues, or incompatible runtime, reject use explicitly and preserve the manifest declaration. Do not silently substitute or erase. A revocation may intentionally block Run for security; the diagnostic must explain why and the source/project must remain inspectable.
- **Cache cleanup:** Remove only derived cache data. Never mutate package/project manifests or source during cache cleanup.

## 10. Required reviewer evidence and pass/fail gate

A reviewer approving a pack must inspect its full closure and record all of the following:

1. Exact package IDs/versions, source URLs/repository revisions, `.nupkg` hashes, dependency graph, selected asset paths, and resulting assembly identities/hashes. Independent recomputation must match the catalog.
2. Compile-reference/runtime-implementation mapping for every referenced assembly, with evidence of no identity collisions or undeclared dependency.
3. Browser-WASM compatibility evidence against the pinned SDK, Roslyn, runtime, MonoGame reference/runtime, and Release packaging settings. Include an actual compile and fresh-preview load/run where the candidate exposes runtime functionality.
4. IL scan output and manual API/security review covering native/JS interop, reflection/dynamic behavior, package build hooks, transitive dependencies, and the `supported-api-policy.md` impact.
5. License/provenance evidence for every closure member, including third-party notice/SBOM fields and unresolved legal questions.
6. Deterministic clean/offline rebuild or staging evidence and cache hit/miss/corruption/failure behavior, proving no feed access or arbitrary path loading occurs at Run time.
7. Incremental and total compressed size per supported release package, with the existing 100 MiB release gate result and 50 MiB stretch-goal comparison.
8. Failure-path evidence: unknown/missing/revoked pack and pack version, malformed/duplicate selection, missing local asset, hash/identity mismatch, dependency conflict, unsupported assembly/native asset, and exceeded size limits all fail closed before Run with no partial staging.

**PASS:** every criterion has concrete evidence, no policy exception is implicit, the complete closure is pinned and license-reviewed, and all platform release packages pass the size gate.

**FAIL:** any closure member, identity, source, license, runtime implementation, API impact, size, or failure behavior is unknown or over limit; there is arbitrary restore/path access; or any test requires runtime network access. A failed candidate remains unapproved.

## 11. Representative feasibility candidate for issue 076

Use **`Newtonsoft.Json` 13.0.3** as the representative candidate for the next managed-dependency feasibility exercise. The exact NuGet package ID and version are fixed for that experiment; issue 076 must obtain and record the exact package bytes/hash, provenance, license evidence, and full resolved closure for its pinned test environment rather than trusting a version string.

This is a **candidate only**, not an approved pack, not an entry in the shipping catalog, and not permission to add it to the compiler references, product package, project manifest, or runtime. The experiment must establish whether this package's selected reference and implementation assets are usable on the product's pinned browser-WASM/.NET interpreter and whether deterministic preview dependency resolution can be demonstrated. It must evaluate the same API, IL, licensing, closure, offline/cache, and size gates above. A successful spike is evidence for a later approval/review step, not automatic shipping authorization; failure leaves the shipping catalog empty.

## 12. Trace against the current implementation

This is a policy document only. The following existing boundaries inform it; implementation work must verify them again when building the later pack features:

| Area | Current implementation/evidence | Consequence for packs |
| --- | --- | --- |
| Compiler references | `docs/reference-allowlist.json` pins 13 assembly identities and hashes; `scripts/collect-compiler-references.py` verifies the committed `src/compiler/References/` inputs; `src/compiler/Playground.Compiler.csproj` embeds those DLLs and the manifest. | A project pack cannot flow into Roslyn through arbitrary paths or ambient SDK references. Future compile references need verified catalog assets and a deterministic effective inventory. |
| API/security policy | `docs/supported-api-policy.md` version 2.0.0 and `src/compiler/PolicyAnalyzer.cs` define the base API boundary and prohibited interop constructs. `docs/security-model.md` describes the opaque-origin/CSP/protocol constraints and limitations. | Package assemblies widen reachable APIs and require review; the analyzer and iframe boundary are not a complete malicious-code sandbox. |
| Preview staging/loading | `src/preview/Playground.Preview.csproj` pins Release browser-WASM settings and links the verified MonoGame native artifacts. `src/preview/PreviewExports.Lifecycle.cs` validates and loads one user assembly/PDB pair with `Assembly.Load`; `src/preview/wwwroot/preview.js` verifies binary proof and serializes mount/load before start. | There is not yet a pack runtime resolver. Never claim a package runs just because Roslyn can reference it. Additions must be staged and resolved in a fresh preview before start, with bounded immutable identities and transactional failure behavior. |
| Project manifest | `src/frontend/src/project-manager.ts` defines schema 1 (`name`, `schemaVersion`, `contentProfile`), ignores unknown fields when reconstructing its normalized manifest, and rejects newer schemas before mutation. | Do not persist pack selection in schema 1. Introduce a schema migration and preserving parser behavior before projects can select packs. |
| Release size | `scripts/measure-release-size.mjs` enforces the 100 MiB limit per distributed product package and checks all recognized artifacts; `docs/release-support-matrix.md` documents the package-matrix gate. | Measure the added pack on each shipping platform/package; a small platform result cannot hide an oversized package elsewhere. |
| Legal/release obligations | PRD sections 18 and 22.5 require offline operation, third-party notices and an SBOM; `docs/release-support-matrix.md` records the remaining release-hardening work. | Record license and SBOM data at curation time, preserve offline behavior, and do not treat this policy as completion of that separate work. |

No source code, compiler allowlist, preview runtime, package, lockfile, or UI is changed by this policy. Those changes require their own scoped implementation and verification.

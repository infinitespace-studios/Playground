# Define the curated managed dependency-pack policy

**Type:** AFK
**Status:** Ready
**Blocked by:** [019-build-runtime-reference-assembly-allowlist.md](019-build-runtime-reference-assembly-allowlist.md), [031-publish-supported-api-policy-and-analyzers.md](031-publish-supported-api-policy-and-analyzers.md), [043-measure-release-package-size-api-survival.md](043-measure-release-package-size-api-survival.md)
**Feature area:** Dependencies
**Triage:** feature-backlog policy

## Context

The product currently resolves no arbitrary NuGet packages: compiler references are byte-pinned and the preview has only the implementation assemblies staged at build time. The desired feature is fast use of pre-approved libraries, not unrestricted restore. Pure managed IL often need not be compiled to native WASM, but compile-time references, runtime implementations, transitive closure, compatibility, licensing, and cache identity must all be defined.

## Scope

### In scope

- Write `docs/dependency-packs.md` defining a closed catalog of build-time curated packs.
- Define eligibility: browser-WASM compatible, pure managed unless separately proven, no prohibited native/JS interop, bounded transitive closure, pinned package/version/hash/license/source.
- Define separate compile-reference and runtime-implementation inventories, deterministic pack id/version, offline staging/cache, API-policy review, IL scanning, package-size budget, SBOM/notices obligations, and removal/update rules.
- Define project-manifest representation and behavior for unknown/missing/newer packs.
- Define reviewer evidence and threat model; explicitly prohibit runtime network restore and arbitrary DLL paths.
- Select `Newtonsoft.Json 13.0.3` as the representative feasibility candidate for issue 076, not as an approved shipping pack.

### Out of scope

- Downloading or shipping a package, changing the allowlist, runtime loading, or UI.

## Acceptance criteria

- [ ] Policy covers provenance, hashes, transitive closure, runtime/reference split, compatibility, security, licensing, size, cache, versioning, and failure behavior.
- [ ] Arbitrary NuGet restore remains explicitly unsupported.
- [ ] The next spike has unambiguous inputs and pass/fail evidence.

## Verification

The reviewer traces the proposed model against current compiler reference collection, preview staging/loading, manifest parser, security policy, package-size gate, and release legal requirements. Record omissions or approve with explicit rationale.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent policy review PASS.

Suggested commit subject: `docs: define curated managed dependency packs`

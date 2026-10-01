# Define the curated managed dependency-pack policy

**Type:** AFK
**Status:** Done
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

- [x] Policy covers provenance, hashes, transitive closure, runtime/reference split, compatibility, security, licensing, size, cache, versioning, and failure behavior.
- [x] Arbitrary NuGet restore remains explicitly unsupported.
- [x] The next spike has unambiguous inputs and pass/fail evidence.

## Verification

The reviewer traces the proposed model against current compiler reference collection, preview staging/loading, manifest parser, security policy, package-size gate, and release legal requirements. Record omissions or approve with explicit rationale.

## Verification record

- **Verdict:** PASS
- **Verifier:** GitHub Copilot (`gpt-6-luna`), pi session `01a0f6c4-cc22-73df-b5c0-4844d99c6bb0` (independent verifier)
- **Date:** 2026-10-01 (UTC)
- **Inspected files:** `docs/dependency-packs.md`; `docs/reference-allowlist.json`; `scripts/collect-compiler-references.py`; `src/compiler/Playground.Compiler.csproj`; `docs/supported-api-policy.md`; `src/compiler/PolicyAnalyzer.cs`; `docs/security-model.md`; `src/preview/Playground.Preview.csproj`; `src/preview/PreviewExports.Lifecycle.cs`; `src/preview/wwwroot/preview.js`; `src/frontend/src/project-manager.ts`; `scripts/measure-release-size.mjs`; `docs/release-support-matrix.md`; `PRD-MonoGame-Desktop-Playground_Version2.md`.
- **Evidence:** PASS on all three acceptance criteria. `docs/dependency-packs.md` §§3–10 specifies exact source/version/archive SHA-256 and selected-asset hashes, complete pinned dependency closure, independent compile-reference and runtime-implementation inventories, browser-WASM compatibility and identity checks, fail-closed API/IL/security and licensing review, explicit per-pack/project size ceilings, deterministic content-addressed cache identity/atomic failure behavior, lifecycle/version rules, and concrete reviewer pass/fail evidence. §1 expressly keeps arbitrary NuGet installation and arbitrary assembly references unsupported; §§5 and 8 prohibit runtime fetching and user-supplied DLL paths. §11 fixes the next experiment's input to `Newtonsoft.Json` 13.0.3 while explicitly retaining candidate-only/non-shipping status and requiring issue 076 to record the exact archive hash, provenance, license, and full closure.
  - Trace against the existing compiler: `docs/reference-allowlist.json` is the 13-identity hash-pinned base inventory; `scripts/collect-compiler-references.py` verifies committed asset hashes/identities, and `src/compiler/Playground.Compiler.csproj` embeds the DLLs and manifest. `docs/supported-api-policy.md` v2.0.0 and `src/compiler/PolicyAnalyzer.cs` define/enforce the prohibited API/interop boundary. The policy treats packs as an explicit API widening, not as an allowlist bypass.
  - Trace against preview/loading: `src/preview/Playground.Preview.csproj` targets Release `browser-wasm` and pins MonoGame inputs; `src/preview/PreviewExports.Lifecycle.cs` validates and loads one user DLL/PDB pair using `Assembly.Load`, while `src/preview/wwwroot/preview.js` maintains the mount→configure→load→run lifecycle. The implementation has no general pack resolver, so the policy correctly requires later fresh-preview closure staging/resolution before claiming runtime usability.
  - Trace against manifests and security: `src/frontend/src/project-manager.ts` is schema 1, reconstructs only `name`, `schemaVersion`, and `contentProfile`, and rejects newer schemas before mutation; therefore the policy correctly defers persisted pack selection to a schema migration. `docs/security-model.md` constrains preview `connect-src` to `playground-preview:` in an opaque-origin sandbox, and `docs/supported-api-policy.md` specifies prohibited native/JS interop; the pack rules preserve those boundaries and the PRD offline requirement.
  - Trace against release/legal gates: `scripts/measure-release-size.mjs` sets a 100 MiB hard limit and checks each recognized package independently (50 MiB remains informational stretch goal); `docs/release-support-matrix.md` confirms the per-package matrix gate and that notices/SBOM remain separate release work. PRD §§18 and 22.5 require offline operation, bundled third-party notices/SBOM, and no external runtime URLs; the policy assigns closure-wide provenance/license/notice/SBOM and per-platform size evidence to pack approval.
  - No implementation, allowlist, manifest, preview runtime, package, or UI changes are approved by this policy; the candidate remains unapproved pending the separately scoped feasibility spike.

## Commit gate

Commit only after independent policy review PASS.

Suggested commit subject: `docs: define curated managed dependency packs`

# Build deterministic dependency-pack staging and cache

**Type:** AFK
**Status:** Blocked
**Blocked by:** [076-prove-one-managed-dependency-pack-in-wasm.md](076-prove-one-managed-dependency-pack-in-wasm.md)
**Feature area:** Dependencies
**Triage:** feature-backlog security-sensitive

## Context

The feasibility spike establishes the viable assembly strategy. This slice turns that strategy into a generic, build-time curated catalog and offline cache. Packs are part of the application release, never fetched by user code or the game preview.

## Scope

### In scope

- Define a machine-readable dependency-pack catalog with pack id/version, package provenance/hash/license, full reference/runtime closure, API policy, and size metadata.
- Add deterministic tooling to acquire/verify/stage approved packs at build time and a `--check` mode that fails on drift, missing bytes, extra assemblies, or hash mismatch.
- Stage compiler references and preview runtime assemblies separately according to the issue 076 strategy.
- Cache by immutable pack digest in CI/local builds without trusting cache contents before hash verification.
- Extend project manifest parsing for a bounded list of enabled pack ids and reject unknown/newer/incompatible versions without modifying the project.
- Add one pack only if issue 076 recommends shipping it and the issue verification records explicit product-owner approval; otherwise use a repository-owned fixture pack to prove machinery.

### Out of scope

- UI, arbitrary package search/restore, runtime network, unapproved packages, or IntelliSense integration.

## Acceptance criteria

- [ ] Clean and cached builds produce byte-identical staged pack inventories.
- [ ] Tampered/extra/missing/transitively incomplete packs fail closed.
- [ ] A manifest can enable a known pack and rejects unknown packs safely.
- [ ] PRODUCT includes only explicitly approved catalog entries and passes size/security gates.

## Verification

Run tooling from a clean cache and warm cache, compare hashes, then execute negative tamper/extra/missing/unknown-manifest tests. Build PRODUCT offline, compile/run the pack fixture, inspect staged compiler/preview assets, and run binary/profile/package-size checks.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent security and reproducibility PASS.

Suggested commit subject: `build: add deterministic dependency pack staging`

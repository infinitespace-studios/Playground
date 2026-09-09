# Session handoff: production/proof architecture cleanup

**Last updated:** 2026-09-08
**Next stage:** Stage 7 — final architecture enforcement and cleanup
**Working-tree expectation:** clean

## Read first

1. [`production-proof-cleanup-plan.md`](production-proof-cleanup-plan.md)
2. [`adr/0003-embedded-preview-and-non-yielding-code.md`](adr/0003-embedded-preview-and-non-yielding-code.md)
3. The last completed stage commits listed below

## Completed work

### Stage 1 — compile-time PRODUCT/PROOF split

Commit: `6675761 build: separate product and proof frontend profiles`

- Product entry: `src/frontend/src/entry.product.ts`
- Proof entry: `src/frontend/src/entry.proof.ts`
- Product output: `src/frontend/dist/`
- Proof output: `src/frontend/dist-proof/`
- Product/proof Tauri configurations have different names and identifiers.
- `profile-manifest.json` records the actual Rollup module graph.
- `check-profile-artifacts.mjs` rejects proof modules or markers in PRODUCT.
- Release CI runs the product-profile artifact check.

Accepted evidence:

- PRODUCT graph had 23 modules and zero proof markers after Stage 1.
- PROOF graph had 49 modules and all 18 expected proof markers.
- Native product and proof packages both built successfully.

### Stage 2 — extract the mixed production core

Commit: `f2f4013 refactor: extract product preview lifecycle`

New production/domain modules:

- `src/frontend/src/compiler-context.ts`
- `src/frontend/src/live-preview.ts`
- `src/frontend/src/lifecycle-controller.ts`
- `src/frontend/src/run-stop.ts`
- `src/frontend/src/first-run-warning.ts`

`issue21.ts`, `issue24.ts`, and `issue37.ts` are proof-facing compatibility
modules and are absent from the PRODUCT graph.

Accepted evidence:

- PRODUCT graph: 21 modules, zero proof markers.
- PRODUCT excludes `issue21.ts`, `issue24.ts`, `issue37.ts`,
  `issue24-controller.ts`, `issue23-controller.ts`, and `issue38-bridge.ts`.
- PROOF graph: 53 modules with all 18 expected markers.
- Full packaged proof suite passed:
  038, 024, 025, 023, 033, 033-no-wasm-eval, 034, 035, 036, and 037 phases 1–2.
- Zero orphan processes and clean invoke-key scan.
- A full native PRODUCT package built successfully after the proof package.

### Stage 3 — rename/extract product UI modules

Commit: `0a45457 refactor: name product UI modules by responsibility`

New responsibility-named modules:

- `src/frontend/src/theme-controller.ts`
- `src/frontend/src/monaco-editor.ts`
- `src/frontend/src/problems-panel.ts`
- `src/frontend/src/output-panel.ts`
- `src/frontend/src/dirty-state.ts`
- `src/frontend/src/project-manager.ts`
- `src/frontend/src/preview-panel.ts`
- `src/frontend/src/project-content.ts`

`issue049.ts` and `issue051.ts` are thin proof/test compatibility façades. All
other Stage-3 issue-numbered implementation modules were removed. The artifact
checker generically rejects any issue-numbered source module in the PRODUCT
Rollup graph and requires all eight new domain modules.

Accepted evidence:

- PRODUCT graph: 21 modules, all eight Stage-3 domain modules present, zero
  issue-numbered modules, and zero proof markers.
- PROOF graph: 53 modules with all 18 expected markers.
- TypeScript, 102 protocol tests, 45 focused content/project tests, 56 Rust
  tests, the full frontend build, and profile verification passed.
- Full packaged proof suite passed issues
  038/024/025/023/033/033-no-wasm-eval/034/035/036/037 phases 1–2.
- Zero orphan processes and clean invoke-key scan.
- A full native PRODUCT package built successfully after the proof package.
- Independent review reported no blocking findings.

### Stage 4 — consolidate historical issue proofs

Commit: `ad8b0a8 test: consolidate proof drivers into scenarios`

Delivered:

- Eight scenario modules: compile/run/stop, compiler diagnostics, runtime
  exception mapping, output capture, content workflow, preview security,
  project lifecycle, and performance.
- `entry.proof.ts` dispatches one entrypoint per scenario through
  `scenario-runner.ts`.
- `scripts/prove-scenarios-macos.sh` is the canonical packaged scenario runner.
- `project-lifecycle.test.ts` consolidates identity/open/dirty-state coverage
  and adds Save All and atomic-failure tests.
- Content and shared proof flows use the embedded opaque-origin iframe path.
  `issue38.ts` is now the sole importer of `issue38-bridge.ts`.
- The artifact checker structurally forbids `proof-*` modules in PRODUCT and
  requires exactly the eight expected scenario modules in PROOF.
- The existing issue040 input command gained bounded, exact-generation,
  main-caller-only embedded registration for trusted packaged audio input;
  command and ACL inventories did not change.

Accepted evidence:

- PRODUCT graph: 21 modules, zero issue-numbered modules, zero scenario modules,
  and zero proof markers.
- PROOF graph: 44 modules, exactly eight scenario modules, and all 18 expected
  markers.
- TypeScript, 102 protocol tests, 51 focused content/project tests, 32
  performance tests, Cargo format/check/Clippy, and 58 Rust tests passed.
- The canonical packaged suite passed all eight scenarios and every mapped
  sub-proof, including embedded texture/audio and performance.
- The retained issue038 packaged regression suite passed with zero orphans and
  a clean invoke-key scan.
- Full native PROOF and PRODUCT packages built successfully, with PRODUCT built
  last and passing its artifact check.
- Independent strict review accepted the final implementation with no blocking
  findings.

Detailed mapping and verification matrix:
[`stage4-proof-consolidation.md`](stage4-proof-consolidation.md).

### Stage 5 — retire the isolated-window issue038 harness

Commit: `681be79 refactor: retire isolated preview harness`

Delivered:

- Removed `issue38.ts`, `issue38-bridge.ts`, the issue038 packaged runner,
  isolated documents/assets/protocol routes, Rust bridge/transfer/relay state,
  and the isolated issue040 dispatch branch.
- Removed all fifteen `issue038_*` commands from Tauri handlers, build
  inventories, permissions, and proof command inventories.
- Application commands dropped from 97 to 82; effective ACL entries dropped
  from 99 to 84.
- Preserved durable security claims on the embedded opaque-origin iframe and
  retained exactly eight scenario suites.
- Re-pointed startup/performance measurement and the offline packaged proof to
  the embedded product path.
- Preserved issue 038 and ADR 0002 as unmodified historical evidence. No hostile
  non-yielding program was moved into the product WebView.

Accepted evidence:

- PRODUCT graph: 21 modules, zero issue-numbered/scenario modules, and zero
  proof markers.
- PROOF graph: 42 modules, exactly eight scenarios, issue38 absent, and all 17
  expected markers.
- TypeScript, 102 protocol tests, 51 focused content/project tests, 32
  performance tests, Cargo format/check/Clippy, and 38 Rust tests passed.
- The canonical packaged suite passed all eight scenarios with zero orphans and
  a clean invoke-key scan.
- The process-sandboxed offline embedded texture/audio/input proof passed with
  exactly one clean report and no orphan process.
- The fresh embedded memory baseline passed. A separate 10-run timing
  corroboration had no failed/censored samples or threshold violations;
  embedded preview-start p95 was 239 ms cold and 229 ms warm.
- Native PROOF and PRODUCT packages built successfully, with PRODUCT built last
  and passing its artifact check.
- Independent strict review accepted the final implementation with no blocking
  findings.

Detailed inventory and verification matrix:
[`stage5-issue038-retirement.md`](stage5-issue038-retirement.md).

### Stage 6 — compile proof surfaces out of release binaries

Commit: `19ecadb build: compile proof harness out of product releases`

Delivered:

- Non-default `proof-harness` Cargo feature: PRODUCT compiles eight
  responsibility-named commands; PROOF adds 70 feature-gated commands.
- Four dead issue039 transfer commands and their inert state/routes were
  removed, leaving 78 commands in the proof package.
- PRODUCT and PROOF have separate capability/permission inventories with
  effective ACL counts of 10 and 82 respectively.
- Product commands, Rust state/helpers, frontend callers, types, constants, and
  first-run DOM identifiers were renamed by responsibility.
- Preview and compiler C#/JS proof exports/actions/globals/assets were split into
  proof-only compilation and staging units.
- Compiler/preview staging and PRODUCT → PROOF → PRODUCT verification are fully
  profile-aware; a shared staged tree can no longer pass.
- A cross-platform compiled binary/runtime checker with 11 negative self-tests
  is wired into package scripts and release CI.

Accepted evidence:

- PRODUCT frontend graph: 21 modules, zero proof markers/scenarios. Its
  identity-verified native package exposes exactly eight product commands and
  no proof commands, gates, relay state, C# proof exports, JS proof globals, or
  proof extension assets.
- PROOF frontend graph: 42 modules, exactly eight scenarios, all 17 markers.
  Its identity-verified package exposes all 78 commands and required proof
  runtime assets.
- TypeScript, 104 protocol tests, 51 focused tests, 32 performance tests, Rust
  format/Clippy, and 23 PRODUCT plus 37 PROOF Rust tests passed.
- All four compiler/preview staging-clean tests and the corrected independent
  PRODUCT → PROOF → PRODUCT staging sequence passed.
- The binary checker passed 11 negative tests and both package profiles.
- All eight packaged scenarios, the process-sandboxed offline embedded proof,
  and a fresh embedded startup/memory baseline passed with zero orphans.
- Native PROOF built first and PRODUCT built last; both artifact checks passed.
- `external/MonoGame` remained clean at the pinned commit. Independent strict
  review accepted the implementation with no blocking findings.

Detailed design and verification:
[`stage6-proof-binary-separation.md`](stage6-proof-binary-separation.md).

### Orchestration record

Each completed stage used:

1. Fresh `worker` subagent.
2. Independent read-only `reviewer` subagent.
3. Orchestrator remediation and source/artifact inspection.
4. Full required verification before commit.

The user-level worker/reviewer definitions are expected to select
`github-copilot/claude-opus-4.8` explicitly.

## Current architecture invariants

- ADR 0003 is authoritative: the production preview is the embedded,
  opaque-origin sandboxed iframe. Do not restore the separate visible preview
  window as product UX.
- PRODUCT is the default for normal npm, Tauri, and release builds.
- PROOF must be requested explicitly.
- PRODUCT must contain zero `MONOGAME_ISSUE*_PROOF` frontend markers.
- Compile failure must leave an already-running preview untouched.
- Content assets mount before game start.
- Each successful Run gets a fresh preview runtime.
- Protocol validation, CSP, sandboxing, IPC denial, and lifecycle cleanup must
  not be weakened.

## Next task: Stage 7

Complete final architecture enforcement, responsibility-based source cleanup,
and release acceptance.

Requirements:

- Enforce in CI that PRODUCT frontend, staged compiler/preview assets, native
  binary, ACL manifests, and packages contain no proof modules, markers,
  commands, issue-numbered implementation identifiers, or proof-only assets.
- Ensure production source paths contain no issue-numbered implementation
  files. Keep only clearly documented proof/test compatibility files where the
  explicit proof harness still requires them, or rename/remove them.
- Split oversized Rust, TypeScript, C#, and runtime JavaScript files by domain
  responsibility where necessary for maintainability; do not weaken the build
  or security boundaries established in Stages 1–6.
- Remove stale compatibility façades, comments, identifiers, scripts, and
  documentation that no longer have consumers. Preserve historical issue
  records and superseded ADRs as history.
- Run final PRODUCT smoke, security, offline, package-size, startup, memory,
  protocol, formatting, lint, and clean-clone/build gates across supported
  platforms where available.
- Confirm normal npm/Tauri/release builds remain PRODUCT by default; PROOF must
  remain explicit via `proof-harness` and retain all eight scenarios.
- Update architecture, build, security, content, performance, and contributor
  documentation to describe the final product/proof architecture rather than
  transitional stages.
- Preserve ADR 0003's embedded preview, compile-failure behavior, fresh runtime
  per Run, content-before-start, protocol/CSP/opaque-origin sandbox/IPC denial,
  binary integrity, and lifecycle cleanup.

Before implementation, inventory every remaining issue-numbered source file,
compatibility façade, oversized module, transitional comment/doc, and final CI
acceptance gap. Define the exact final architecture and verification matrix
before deleting or splitting code.

## Resume procedure

1. Run `git status --short --branch`. If the tree is not clean, stop and classify
   the changes before delegating.
2. Confirm commits `6675761`, `f2f4013`, `0a45457`, `ad8b0a8`, `681be79`,
   and `19ecadb` are reachable.
3. Invoke a fresh `worker` agent with the Stage-7 scope above and instruct it not
   to commit.
4. Invoke a separate `reviewer` agent after implementation.
5. Resolve every critical finding and rerun review if necessary.
6. Perform independent source, module-graph, test, and package checks.
7. Update both this handoff and `production-proof-cleanup-plan.md` with the
   accepted stage commit/evidence.
8. Commit only the accepted Stage-7 scope, then leave a clean tree.

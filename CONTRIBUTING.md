# Contributing to MonoGame Playground

This guide describes how the codebase is organised, the PRODUCT/PROOF boundary
you must respect, and the checks to run before proposing a change.

## Golden rules

1. **PRODUCT is the default and must stay clean.** Normal `npm`, Tauri, and
   release builds produce the PRODUCT profile. PRODUCT source paths, the Rollup
   module graph, staged compiler/preview assets, the native binary, and the ACL
   manifests must contain **no** proof modules, `MONOGAME_ISSUE*_PROOF` markers,
   proof commands, issue-numbered implementation identifiers, or proof-only
   assets. The profile and binary checkers enforce this; do not weaken them.
2. **Proof code is explicit and separate.** The proof harness requires both
   `MONOGAME_FRONTEND_PROFILE=proof` and the `proof-harness` Cargo feature. Keep
   exactly **eight** proof scenario modules (`src/frontend/src/proof-*.ts`).
3. **Preserve [ADR 0003](docs/adr/0003-embedded-preview-and-non-yielding-code.md).**
   The production preview is the embedded opaque-origin sandboxed iframe. Do not
   reintroduce a separate visible preview window. A compile failure must not
   replace an already-running preview; each successful Run gets a fresh runtime;
   content mounts before the game starts.
4. **Never weaken the security boundary.** Protocol validation, CSP,
   opaque-origin sandbox, Tauri IPC/capability denial, binary-transfer
   integrity, and lifecycle cleanup are load-bearing. See
   [`docs/security-model.md`](docs/security-model.md).
5. **No issue-numbered implementation filenames or identifiers in product
   source.** History lives in `issues/` and the ADRs. Product/proof modules are
   named by responsibility. Live proof *protocol* names (env gates, report
   command names) are deliberately retained; do not rename them for aesthetics.

## Naming conventions

- Product domain modules are responsibility-named (`compiler-context.ts`,
  `live-preview.ts`, `lifecycle-controller.ts`, `project-manager.ts`, …).
- Proof scenario suites are `proof-<domain>.ts` (exactly eight). The shared
  proof toolkit is `scenario-toolkit.ts`; the shared driver is
  `scenario-runner.ts`; proof controllers are `scenario-*-controller.ts`.
  Do **not** name a non-scenario module `proof-*` — that prefix is reserved and
  structurally enforced.
- Tauri product commands are `workspace_*`, `project_*`, `first_run_*` (eight
  total). Proof commands keep their `issueNNN_*` protocol names and compile only
  under `proof-harness`.

## Layout

| Path | Contents |
| --- | --- |
| `src/frontend/src` | Workbench UI + proof scenarios + shared proof toolkit |
| `src/frontend/scripts` | Staging (`stage-*.mjs`), profile checker, static tests |
| `src/compiler` | Roslyn→WASM compiler (`*.cs`) + harness (`wwwroot/`) |
| `src/preview` | MonoGame Web preview runtime (`*.cs`) + `wwwroot/` |
| `src/desktop/src-tauri` | Rust shell, `build.rs` inventories, capabilities/permissions |
| `src/shared` | Protocol/contract runtime shared by editor and preview |
| `scripts` | Build/verify/packaged-proof scripts |

## Checks to run before a PR

These run without a native package build and are the fast gate:

```bash
# TypeScript + frontend unit/protocol tests
npm --prefix src/frontend run typecheck
node --experimental-strip-types --test src/frontend/src/protocol.test.ts
node --test src/frontend/src/content-validation.test.ts
node --test src/frontend/src/audio-content.test.ts
node --test src/frontend/src/project-lifecycle.test.ts

# Performance report/measurement unit tests
node --test scripts/performance-report.test.mjs
node --test scripts/measure-performance.test.mjs

# Profile separation (build both profiles first, then check)
npm --prefix src/frontend run build:vite
MONOGAME_FRONTEND_PROFILE=proof npm --prefix src/frontend run build:vite:proof
npm --prefix src/frontend run check:profiles

# Rust: format, lint, and tests for BOTH profiles
( cd src/desktop/src-tauri
  cargo fmt --check
  cargo clippy --all-targets
  cargo clippy --all-targets --features proof-harness
  cargo test
  cargo test --features proof-harness )

# Binary/ACL checker self-test, release-size gate self-test, product smoke self-test
node scripts/check-binary-command-inventory.mjs --self-test
node scripts/measure-release-size.mjs --self-test
node scripts/smoke-product.mjs --self-test

# Shell scripts parse
for s in scripts/*.sh src/frontend/scripts/*.sh; do bash -n "$s"; done
```

CI (`.github/workflows/quality.yml`) runs this fast gate on PR/push from a clean
clone (no submodule, no staged assets): `npm ci`, typecheck, the focused tests,
perf-tooling tests, the four tool self-tests, shell `bash -n` + static runner
tests, and `cargo fmt --check`. The asset-dependent gates — `cargo
clippy`/`cargo test` (both profiles), profile-separation checks, package-size and
product-smoke against each freshly built bundle, and the packaged scenario/
offline proofs — run in `.github/workflows/release.yml` after the MonoGame
artifact build and asset staging (the PROOF ones behind the opt-in
`run_proof_acceptance` dispatch input).

## Expensive / manual gates (release scope)

These require a full .NET + Emscripten + native packaging environment and are
not part of the fast PR gate:

- Native x64 + arm64 PRODUCT and PROOF packages (`tauri build`).
- Packaged scenario suite: `scripts/prove-scenarios-macos.sh`.
- Process-sandboxed offline proof: `scripts/prove-packaged-offline-macos.sh`.
- Startup/memory baseline: `scripts/measure-performance.mjs`.
- Product/proof binary inventory checks: `npm --prefix src/desktop run
  check:binary:product` / `check:binary:proof`.
- Package-size gate against a real bundle: `node
  scripts/measure-release-size.mjs --profile product --package-dir <bundle>
  --binary <exe> --dist src/frontend/dist`.
- Bounded product smoke against a built bundle: `node scripts/smoke-product.mjs
  --bundle <app>` (full launch needs a display; `--identity-only` otherwise).

## Submodule

Do **not** modify `external/MonoGame`; it is a pinned submodule. Toolchain
changes go through `docs/toolchain-manifest.json` (see `docs/build.md`).

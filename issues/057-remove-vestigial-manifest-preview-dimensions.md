# Remove vestigial manifest preview.width/height from the schema

**Type:** AFK
**Status:** Implementation complete — awaiting packaged human verification
**Blocked by:** [052-route-focus-input-resize-and-content-workflow.md](052-route-focus-input-resize-and-content-workflow.md)
**PRD references:** 14.4, 15
**User stories:** US3, US6
**Triage:** needs-triage

## Context

The `playground.json` manifest schema (issue 51) includes a `preview: { width,
height }` block, per PRD §14.4's sentence: "Manifest preview dimensions set the
initial panel size." During issue 052 verification (2026-09-06) this was found to
be **vestigial**: the field is parsed by issue 51
(`src/frontend/src/issue051.ts`, defaulting to 800×480) but **never applied** to
the preview panel, and the app deliberately does not use a fixed panel size.

The actual, verified resize model (checked against the pinned MonoGame source in
issue 052 — see that issue's Verification record) is:

- **Render resolution** = the game's `GraphicsDeviceManager.PreferredBackBufferWidth/Height`
  (drives the canvas backing store via the native `Window_SetClientSize` path).
- **Display size** = CSS (`preview.css`: `canvas { width: 100%; max-width:
  640px; aspect-ratio: 16/9 }`), so the canvas fills the responsive preview panel
  (a CSS-grid `minmax(360px, 1fr)` cell) and the browser scales the backing store
  to fit. No `ResizeObserver`; the backing store changes only when the game does.

Applying a manifest-declared fixed panel size would **fight** this cleaner,
responsive/CSS-scale model, so the field should be removed rather than wired up.
This is a small, deliberate schema/cleanup change, split out of issue 052 so it
gets its own verification.

## What to build

Remove the `preview: { width, height }` block from the `playground.json` manifest
schema and all code that parses, defaults, serialises, or type-declares it, while
keeping backward compatibility with any existing manifest that still contains the
field (ignore it, do not error).

## Scope

### In scope

- Remove `preview.width/height` from the `Issue051Manifest` type, the manifest
  parser/defaults, and the serialiser in `src/frontend/src/issue051.ts`.
- Tolerate (ignore) a `preview` block in an on-disk manifest so older projects
  still open without error; never write it back out.
- Update `examples/*/playground.json` (e.g. `HelloWorld`, `ContentExample`) to
  drop the now-unused `preview` block.
- Update `docs/content-workflow.md` and any manifest documentation to reflect the
  reduced schema (the schema version may stay the same since the change is
  forward/backward compatible by ignoring the field, or bump it if the team
  prefers an explicit version — decide during implementation).

### Out of scope

- Any change to the render-resolution or CSS display-size behaviour (both are
  correct as-is per issue 052's finding).
- Adding a user-draggable preview/editor splitter (optional future polish, not
  required by PRD 14.4's feasibility reading).
- The `max-width: 640px` display cap and hard-coded `aspect-ratio: 16/9` cosmetic
  notes from issue 052 (separate polish, not this cleanup).

## Implementation guidance

1. In `src/frontend/src/issue051.ts`: drop `preview` from `Issue051Manifest`,
   `defaultManifest`, `parseManifest`, and `serializeManifest`. In `parseManifest`,
   simply do not read `obj.preview` (ignoring an unknown block is already the
   desired tolerant behaviour); confirm an existing manifest with a `preview`
   block still parses and that Save All never re-emits it.
2. Update the committed example manifests and re-check any manifest fixture/tests.
3. Update docs.

## Acceptance criteria

- [x] The `playground.json` schema no longer includes `preview.width/height`; no
      code reads or writes it.
- [x] Opening a project whose on-disk `playground.json` still contains a
      `preview` block succeeds (field ignored, no error), and a subsequent Save
      All does not write the block back.
- [ ] Example manifests updated; the workbench still opens them and Run works.
- [x] Manifest docs reflect the reduced schema.
- [ ] Render resolution and display scaling behave exactly as before (no visible
      change to how the preview renders or resizes).

## Verification

Open `examples/ContentExample/` and confirm it still opens, Runs, and renders as
before. Open a throwaway project whose `playground.json` still contains a
`preview` block and confirm it opens without error and that Save All does not
re-add the block. Grep the codebase to confirm no remaining references to
`preview.width`/`preview.height`. The verifier must personally perform these
checks.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Static/automated verdict:** PASS
- **Verifier:** Independent pi reviewer (`claude-opus-4.8`)
- **Date:** 2026-09-11
- **Implementation commit:** `6c065cd frontend: remove vestigial manifest preview dimensions`
- **Evidence:** TypeScript passed; project-lifecycle tests passed 12/12,
  including legacy parse/drop and Save-All no-re-emission coverage; protocol
  tests passed 104/104; both example manifests parse as JSON; grep found no live
  `preview.width`/`preview.height` reads; no CSS, layout, preview, or graphics
  implementation changed.
- **Packaged human verdict:** Pending. Open `examples/ContentExample/`, Run it,
  and open/save a throwaway legacy manifest containing `preview` before marking
  this issue Done.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `frontend: remove vestigial manifest preview.width/height`

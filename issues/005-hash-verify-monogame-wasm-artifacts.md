# Hash and verify required MonoGame WASM artifacts

**Type:** AFK
**Status:** Ready
**Blocked by:** [004-build-monogame-via-build-csproj.md](004-build-monogame-via-build-csproj.md)
**PRD references:** 11.3, 11.4, 2.6
**User stories:** US8
**Triage:** needs-triage

## Context

PRD section 11.3 requires CI/build scripts to verify that native artifact hashes match the pinned submodule and toolchain, and to detect a missing native MonoGame artifact before building the playground (section 11.2 item 14). Section 2.6 requires release artifacts to record hashes of bundled native and WebAssembly artifacts. This issue defines the authoritative list of required files produced by issue 4's `artifacts/monogame/` staging step, computes their hashes, and writes a manifest that later build steps (issue 6+) can check against before consuming the artifacts.

## What to build

Create `scripts/verify-monogame-artifacts.sh` (and `.ps1` twin) that reads a required-file list from a new `docs/monogame-artifacts.json` file (created by this issue), confirms each required file exists under `artifacts/monogame/`, computes a SHA-256 hash for each, writes the hashes into `artifacts/monogame/artifact-hashes.json` alongside the recorded MonoGame commit SHA, and exits non-zero listing every missing file if any required artifact is absent.

## Scope

### In scope

- `docs/monogame-artifacts.json`: the authoritative list of required relative paths under `artifacts/monogame/` (e.g. the compiled WebAssembly module, its `.js`/`.wasm` glue files, and any MonoGame managed assemblies needed by the preview)
- `scripts/verify-monogame-artifacts.sh` / `.ps1`
- Writing `artifacts/monogame/artifact-hashes.json` (gitignored, since it lives under `artifacts/`)

### Out of scope

- Building MonoGame itself (issue 4, already done)
- Consuming these hashes inside the Tauri shell (issue 8)
- Release-artifact hash recording for the final package (issue 43/54)

## Implementation guidance

1. After running `scripts/build-monogame.sh` from issue 4, inspect `artifacts/monogame/` (`find artifacts/monogame -type f`) and identify the actual files produced: expect at least a `.wasm` binary, a JS/Emscripten glue loader, and any MonoGame Web-profile managed DLLs needed at runtime. Cross-reference with `external/MonoGame/Example/Example.Web.csproj` and its `wwwroot`/output folder to see what a working web example actually needs to load.
2. Write `docs/monogame-artifacts.json`:
```json
{
  "schemaVersion": 1,
  "monogameCommitSha": "<sha recorded in docs/toolchain-manifest.json>",
  "requiredFiles": [
    "<relative path 1 under artifacts/monogame/>",
    "<relative path 2>"
  ]
}
```
3. `scripts/verify-monogame-artifacts.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
MISSING=()
REQUIRED=$(python3 -c "import json;print('\n'.join(json.load(open('docs/monogame-artifacts.json'))['requiredFiles']))")
HASHES_JSON="{"
FIRST=1
while IFS= read -r rel; do
  path="artifacts/monogame/$rel"
  if [ ! -f "$path" ]; then
    MISSING+=("$rel")
    continue
  fi
  hash=$(shasum -a 256 "$path" | awk '{print $1}')
  [ $FIRST -eq 0 ] && HASHES_JSON+=","
  HASHES_JSON+="\"$rel\":\"$hash\""
  FIRST=0
done <<< "$REQUIRED"
HASHES_JSON+="}"
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Missing required MonoGame artifacts:" >&2
  printf ' - %s\n' "${MISSING[@]}" >&2
  exit 1
fi
echo "$HASHES_JSON" > artifacts/monogame/artifact-hashes.json
echo "All required MonoGame artifacts present; hashes written to artifacts/monogame/artifact-hashes.json"
```
4. Mirror in `.ps1` using `Get-FileHash -Algorithm SHA256`.

## Acceptance criteria

- [ ] `docs/monogame-artifacts.json` lists at least the `.wasm` module and its JS loader as required files, based on actual inspection of `artifacts/monogame/`
- [ ] `scripts/verify-monogame-artifacts.sh` exits 0 and writes `artifacts/monogame/artifact-hashes.json` when all required files are present
- [ ] Temporarily removing/renaming one required artifact causes the script to list it by name and exit non-zero
- [ ] `artifacts/monogame/artifact-hashes.json` contains a SHA-256 hex digest for every required file

## Verification

```bash
bash scripts/verify-monogame-artifacts.sh; echo "exit=$?"
cat artifacts/monogame/artifact-hashes.json
```
Expect exit 0 and a JSON object with one hash per required file. Then temporarily move one required file aside (`mv artifacts/monogame/<file> artifacts/monogame/<file>.aside`), rerun, confirm non-zero exit and the file listed under "Missing required MonoGame artifacts", then restore it (`mv artifacts/monogame/<file>.aside artifacts/monogame/<file>`) and rerun to confirm exit 0 again. The verifier must capture all three transcripts.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `scripts: hash and verify required MonoGame WASM artifacts`

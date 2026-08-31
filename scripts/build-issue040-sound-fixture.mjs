/**
 * Issue 040: regenerates the committed Web-profile SoundEffect fixture.
 *
 * Usage: node scripts/build-issue040-sound-fixture.mjs [--check]
 *
 * The fixture is hand-assembled against the pinned MonoGame 3.8.5.1
 * SoundEffectWriter/SoundEffectReader binary contract (see
 * src/frontend/src/issue040-fixture.ts). `--check` verifies the committed file
 * matches the generator instead of rewriting it.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ISSUE040_FIXTURE_SHA256,
  buildIssue040SoundFixture,
} from "../src/frontend/src/issue040-fixture.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  repositoryRoot,
  "examples/ContentExample/Content/audio/blip.xnb",
);

const bytes = buildIssue040SoundFixture();
const sha256 = createHash("sha256").update(bytes).digest("hex");
const check = process.argv.includes("--check");

if (check) {
  const committed = await readFile(fixturePath);
  const committedSha256 = createHash("sha256").update(committed).digest("hex");
  const failures = [];
  if (committedSha256 !== sha256) {
    failures.push(`committed fixture SHA-256 ${committedSha256} != generated ${sha256}`);
  }
  if (sha256 !== ISSUE040_FIXTURE_SHA256) {
    failures.push(`generated SHA-256 ${sha256} != pinned ${ISSUE040_FIXTURE_SHA256}`);
  }
  if (committed.length !== bytes.length) {
    failures.push(`committed length ${committed.length} != generated ${bytes.length}`);
  }
  if (failures.length > 0) {
    console.error(`issue040 fixture check FAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`issue040 fixture check PASS (${bytes.length} bytes, sha256 ${sha256})`);
} else {
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, bytes);
  console.log(`Wrote ${fixturePath} (${bytes.length} bytes, sha256 ${sha256})`);
  if (sha256 !== ISSUE040_FIXTURE_SHA256) {
    console.error(
      `WARNING: generated SHA-256 ${sha256} does not match the pinned ISSUE040_FIXTURE_SHA256 ${ISSUE040_FIXTURE_SHA256}.`,
    );
    process.exit(2);
  }
}

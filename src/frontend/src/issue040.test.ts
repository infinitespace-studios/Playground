import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  ISSUE040_FIXTURE_ASSET_NAME,
  ISSUE040_FIXTURE_ASSET_PATH,
  ISSUE040_FIXTURE_BYTE_LENGTH,
  ISSUE040_FIXTURE_DURATION_MS,
  ISSUE040_FIXTURE_SAMPLE_COUNT,
  ISSUE040_FIXTURE_SAMPLE_RATE,
  ISSUE040_FIXTURE_SHA256,
  SOUND_EFFECT_READER_TYPE,
  buildIssue040FixturePcm,
  buildIssue040SoundFixture,
  buildSoundEffectXnb,
} from "./issue040-fixture.ts";
import { ISSUE040_EXPECTED_VALIDATOR_CASES, ISSUE040_GAME_SOURCE } from "./issue040-contract.ts";

const repositoryFile = async relativePath =>
  readFile(new URL(`../../../${relativePath}`, import.meta.url));

const sha256Hex = bytes => createHash("sha256").update(bytes).digest("hex");

/** Minimal independent XNB reader mirroring the pinned SoundEffectReader layout. */
function parseSoundEffectXnb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  const platform = String.fromCharCode(bytes[3]);
  const formatVersion = bytes[4];
  const flags = bytes[5];
  const declaredFileSize = view.getInt32(6, true);
  offset = 10;

  const read7Bit = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[offset++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
  };
  const readInt32 = () => {
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };

  const readerCount = read7Bit();
  const readerNameLength = read7Bit();
  const readerType = new TextDecoder().decode(bytes.subarray(offset, offset + readerNameLength));
  offset += readerNameLength;
  const readerVersion = readInt32();
  const sharedResourceCount = read7Bit();
  const rootReaderSelector = read7Bit();
  const formatSize = readInt32();
  const format = bytes.subarray(offset, offset + formatSize);
  offset += formatSize;
  const formatView = new DataView(format.buffer, format.byteOffset, format.byteLength);
  const dataSize = readInt32();
  const dataOffset = offset;
  offset += dataSize;
  const loopStart = readInt32();
  const loopLength = readInt32();
  const durationMilliseconds = readInt32();

  return {
    magic,
    platform,
    formatVersion,
    flags,
    declaredFileSize,
    readerCount,
    readerType,
    readerVersion,
    sharedResourceCount,
    rootReaderSelector,
    formatSize,
    formatTag: formatView.getInt16(0, true),
    channels: formatView.getInt16(2, true),
    sampleRate: formatView.getInt32(4, true),
    averageBytesPerSecond: formatView.getInt32(8, true),
    blockAlign: formatView.getInt16(12, true),
    bitsPerSample: formatView.getInt16(14, true),
    cbSize: formatView.getInt16(16, true),
    dataSize,
    dataOffset,
    loopStart,
    loopLength,
    durationMilliseconds,
    trailingBytes: bytes.byteLength - offset,
  };
}

test("issue040 fixture builder is deterministic and matches the pinned hash", () => {
  const first = buildIssue040SoundFixture();
  const second = buildIssue040SoundFixture();
  assert.deepEqual([...first], [...second]);
  assert.equal(first.length, ISSUE040_FIXTURE_BYTE_LENGTH);
  assert.equal(sha256Hex(first), ISSUE040_FIXTURE_SHA256);
});

test("issue040 committed repository fixture is byte-identical to the generator", async () => {
  const committed = await repositoryFile(`examples/ContentExample/Content/${ISSUE040_FIXTURE_ASSET_PATH}`);
  const generated = buildIssue040SoundFixture();
  assert.equal(committed.length, generated.length);
  assert.equal(sha256Hex(committed), ISSUE040_FIXTURE_SHA256);
  assert.ok(Buffer.from(generated).equals(committed));
});

test("issue040 fixture matches the pinned Web-profile SoundEffect layout", () => {
  const parsed = parseSoundEffectXnb(buildIssue040SoundFixture());
  assert.equal(parsed.magic, "XNB");
  assert.equal(parsed.platform, "b", "Web profile platform marker");
  assert.equal(parsed.formatVersion, 5);
  assert.equal(parsed.flags, 0, "uncompressed content only");
  assert.equal(parsed.declaredFileSize, ISSUE040_FIXTURE_BYTE_LENGTH);
  assert.equal(parsed.readerCount, 1);
  assert.equal(parsed.readerType, SOUND_EFFECT_READER_TYPE);
  assert.equal(parsed.readerVersion, 0);
  assert.equal(parsed.sharedResourceCount, 0);
  assert.equal(parsed.rootReaderSelector, 1);
  assert.equal(parsed.formatSize, 18, "WAVEFORMATEX with cbSize");
  assert.equal(parsed.formatTag, 1, "uncompressed PCM");
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.sampleRate, ISSUE040_FIXTURE_SAMPLE_RATE);
  assert.equal(parsed.bitsPerSample, 16);
  assert.equal(parsed.blockAlign, 2);
  assert.equal(parsed.averageBytesPerSecond, ISSUE040_FIXTURE_SAMPLE_RATE * 2);
  assert.equal(parsed.cbSize, 0);
  assert.equal(parsed.dataSize, ISSUE040_FIXTURE_SAMPLE_COUNT * 2);
  assert.equal(parsed.loopStart, 0);
  assert.equal(parsed.loopLength, ISSUE040_FIXTURE_SAMPLE_COUNT);
  assert.equal(parsed.durationMilliseconds, ISSUE040_FIXTURE_DURATION_MS);
  assert.equal(parsed.trailingBytes, 0, "no trailing bytes after the payload");
});

test("issue040 fixture PCM is audible, click-free, and block aligned", () => {
  const pcm = buildIssue040FixturePcm();
  assert.equal(pcm.length % 2, 0);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let peak = 0;
  let sumSquares = 0;
  for (let index = 0; index < pcm.length / 2; index++) {
    const sample = view.getInt16(index * 2, true);
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / (pcm.length / 2));
  assert.ok(peak > 4000, `peak ${peak} must be clearly audible`);
  assert.ok(peak <= 8192, `peak ${peak} must stay at a safe level`);
  assert.ok(rms > 1000, `rms ${rms} must be non-trivial`);
  assert.equal(view.getInt16(0, true), 0, "starts at silence");
  assert.equal(view.getInt16(pcm.length - 2, true), 0, "ends at silence");
});

test("issue040 fixture builder can produce the rejected variants the validator must refuse", () => {
  const data = new Uint8Array(64);
  const nonPcm = parseSoundEffectXnb(buildSoundEffectXnb({ data, formatTag: 2 }));
  assert.equal(nonPcm.formatTag, 2);
  const wrongPlatform = parseSoundEffectXnb(
    buildSoundEffectXnb({ data, platformByte: 0x64 }));
  assert.equal(wrongPlatform.platform, "d");
  const trailing = parseSoundEffectXnb(
    buildSoundEffectXnb({ data, trailingBytes: new Uint8Array([1, 2, 3]) }));
  assert.equal(trailing.trailingBytes, 3);
});

test("issue040 validator expectations cover both texture and sound content", () => {
  const names = Object.keys(ISSUE040_EXPECTED_VALIDATOR_CASES);
  const soundCases = names.filter(name => name.startsWith("sound-"));
  const textureCases = names.filter(name => !name.startsWith("sound-"));
  assert.ok(textureCases.length >= 20, "issue 039 texture cases must be retained");
  assert.ok(soundCases.length >= 20, "sound cases must be covered");
  assert.deepEqual(ISSUE040_EXPECTED_VALIDATOR_CASES["good-fixture"], [true, null]);
  assert.deepEqual(ISSUE040_EXPECTED_VALIDATOR_CASES["sound-good-fixture"], [true, null]);
  const acceptedCases = names.filter(name => ISSUE040_EXPECTED_VALIDATOR_CASES[name][0]);
  assert.deepEqual(
    acceptedCases.sort(),
    ["good-fixture", "sound-good-fixture", "sound-good-stereo-8bit"],
    "the validator must stay fail-closed apart from the pinned accepted shapes",
  );
});

test("issue040 validator expectations agree with the issue 039 proof harness", async () => {
  const issue039Source = await repositoryFile("src/frontend/src/proof-content.ts");
  const text = issue039Source.toString("utf8");
  for (const [name, [valid, diagnostic]] of Object.entries(ISSUE040_EXPECTED_VALIDATOR_CASES)) {
    const quoted = /^[a-z0-9-]+$/.test(name) && name.includes("-") ? `"${name}"` : name;
    const pattern = new RegExp(
      `${quoted.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}:\\s*\\[${valid},\\s*${diagnostic === null ? "null" : `"${diagnostic}"`}\\]`,
    );
    assert.ok(
      pattern.test(text),
      `issue039 proof is missing validator expectation for ${name}`,
    );
  }
});

test("issue040 test game drives audio only through public MonoGame APIs", () => {
  assert.match(ISSUE040_GAME_SOURCE, /Content\.Load<SoundEffect>\("audio\/blip"\)/);
  assert.match(ISSUE040_GAME_SOURCE, /_sound\.CreateInstance\(\)/);
  assert.match(ISSUE040_GAME_SOURCE, /_instance\.Play\(\)/);
  assert.match(ISSUE040_GAME_SOURCE, /_instance\.Stop\(\)/);
  assert.match(ISSUE040_GAME_SOURCE, /Keys\.Space/);
  assert.match(ISSUE040_GAME_SOURCE, /Keys\.Escape/);
  assert.equal(ISSUE040_FIXTURE_ASSET_NAME, "audio/blip");
  // The game must not reach outside the supported managed surface.
  assert.doesNotMatch(ISSUE040_GAME_SOURCE, /JSImport|JSExport|DllImport|unsafe|System\.Runtime\.InteropServices/);
});

test("issue040 proof commands are gated and registered in every ACL inventory", async () => {
  const commands = [
    "issue040_is_proof_enabled",
    "issue040_emit_checkpoint",
    "issue040_emit_report",
    "issue040_dispatch_preview_input",
  ];
  const buildRs = (await repositoryFile("src/desktop/src-tauri/build.rs")).toString("utf8");
  const permission = (await repositoryFile("src/desktop/src-tauri/permissions/proof.toml")).toString("utf8");
  const mainPermission = (await repositoryFile("src/desktop/src-tauri/permissions/main.toml")).toString("utf8");
  const lib = (await repositoryFile("src/desktop/src-tauri/src/lib.rs")).toString("utf8");
  const issue34 = (await repositoryFile("src/frontend/src/proof-preview-security.ts")).toString("utf8");
  const approvedCommands = issue34.match(/ISSUE034_APPROVED_COMMANDS = \[(.*?)\] as const/s)?.[0] ?? "";
  for (const command of commands) {
    assert.ok(buildRs.includes(`"${command}"`), `${command} missing from build.rs`);
    // Stage 6 binary separation: issue040 proof commands live in the proof-only
    // ACL overlay (proof.toml), never the product permission (main.toml).
    assert.ok(permission.includes(`"${command}"`), `${command} missing from proof.toml`);
    assert.ok(!mainPermission.includes(`"${command}"`), `${command} leaked into main.toml`);
    assert.ok(lib.includes(command), `${command} missing from lib.rs`);
    assert.ok(
      approvedCommands.includes(`"${command}"`),
      `${command} missing from the issue 034 ACL rejection inventory`,
    );
  }
  assert.ok(
    lib.includes('std::env::var_os("MONOGAME_ISSUE040_PROOF")'),
    "issue 040 proof commands must be environment gated",
  );
});

test("issue040 preview instrumentation stays gated behind the proof flag", async () => {
  // The proof audio instrumentation moved out of the shipping preview runtime
  // into the PROOF-only extension (Stage 6 slice 4). Assert the gating lives in
  // the extension and that the product preview.js carries none of it.
  const preview = (await repositoryFile("src/preview/wwwroot/preview.js")).toString("utf8");
  const extension =
    (await repositoryFile("src/preview/wwwroot/preview-proof-extension.js")).toString("utf8");
  for (const action of ["issue040-audio-arm", "issue040-audio-sample"]) {
    const index = extension.indexOf(`action === "${action}"`);
    assert.ok(index > 0, `${action} bridge action missing`);
    const guard = extension.slice(index, index + 220);
    assert.ok(
      guard.includes("previewIssue040Proof.enabled"),
      `${action} must be gated on the issue 040 proof flag`,
    );
    assert.ok(
      !preview.includes(`action === "${action}"`),
      `${action} must not appear in the product preview runtime`,
    );
  }
  for (const snapshot of ["issue040-audio", "issue040-managed-audio"]) {
    const index = extension.indexOf(`name === "${snapshot}"`);
    assert.ok(index > 0, `${snapshot} snapshot missing`);
    const guard = extension.slice(index, index + 220);
    assert.ok(
      guard.includes("previewIssue040Proof.enabled"),
      `${snapshot} must be gated on the issue 040 proof flag`,
    );
  }
  assert.ok(
    extension.includes("if (globalThis.previewIssue040Proof.enabled) installIssue040AudioProbe();"),
    "the audio probe must only be installed for the gated proof",
  );
  assert.ok(
    !preview.includes("installIssue040AudioProbe"),
    "the product preview runtime must not reference the audio probe",
  );
});

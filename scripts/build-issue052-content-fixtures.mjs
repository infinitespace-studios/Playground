/**
 * Issue 052: regenerates the committed RAW content fixtures for
 * examples/ContentExample — a real PNG and a real PCM WAV that the Playground
 * preview mounts with NO MGCB step:
 *
 *   Content/textures/sprite.png  — loaded via Content.Load<Texture2D> (the
 *                                  MonoGame Web runtime's Texture2D.FromStream
 *                                  fallback decodes raw PNG/JPG/BMP).
 *   Content/audio/tone.wav       — loaded via Content.Load<SoundEffect> (the
 *                                  preview transcodes raw PCM WAV -> XNB
 *                                  SoundEffect at mount; WavToXnb.cs).
 *
 * Both are hand-assembled and deterministic (no Math.* in the sample path — the
 * WAV reuses the issue 040 integer sine-table PCM), so Node and any rebuild emit
 * byte-identical output.
 *
 * Usage: node scripts/build-issue052-content-fixtures.mjs [--check]
 */

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildIssue040FixturePcm,
  ISSUE040_FIXTURE_SAMPLE_RATE,
  ISSUE040_FIXTURE_CHANNELS,
  ISSUE040_FIXTURE_BITS_PER_SAMPLE,
} from "../src/frontend/src/issue040-fixture.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── PNG ───────────────────────────────────────────────────────────────────
// A tiny 8x8 truecolour-with-alpha PNG. Hand-built: signature + IHDR + IDAT
// (zlib-wrapped deflate of the raw scanlines) + IEND, each chunk CRC-32'd.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const len = data.length;
  const crc = crc32(body);
  const out = new Uint8Array(4 + body.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len, false);
  out.set(body, 4);
  dv.setUint32(4 + body.length, crc, false);
  return out;
}

function buildSpritePng() {
  const width = 8;
  const height = 8;
  // Deterministic pattern: a colourful gradient with a solid alpha, distinct so
  // it is obviously "an image" in the preview.
  const raw = new Uint8Array(height * (1 + width * 4)); // +1 filter byte per row
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o++] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x += 1) {
      raw[o++] = (x * 32) & 0xff;          // R ramps across
      raw[o++] = (y * 32) & 0xff;          // G ramps down
      raw[o++] = ((x + y) * 16) & 0xff;    // B diagonal
      raw[o++] = 0xff;                     // A opaque
    }
  }
  // zlib stream (deflateSync gives a valid zlib wrapper StbImageSharp accepts).
  const idat = deflateSync(raw, { level: 9 });

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type 6 = truecolour + alpha
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png;
}

// ── WAV ───────────────────────────────────────────────────────────────────
// RIFF/WAVE container around the issue 040 integer-sine PCM (byte-identical
// audio to blip.xnb, but as a raw .wav the preview transcodes at mount).
function buildToneWav() {
  const pcm = buildIssue040FixturePcm(); // Uint8Array of 16-bit LE mono samples
  const channels = ISSUE040_FIXTURE_CHANNELS;
  const sampleRate = ISSUE040_FIXTURE_SAMPLE_RATE;
  const bits = ISSUE040_FIXTURE_BITS_PER_SAMPLE;
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;

  const dataSize = pcm.length;
  const riffSize = 4 + (8 + 16) + (8 + dataSize); // "WAVE" + fmt chunk + data chunk
  const out = new Uint8Array(8 + riffSize);
  const dv = new DataView(out.buffer);
  const enc = new TextEncoder();
  let o = 0;
  const putStr = s => { out.set(enc.encode(s), o); o += s.length; };
  const putU32 = v => { dv.setUint32(o, v, true); o += 4; };
  const putU16 = v => { dv.setUint16(o, v, true); o += 2; };

  putStr("RIFF"); putU32(riffSize); putStr("WAVE");
  putStr("fmt "); putU32(16);
  putU16(1);            // PCM
  putU16(channels);
  putU32(sampleRate);
  putU32(byteRate);
  putU16(blockAlign);
  putU16(bits);
  putStr("data"); putU32(dataSize);
  out.set(pcm, o);
  return out;
}

// ── Emit / check ────────────────────────────────────────────────────────────
const targets = [
  { rel: "examples/ContentExample/Content/textures/sprite.png", bytes: buildSpritePng() },
  { rel: "examples/ContentExample/Content/audio/tone.wav", bytes: buildToneWav() },
];

const check = process.argv.includes("--check");
let failed = false;
for (const { rel, bytes } of targets) {
  const abs = path.join(repositoryRoot, rel);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (check) {
    try {
      const committed = await readFile(abs);
      const csha = createHash("sha256").update(committed).digest("hex");
      if (csha !== sha || committed.length !== bytes.length) {
        console.error(`FAIL ${rel}: committed ${csha} (${committed.length}b) != generated ${sha} (${bytes.length}b)`);
        failed = true;
      } else {
        console.log(`PASS ${rel} (${bytes.length}b, sha256 ${sha})`);
      }
    } catch {
      console.error(`FAIL ${rel}: not committed`);
      failed = true;
    }
  } else {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    console.log(`Wrote ${rel} (${bytes.length}b, sha256 ${sha})`);
  }
}
if (failed) process.exit(1);

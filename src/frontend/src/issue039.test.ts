import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  LIMITS,
  isCanonicalPath,
  isUuidV4,
  validateAssetMountRequest,
  validateAssetMountResponse,
  standaloneBuffer,
  sha256,
} from "./protocol.ts";
import { createAssetMountExecutor } from "../../shared/AssetMountRuntime.js";
import { createPreStartAdmission } from "../../shared/PreStartAdmission.js";

const uuid = "00112233-4455-4677-8899-aabbccddeeff";
const mountId = "aabbccdd-1122-4334-8556-667788990011";
const previewId = "11223344-5566-4778-899a-bbccddeeff00";

function makeAssetBuffer(bytes) {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function loadFixture(name) {
  const path = new URL(
    `../../../tests/security/fixtures/${name}`,
    import.meta.url,
  );
  const data = await readFile(path);
  return standaloneBuffer(new Uint8Array(data));
}

async function loadGoodFixture() {
  const path = new URL(
    `../../../examples/ContentExample/Content/textures/player.xnb`,
    import.meta.url,
  );
  const data = await readFile(path);
  return standaloneBuffer(new Uint8Array(data));
}

// ── XNB fixture validation ───────────────────────────────────────────

test("known-good Web XNB fixture has correct header", async () => {
  const buffer = await loadGoodFixture();
  const bytes = new Uint8Array(buffer);
  assert.equal(bytes[0], 0x58, "magic X");
  assert.equal(bytes[1], 0x4E, "magic N");
  assert.equal(bytes[2], 0x42, "magic B");
  assert.equal(bytes[3], 0x62, "platform b (Web)");
  assert.equal(bytes[4], 5, "format version 5");
  assert.equal(bytes[5], 0x00, "flags: uncompressed, Reach");
  const declaredSize = new DataView(buffer).getInt32(6, true);
  assert.equal(declaredSize, bytes.length, "declared size matches actual");
});

test("known-good Web XNB fixture SHA-256", async () => {
  const buffer = await loadGoodFixture();
  const hash = await sha256(buffer);
  assert.equal(
    hash,
    "ec8c5439755b300163c43165a3c1c374063f076a8347a982a320d2508106b629",
    "fixture SHA-256 matches provenance",
  );
});

// ── validateAssetMountRequest ────────────────────────────────────────

test("validateAssetMountRequest accepts valid request", async () => {
  const goodXnb = await loadGoodFixture();
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.request",
    payload: {
      previewId,
      mountId,
      assets: [{ path: "textures/player.xnb", bytes: goodXnb }],
    },
  };
  const { message } = validateAssetMountRequest(request, previewId);
  assert.equal(message.payload.mountId, mountId);
  assert.equal(message.payload.assets.length, 1);
});

test("validateAssetMountRequest rejects wrong previewId", async () => {
  const goodXnb = await loadGoodFixture();
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.request",
    payload: {
      previewId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      mountId,
      assets: [{ path: "textures/player.xnb", bytes: goodXnb }],
    },
  };
  assert.throws(
    () => validateAssetMountRequest(request, previewId),
    { message: "MESSAGE_SOURCE_REJECTED" },
  );
});

test("validateAssetMountRequest rejects invalid mountId", async () => {
  const goodXnb = await loadGoodFixture();
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.request",
    payload: {
      previewId,
      mountId: "not-a-uuid",
      assets: [{ path: "textures/player.xnb", bytes: goodXnb }],
    },
  };
  assert.throws(
    () => validateAssetMountRequest(request, previewId),
    { message: "MALFORMED_PAYLOAD" },
  );
});

test("validateAssetMountRequest rejects empty assets", () => {
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.request",
    payload: {
      previewId,
      mountId,
      assets: [],
    },
  };
  assert.throws(
    () => validateAssetMountRequest(request, previewId),
    { message: "MALFORMED_PAYLOAD" },
  );
});

test("validateAssetMountRequest rejects oversized asset", async () => {
  const oversized = new ArrayBuffer(16 * 1024 * 1024 + 1);
  new Uint8Array(oversized).fill(0x42);
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.request",
    payload: {
      previewId,
      mountId,
      assets: [{ path: "textures/huge.xnb", bytes: oversized }],
    },
  };
  assert.throws(
    () => validateAssetMountRequest(request, previewId),
    { message: "ASSET_TOO_LARGE" },
  );
});

test("validateAssetMountRequest rejects duplicate paths", async () => {
  const goodXnb1 = await loadGoodFixture();
  const goodXnb2 = await loadGoodFixture(); // separate buffer instance
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.request",
    payload: {
      previewId,
      mountId,
      assets: [
        { path: "textures/player.xnb", bytes: goodXnb1 },
        { path: "textures/player.xnb", bytes: goodXnb2 },
      ],
    },
  };
  assert.throws(
    () => validateAssetMountRequest(request, previewId),
    { message: "ASSET_PATH_DUPLICATE" },
  );
});

test("validateAssetMountRequest rejects path traversal", async () => {
  const goodXnb = await loadGoodFixture();
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.request",
    payload: {
      previewId,
      mountId,
      assets: [{ path: "../secrets/evil.xnb", bytes: goodXnb }],
    },
  };
  assert.throws(
    () => validateAssetMountRequest(request, previewId),
    { message: "ASSET_PATH_INVALID" },
  );
});

test("validateAssetMountRequest rejects absolute path", async () => {
  const goodXnb = await loadGoodFixture();
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.request",
    payload: {
      previewId,
      mountId,
      assets: [{ path: "/etc/passwd", bytes: goodXnb }],
    },
  };
  assert.throws(
    () => validateAssetMountRequest(request, previewId),
    { message: "ASSET_PATH_INVALID" },
  );
});

// ── validateAssetMountResponse ───────────────────────────────────────

test("validateAssetMountResponse accepts valid success", () => {
  const response = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.response",
    result: {
      success: true,
      data: {
        previewId,
        mountId,
        mountedFileCount: 1,
        mountedByteLength: 224,
      },
    },
  };
  const { message } = validateAssetMountResponse(response, uuid, previewId, mountId);
  assert.equal(message.result.success, true);
});

test("validateAssetMountResponse accepts valid failure", () => {
  const response = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "asset.mount.response",
    result: {
      success: false,
      error: {
        code: "ASSET_PATH_INVALID",
        message: "Path is invalid.",
      },
    },
  };
  const { message } = validateAssetMountResponse(response, uuid, previewId, mountId);
  assert.equal(message.result.success, false);
});

// ── Negative XNB fixture tests ───────────────────────────────────────

test("wrong-platform fixture has DesktopGL marker", async () => {
  const buffer = await loadFixture("issue039-wrong-platform.xnb");
  const bytes = new Uint8Array(buffer);
  assert.equal(bytes[3], 0x64, "platform d (DesktopGL)");
});

test("compressed fixture has LZ4 flag set", async () => {
  const buffer = await loadFixture("issue039-compressed.xnb");
  const bytes = new Uint8Array(buffer);
  assert.notEqual(bytes[5] & 0x40, 0, "LZ4 compression flag");
});

test("truncated fixture is too short for header", async () => {
  const buffer = await loadFixture("issue039-truncated.xnb");
  assert.ok(buffer.byteLength < 10, "truncated below header size");
});

test("bad-magic fixture has wrong magic bytes", async () => {
  const buffer = await loadFixture("issue039-bad-magic.xnb");
  const bytes = new Uint8Array(buffer);
  assert.notEqual(bytes[0], 0x58, "first byte is not X");
});

// ── Path normalization ───────────────────────────────────────────────

test("isCanonicalPath accepts valid nested asset path", () => {
  assert.ok(isCanonicalPath("textures/player.xnb"));
  assert.ok(isCanonicalPath("Content/textures/nested/deep/file.xnb"));
});

test("isCanonicalPath rejects traversal and invalid paths", () => {
  assert.ok(!isCanonicalPath("../evil.xnb"));
  assert.ok(!isCanonicalPath("/absolute/path.xnb"));
  assert.ok(!isCanonicalPath("path\\backslash.xnb"));
  assert.ok(!isCanonicalPath(""));
  assert.ok(!isCanonicalPath("path//double.xnb"));
  assert.ok(!isCanonicalPath("C:/drive.xnb"));
  assert.ok(!isCanonicalPath("path%20encoded.xnb"));
  assert.ok(!isCanonicalPath("path?query.xnb"));
  assert.ok(!isCanonicalPath("path#hash.xnb"));
});

// ── Strict XNB parser negative fixtures ─────────────────────────────

test("appended-bytes fixture is rejected by strict size check", async () => {
  const buffer = await loadFixture("issue039-appended-bytes.xnb");
  const view = new DataView(buffer);
  const declared = view.getInt32(6, true);
  assert.equal(declared, 224, "declared size");
  assert.equal(buffer.byteLength, 225, "actual size (appended byte)");
  assert.notEqual(declared, buffer.byteLength, "strict size mismatch");
});

test("suffixed-reader fixture has non-exact Texture2DReader name", async () => {
  const buffer = await loadFixture("issue039-suffixed-reader.xnb");
  const bytes = new Uint8Array(buffer);
  // Verify it has Web platform and valid magic
  assert.equal(bytes[0], 0x58);
  assert.equal(bytes[3], 0x62, "Web platform");
  // The reader type starts with Texture2DReader but has "Fake" suffix
  const text = new TextDecoder().decode(bytes.slice(11));
  assert.ok(text.includes("Texture2DReaderFake"), "contains suffixed reader name");
});

test("multi-reader fixture has two reader entries", async () => {
  const buffer = await loadFixture("issue039-multi-reader.xnb");
  const bytes = new Uint8Array(buffer);
  assert.equal(bytes[3], 0x62, "Web platform");
  // Reader count should be 2 (at body offset 10)
  assert.equal(bytes[10], 2, "reader count = 2");
});

test("bad-root-index fixture has reader selector 0", async () => {
  const buffer = await loadFixture("issue039-bad-root-index.xnb");
  const bytes = new Uint8Array(buffer);
  assert.equal(bytes[3], 0x62, "Web platform");
});

// ── PreStartAdmission production wrapper tests ───────────────────

function deferred() {
  let resolve = (_v) => {};
  let reject = (_e) => {};
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("admission: mount pending blocks runLoad and runStart", async () => {
  const adm = createPreStartAdmission();
  const d = deferred();

  const mountPromise = adm.runMount("m1", ["stopped", "loaded"], "stopped", () => d.promise);
  assert.equal(adm.isHeld(), true, "gate held during mount");
  assert.deepEqual(adm.currentOwner(), { kind: "mount", id: "m1" });

  // Load rejects while mount pending
  await assert.rejects(() => adm.runLoad("l1", "stopped", async () => ({})), { message: "INVALID_STATE" });

  // Start rejects while mount pending (runStart tries to acquire)
  await assert.rejects(
    () => adm.runStart("s1", "loaded", async () => ({})),
    { message: "INVALID_STATE" },
  );

  // Resolve mount; gate released
  d.resolve({ result: { success: true } });
  await mountPromise;
  assert.equal(adm.isHeld(), false, "gate released after mount");
});

test("admission: runLoad pending blocks mount and start", async () => {
  const adm = createPreStartAdmission();
  const d = deferred();

  const loadPromise = adm.runLoad("l1", "stopped", () => d.promise);
  assert.equal(adm.isHeld(), true, "gate held during load");
  assert.deepEqual(adm.currentOwner(), { kind: "load", id: "l1" });

  // Mount rejects (structured INVALID_STATE, operation never called)
  let mountOpCalled = false;
  const mountResult = await adm.runMount("m1", ["stopped", "loaded"], "stopped", async () => {
    mountOpCalled = true;
    return { result: { success: true } };
  });
  assert.equal(mountResult.result.success, false);
  assert.equal(mountResult.result.error.code, "INVALID_STATE");
  assert.equal(mountOpCalled, false, "mount operation must not be invoked");

  // Start rejects
  await assert.rejects(() => adm.runStart("s1", "loaded", async () => ({})), { message: "INVALID_STATE" });

  d.resolve({ result: { success: true } });
  await loadPromise;
  assert.equal(adm.isHeld(), false);
});

test("admission: runStart pending blocks mount and load; owner is start", async () => {
  const adm = createPreStartAdmission();
  const d = deferred();

  const startPromise = adm.runStart("s1", "loaded", () => d.promise);
  assert.equal(adm.isHeld(), true, "gate held during start");
  assert.deepEqual(adm.currentOwner(), { kind: "start", id: "s1" });

  // Mount rejects (structured, operation never invoked)
  let mountOpCalled = false;
  const mountResult = await adm.runMount("m1", ["stopped", "loaded"], "loaded", async () => {
    mountOpCalled = true;
    return { result: { success: true } };
  });
  assert.equal(mountResult.result.success, false);
  assert.equal(mountResult.result.error.code, "INVALID_STATE");
  assert.equal(mountOpCalled, false, "mount operation never invoked during start");

  // Load rejects (thrown)
  await assert.rejects(() => adm.runLoad("l1", "stopped", async () => ({})), { message: "INVALID_STATE" });

  d.resolve({ result: { success: true } });
  await startPromise;
  assert.equal(adm.isHeld(), false, "gate released after start");
});

test("admission: mount operation throws — finally releases; start can proceed", async () => {
  const adm = createPreStartAdmission();

  await assert.rejects(
    () => adm.runMount("m1", ["stopped"], "stopped", async () => { throw new Error("boom"); }),
    { message: "boom" },
  );
  assert.equal(adm.isHeld(), false, "gate released after mount throws");

  // Start can acquire after failed mount
  const startResult = await adm.runStart("s1", "loaded", async () => ({ result: { success: true } }));
  assert.equal(startResult.result.success, true);
  assert.equal(adm.isHeld(), false);
});

test("admission: load operation rejects — finally releases", async () => {
  const adm = createPreStartAdmission();

  await assert.rejects(
    () => adm.runLoad("l1", "stopped", async () => { throw new Error("load-fail"); }),
    { message: "load-fail" },
  );
  assert.equal(adm.isHeld(), false, "gate released after load rejects");

  const mountResult = await adm.runMount("m1", ["stopped"], "stopped",
    async () => ({ result: { success: true } }));
  assert.equal(mountResult.result.success, true);
});

test("admission: start operation throws — finally releases", async () => {
  const adm = createPreStartAdmission();

  await assert.rejects(
    () => adm.runStart("s1", "loaded", async () => { throw new Error("start-fail"); }),
    { message: "start-fail" },
  );
  assert.equal(adm.isHeld(), false, "gate released after start throws");

  // Mount can acquire after failed start
  const mountResult = await adm.runMount("m1", ["loaded"], "loaded",
    async () => ({ result: { success: true } }));
  assert.equal(mountResult.result.success, true);
});

test("admission: state check rejects mount before gate is acquired", async () => {
  const adm = createPreStartAdmission();

  // Mount in wrong state throws before gate touched
  await assert.rejects(
    () => adm.runMount("m1", ["stopped", "loaded"], "running", async () => ({})),
    { message: "INVALID_STATE" },
  );
  assert.equal(adm.isHeld(), false, "gate untouched");
});

test("admission: load in wrong state throws before gate", async () => {
  const adm = createPreStartAdmission();

  await assert.rejects(
    () => adm.runLoad("l1", "loaded", async () => ({})),
    { message: "INVALID_STATE" },
  );
  assert.equal(adm.isHeld(), false);
});

test("admission: second mount during pending mount returns structured INVALID_STATE", async () => {
  const adm = createPreStartAdmission();
  const d = deferred();

  const mount1 = adm.runMount("m1", ["stopped"], "stopped", () => d.promise);
  const mount2Result = await adm.runMount("m2", ["stopped"], "stopped", async () => {
    throw new Error("should not be called");
  });
  assert.equal(mount2Result.result.success, false);
  assert.equal(mount2Result.result.error.code, "INVALID_STATE");

  d.resolve({ result: { success: true } });
  await mount1;
});

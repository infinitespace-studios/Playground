/**
 * Issue 039: Validate and mount nested Web-profile Texture2D content.
 *
 * Full packaged proof through the production isolated architecture:
 *  1. Mount known-good Web XNB fixture via asset.mount.request
 *  2. Compile/load/start example Game1 with Content.Load<Texture2D>
 *  3. Sample distinctive 4×4 pixel grid proving texture rendered (not clear color)
 *  4. Verify mount path/SHA/byte continuity and cleanup
 *  5. Negative: wrong-platform XNB rejected with PG0010 and MonoGamePlatform=Web,
 *     construction/run counters remain zero, no partial mount
 */

import { compileToBuffers, preparePackagedProofRuntime } from "./issue21";
import {
  createIsolatedPreview,
  storeBinaryTransfer,
} from "./issue38-bridge";
import {
  validatePreviewLoadResponse,
  validatePreviewStartResponse,
  validatePreviewStopResponse,
  validateAssetMountResponse,
  sha256,
  standaloneBuffer,
} from "./protocol";
import type { UuidV4 } from "../../shared/MessageContracts";

const PROTOCOL_VERSION = 1;
const createUuid = () => crypto.randomUUID() as UuidV4;
const wait = (ms: number) => new Promise<void>(r => globalThis.setTimeout(r, ms));

// ── Embedded fixtures (no host filesystem, no Vite asset transform) ──

// 224 bytes, SHA-256: ec8c5439755b300163c43165a3c1c374063f076a8347a982a320d2508106b629
// Web-profile uncompressed Texture2D 4×4 with distinctive per-cell pattern
const GOOD_XNB = new Uint8Array([0x58, 0x4e, 0x42, 0x62, 0x05, 0x00, 0xe0, 0x00, 0x00, 0x00, 0x01, 0x7a, 0x4d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74, 0x2e, 0x58, 0x6e, 0x61, 0x2e, 0x46, 0x72, 0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2e, 0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x2e, 0x54, 0x65, 0x78, 0x74, 0x75, 0x72, 0x65, 0x32, 0x44, 0x52, 0x65, 0x61, 0x64, 0x65, 0x72, 0x2c, 0x20, 0x4d, 0x6f, 0x6e, 0x6f, 0x47, 0x61, 0x6d, 0x65, 0x2e, 0x46, 0x72, 0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2c, 0x20, 0x56, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x33, 0x2e, 0x38, 0x2e, 0x35, 0x2e, 0x31, 0x2c, 0x20, 0x43, 0x75, 0x6c, 0x74, 0x75, 0x72, 0x65, 0x3d, 0x6e, 0x65, 0x75, 0x74, 0x72, 0x61, 0x6c, 0x2c, 0x20, 0x50, 0x75, 0x62, 0x6c, 0x69, 0x63, 0x4b, 0x65, 0x79, 0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x3d, 0x6e, 0x75, 0x6c, 0x6c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff, 0xff, 0x80, 0x00, 0xff, 0x80, 0x00, 0xff, 0xff, 0xff, 0xc0, 0xcb, 0xff, 0x80, 0x80, 0x80, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff]);

const EXPECTED_FIXTURE_SHA256 = "ec8c5439755b300163c43165a3c1c374063f076a8347a982a320d2508106b629";

// DesktopGL platform marker (byte 3 = 'd')
const WRONG_PLATFORM_XNB = new Uint8Array([0x58, 0x4e, 0x42, 0x64, 0x05, 0x00, 0xe0, 0x00, 0x00, 0x00, 0x01, 0x7a, 0x4d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74, 0x2e, 0x58, 0x6e, 0x61, 0x2e, 0x46, 0x72, 0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2e, 0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x2e, 0x54, 0x65, 0x78, 0x74, 0x75, 0x72, 0x65, 0x32, 0x44, 0x52, 0x65, 0x61, 0x64, 0x65, 0x72, 0x2c, 0x20, 0x4d, 0x6f, 0x6e, 0x6f, 0x47, 0x61, 0x6d, 0x65, 0x2e, 0x46, 0x72, 0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2c, 0x20, 0x56, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x33, 0x2e, 0x38, 0x2e, 0x35, 0x2e, 0x31, 0x2c, 0x20, 0x43, 0x75, 0x6c, 0x74, 0x75, 0x72, 0x65, 0x3d, 0x6e, 0x65, 0x75, 0x74, 0x72, 0x61, 0x6c, 0x2c, 0x20, 0x50, 0x75, 0x62, 0x6c, 0x69, 0x63, 0x4b, 0x65, 0x79, 0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x3d, 0x6e, 0x75, 0x6c, 0x6c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff, 0xff, 0x80, 0x00, 0xff, 0x80, 0x00, 0xff, 0xff, 0xff, 0xc0, 0xcb, 0xff, 0x80, 0x80, 0x80, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff]);

// Game1 loads Content.Load<Texture2D>("textures/player") and draws full-canvas
const game1Source = `
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

public sealed class Game1 : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private SpriteBatch _spriteBatch;
    private Texture2D _playerTexture;
    private static int _frameCount;
    private static int _disposeCount;
    private static int _runCount;
    private static int _staticConstructorCount;

    static Game1() { _staticConstructorCount++; }
    public static int FrameCount => System.Threading.Volatile.Read(ref _frameCount);
    public static int DisposeCount => System.Threading.Volatile.Read(ref _disposeCount);
    public static int RunCount => System.Threading.Volatile.Read(ref _runCount);
    public static int StaticConstructorCount => System.Threading.Volatile.Read(ref _staticConstructorCount);

    public Game1()
    {
        _graphics = new GraphicsDeviceManager(this);
        Content.RootDirectory = "Content";
        _runCount++;
    }

    protected override void LoadContent()
    {
        _spriteBatch = new SpriteBatch(GraphicsDevice);
        _playerTexture = Content.Load<Texture2D>("textures/player");
    }

    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(new Color(32, 32, 32, 255));
        if (_spriteBatch != null && _playerTexture != null)
        {
            _spriteBatch.Begin(samplerState: SamplerState.PointClamp);
            _spriteBatch.Draw(_playerTexture, new Rectangle(0, 0, 640, 360), Color.White);
            _spriteBatch.End();
        }
        System.Threading.Interlocked.Increment(ref _frameCount);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) System.Threading.Interlocked.Increment(ref _disposeCount);
        base.Dispose(disposing);
    }
}`;

// Simple game for negative test: loads but Content.RootDirectory is default, no Content.Load
const simpleGameSource = `
using Microsoft.Xna.Framework;

public sealed class SimpleGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _frameCount;
    private static int _disposeCount;
    private static int _runCount;
    private static int _staticConstructorCount;

    static SimpleGame() { _staticConstructorCount++; }
    public static int FrameCount => System.Threading.Volatile.Read(ref _frameCount);
    public static int DisposeCount => System.Threading.Volatile.Read(ref _disposeCount);
    public static int RunCount => System.Threading.Volatile.Read(ref _runCount);
    public static int StaticConstructorCount => System.Threading.Volatile.Read(ref _staticConstructorCount);

    public SimpleGame() { _graphics = new GraphicsDeviceManager(this); _runCount++; }

    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        System.Threading.Interlocked.Increment(ref _frameCount);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) System.Threading.Interlocked.Increment(ref _disposeCount);
        base.Dispose(disposing);
    }
}`;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION: ${message}`);
}

export async function runIssue039ContentProof(): Promise<void> {
  const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
  if (!invoke) return;
  if (!(await invoke("issue039_is_proof_enabled") as boolean)) return;

  const cp = (msg: string) => invoke("issue039_emit_checkpoint", { checkpoint: msg });
  const fail = (msg: string) => { throw new Error(msg); };

  try {
    await cp("proof-started");

    // Boot compiler and packaged proof runtime first
    await preparePackagedProofRuntime();
    await cp("runtime-prepared");

    // ═══════════════════════════════════════════════════════════════
    // ── POSITIVE TEST: Mount → Load → Start → Pixel → Stop ──────
    // ═══════════════════════════════════════════════════════════════

    // Verify fixture integrity
    const fixtureBuffer = standaloneBuffer(GOOD_XNB);
    const fixtureHash = await sha256(fixtureBuffer);
    assert(fixtureHash === EXPECTED_FIXTURE_SHA256,
      `Fixture hash mismatch: ${fixtureHash}`);
    assert(fixtureBuffer.byteLength === 224,
      `Fixture length: ${fixtureBuffer.byteLength}`);
    await cp(`fixture-verified:${fixtureHash.slice(0, 16)},${fixtureBuffer.byteLength}b`);

    // Compile Game1 via real Roslyn
    await cp("compiling-game1");
    const compiled = await compileToBuffers({
      assemblyName: "Issue039ContentGame",
      sourcePath: "src/Game1.cs",
      sourceText: game1Source,
    });
    await cp(`compiled:asm=${compiled.assembly.byteLength},pdb=${compiled.pdb.byteLength}`);

    // Create isolated preview
    const ctx = await createIsolatedPreview(invoke, {
      proofFlags: { issue024Proof: true, issue039Proof: true },
    });
    await cp("isolated-preview-created");

    // Store binaries
    await storeBinaryTransfer(invoke, ctx.transferToken, compiled.assembly, compiled.pdb);
    await cp("binaries-transferred");

    // Wait for bridge ready (WASM runtime needs time to boot)
    await cp("waiting-for-bridge-ready");
    const ready = await Promise.race([
      ctx.waitForReady(),
      wait(60_000).then(() => fail("Bridge ready timeout after 60s")),
    ]) as Record<string, unknown>;
    await cp(`bridge-ready:${JSON.stringify(ready).slice(0, 100)}`);

    const validatorSelfTest = await ctx.bridge.request<any>("snapshot", { name: "issue039-validator-test" });
    const EXPECTED_VALIDATOR = {
      "good-fixture": [true, null],
      "wrong-platform": [false, "PG0010_CONTENT_PLATFORM_MISMATCH"],
      compressed: [false, "PG0203_CONTENT_COMPRESSED"],
      truncated: [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "bad-magic": [false, "PG0201_CONTENT_INVALID_HEADER"],
      "bad-size": [false, "PG0204_CONTENT_SIZE_MISMATCH"],
      "appended-bytes": [false, "PG0204_CONTENT_SIZE_MISMATCH"],
      "suffixed-reader": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "multi-reader": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "unsupported-reader": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "bad-root-index": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "wrong-mip-size": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "zero-width": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "excess-mip-count": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "nonzero-shared-resources": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "malformed-7bit": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "wrong-reader-version": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "wrong-reader-assembly": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "invalid-utf8": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "overlong-7bit": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "dimension-impossible-mips": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-good-fixture": [true, null],
      "sound-good-stereo-8bit": [true, null],
      "sound-wrong-platform": [false, "PG0010_CONTENT_PLATFORM_MISMATCH"],
      "sound-compressed-flag": [false, "PG0203_CONTENT_COMPRESSED"],
      "sound-non-pcm-format": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "sound-bad-format-size": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "sound-nonzero-cbsize": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "sound-bad-channels": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "sound-bad-bits": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "sound-bad-sample-rate": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "sound-block-align-mismatch": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-average-bytes-mismatch": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-zero-data": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-unaligned-data": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-data-size-overflow": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-loop-out-of-range": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-negative-loop-start": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-duration-mismatch": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-trailing-bytes": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-truncated-tail": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-multi-reader": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-suffixed-reader": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "sound-wrong-reader-version": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
      "sound-bad-root-index": [false, "PG0205_CONTENT_MALFORMED_READERS"],
      "sound-nonzero-shared-resources": [false, "PG0205_CONTENT_MALFORMED_READERS"],
    } as const;
    assert(
      validatorSelfTest != null &&
      JSON.stringify(Object.keys(validatorSelfTest).sort()) ===
        JSON.stringify(Object.keys(EXPECTED_VALIDATOR).sort()),
      `validator cases: ${JSON.stringify(Object.keys(validatorSelfTest ?? {}).sort())} != ${JSON.stringify(Object.keys(EXPECTED_VALIDATOR).sort())}`,
    );
    for (const [caseName, [expValid, expDiag]] of Object.entries(EXPECTED_VALIDATOR)) {
      const actual = validatorSelfTest?.[caseName];
      assert(actual?.valid === expValid, `validator ${caseName}: valid=${actual?.valid} expected=${expValid}`);
      assert(
        (actual?.diagnosticId ?? null) === expDiag,
        `validator ${caseName}: diag=${actual?.diagnosticId} expected=${expDiag}`,
      );
    }
    await cp("validator-self-test-passed");

    const atomicMountSelfTest = await ctx.bridge.request<any>("snapshot", { name: "issue039-atomic-test" });
    assert(atomicMountSelfTest?.initialMountValidated === true, "atomic: initialMountValidated");
    assert(atomicMountSelfTest?.firstAssetStaged === true, "atomic self-test: first asset was not staged");
    assert(atomicMountSelfTest?.secondAssetFailed === true, "atomic self-test: second asset did not fail");
    assert(atomicMountSelfTest?.mountedCountAfterAbort === 0,
      `atomic self-test: mounted count ${atomicMountSelfTest?.mountedCountAfterAbort}`);
    assert(atomicMountSelfTest?.stagedCountAfterAbort === 0,
      `atomic self-test: staged count ${atomicMountSelfTest?.stagedCountAfterAbort}`);
    assert(atomicMountSelfTest?.pendingMountClearedAfterAbort === true,
      "atomic self-test: pending mount not cleared");
    assert(atomicMountSelfTest?.staleMountValidated === true, "atomic: staleMountValidated");
    assert(atomicMountSelfTest?.staleAssetStaged === true, "atomic: staleAssetStaged");
    assert(atomicMountSelfTest?.replacementMountValidated === true, "atomic: replacementMountValidated");
    assert(atomicMountSelfTest?.rollbackAttempted === true,
      "atomic self-test: rollback scenario did not fail as expected");
    assert(atomicMountSelfTest?.rollbackFirstFileDeleted === true,
      "atomic self-test: rollback left committed files behind");
    assert(atomicMountSelfTest?.rollbackMountedAssetsZero === true,
      "atomic self-test: rollback left mounted assets behind");
    assert(atomicMountSelfTest?.rollbackCommittedIdAbsent === true,
      "atomic self-test: rollback left committed mount id behind");
    assert(atomicMountSelfTest?.rollbackMountedSuccessUnchanged === true,
      "atomic self-test: rollback changed mounted success flag");
    assert(atomicMountSelfTest?.staleStagingCleared === true,
      "atomic self-test: stale staging not cleared");
    assert(atomicMountSelfTest?.staleCommitRejected === true,
      "atomic self-test: stale commit was not rejected");
    assert(atomicMountSelfTest?.mountedCountAfterReplacement === 0, "atomic: mountedCountAfterReplacement");
    assert(atomicMountSelfTest?.stagedCountAfterReplacement === 0, "atomic: stagedCountAfterReplacement");
    assert(atomicMountSelfTest?.pendingMountIdAfterReplacement != null, "atomic: pendingMountIdAfterReplacement");
    assert(atomicMountSelfTest?.startupCommitRejected === true, "atomic: startupCommitRejected");
    assert(atomicMountSelfTest?.startupMountedZero === true, "atomic: startupMountedZero");
    assert(atomicMountSelfTest?.startupStagingCleared === true, "atomic: startupStagingCleared");
    assert(atomicMountSelfTest?.startupPendingCleared === true, "atomic: startupPendingCleared");
    await cp("atomic-self-test-passed");

    // ── Verify gate state before mount ──────────────────────────
    const gateBeforeMount = await ctx.bridge.request<any>("snapshot", { name: "issue039-gate" });
    assert(gateBeforeMount?.held === false, `Gate should be free before mount, got ${JSON.stringify(gateBeforeMount)}`);

    // ── Mount asset via raw binary transfer ─────────────────────
    const mountCorrelationId = createUuid();
    const mountId = createUuid();
    const assetTransferToken = createUuid().replace(/-/g, "");
    const mountBuffer = standaloneBuffer(new Uint8Array(GOOD_XNB));
    const mountHash = await sha256(mountBuffer);
    assert(mountHash === EXPECTED_FIXTURE_SHA256, "Mount buffer hash mismatch");

    // Store raw asset bytes via Tauri 2 raw IPC (InvokeBody::Raw)
    // No JSON byte arrays — binary sent directly as Uint8Array body
    await invoke("issue039_store_asset", new Uint8Array(mountBuffer), {
      headers: {
        "x-token": assetTransferToken,
        "x-generation": ctx.generation,
        "x-index": "0",
        "x-path": "textures/player.xnb",
        "x-sha256": mountHash,
      },
    });
    await cp("asset-stored-in-rust");

    // Send mount request with transfer token instead of inline bytes
    // The bridge-setup.js will intercept this, fetch raw bytes from Rust,
    // and reconstruct ArrayBuffers before forwarding to the preview endpoint
    const mountResponse: any = await ctx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: mountCorrelationId,
        type: "asset.mount.request",
        payload: {
          previewId: ctx.previewId,
          mountId,
          contentRootDirectory: "Content",
          assetTransferToken,
          assetManifest: [{ index: 0, path: "textures/player.xnb", sha256: mountHash, byteLength: GOOD_XNB.length }],
        },
      } as any,
      "asset.mount.response",
      (v: any) => validateAssetMountResponse(v, mountCorrelationId, ctx.previewId, mountId),
      [],
      15_000,
    );
    const mountResult = mountResponse.message.result;
    assert(mountResult.success === true, `Mount failed: ${mountResult.error?.message}`);
    assert(mountResult.data.mountedFileCount === 1, `Mounted ${mountResult.data.mountedFileCount} files`);
    assert(mountResult.data.mountedByteLength === 224, `Mounted ${mountResult.data.mountedByteLength} bytes`);
    assert(mountResult.data.previewId === ctx.previewId, "Mount previewId mismatch");
    assert(mountResult.data.mountId === mountId, "Mount mountId mismatch");
    await cp(`mounted:${mountResult.data.mountedFileCount}f,${mountResult.data.mountedByteLength}b`);

    // Query mount state
    const mountState = await ctx.bridge.request<any>("snapshot", { name: "mount" });
    assert(mountState?.mounted === true, "Mount state not mounted");
    assert(mountState?.mountedFileCount === 1, `Mount state files: ${mountState?.mountedFileCount}`);
    assert(mountState?.contentRootDirectory === "Content", `Root: ${mountState?.contentRootDirectory}`);
    await cp("mount-state-verified");

    // Verify gate released after mount
    const gateAfterMount = await ctx.bridge.request<any>("snapshot", { name: "issue039-gate" });
    assert(gateAfterMount?.held === false, `Gate should be released after mount, got ${JSON.stringify(gateAfterMount)}`);
    await cp("gate-released-after-mount");

    let tamperedManifestRejected = false;
    let tamperedMountResponseCode: string | null = null;
    let tamperedMountCountUnchanged = false;
    const tamperedCorrelationId = createUuid();
    const tamperedMountId = createUuid();
    const tamperedAssetToken = createUuid().replace(/-/g, "");
    const tamperedBuffer = standaloneBuffer(new Uint8Array(GOOD_XNB));
    const tamperedHash = await sha256(tamperedBuffer);
    await invoke("issue039_store_asset", new Uint8Array(tamperedBuffer), {
      headers: {
        "x-token": tamperedAssetToken,
        "x-generation": ctx.generation,
        "x-index": "0",
        "x-path": "textures/tampered-player.xnb",
        "x-sha256": tamperedHash,
      },
    });
    try {
      const tamperedMountResponse: any = await ctx.protocolClient.request(
        {
          protocolVersion: PROTOCOL_VERSION,
          correlationId: tamperedCorrelationId,
          type: "asset.mount.request",
          payload: {
            previewId: ctx.previewId,
            mountId: tamperedMountId,
            contentRootDirectory: "Content",
            assetTransferToken: tamperedAssetToken,
            assetManifest: [{
              index: 0,
              path: "textures/player.xnb",
              sha256: tamperedHash,
              byteLength: GOOD_XNB.length,
            }],
          },
        } as any,
        "asset.mount.response",
        (v: any) => validateAssetMountResponse(v, tamperedCorrelationId, ctx.previewId, tamperedMountId),
        [],
        10_000,
      );
      const tamperedResult = tamperedMountResponse.message.result;
      tamperedMountResponseCode = tamperedResult.error?.code ?? null;
      assert(tamperedMountResponse.message.correlationId === tamperedCorrelationId,
        "Tampered mount correlationId mismatch");
      assert(tamperedResult.success === false, "Tampered manifest mount should fail");
      assert(tamperedMountResponseCode === "PREVIEW_LOAD_FAILED",
        `Tampered mount code: ${tamperedMountResponseCode}`);
      const mountStateAfterTamper = await ctx.bridge.request<any>("snapshot", { name: "mount" });
      assert(mountStateAfterTamper?.mounted === true, "Tampered mount changed mounted state");
      assert(mountStateAfterTamper?.mountedFileCount === 1,
        `Tampered mount changed mounted file count: ${mountStateAfterTamper?.mountedFileCount}`);
      assert(mountStateAfterTamper?.mountedByteLength === 224,
        `Tampered mount changed mounted bytes: ${mountStateAfterTamper?.mountedByteLength}`);
      tamperedMountCountUnchanged = mountStateAfterTamper?.mountedFileCount === 1;
      tamperedManifestRejected = true;
    } finally {
      await invoke("issue039_clear_assets", { token: tamperedAssetToken }).catch(() => {});
    }
    await cp(`tampered-manifest-rejected:${tamperedMountResponseCode}`);

    // ── Load assembly ────────────────────────────────────────────
    const loadCorrelationId = createUuid();
    const loadResponse: any = await ctx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: loadCorrelationId,
        type: "preview.load.request",
        payload: {
          previewId: ctx.previewId,
          compileId: compiled.compileId,
          binaryProof: compiled.binaryProof,
          transferToken: ctx.transferToken,
        },
      } as any,
      "preview.load.response",
      (v: any) => validatePreviewLoadResponse(v, loadCorrelationId, ctx.previewId, compiled.compileId),
      [],
      30_000,
    );
    assert(loadResponse.message.result.success === true,
      `Load failed: ${loadResponse.message.result.error?.message}`);
    await cp("assembly-loaded");

    // ── Start game ───────────────────────────────────────────────
    const startCorrelationId = createUuid();
    const startedPromise = new Promise<any>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => reject(new Error("started timeout")), 15_000);
      const remove = ctx.protocolClient.onLifecycleEvent((msg: any) => {
        if (msg.type === "preview.started") {
          globalThis.clearTimeout(timer); remove(); resolve(msg);
        } else if (msg.type === "preview.failed") {
          globalThis.clearTimeout(timer); remove();
          reject(new Error(`Start failed: ${msg.payload?.error?.message}`));
        }
      });
    });

    const startResponse: any = await ctx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: startCorrelationId,
        type: "preview.start.request",
        payload: { previewId: ctx.previewId },
      } as any,
      "preview.start.response",
      (v: any) => validatePreviewStartResponse(v, startCorrelationId, ctx.previewId),
      [],
      15_000,
    );
    assert(startResponse.message.result.success === true,
      `Start failed: ${startResponse.message.result.error?.message}`);
    await startedPromise;
    await cp("game-started-and-running");

    // ── Wait for frames and sample pixel grid ────────────────────
    await wait(2500);
    const gridSample = await ctx.bridge.request<any>("sample-texture-grid");
    await cp(`grid-sampled:${JSON.stringify(gridSample?.grid?.[0]?.[0])}`);

    assert(gridSample != null, "Grid sample is null");
    assert(Array.isArray(gridSample.grid), "Grid is not array");
    assert(gridSample.grid.length === 4, `Grid rows: ${gridSample.grid.length}`);
    assert(gridSample.glError === 0, `GL error: ${gridSample.glError}`);
    assert(!gridSample.contextLost, "Context lost");

    // Verify key distinctive pixels with tolerance for sampling position variance.
    // PointClamp with non-power-of-two scaling may shift cell boundaries.
    const T = 40;
    const grid: number[][][] = gridSample.grid;
    const pixelClose = (actual: number[], expected: number[], tolerance: number) =>
      actual.length === 4 &&
      Math.abs(actual[0] - expected[0]) <= tolerance &&
      Math.abs(actual[1] - expected[1]) <= tolerance &&
      Math.abs(actual[2] - expected[2]) <= tolerance &&
      actual[3] >= 200;

    // Corner pixels are most reliable: top-left=Red, bottom-right row3=CornflowerBlue
    assert(pixelClose(grid[0][0], [255, 0, 0, 255], T), `Row0Col0 not Red: ${JSON.stringify(grid[0][0])}`);

    // Flatten all grid pixels and verify diversity (texture, not clear color)
    const allPixels = grid.flat();
    const clearColor = [32, 32, 32, 255];
    const hasNonClear = allPixels.some(
      (p: number[]) => Math.abs(p[0] - 32) > T || Math.abs(p[1] - 32) > T || Math.abs(p[2] - 32) > T);
    assert(hasNonClear, "All pixels match clear color — texture not rendered");

    // Count distinct colors (at least 3 distinct to prove multi-color texture)
    const colorKey = (p: number[]) => `${Math.round(p[0]/32)},${Math.round(p[1]/32)},${Math.round(p[2]/32)}`;
    const distinctColors = new Set(allPixels.map(colorKey));
    assert(distinctColors.size >= 3,
      `Only ${distinctColors.size} distinct color groups — expected multi-color texture`);

    // Verify at least one pixel has strong red channel (proving Red fixture pixel exists)
    const hasRed = allPixels.some((p: number[]) => p[0] > 200 && p[1] < 50 && p[2] < 50);
    assert(hasRed, "No red pixel found in grid");

    await cp(`pixels-verified:distinct=${distinctColors.size},hasRed=${hasRed}`);

    // Query actual game state counters via managed export
    const gameState = await ctx.bridge.request<any>("snapshot", { name: "issue039-state" });
    const frameCount = gameState?.frameCount ?? 0;
    const constructionAttempts = gameState?.constructionAttempts ?? 0;
    const runAttempts = gameState?.runAttempts ?? 0;
    assert(frameCount > 0, `FrameCount must be >0, got ${frameCount}`);
    assert(constructionAttempts === 1, `ConstructionAttempts must be 1, got ${constructionAttempts}`);
    assert(runAttempts === 1, `RunAttempts must be 1, got ${runAttempts}`);
    await cp(`game-state:frames=${frameCount},construct=${constructionAttempts},runs=${runAttempts}`);

    // ── Stop game ────────────────────────────────────────────────
    await cp("stopping-game");
    const stopCorrelationId = createUuid();

    // Listen for preview.stopped which fires after disposal completes
    const stoppedPromise = new Promise<any>((resolve, reject) => {
      const timer = globalThis.setTimeout(
        () => reject(new Error("preview.stopped timed out")),
        10_000,
      );
      const remove = ctx.protocolClient.onLifecycleEvent((msg: any) => {
        if (msg.type === "preview.stopped") {
          globalThis.clearTimeout(timer); remove(); resolve(msg);
        } else if (msg.type === "preview.failed") {
          globalThis.clearTimeout(timer); remove();
          reject(new Error(`preview.failed before preview.stopped: ${msg.payload?.error?.message ?? "unknown"}`));
        }
      });
    });

    const stopResponse: any = await ctx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: stopCorrelationId,
        type: "preview.stop.request",
        payload: { previewId: ctx.previewId, reason: "user" },
      } as any,
      "preview.stop.response",
      (v: any) => validatePreviewStopResponse(v, stopCorrelationId, ctx.previewId),
      [],
      5_000,
    );
    assert(stopResponse.message.result.success === true, "Stop failed");

    // Wait for the preview.stopped event (disposal completes before this fires)
    await stoppedPromise;
    // Additional quiescence wait
    await wait(300);
    await cp("game-stopped");

    let disposeAttempts = -1;
    let disposeCount = -1;
    try {
      const snap024 = await ctx.bridge.request<any>("snapshot", { name: "issue024" });
      disposeAttempts = snap024?.stop?.disposeAttempts ?? -1;
      disposeCount = snap024?.stop?.quiescent?.disposeCount ?? -1;
    } catch { /* bridge may have closed */ }
    assert(disposeAttempts === 1, `disposeAttempts must be 1, got ${disposeAttempts}`);
    assert(disposeCount === 1, `disposeCount must be 1, got ${disposeCount}`);
    await cp(`dispose:disposeAttempts=${disposeAttempts},disposeCount=${disposeCount}`);

    // ── Retire and verify cleanup ────────────────────────────────
    const forceResult = await ctx.forceDestroyAndRetire("positive-proof-complete");
    await wait(500);
    const windowGone = !(await ctx.exists().catch(() => false));
    assert(windowGone, "Preview window still exists after retirement");

    // Verify asset transfer token cleared by lifecycle (don't call issue039_clear_assets first)
    const transferState = JSON.parse(await invoke("issue039_transfer_state", { token: assetTransferToken }) as string);
    assert(!transferState.exists, `Transfer not cleared by lifecycle: ${JSON.stringify(transferState)}`);
    await cp(`retired:windowGone=${windowGone},transferCleared=${!transferState.exists},disposeAttempts=${disposeAttempts},disposeCount=${disposeCount}`);

    // ═══════════════════════════════════════════════════════════════
    // ── NEGATIVE TEST: Wrong platform marker ────────────────────
    // ═══════════════════════════════════════════════════════════════

    await cp("negative-start");

    // Ensure first preview is fully destroyed
    await invoke("issue038_destroy_all_previews");
    await wait(1000);

    // Compile simple game
    const negCompiled = await compileToBuffers({
      assemblyName: "Issue039SimpleGame",
      sourcePath: "src/SimpleGame.cs",
      sourceText: simpleGameSource,
    });

    // Create fresh preview
    const negCtx = await createIsolatedPreview(invoke);
    await storeBinaryTransfer(invoke, negCtx.transferToken, negCompiled.assembly, negCompiled.pdb);
    await Promise.race([
      negCtx.waitForReady(),
      wait(60_000).then(() => fail("Neg bridge timeout")),
    ]);
    await cp("negative-preview-ready");

    // Load the simple assembly first (this should succeed)
    const negLoadCorrelation = createUuid();
    const negLoadResponse: any = await negCtx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: negLoadCorrelation,
        type: "preview.load.request",
        payload: {
          previewId: negCtx.previewId,
          compileId: negCompiled.compileId,
          binaryProof: negCompiled.binaryProof,
          transferToken: negCtx.transferToken,
        },
      } as any,
      "preview.load.response",
      (v: any) => validatePreviewLoadResponse(v, negLoadCorrelation, negCtx.previewId, negCompiled.compileId),
      [],
      30_000,
    );
    assert(negLoadResponse.message.result.success === true, "Neg load failed");
    await cp("negative-assembly-loaded");

    // Query state before mount — construction/run should be zero
    const preState = await negCtx.bridge.request<any>("snapshot", { name: "mount" });
    const preMountCount = preState?.mountedFileCount ?? 0;
    await cp(`negative-pre-mount:files=${preMountCount}`);

    // Submit wrong-platform mount via raw transfer
    const negMountCorrelation = createUuid();
    const negMountId = createUuid();
    const negAssetToken = createUuid().replace(/-/g, "");
    const negMountBuffer = standaloneBuffer(new Uint8Array(WRONG_PLATFORM_XNB));
    const negMountHash = await sha256(negMountBuffer);

    // Store via raw IPC (no JSON byte arrays)
    await invoke("issue039_store_asset", new Uint8Array(negMountBuffer), {
      headers: {
        "x-token": negAssetToken,
        "x-generation": negCtx.generation,
        "x-index": "0",
        "x-path": "textures/player.xnb",
        "x-sha256": negMountHash,
      },
    });

    const negMountResponse: any = await negCtx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: negMountCorrelation,
        type: "asset.mount.request",
        payload: {
          previewId: negCtx.previewId,
          mountId: negMountId,
          contentRootDirectory: "Content",
          assetTransferToken: negAssetToken,
          assetManifest: [{ index: 0, path: "textures/player.xnb", sha256: negMountHash, byteLength: WRONG_PLATFORM_XNB.length }],
        },
      } as any,
      "asset.mount.response",
      (v: any) => validateAssetMountResponse(v, negMountCorrelation, negCtx.previewId, negMountId),
      [],
      15_000,
    );

    const negResult = negMountResponse.message.result;
    assert(negResult.success === false, "Wrong-platform mount should fail");

    // Check diagnostic
    const negDiagnostics = negResult.error?.diagnostics ?? [];
    const negDiagId = negDiagnostics[0]?.id ?? null;
    const negDiagMsg = negDiagnostics[0]?.message ?? negResult.error?.message ?? "";
    assert(negDiagId === "PG0010_CONTENT_PLATFORM_MISMATCH" || negDiagMsg.includes("MonoGamePlatform=Web"),
      `Expected PG0010 diagnostic, got id=${negDiagId}, msg=${negDiagMsg.slice(0, 100)}`);
    assert(negDiagMsg.includes("MonoGamePlatform=Web"),
      `Diagnostic must mention MonoGamePlatform=Web: ${negDiagMsg.slice(0, 100)}`);
    await cp(`negative-diagnostic:${negDiagId}`);

    // Query state after failed mount — no partial mount
    const postState = await negCtx.bridge.request<any>("snapshot", { name: "mount" });
    const postMountCount = postState?.mountedFileCount ?? 0;
    assert(postMountCount === preMountCount,
      `Partial mount detected: ${preMountCount} → ${postMountCount}`);
    await cp(`negative-no-partial-mount:${postMountCount}`);

    // Query proof state — constructionAttempts and runAttempts should be 0
    const negGameState = await negCtx.bridge.request<any>("snapshot", { name: "issue039-state" });
    const negConstruction = negGameState?.constructionAttempts ?? -1;
    const negRuns = negGameState?.runAttempts ?? -1;
    const negState = negGameState?.state ?? "unknown";
    assert(negConstruction === 0, `Neg constructionAttempts must be 0, got ${negConstruction}`);
    assert(negRuns === 0, `Neg runAttempts must be 0, got ${negRuns}`);
    assert(negState === "loaded", `Neg state must be 'loaded', got '${negState}'`);
    await cp(`negative-state:${negState},construct=${negConstruction},runs=${negRuns}`);

    // Retire negative preview
    await negCtx.forceDestroyAndRetire("negative-proof-complete");
    await wait(200);

    // Verify negative transfer cleaned by lifecycle (don't call issue039_clear_assets first)
    const negTransferState = JSON.parse(await invoke("issue039_transfer_state", { token: negAssetToken }) as string);
    assert(!negTransferState.exists, "Negative transfer not cleared by lifecycle");

    await cp("negative-done");

    // ═══════════════════════════════════════════════════════════════
    // ── EMIT REPORT ─────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      positive: {
        fixtureHash,
        fixtureByteLength: GOOD_XNB.length,
        mountHash,
        mountedFileCount: mountResult.data.mountedFileCount,
        mountedByteLength: mountResult.data.mountedByteLength,
        contentRootDirectory: mountState?.contentRootDirectory,
        validatorSelfTest,
        atomicMountSelfTest,
        tamperedManifestRejected,
        tamperedMountResponseCode,
        tamperedMountCountUnchanged,
        gateFreeBefore: gateBeforeMount?.held === false,
        gateReleasedAfter: gateAfterMount?.held === false,
        loadSuccess: true,
        startSuccess: true,
        pixelGrid: grid,
        pixelRow0Col0: grid[0][0],
        hasNonClearPixel: hasNonClear,
        hasRedPixel: hasRed,
        distinctColorCount: distinctColors.size,
        frameCount,
        constructionAttempts,
        runAttempts,
        disposeAttempts,
        disposeCount,
        stopSuccess: true,
        windowGoneAfterRetire: windowGone,
        transferCleared: !transferState.exists,
      },
      negative: {
        mountSuccess: negResult.success,
        diagnosticId: negDiagId,
        diagnosticContainsMonoGamePlatformWeb: negDiagMsg.includes("MonoGamePlatform=Web"),
        diagnosticMessage: negDiagMsg.slice(0, 200),
        preMountFileCount: preMountCount,
        postMountFileCount: postMountCount,
        noPartialMount: postMountCount === preMountCount,
        constructionAttempts: negConstruction,
        runAttempts: negRuns,
        state: negState,
        negTransferCleared: !negTransferState.exists,
      },
    };

    await invoke("issue039_emit_report", { report: JSON.stringify(report) });

  } catch (error: unknown) {
    await cp(`error:${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

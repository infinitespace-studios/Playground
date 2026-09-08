// Scenario proof suite — Texture / audio content workflow (durable).
//
// Stage-4 consolidation of the former per-issue drivers issue039 (validate and
// mount Web-profile Texture2D content, incl. wrong-platform rejection) and
// issue040 (activate/play/stop a Web-profile SoundEffect across fresh
// previews). The committed fixtures/contracts remain in their own modules.
// Bodies verbatim inside namespaces; markers/report commands unchanged.
// PRODUCT never imports this module.
//
// Preview transport: the EMBEDDED opaque-origin sandboxed iframe (ADR 0003),
// via the shared `createEmbeddedProofPreview` helper — NOT the issue-038
// isolated WebviewWindow bridge. Compiled binaries and content assets are
// transferred INLINE over the in-page protocol port (like the shipping
// `runLivePreviewInPage`), so no Rust transfer store / `issue038_*` /
// `issue039_store_asset` mediation is used.
import {
  compileToBuffers,
  createEmbeddedProofPreview,
  preparePackagedProofRuntime,
  type EmbeddedProofPreviewContext,
} from "./issue21";
import {
  validatePreviewLoadResponse,
  validatePreviewStartResponse,
  validatePreviewStopResponse,
  validateAssetMountResponse,
  sha256,
  standaloneBuffer,
} from "./protocol";
import {
  ISSUE040_FIXTURE_ASSET_NAME,
  ISSUE040_FIXTURE_ASSET_PATH,
  ISSUE040_FIXTURE_BYTE_LENGTH,
  ISSUE040_FIXTURE_DURATION_MS,
  ISSUE040_FIXTURE_SHA256,
  buildIssue040SoundFixture,
} from "./issue040-fixture";
import {
  ISSUE040_EXPECTED_VALIDATOR_CASES,
  ISSUE040_GAME_SOURCE,
} from "./issue040-contract";
import type { UuidV4 } from "../../shared/MessageContracts";
import { runScenario, type SubProof } from "./scenario-runner";

// Deduplicated shared helpers (were redeclared identically inside the issue039
// and issue040 namespaces).
const PROTOCOL_VERSION = 1;
const createUuid = () => crypto.randomUUID() as UuidV4;
const wait = (ms: number) => new Promise<void>(resolve => globalThis.setTimeout(resolve, ms));
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION: ${message}`);
}

// ── Validate + mount Web-profile Texture2D content (former issue039) ──
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

    // Create embedded (in-page) preview
    const ctx = await createEmbeddedProofPreview({
      proofFlags: { issue024Proof: true, issue039Proof: true },
    });
    await cp("isolated-preview-created");

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

    // ── Mount asset via inline transfer over the protocol port ─────────
    const mountCorrelationId = createUuid();
    const mountId = createUuid();
    const mountBuffer = standaloneBuffer(new Uint8Array(GOOD_XNB));
    const mountHash = await sha256(mountBuffer);
    assert(mountHash === EXPECTED_FIXTURE_SHA256, "Mount buffer hash mismatch");

    // Send mount request with the asset bytes INLINE (transferred ArrayBuffer),
    // exactly the shape the shipping in-page live preview uses. The preview's
    // content-type-aware mount gate validates the XNB before staging it.
    const mountResponse: any = await ctx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: mountCorrelationId,
        type: "asset.mount.request",
        payload: {
          previewId: ctx.previewId,
          mountId,
          contentRootDirectory: "Content",
          assets: [{ path: "textures/player.xnb", bytes: mountBuffer }],
        },
      } as any,
      "asset.mount.response",
      (v: any) => validateAssetMountResponse(v, mountCorrelationId, ctx.previewId, mountId),
      [mountBuffer],
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

    // ── Rejected second mount must not disturb the committed mount ──
    // Inline-transport equivalent of the former transfer-token "tampered
    // manifest" probe: submit a SECOND mount whose bytes fail content
    // validation (wrong-platform XNB) and prove the mount gate rejects it
    // atomically, leaving the already-committed good mount unchanged.
    let tamperedManifestRejected = false;
    let tamperedMountResponseCode: string | null = null;
    let tamperedMountCountUnchanged = false;
    const tamperedCorrelationId = createUuid();
    const tamperedMountId = createUuid();
    const tamperedBuffer = standaloneBuffer(new Uint8Array(WRONG_PLATFORM_XNB));
    {
      const tamperedMountResponse: any = await ctx.protocolClient.request(
        {
          protocolVersion: PROTOCOL_VERSION,
          correlationId: tamperedCorrelationId,
          type: "asset.mount.request",
          payload: {
            previewId: ctx.previewId,
            mountId: tamperedMountId,
            contentRootDirectory: "Content",
            assets: [{ path: "textures/player.xnb", bytes: tamperedBuffer }],
          },
        } as any,
        "asset.mount.response",
        (v: any) => validateAssetMountResponse(v, tamperedCorrelationId, ctx.previewId, tamperedMountId),
        [tamperedBuffer],
        10_000,
      );
      const tamperedResult = tamperedMountResponse.message.result;
      tamperedMountResponseCode = tamperedResult.error?.code ?? null;
      assert(tamperedMountResponse.message.correlationId === tamperedCorrelationId,
        "Tampered mount correlationId mismatch");
      assert(tamperedResult.success === false, "Wrong-platform second mount should fail");
      const mountStateAfterTamper = await ctx.bridge.request<any>("snapshot", { name: "mount" });
      assert(mountStateAfterTamper?.mounted === true, "Tampered mount changed mounted state");
      assert(mountStateAfterTamper?.mountedFileCount === 1,
        `Tampered mount changed mounted file count: ${mountStateAfterTamper?.mountedFileCount}`);
      assert(mountStateAfterTamper?.mountedByteLength === 224,
        `Tampered mount changed mounted bytes: ${mountStateAfterTamper?.mountedByteLength}`);
      tamperedMountCountUnchanged = mountStateAfterTamper?.mountedFileCount === 1;
      tamperedManifestRejected = true;
    }
    await cp(`tampered-manifest-rejected:${tamperedMountResponseCode}`);

    // ── Load assembly ────────────────────────────────────────────
    const loadCorrelationId = createUuid();
    const loadAssembly = standaloneBuffer(new Uint8Array(compiled.assembly));
    const loadPdb = standaloneBuffer(new Uint8Array(compiled.pdb));
    const loadResponse: any = await ctx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: loadCorrelationId,
        type: "preview.load.request",
        payload: {
          previewId: ctx.previewId,
          compileId: compiled.compileId,
          assembly: loadAssembly,
          pdb: loadPdb,
          binaryProof: compiled.binaryProof,
        },
      } as any,
      "preview.load.response",
      (v: any) => validatePreviewLoadResponse(v, loadCorrelationId, ctx.previewId, compiled.compileId),
      [loadAssembly, loadPdb],
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

    // In-page transport: the compiled binaries and asset bytes were transferred
    // INLINE (detached ArrayBuffers) over the protocol port; retiring the iframe
    // drops every reference. transferCleared mirrors the retired-frame state.
    const transferCleared = windowGone && ctx.retired;
    assert(transferCleared, "Preview iframe/context not fully retired");
    await cp(`retired:windowGone=${windowGone},transferCleared=${transferCleared},disposeAttempts=${disposeAttempts},disposeCount=${disposeCount}`);

    // ═══════════════════════════════════════════════════════════════
    // ── NEGATIVE TEST: Wrong platform marker ────────────────────
    // ═══════════════════════════════════════════════════════════════

    await cp("negative-start");
    await wait(500);

    // Compile simple game
    const negCompiled = await compileToBuffers({
      assemblyName: "Issue039SimpleGame",
      sourcePath: "src/SimpleGame.cs",
      sourceText: simpleGameSource,
    });

    // Create fresh embedded preview (fresh realm/runtime)
    const negCtx = await createEmbeddedProofPreview({
      proofFlags: { issue024Proof: true, issue039Proof: true },
    });
    await Promise.race([
      negCtx.waitForReady(),
      wait(60_000).then(() => fail("Neg bridge timeout")),
    ]);
    await cp("negative-preview-ready");

    // Load the simple assembly first (this should succeed) — INLINE transfer
    const negLoadCorrelation = createUuid();
    const negLoadAssembly = standaloneBuffer(new Uint8Array(negCompiled.assembly));
    const negLoadPdb = standaloneBuffer(new Uint8Array(negCompiled.pdb));
    const negLoadResponse: any = await negCtx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: negLoadCorrelation,
        type: "preview.load.request",
        payload: {
          previewId: negCtx.previewId,
          compileId: negCompiled.compileId,
          assembly: negLoadAssembly,
          pdb: negLoadPdb,
          binaryProof: negCompiled.binaryProof,
        },
      } as any,
      "preview.load.response",
      (v: any) => validatePreviewLoadResponse(v, negLoadCorrelation, negCtx.previewId, negCompiled.compileId),
      [negLoadAssembly, negLoadPdb],
      30_000,
    );
    assert(negLoadResponse.message.result.success === true, "Neg load failed");
    await cp("negative-assembly-loaded");

    // Query state before mount — construction/run should be zero
    const preState = await negCtx.bridge.request<any>("snapshot", { name: "mount" });
    const preMountCount = preState?.mountedFileCount ?? 0;
    await cp(`negative-pre-mount:files=${preMountCount}`);

    // Submit wrong-platform mount via INLINE transfer
    const negMountCorrelation = createUuid();
    const negMountId = createUuid();
    const negMountBuffer = standaloneBuffer(new Uint8Array(WRONG_PLATFORM_XNB));
    const negMountHash = await sha256(negMountBuffer);

    const negMountResponse: any = await negCtx.protocolClient.request(
      {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: negMountCorrelation,
        type: "asset.mount.request",
        payload: {
          previewId: negCtx.previewId,
          mountId: negMountId,
          contentRootDirectory: "Content",
          assets: [{ path: "textures/player.xnb", bytes: negMountBuffer }],
        },
      } as any,
      "asset.mount.response",
      (v: any) => validateAssetMountResponse(v, negMountCorrelation, negCtx.previewId, negMountId),
      [negMountBuffer],
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

    // In-page transport: retiring the iframe drops the inline-transferred bytes.
    const negWindowGone = !(await negCtx.exists().catch(() => false));
    const negTransferCleared = negWindowGone && negCtx.retired;
    assert(negTransferCleared, "Negative preview iframe/context not fully retired");

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
        transferCleared,
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
        negTransferCleared,
      },
    };

    await invoke("issue039_emit_report", { report: JSON.stringify(report) });

  } catch (error: unknown) {
    await cp(`error:${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ── Activate/play/stop Web-profile SoundEffect across fresh previews (former issue040) ──
interface ManagedAudioState {
  gameTypeObserved: boolean;
  soundLoadedCount: number | null;
  soundAssetName: string | null;
  soundDurationMilliseconds: number | null;
  playInvocationCount: number | null;
  stopInvocationCount: number | null;
  stateAfterPlay: string | null;
  stateAtStopCall: string | null;
  stateAfterStop: string | null;
  currentInstanceState: string | null;
  observedPlayingUpdateCount: number | null;
  triggerObservationCount: number | null;
  lastTriggerSource: string | null;
  audioErrorText: string | null;
}

interface AudioSample {
  label: string;
  windowCount: number;
  nonSilentWindows: number;
  maxPeak: number;
  maxRms: number;
  contextState: string;
  samples: Array<{ atMs: number; peak: number; rms: number }>;
}

interface AudioProbeSnapshot {
  installed: boolean;
  analyserInstalled: boolean;
  destinationConnections: number;
  contextCount: number;
  contexts: Array<Record<string, unknown>>;
  inputEvents: Array<Record<string, unknown>>;
  resumeAttempts: Array<Record<string, unknown>>;
  userActivation: { isActive: boolean; hasBeenActive: boolean } | null;
  errors: string[];
}

async function pollUntil<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 150,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && performance.now() < deadline) {
    await wait(intervalMs);
    value = await read();
  }
  return value;
}

function summarizeSample(sample: AudioSample) {
  return {
    label: sample.label,
    windowCount: sample.windowCount,
    nonSilentWindows: sample.nonSilentWindows,
    maxPeak: sample.maxPeak,
    maxRms: sample.maxRms,
    contextState: sample.contextState,
    firstWindows: sample.samples.slice(0, 4),
    lastWindows: sample.samples.slice(-4),
  };
}

export async function runIssue040AudioProof(): Promise<void> {
  const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
  if (!invoke) return;
  if (!(await invoke("issue040_is_proof_enabled") as boolean)) return;

  const cp = (message: string) => invoke("issue040_emit_checkpoint", { checkpoint: message });

  try {
    await cp("proof-started");
    await preparePackagedProofRuntime();
    await cp("runtime-prepared");

    // The fixture bytes are rebuilt here and hash-pinned to the committed
    // repository fixture, so the mounted asset is provably that file.
    const fixture = buildIssue040SoundFixture();
    const fixtureBuffer = standaloneBuffer(fixture);
    const fixtureHash = await sha256(fixtureBuffer);
    assert(fixtureHash === ISSUE040_FIXTURE_SHA256, `Fixture hash mismatch: ${fixtureHash}`);
    assert(fixture.length === ISSUE040_FIXTURE_BYTE_LENGTH, `Fixture length: ${fixture.length}`);
    await cp(`fixture-verified:${fixtureHash.slice(0, 16)},${fixture.length}b`);

    const compiled = await compileToBuffers({
      assemblyName: "Issue040AudioGame",
      sourcePath: "src/Game1.cs",
      sourceText: ISSUE040_GAME_SOURCE,
    });
    await cp(`compiled:asm=${compiled.assembly.byteLength},pdb=${compiled.pdb.byteLength}`);

    const instances: Array<Record<string, unknown>> = [];
    let validatorSelfTest: Record<string, { valid: boolean; diagnosticId: string | null }> | null = null;

    for (const instanceIndex of [1, 2]) {
      const tag = `instance${instanceIndex}`;
      await cp(`${tag}:creating-preview`);

      // A brand-new embedded preview: new realm, new WASM runtime, new
      // audio context — exactly the issue 25 clean-restart shape, now in the
      // in-page opaque-origin sandboxed iframe (ADR 0003).
      const ctx: EmbeddedProofPreviewContext = await createEmbeddedProofPreview({
        proofFlags: { issue024Proof: true, issue039Proof: true, issue040Proof: true },
        issue040EmbeddedInput: true,
      });
      const instanceRecord: Record<string, unknown> = {
        instanceIndex,
        previewId: ctx.previewId,
        generation: ctx.generation,
        label: ctx.label,
      };

      try {
        const ready = await Promise.race([
          ctx.waitForReady(),
          wait(60_000).then(() => { throw new Error(`${tag}: bridge ready timeout`); }),
        ]) as Record<string, unknown>;
        instanceRecord.realmToken = ready.realmToken;
        instanceRecord.opaqueOrigin = ready.opaqueOrigin;
        instanceRecord.runtimeStarts = ready.runtimeStarts;
        await cp(`${tag}:bridge-ready:${String(ready.realmToken).slice(0, 8)}`);

        if (instanceIndex === 1) {
          validatorSelfTest = await ctx.bridge.request("snapshot", { name: "issue039-validator-test" });
          assert(validatorSelfTest != null, "validator self-test returned null");
          const actualKeys = Object.keys(validatorSelfTest).sort();
          const expectedKeys = Object.keys(ISSUE040_EXPECTED_VALIDATOR_CASES).sort();
          assert(
            JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
            `validator cases: ${JSON.stringify(actualKeys)} != ${JSON.stringify(expectedKeys)}`,
          );
          for (const [name, [expectedValid, expectedDiagnostic]] of
            Object.entries(ISSUE040_EXPECTED_VALIDATOR_CASES)) {
            const actual = validatorSelfTest[name];
            assert(actual?.valid === expectedValid,
              `validator ${name}: valid=${actual?.valid} expected=${expectedValid}`);
            assert((actual?.diagnosticId ?? null) === expectedDiagnostic,
              `validator ${name}: diagnostic=${actual?.diagnosticId} expected=${expectedDiagnostic}`);
          }
          await cp("validator-self-test-passed");
        }

        // ── Arm audio instrumentation before the runtime creates any context ──
        const armed = await ctx.bridge.request<AudioProbeSnapshot & { installed: boolean }>(
          "issue040-audio-arm");
        assert(armed.installed === true, `${tag}: audio probe not installed`);
        assert(armed.contextCount === 0,
          `${tag}: preview already had ${armed.contextCount} audio contexts before start`);
        instanceRecord.audioProbeArmed = {
          installed: armed.installed,
          contextCountBeforeStart: armed.contextCount,
          userActivationBeforeGesture: armed.userActivation,
        };
        await cp(`${tag}:audio-armed`);

        // ── Mount the SoundEffect fixture INLINE over the protocol port ──
        const mountId = createUuid();
        const mountCorrelationId = createUuid();
        const mountBuffer = standaloneBuffer(new Uint8Array(fixture));
        const mountHash = await sha256(mountBuffer);
        assert(mountHash === ISSUE040_FIXTURE_SHA256, `${tag}: mount buffer hash mismatch`);

        const mountResponse: any = await ctx.protocolClient.request(
          {
            protocolVersion: PROTOCOL_VERSION,
            correlationId: mountCorrelationId,
            type: "asset.mount.request",
            payload: {
              previewId: ctx.previewId,
              mountId,
              contentRootDirectory: "Content",
              assets: [{ path: ISSUE040_FIXTURE_ASSET_PATH, bytes: mountBuffer }],
            },
          } as any,
          "asset.mount.response",
          (value: any) => validateAssetMountResponse(value, mountCorrelationId, ctx.previewId, mountId),
          [mountBuffer],
          20_000,
        );
        const mountResult = mountResponse.message.result;
        assert(mountResult.success === true, `${tag}: mount failed: ${mountResult.error?.message}`);
        assert(mountResult.data.mountedFileCount === 1,
          `${tag}: mounted ${mountResult.data.mountedFileCount} files`);
        assert(mountResult.data.mountedByteLength === ISSUE040_FIXTURE_BYTE_LENGTH,
          `${tag}: mounted ${mountResult.data.mountedByteLength} bytes`);
        const mountState = await ctx.bridge.request<any>("snapshot", { name: "mount" });
        assert(mountState?.mounted === true, `${tag}: mount state not mounted`);
        instanceRecord.mount = {
          mountId,
          mountedFileCount: mountResult.data.mountedFileCount,
          mountedByteLength: mountResult.data.mountedByteLength,
          contentRootDirectory: mountState?.contentRootDirectory,
          sha256: mountHash,
        };
        await cp(`${tag}:mounted:${mountResult.data.mountedByteLength}b`);

        // ── Load and start the game (INLINE binary transfer) ──
        const loadCorrelationId = createUuid();
        const loadAssembly = standaloneBuffer(new Uint8Array(compiled.assembly));
        const loadPdb = standaloneBuffer(new Uint8Array(compiled.pdb));
        const loadResponse: any = await ctx.protocolClient.request(
          {
            protocolVersion: PROTOCOL_VERSION,
            correlationId: loadCorrelationId,
            type: "preview.load.request",
            payload: {
              previewId: ctx.previewId,
              compileId: compiled.compileId,
              assembly: loadAssembly,
              pdb: loadPdb,
              binaryProof: compiled.binaryProof,
            },
          } as any,
          "preview.load.response",
          (value: any) => validatePreviewLoadResponse(
            value, loadCorrelationId, ctx.previewId, compiled.compileId),
          [loadAssembly, loadPdb],
          30_000,
        );
        assert(loadResponse.message.result.success === true,
          `${tag}: load failed: ${loadResponse.message.result.error?.message}`);

        const startCorrelationId = createUuid();
        const startedPromise = new Promise<any>((resolve, reject) => {
          const timer = globalThis.setTimeout(() => reject(new Error(`${tag}: started timeout`)), 20_000);
          const remove = ctx.protocolClient.onLifecycleEvent((message: any) => {
            if (message.type === "preview.started") {
              globalThis.clearTimeout(timer); remove(); resolve(message);
            } else if (message.type === "preview.failed") {
              globalThis.clearTimeout(timer); remove();
              reject(new Error(`${tag}: start failed: ${message.payload?.error?.message}`));
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
          (value: any) => validatePreviewStartResponse(value, startCorrelationId, ctx.previewId),
          [],
          20_000,
        );
        assert(startResponse.message.result.success === true,
          `${tag}: start failed: ${startResponse.message.result.error?.message}`);
        await startedPromise;
        await cp(`${tag}:game-started`);

        // ── Content.Load<SoundEffect> evidence ──
        const readManaged = () =>
          ctx.bridge.request<ManagedAudioState>("snapshot", { name: "issue040-managed-audio" });
        const loadedState = await pollUntil(
          readManaged, state => (state?.soundLoadedCount ?? 0) > 0, 20_000);
        assert(loadedState.soundLoadedCount === 1,
          `${tag}: SoundEffect load count ${loadedState.soundLoadedCount} (errors: ${loadedState.audioErrorText})`);
        assert(loadedState.soundAssetName === ISSUE040_FIXTURE_ASSET_NAME,
          `${tag}: loaded asset name ${loadedState.soundAssetName}`);
        assert(loadedState.soundDurationMilliseconds === ISSUE040_FIXTURE_DURATION_MS,
          `${tag}: loaded duration ${loadedState.soundDurationMilliseconds} ms`);
        instanceRecord.contentLoad = {
          soundLoadedCount: loadedState.soundLoadedCount,
          soundAssetName: loadedState.soundAssetName,
          soundDurationMilliseconds: loadedState.soundDurationMilliseconds,
        };
        await cp(`${tag}:sound-loaded:${loadedState.soundAssetName},${loadedState.soundDurationMilliseconds}ms`);

        // ── Audio context exists and is locked until a real gesture arrives ──
        const beforeGesture = await pollUntil(
          () => ctx.bridge.request<AudioProbeSnapshot>("snapshot", { name: "issue040-audio" }),
          snapshot => snapshot.contextCount > 0,
          20_000,
        );
        assert(beforeGesture.contextCount >= 1,
          `${tag}: runtime created no AudioContext (${JSON.stringify(beforeGesture.errors)})`);
        const contextBefore = beforeGesture.contexts[0] as Record<string, unknown>;
        const stateBeforeGesture = String(contextBefore.state);
        const trustedInputsBefore = beforeGesture.inputEvents.filter(event => event.trusted === true).length;
        instanceRecord.audioBeforeGesture = {
          contextCount: beforeGesture.contextCount,
          state: stateBeforeGesture,
          initialState: contextBefore.initialState,
          analyserInstalled: beforeGesture.analyserInstalled,
          destinationConnections: beforeGesture.destinationConnections,
          userActivation: beforeGesture.userActivation,
          trustedInputEvents: trustedInputsBefore,
        };
        assert(beforeGesture.analyserInstalled === true,
          `${tag}: no analyser spliced in front of the audio destination`);
        await cp(`${tag}:audio-context-before-gesture:${stateBeforeGesture}`);

        const managedBeforeGesture = await readManaged();
        assert((managedBeforeGesture.playInvocationCount ?? 0) === 0,
          `${tag}: game played before any gesture`);

        // Put the audio device back into the autoplay-locked state so the only
        // path back to "running" is the real user gesture dispatched below.
        const locked = await ctx.bridge.request<any>("issue040-audio-lock");
        const lockedState = String(locked?.snapshot?.contexts?.[0]?.state);
        assert(lockedState === "suspended",
          `${tag}: audio context did not lock: ${JSON.stringify(locked?.locked)}`);
        instanceRecord.audioLocked = locked.locked;
        await cp(`${tag}:audio-locked:${lockedState}`);

        // ── Trusted Space key press: unlocks audio and triggers Play() ──
        // Focus the embedded opaque-origin preview iframe first so the native
        // host's trusted key event lands on the focused preview document, not
        // Monaco or the host shell.
        ctx.focusPreviewFrame();
        const playDispatch = JSON.parse(await invoke("issue040_dispatch_preview_input", {
          generation: ctx.generation, kind: "space-down",
        }) as string);
        await wait(500);
        ctx.focusPreviewFrame();
        await invoke("issue040_dispatch_preview_input", {
          generation: ctx.generation, kind: "space-up",
        });
        await cp(`${tag}:play-gesture-dispatched:${JSON.stringify(playDispatch).slice(0, 400)}`);

        const afterGesture = await pollUntil(
          () => ctx.bridge.request<AudioProbeSnapshot>("snapshot", { name: "issue040-audio" }),
          snapshot => snapshot.contexts.some(context => context.state === "running") &&
            snapshot.inputEvents.some(event => event.trusted === true && event.type === "keydown"),
          15_000,
        );
        await cp(`${tag}:gesture-observations:${JSON.stringify({
          contexts: afterGesture.contexts.map(context => context.state),
          inputEvents: afterGesture.inputEvents.slice(0, 8),
          userActivation: afterGesture.userActivation,
          resumeAttempts: afterGesture.resumeAttempts.slice(0, 4),
        }).slice(0, 3500)}`);
        const contextAfter = afterGesture.contexts[0] as Record<string, unknown>;
        const trustedGestures = afterGesture.inputEvents.filter(event => event.trusted === true);
        const trustedKeyDown = trustedGestures.find(
          event => event.type === "keydown" && event.code === "Space");
        assert(trustedGestures.length > 0,
          `${tag}: no trusted input event reached the preview document`);
        assert(trustedKeyDown != null,
          `${tag}: no trusted Space keydown observed: ${JSON.stringify(trustedGestures).slice(0, 300)}`);
        assert(String(contextAfter.state) === "running",
          `${tag}: audio context state after gesture is ${contextAfter.state}`);
        instanceRecord.audioActivation = {
          stateAtDeviceOpen: stateBeforeGesture,
          stateBeforeGesture: lockedState,
          stateAfterGesture: contextAfter.state,
          transitions: contextAfter.transitions,
          trustedGesture: trustedKeyDown,
          userActivation: afterGesture.userActivation,
          resumeAttempts: afterGesture.resumeAttempts,
          dispatch: playDispatch,
        };
        await cp(`${tag}:audio-running-after-trusted-gesture`);

        // ── Managed play evidence ──
        const playState = await pollUntil(
          readManaged, state => (state?.playInvocationCount ?? 0) > 0, 15_000);
        await cp(`${tag}:managed-after-gesture:${JSON.stringify(playState).slice(0, 1200)}`);
        assert(playState.playInvocationCount === 1,
          `${tag}: play invocations ${playState.playInvocationCount} (errors: ${playState.audioErrorText})`);
        assert(playState.stateAfterPlay === "Playing",
          `${tag}: SoundEffectInstance state after Play() is ${playState.stateAfterPlay}`);
        const playingState = await pollUntil(
          readManaged, state => (state?.observedPlayingUpdateCount ?? 0) > 5, 10_000);
        assert((playingState.observedPlayingUpdateCount ?? 0) > 5,
          `${tag}: only ${playingState.observedPlayingUpdateCount} updates observed Playing`);
        await cp(`${tag}:managed-playing:${playState.stateAfterPlay},trigger=${playState.lastTriggerSource}`);

        // ── Measured audio output while playing ──
        const playingSample = await ctx.bridge.request<AudioSample>(
          "issue040-audio-sample", { durationMs: 900, label: `${tag}-playing` });
        assert(playingSample.contextState === "running",
          `${tag}: context not running during playback sample`);
        assert(playingSample.maxPeak > 0.005,
          `${tag}: playback peak ${playingSample.maxPeak} is silent`);
        assert(playingSample.nonSilentWindows > 5,
          `${tag}: only ${playingSample.nonSilentWindows} non-silent windows during playback`);
        await cp(`${tag}:playing-signal:peak=${playingSample.maxPeak.toFixed(5)},rms=${playingSample.maxRms.toFixed(5)}`);

        // ── Trusted Escape key press: SoundEffectInstance.Stop() ──
        ctx.focusPreviewFrame();
        await invoke("issue040_dispatch_preview_input", {
          generation: ctx.generation, kind: "escape-down",
        });
        await wait(400);
        ctx.focusPreviewFrame();
        await invoke("issue040_dispatch_preview_input", {
          generation: ctx.generation, kind: "escape-up",
        });
        const stoppedState = await pollUntil(
          readManaged,
          state => (state?.stopInvocationCount ?? 0) > 0 && state?.stateAfterStop === "Stopped",
          15_000);
        assert(stoppedState.stopInvocationCount === 1,
          `${tag}: stop invocations ${stoppedState.stopInvocationCount} (errors: ${stoppedState.audioErrorText})`);
        assert(stoppedState.stateAfterStop === "Stopped",
          `${tag}: SoundEffectInstance state after Stop() settled as ${stoppedState.stateAfterStop}`);
        const quiescent = await pollUntil(
          readManaged, state => state?.currentInstanceState === "Stopped", 10_000);
        assert(quiescent.currentInstanceState === "Stopped",
          `${tag}: instance state after stop is ${quiescent.currentInstanceState}`);
        const playingUpdatesAtStop = quiescent.observedPlayingUpdateCount ?? 0;
        await cp(`${tag}:managed-stopped:${stoppedState.stateAfterStop},atCall=${stoppedState.stateAtStopCall}`);

        // ── Measured silence after Stop() ──
        await wait(300);
        const stoppedSample = await ctx.bridge.request<AudioSample>(
          "issue040-audio-sample", { durationMs: 900, label: `${tag}-stopped` });
        assert(stoppedSample.contextState === "running",
          `${tag}: context left running state after stop: ${stoppedSample.contextState}`);
        assert(stoppedSample.maxPeak < playingSample.maxPeak / 10,
          `${tag}: post-stop peak ${stoppedSample.maxPeak} is not silent versus ${playingSample.maxPeak}`);
        assert(stoppedSample.nonSilentWindows === 0,
          `${tag}: ${stoppedSample.nonSilentWindows} non-silent windows after Stop()`);
        await cp(`${tag}:stopped-signal:peak=${stoppedSample.maxPeak.toFixed(5)}`);

        const finalManaged = await readManaged();
        assert((finalManaged.audioErrorText ?? "") === "",
          `${tag}: managed audio errors: ${finalManaged.audioErrorText}`);
        assert((finalManaged.observedPlayingUpdateCount ?? 0) === playingUpdatesAtStop,
          `${tag}: instance reported Playing again after Stop() ` +
          `(${playingUpdatesAtStop} -> ${finalManaged.observedPlayingUpdateCount})`);

        instanceRecord.playback = {
          playInvocationCount: playState.playInvocationCount,
          stateAfterPlay: playState.stateAfterPlay,
          triggerSource: playState.lastTriggerSource,
          observedPlayingUpdateCount: playingState.observedPlayingUpdateCount,
          playingSample: summarizeSample(playingSample),
        };
        instanceRecord.stop = {
          stopInvocationCount: stoppedState.stopInvocationCount,
          stateAtStopCall: stoppedState.stateAtStopCall,
          stateAfterStop: stoppedState.stateAfterStop,
          playingUpdatesAtStop,
          currentInstanceState: quiescent.currentInstanceState,
          stoppedSample: summarizeSample(stoppedSample),
          silenceRatio: playingSample.maxPeak > 0
            ? stoppedSample.maxPeak / playingSample.maxPeak
            : null,
        };
        instanceRecord.managedFinal = finalManaged;

        // ── Stop the preview and retire the window ──
        const stopCorrelationId = createUuid();
        const stoppedPromise = new Promise<any>((resolve, reject) => {
          const timer = globalThis.setTimeout(
            () => reject(new Error(`${tag}: preview.stopped timeout`)), 15_000);
          const remove = ctx.protocolClient.onLifecycleEvent((message: any) => {
            if (message.type === "preview.stopped") {
              globalThis.clearTimeout(timer); remove(); resolve(message);
            } else if (message.type === "preview.failed") {
              globalThis.clearTimeout(timer); remove();
              reject(new Error(`${tag}: preview.failed before stopped`));
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
          (value: any) => validatePreviewStopResponse(value, stopCorrelationId, ctx.previewId),
          [],
          10_000,
        );
        assert(stopResponse.message.result.success === true, `${tag}: preview stop failed`);
        await stoppedPromise;
        await wait(300);

        let disposeAttempts = -1;
        let disposeCount = -1;
        try {
          const stopSnapshot = await ctx.bridge.request<any>("snapshot", { name: "issue024" });
          disposeAttempts = stopSnapshot?.stop?.disposeAttempts ?? -1;
          disposeCount = stopSnapshot?.stop?.quiescent?.disposeCount ?? -1;
        } catch { /* bridge may already be closing */ }
        assert(disposeAttempts === 1, `${tag}: disposeAttempts ${disposeAttempts}`);
        assert(disposeCount === 1, `${tag}: disposeCount ${disposeCount}`);
        instanceRecord.teardown = { disposeAttempts, disposeCount };

        await ctx.forceDestroyAndRetire(`${tag}-complete`);
        await wait(500);
        const windowGone = !(await ctx.exists().catch(() => false));
        assert(windowGone, `${tag}: preview window still exists after retirement`);
        // In-page transport: retiring the iframe drops the inline-transferred
        // asset/binary bytes; there is no Rust transfer store to poll.
        const assetTransferCleared = windowGone && ctx.retired;
        assert(assetTransferCleared, `${tag}: preview iframe/context not fully retired`);
        instanceRecord.retirement = { windowGone, assetTransferCleared };
        await cp(`${tag}:retired`);
      } finally {
        await ctx.forceDestroyAndRetire(`${tag}-cleanup`).catch(() => {});
      }

      instances.push(instanceRecord);
      await wait(1_000);
    }

    const [first, second] = instances;
    const freshPreview =
      first.previewId !== second.previewId &&
      first.generation !== second.generation &&
      first.realmToken !== second.realmToken &&
      first.label !== second.label;
    assert(freshPreview, "second preview was not a brand-new embedded instance");

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE040_PROOF=1",
      fixture: {
        assetPath: ISSUE040_FIXTURE_ASSET_PATH,
        assetName: ISSUE040_FIXTURE_ASSET_NAME,
        sha256: ISSUE040_FIXTURE_SHA256,
        byteLength: ISSUE040_FIXTURE_BYTE_LENGTH,
        durationMilliseconds: ISSUE040_FIXTURE_DURATION_MS,
      },
      validatorSelfTest,
      freshPreview,
      instances,
    };
    await invoke("issue040_emit_report", { report: JSON.stringify(report) });
  } catch (error: unknown) {
    const message = error instanceof Error
      ? `${error.message} @ ${error.stack ?? "no stack"}`
      : String(error);
    await cp(`error:${message.slice(0, 500)}`).catch(() => {});
    await invoke("issue040_emit_report", {
      report: JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        failure: message,
      }),
    }).catch(() => {});
    throw error;
  }
}

// Single durable-scenario entrypoint. Orchestrates the texture (issue039) and
// audio (issue040) content sub-proofs; each self-gates on its own env flag and
// emits its own success report, while this driver owns per-sub-proof failure
// reporting.
export async function runContentWorkflowScenario(): Promise<void> {
  const subProofs: SubProof[] = [
    { label: "texture validate + mount (issue039)", reportCommand: "issue039_emit_report", run: runIssue039ContentProof },
    { label: "audio activate/play/stop (issue040)", reportCommand: "issue040_emit_report", run: runIssue040AudioProof },
  ];
  await runScenario(subProofs);
}

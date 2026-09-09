using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Xna.Framework;

namespace Playground.Preview;

// Proof-only preview surface. This compilation unit is included ONLY when the
// preview is built/staged for the PROOF profile (MONOGAME_FRONTEND_PROFILE=proof
// selects the `MonoGamePreviewProof` MSBuild constant/item in the csproj). The
// default PRODUCT publish never compiles this file, so the shipped preview wasm
// carries none of these JSExports, proof fixtures, or self-test surfaces.
//
// Everything here is a proof/scenario instrumentation surface (issue 034 FS
// probe, issue 039 content-state, issue 040 audio-state, the mount/validator/
// transcoder/writer/runner self-tests, and the stopped-game quiescence proof).
// It reaches into the SAME `PreviewExports` partial as the product runtime, so
// it observes product state without duplicating any product lifecycle code.
public static partial class PreviewExports
{
    private static readonly byte[] Issue039GoodXnb =
    [
        0x58, 0x4e, 0x42, 0x62, 0x05, 0x00, 0xe0, 0x00, 0x00, 0x00, 0x01, 0x7a,
        0x4d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74, 0x2e, 0x58, 0x6e,
        0x61, 0x2e, 0x46, 0x72, 0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2e,
        0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x2e, 0x54, 0x65, 0x78, 0x74,
        0x75, 0x72, 0x65, 0x32, 0x44, 0x52, 0x65, 0x61, 0x64, 0x65, 0x72, 0x2c,
        0x20, 0x4d, 0x6f, 0x6e, 0x6f, 0x47, 0x61, 0x6d, 0x65, 0x2e, 0x46, 0x72,
        0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2c, 0x20, 0x56, 0x65, 0x72,
        0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x33, 0x2e, 0x38, 0x2e, 0x35, 0x2e, 0x31,
        0x2c, 0x20, 0x43, 0x75, 0x6c, 0x74, 0x75, 0x72, 0x65, 0x3d, 0x6e, 0x65,
        0x75, 0x74, 0x72, 0x61, 0x6c, 0x2c, 0x20, 0x50, 0x75, 0x62, 0x6c, 0x69,
        0x63, 0x4b, 0x65, 0x79, 0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x3d, 0x6e, 0x75,
        0x6c, 0x6c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x04, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x40, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff,
        0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff,
        0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff,
        0xff, 0x80, 0x00, 0xff, 0x80, 0x00, 0xff, 0xff, 0xff, 0xc0, 0xcb, 0xff,
        0x80, 0x80, 0x80, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
        0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
    ];
    private static readonly byte[] Issue039WrongPlatformXnb =
    [
        0x58, 0x4e, 0x42, 0x64, 0x05, 0x00, 0xe0, 0x00, 0x00, 0x00, 0x01, 0x7a,
        0x4d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74, 0x2e, 0x58, 0x6e,
        0x61, 0x2e, 0x46, 0x72, 0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2e,
        0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x2e, 0x54, 0x65, 0x78, 0x74,
        0x75, 0x72, 0x65, 0x32, 0x44, 0x52, 0x65, 0x61, 0x64, 0x65, 0x72, 0x2c,
        0x20, 0x4d, 0x6f, 0x6e, 0x6f, 0x47, 0x61, 0x6d, 0x65, 0x2e, 0x46, 0x72,
        0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2c, 0x20, 0x56, 0x65, 0x72,
        0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x33, 0x2e, 0x38, 0x2e, 0x35, 0x2e, 0x31,
        0x2c, 0x20, 0x43, 0x75, 0x6c, 0x74, 0x75, 0x72, 0x65, 0x3d, 0x6e, 0x65,
        0x75, 0x74, 0x72, 0x61, 0x6c, 0x2c, 0x20, 0x50, 0x75, 0x62, 0x6c, 0x69,
        0x63, 0x4b, 0x65, 0x79, 0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x3d, 0x6e, 0x75,
        0x6c, 0x6c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x04, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x40, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff,
        0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff,
        0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff,
        0xff, 0x80, 0x00, 0xff, 0x80, 0x00, 0xff, 0xff, 0xff, 0xc0, 0xcb, 0xff,
        0x80, 0x80, 0x80, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
        0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
    ];

    private static int _proofInjectWriteFailureAtIndex = -1;

    // Implements the product-declared mount write-fault seam. The product
    // `CommitMount` calls `InjectMountWriteFault(writeIndex)` before each staged
    // write; in the product build the partial method has no body and the call is
    // elided, so the injection point does not exist in the shipped runtime. Here
    // (proof only) it throws at the configured index to drive the atomic-rollback
    // self-test.
    static partial void InjectMountWriteFault(int writeIndex)
    {
        if (_proofInjectWriteFailureAtIndex == writeIndex)
            throw new IOException("Injected proof write failure");
    }

    // Implements the product-declared stopped-game counter seam. The product
    // `StopGameCore` calls this after teardown; in the product build the partial
    // method has no body and the call is elided, so no reflection-counter read
    // (or its name literal) exists in the shipped runtime. Here (proof only) it
    // reads the proof fixture game's public static counters.
    static partial void ObserveStoppedGameCounters(
        Type? gameType, ref int? frameCount, ref int? disposeCount)
    {
        if (gameType is null) return;
        frameCount = ReadProofCounter(gameType, "FrameCount");
        disposeCount = ReadProofCounter(gameType, "DisposeCount");
    }

    // Implements the product-declared runtime-failure counter seam. The product
    // `OnUnhandledException` calls this while building the failure report; in the
    // product build the call is elided, so the report's counter fields stay null
    // and no reflection-counter reads exist in the shipped runtime. Here (proof
    // only) it reads the proof fixture game's public static counters.
    static partial void ObserveRuntimeFailureCounters(
        Type? gameType, ref int? frameCount, ref int? updateCount,
        ref int? disposeCount, ref int? callbackAfterDisposedCount)
    {
        if (gameType is null) return;
        frameCount = ReadProofCounter(gameType, "FrameCount");
        updateCount = ReadProofCounter(gameType, "UpdateCount");
        disposeCount = ReadProofCounter(gameType, "DisposeCount");
        callbackAfterDisposedCount = ReadProofCounter(gameType, "CallbackAfterDisposedCount");
    }

    // Proof-only reflection helper (relocated from the product file). Reads a
    // public static int counter from a proof fixture game type. Real user games
    // expose no such counters, so this is proof instrumentation and lives only
    // in the proof compilation unit.
    private static int? ReadProofCounter(Type type, string name)
    {
        try
        {
            var property = type.GetProperty(
                name, BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy);
            return property?.PropertyType == typeof(int) ? (int?)property.GetValue(null) : null;
        }
        catch (Exception exception) when (!GameRunner.IsFatal(exception))
        {
            return null;
        }
    }

    [JSExport]
    public static string Issue034FileSystemProbe()
    {
        var paths = new[]
        {
            "/issue034-controlled-canary.txt",
            "tests/security/fixtures/issue034-canary.txt",
            "/Users/issue034-controlled-canary.txt",
        };
        var results = paths.Select((path, index) =>
        {
            try
            {
                _ = File.ReadAllText(path);
                return new { probe = index, read = true, error = (string?)null };
            }
            catch (Exception exception)
            {
                return new
                {
                    probe = index,
                    read = false,
                    error = (string?)exception.GetType().Name
                };
            }
        }).ToArray();
        return JsonSerializer.Serialize(new
        {
            currentDirectory = Environment.CurrentDirectory,
            results,
            anyRead = results.Any(result => result.read),
        });
    }

    /// Query game state counters for the content-lifecycle proof.
    /// Returns FrameCount, DisposeCount, RunCount, StaticConstructorCount from the
    /// loaded Game type's static properties (if any), plus GameRunner snapshot.
    [JSExport]
    public static string QueryIssue039State()
    {
        lock (LifecycleGate)
        {
            var runner = _gameRunner;
            if (runner is null)
            {
                return JsonSerializer.Serialize(
                    new Issue039StateResult("stopped", 0, 0, false, false, 0, null, null, null, null),
                    PreviewProofJsonContext.Default.Issue039StateResult);
            }
            var snapshot = runner.Snapshot();
            return JsonSerializer.Serialize(
                new Issue039StateResult(
                    snapshot.State,
                    snapshot.ConstructionAttempts,
                    snapshot.RunAttempts,
                    snapshot.RunReturned,
                    snapshot.Disposed,
                    snapshot.DisposeAttempts,
                    snapshot.GameType is null ? null : ReadProofCounter(snapshot.GameType, "FrameCount"),
                    snapshot.GameType is null ? null : ReadProofCounter(snapshot.GameType, "DisposeCount"),
                    snapshot.GameType is null ? null : ReadProofCounter(snapshot.GameType, "RunCount"),
                    snapshot.GameType is null ? null : ReadProofCounter(snapshot.GameType, "StaticConstructorCount")),
                PreviewProofJsonContext.Default.Issue039StateResult);
        }
    }

    /// Proof run state: the responsibility-neutral product `QueryRunState` no
    /// longer reports game-instance reflection counters. This proof-only export
    /// restores the full run-state proof (including FrameCount/DisposeCount/
    /// RunCount/StaticConstructorCount read from the loaded game's public static
    /// members) for the compile-run-stop scenario.
    [JSExport]
    public static string QueryRunStateProof()
    {
        GameRunner? runner;
        lock (LifecycleGate)
        {
            runner = _gameRunner;
        }
        if (runner is null)
        {
            return JsonSerializer.Serialize(
                new GameRunStateResult(
                    "stopped", 0, 0, false, null, false, true, 0, null, null, null, null),
                PreviewJsonContext.Default.GameRunStateResult);
        }

        var snapshot = runner.Snapshot();
        int? frameCount = null;
        int? proofDisposeCount = null;
        int? runCount = null;
        int? staticConstructorCount = null;
        if (snapshot.GameType is not null)
        {
            frameCount = ReadProofCounter(snapshot.GameType, "FrameCount");
            proofDisposeCount = ReadProofCounter(snapshot.GameType, "DisposeCount");
            runCount = ReadProofCounter(snapshot.GameType, "RunCount");
            staticConstructorCount = ReadProofCounter(snapshot.GameType, "StaticConstructorCount");
        }
        return JsonSerializer.Serialize(
            new GameRunStateResult(
                snapshot.State,
                snapshot.ConstructionAttempts,
                snapshot.RunAttempts,
                snapshot.RunReturned,
                snapshot.RunDurationMilliseconds,
                snapshot.RetainedGame,
                snapshot.Disposed,
                snapshot.DisposeAttempts,
                frameCount,
                proofDisposeCount,
                runCount,
                staticConstructorCount),
            PreviewJsonContext.Default.GameRunStateResult);
    }

    /// Reports the loaded game's own audio lifecycle counters for the audio proof.
    /// The values come from public static members the running game exposes about itself;
    /// nothing here can start, stop, or observe audio on the game's behalf.
    [JSExport]
    public static string QueryIssue040AudioState()
    {
        GameRunner? runner;
        lock (LifecycleGate)
        {
            runner = _gameRunner;
        }

        var gameType = runner?.Snapshot().GameType ?? _lastStoppedGameType;
        if (gameType is null)
        {
            return JsonSerializer.Serialize(
                new Issue040AudioStateResult(
                    false, null, null, null, null, null, null, null, null, null, null, null, null, null),
                PreviewProofJsonContext.Default.Issue040AudioStateResult);
        }

        return JsonSerializer.Serialize(
            new Issue040AudioStateResult(
                true,
                ReadProofCounter(gameType, "SoundLoadedCount"),
                ReadProofString(gameType, "SoundAssetName"),
                ReadProofCounter(gameType, "SoundDurationMilliseconds"),
                ReadProofCounter(gameType, "PlayInvocationCount"),
                ReadProofCounter(gameType, "StopInvocationCount"),
                ReadProofString(gameType, "StateAfterPlay"),
                ReadProofString(gameType, "StateAtStopCall"),
                ReadProofString(gameType, "StateAfterStop"),
                ReadProofString(gameType, "CurrentInstanceState"),
                ReadProofCounter(gameType, "ObservedPlayingUpdateCount"),
                ReadProofCounter(gameType, "TriggerObservationCount"),
                ReadProofString(gameType, "LastTriggerSource"),
                ReadProofString(gameType, "AudioErrorText")),
            PreviewProofJsonContext.Default.Issue040AudioStateResult);
    }

    [JSExport]
    public static string RunContentValidatorSelfTest()        => JsonSerializer.Serialize(
            ContentValidator.RunSelfTestCases(),
            (JsonTypeInfo<Dictionary<string, ContentValidator.SelfTestCaseResult>>)
            PreviewProofJsonContext.Default.GetTypeInfo(typeof(Dictionary<string, ContentValidator.SelfTestCaseResult>))!);

    // Issue 052: round-trip self-test for the raw WAV -> XNB SoundEffect
    // transcoder (each supported WAV transcodes AND validates as XNB; each
    // unsupported WAV is rejected).
    [JSExport]
    public static string RunWavToXnbSelfTest() => JsonSerializer.Serialize(
            WavToXnb.RunSelfTestCases(),
            (JsonTypeInfo<Dictionary<string, WavToXnb.WavSelfTestCaseResult>>)
            PreviewProofJsonContext.Default.GetTypeInfo(typeof(Dictionary<string, WavToXnb.WavSelfTestCaseResult>))!);

    // Issue 052: magic-byte image validation self-test (png/jpg/jpeg/bmp accepted;
    // empty/garbage/mislabelled rejected).
    [JSExport]
    public static string RunImageContentSelfTest() => JsonSerializer.Serialize(
            ImageContent.RunSelfTestCases(),
            (JsonTypeInfo<Dictionary<string, ImageContent.ImageSelfTestCaseResult>>)
            PreviewProofJsonContext.Default.GetTypeInfo(typeof(Dictionary<string, ImageContent.ImageSelfTestCaseResult>))!);

    [JSExport]
    public static string RunAtomicMountSelfTest()
    {
        static AssetMountPhaseResult? DeserializePhase(string json) =>
            JsonSerializer.Deserialize(json, PreviewJsonContext.Default.AssetMountPhaseResult);

        static AssetMountResult? DeserializeMount(string json) =>
            JsonSerializer.Deserialize(json, PreviewJsonContext.Default.AssetMountResult);

        ClearAllMountState();
        try
        {
            var goodSha = Convert.ToHexString(SHA256.HashData(Issue039GoodXnb)).ToLowerInvariant();
            var badSha = Convert.ToHexString(SHA256.HashData(Issue039WrongPlatformXnb)).ToLowerInvariant();
            var firstMountId = "issue039-atomic-selftest-1";
            var staleMountId = "issue039-atomic-selftest-2";
            var replacementMountId = "issue039-atomic-selftest-3";

            var firstMetadata = JsonSerializer.Serialize(
                new[]
                {
                    new AssetMetaEntry("textures/good_fixture.xnb", Issue039GoodXnb.Length, goodSha),
                    new AssetMetaEntry("textures/bad_fixture.xnb", Issue039WrongPlatformXnb.Length, badSha),
                },
                PreviewJsonContext.Default.AssetMetaEntryArray);
            var firstPhase = DeserializePhase(MountContentAssets(firstMountId, "Content", firstMetadata));
            var firstStage = DeserializePhase(MountSingleAsset(
                firstMountId,
                "Content",
                "textures/good_fixture.xnb",
                Issue039GoodXnb.ToArray(),
                goodSha));
            var secondStage = DeserializeMount(MountSingleAsset(
                firstMountId,
                "Content",
                "textures/bad_fixture.xnb",
                Issue039WrongPlatformXnb.ToArray(),
                badSha));

            int mountedCountAfterAbort;
            int stagedCountAfterAbort;
            bool pendingMountClearedAfterAbort;
            lock (AssetMountGate)
            {
                mountedCountAfterAbort = MountedAssets.Count;
                stagedCountAfterAbort = _stagedAssets.Count;
                pendingMountClearedAfterAbort = _pendingMountId is null;
            }

            var rollbackMountId = "issue039-atomic-selftest-rollback";
            var rollbackVirtualPath1 = ContentPathNormalizer.ResolveVirtualPath("Content", "textures/rollback_a.xnb");
            var rollbackVirtualPath2 = ContentPathNormalizer.ResolveVirtualPath("Content", "textures/rollback_b.xnb");
            var rollbackMetadata = JsonSerializer.Serialize(
                new[]
                {
                    new AssetMetaEntry("textures/rollback_a.xnb", Issue039GoodXnb.Length, goodSha),
                    new AssetMetaEntry("textures/rollback_b.xnb", Issue039GoodXnb.Length, goodSha),
                },
                PreviewJsonContext.Default.AssetMetaEntryArray);
            bool rollbackAttempted;
            bool rollbackFirstFileDeleted;
            bool rollbackMountedAssetsZero;
            bool rollbackCommittedIdAbsent;
            bool rollbackMountedSuccessUnchanged;
            var mountedSuccessBeforeRollback = _assetsMountedSuccessfully;
            try
            {
                _proofInjectWriteFailureAtIndex = 1;
                var rollbackPhase = DeserializePhase(MountContentAssets(rollbackMountId, "Content", rollbackMetadata));
                var rollbackStage1 = DeserializePhase(MountSingleAsset(
                    rollbackMountId,
                    "Content",
                    "textures/rollback_a.xnb",
                    Issue039GoodXnb.ToArray(),
                    goodSha));
                var rollbackStage2 = DeserializePhase(MountSingleAsset(
                    rollbackMountId,
                    "Content",
                    "textures/rollback_b.xnb",
                    Issue039GoodXnb.ToArray(),
                    goodSha));
                var rollbackCommit = DeserializeMount(CommitMount(rollbackMountId));
                rollbackAttempted =
                    rollbackPhase?.Success == true &&
                    rollbackStage1?.Success == true &&
                    rollbackStage2?.Success == true &&
                    rollbackCommit?.Success == false &&
                    rollbackCommit.Error?.Code == "FILESYSTEM_ERROR";
                lock (AssetMountGate)
                {
                    rollbackMountedAssetsZero = MountedAssets.Count == 0;
                    rollbackCommittedIdAbsent = !CommittedMountIds.Contains(rollbackMountId);
                    rollbackMountedSuccessUnchanged = _assetsMountedSuccessfully == mountedSuccessBeforeRollback;
                }
                rollbackFirstFileDeleted =
                    !File.Exists(rollbackVirtualPath1) &&
                    !File.Exists(rollbackVirtualPath2);
            }
            finally
            {
                _proofInjectWriteFailureAtIndex = -1;
            }

            // Test 4: Startup-admitted race prevention
            // Validate and stage an asset, then mark startup admitted
            // CommitMount must reject with zero writes and clear staging
            bool startupCommitRejected;
            bool startupMountedZero;
            bool startupStagingCleared;
            bool startupPendingCleared;
            {
                var raceId = "issue039-atomic-selftest-race";
                var raceMetadata = JsonSerializer.Serialize(
                    new[]
                    {
                        new AssetMetaEntry("textures/race_fixture.xnb", Issue039GoodXnb.Length, goodSha),
                    },
                    PreviewJsonContext.Default.AssetMetaEntryArray);
                var racePhase = DeserializePhase(MountContentAssets(raceId, "Content", raceMetadata));
                var raceStage = DeserializePhase(MountSingleAsset(
                    raceId, "Content", "textures/race_fixture.xnb",
                    Issue039GoodXnb.ToArray(), goodSha));
                // Simulate startup admission
                Volatile.Write(ref _startupAdmitted, true);
                var raceCommit = DeserializeMount(CommitMount(raceId));
                startupCommitRejected = raceCommit?.Success == false &&
                    raceCommit.Error?.Code == "INVALID_STATE";
                lock (AssetMountGate)
                {
                    startupMountedZero = MountedAssets.Count == 0;
                    startupStagingCleared = _stagedAssets.Count == 0;
                    startupPendingCleared = _pendingMountId is null;
                }
                Volatile.Write(ref _startupAdmitted, false); // reset for remaining tests
            }

            var staleMetadata = JsonSerializer.Serialize(
                new[]
                {
                    new AssetMetaEntry("textures/stale_fixture.xnb", Issue039GoodXnb.Length, goodSha),
                },
                PreviewJsonContext.Default.AssetMetaEntryArray);
            var stalePhase = DeserializePhase(MountContentAssets(staleMountId, "Content", staleMetadata));
            var staleStage = DeserializePhase(MountSingleAsset(
                staleMountId,
                "Content",
                "textures/stale_fixture.xnb",
                Issue039GoodXnb.ToArray(),
                goodSha));

            var replacementMetadata = JsonSerializer.Serialize(
                new[]
                {
                    new AssetMetaEntry("textures/replacement_fixture.xnb", Issue039GoodXnb.Length, goodSha),
                },
                PreviewJsonContext.Default.AssetMetaEntryArray);
            var replacementPhase = DeserializePhase(MountContentAssets(
                replacementMountId,
                "Content",
                replacementMetadata));
            var staleCommit = DeserializeMount(CommitMount(staleMountId));

            bool staleStagingCleared;
            string? pendingMountIdAfterReplacement;
            int mountedCountAfterReplacement;
            int stagedCountAfterReplacement;
            lock (AssetMountGate)
            {
                staleStagingCleared = _stagedAssets.Count == 0 && _pendingMountId == replacementMountId;
                pendingMountIdAfterReplacement = _pendingMountId;
                mountedCountAfterReplacement = MountedAssets.Count;
                stagedCountAfterReplacement = _stagedAssets.Count;
            }

            return JsonSerializer.Serialize(
                new AtomicMountSelfTestResult(
                    firstPhase?.Success == true && firstPhase.Phase == "validated",
                    firstStage?.Success == true && firstStage.Phase == "staging" && firstStage.AssetCount == 1,
                    secondStage?.Success == false &&
                        secondStage.Error?.Code == "PREVIEW_LOAD_FAILED" &&
                        secondStage.Diagnostic?.Id == "PG0010_CONTENT_PLATFORM_MISMATCH",
                    mountedCountAfterAbort,
                    stagedCountAfterAbort,
                    pendingMountClearedAfterAbort,
                    stalePhase?.Success == true && stalePhase.Phase == "validated",
                    staleStage?.Success == true && staleStage.Phase == "staged" && staleStage.AssetCount == 1,
                    replacementPhase?.Success == true && replacementPhase.Phase == "validated",
                    rollbackAttempted,
                    rollbackFirstFileDeleted,
                    rollbackMountedAssetsZero,
                    rollbackCommittedIdAbsent,
                    rollbackMountedSuccessUnchanged,
                    staleStagingCleared,
                    staleCommit?.Success == false && staleCommit.Error?.Code == "INVALID_STATE",
                    mountedCountAfterReplacement,
                    stagedCountAfterReplacement,
                    pendingMountIdAfterReplacement,
                    startupCommitRejected,
                    startupMountedZero,
                    startupStagingCleared,
                    startupPendingCleared),
                PreviewProofJsonContext.Default.AtomicMountSelfTestResult);
        }
        finally
        {
            ClearAllMountState();
        }
    }

    private static void ClearAllMountState()
    {
        lock (AssetMountGate)
        {
            foreach (var path in MountedAssets.Keys.ToArray())
            {
                try { File.Delete(path); } catch { /* best effort cleanup */ }
            }
            MountedAssets.Clear();
            CommittedMountIds.Clear();
            _assetsMountedSuccessfully = false;
            Volatile.Write(ref _startupAdmitted, false);
            _contentRootDirectory = "Content";
            ResetPendingMountState();
        }
    }

    [JSExport]
    public static string RunForwardingTextWriterSelfTest()
    {
        var received = new List<string>();
        ForwardingTextWriter? writer = null;
        writer = new ForwardingTextWriter(text =>
        {
            received.Add(text);
            if (text == "reenter")
                writer!.WriteLine("nested");
        });
        writer.Write('a');
        writer.Write("b\r");
        writer.Write('\n');
        writer.WriteLine("");
        writer.Write("partial");
        writer.Flush();
        writer.WriteLine("reenter");
        writer.WriteLine(string.Concat(Enumerable.Repeat("🙂", 5_000)));
        writer.Dispose();
        var expected = new[] {
            "ab", "", "partial", "reenter", "nested",
            string.Concat(Enumerable.Repeat("🙂", 4_096)),
            string.Concat(Enumerable.Repeat("🙂", 904)),
        };
        return JsonSerializer.Serialize(new {
            success = received.SequenceEqual(expected),
            eventCount = received.Count,
            utf8ByteLengths = received.Select(Encoding.UTF8.GetByteCount).ToArray(),
        });
    }

    [JSExport]
    public static string RunGameRunnerBehavioralSelfTest()
    {
        var game = new RunnerSelfTestGame();
        GameRunner? runner = null;
        GameRunner.StartResult? competing = null;
        GameRunner.DisposalResult? racingTeardown = null;
        var callbacks = 0;
        runner = new GameRunner(game, _ =>
        {
            callbacks++;
            competing = runner!.RunGame();
            racingTeardown = runner.Teardown();
        });
        var admitted = runner.RunGame();
        var repeatedTeardown = runner.Teardown();
        var fatal = new Dictionary<string, bool>
        {
            [nameof(OutOfMemoryException)] = GameRunner.IsFatal(new OutOfMemoryException()),
            [nameof(StackOverflowException)] = GameRunner.IsFatal(new StackOverflowException()),
            [nameof(AccessViolationException)] = GameRunner.IsFatal(new AccessViolationException()),
            [nameof(AppDomainUnloadedException)] = GameRunner.IsFatal(new AppDomainUnloadedException()),
            [nameof(CannotUnloadAppDomainException)] = GameRunner.IsFatal(new CannotUnloadAppDomainException()),
            [nameof(InvalidOperationException)] = GameRunner.IsFatal(new InvalidOperationException()),
        };
        return JsonSerializer.Serialize(
            new RunnerBehavioralSelfTest(
                callbacks,
                admitted.RunAttempts,
                admitted.RetainedGame,
                admitted.Disposed,
                competing?.Error?.Code,
                racingTeardown?.DisposeAttempts ?? 0,
                repeatedTeardown.HadGame,
                game.DisposeCount,
                fatal),
            PreviewProofJsonContext.Default.RunnerBehavioralSelfTest);
    }

    [JSExport]
    public static string QueryStoppedGameProof()
    {
        var gameType = _lastStoppedGameType;
        return JsonSerializer.Serialize(
            new GameStoppedProof(
                gameType is null ? null : ReadProofCounter(gameType, "FrameCount"),
                gameType is null ? null : ReadProofCounter(gameType, "UpdateCount"),
                gameType is null ? null : ReadProofCounter(gameType, "DisposeCount"),
                gameType is null ? null : ReadProofCounter(gameType, "CallbackAfterDisposedCount"),
                gameType is null ? null : ReadProofCounter(gameType, "AudioCreateCount"),
                gameType is null ? null : ReadProofCounter(gameType, "AudioPlayCount"),
                gameType is null ? null : ReadProofCounter(gameType, "AudioDisposeCount")),
            PreviewProofJsonContext.Default.GameStoppedProof);
    }

    private static string? ReadProofString(Type type, string name)
    {
        try
        {
            var property = type.GetProperty(
                name, BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy);
            if (property?.PropertyType != typeof(string)) return null;
            var value = property.GetValue(null) as string;
            return value is null || value.Length <= 512 ? value : value[..512];
        }
        catch (Exception exception) when (!GameRunner.IsFatal(exception))
        {
            return null;
        }
    }

    internal sealed record AtomicMountSelfTestResult(
        bool InitialMountValidated,
        bool FirstAssetStaged,
        bool SecondAssetFailed,
        int MountedCountAfterAbort,
        int StagedCountAfterAbort,
        bool PendingMountClearedAfterAbort,
        bool StaleMountValidated,
        bool StaleAssetStaged,
        bool ReplacementMountValidated,
        bool RollbackAttempted,
        bool RollbackFirstFileDeleted,
        bool RollbackMountedAssetsZero,
        bool RollbackCommittedIdAbsent,
        bool RollbackMountedSuccessUnchanged,
        bool StaleStagingCleared,
        bool StaleCommitRejected,
        int MountedCountAfterReplacement,
        int StagedCountAfterReplacement,
        string? PendingMountIdAfterReplacement,
        bool StartupCommitRejected,
        bool StartupMountedZero,
        bool StartupStagingCleared,
        bool StartupPendingCleared);
    internal sealed record Issue039StateResult(
        string State,
        int ConstructionAttempts,
        int RunAttempts,
        bool RunReturned,
        bool Disposed,
        int DisposeAttempts,
        int? FrameCount,
        int? DisposeCount,
        int? RunCount,
        int? StaticConstructorCount);
    internal sealed record RunnerBehavioralSelfTest(
        int RunCallbacks,
        int RunAttempts,
        bool RetainedGame,
        bool Disposed,
        string? CompetingErrorCode,
        int RacingDisposeAttempts,
        bool RepeatedTeardownHadGame,
        int GameDisposeCount,
        Dictionary<string, bool> FatalClassifications);
    internal sealed record GameStoppedProof(
        int? FrameCount,
        int? UpdateCount,
        int? DisposeCount,
        int? CallbackAfterDisposedCount,
        int? AudioCreateCount,
        int? AudioPlayCount,
        int? AudioDisposeCount);
    internal sealed record Issue040AudioStateResult(
        bool GameTypeObserved,
        int? SoundLoadedCount,
        string? SoundAssetName,
        int? SoundDurationMilliseconds,
        int? PlayInvocationCount,
        int? StopInvocationCount,
        string? StateAfterPlay,
        string? StateAtStopCall,
        string? StateAfterStop,
        string? CurrentInstanceState,
        int? ObservedPlayingUpdateCount,
        int? TriggerObservationCount,
        string? LastTriggerSource,
        string? AudioErrorText);
    private sealed class RunnerSelfTestGame : Game
    {
        public int DisposeCount { get; private set; }

        protected override void Dispose(bool disposing)
        {
            if (disposing) DisposeCount++;
            base.Dispose(disposing);
        }
    }
}

// Proof-only serializer context. Kept SEPARATE from the product
// `PreviewJsonContext` (rather than a partial of it) because the JSON source
// generator emits per-primitive helper files by hint name; two partials that
// both pull in a `bool`/`Dictionary` would collide. This context compiles only
// with this file (PROOF profile), so the product build never generates it.
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
[JsonSerializable(typeof(PreviewExports.RunnerBehavioralSelfTest))]
[JsonSerializable(typeof(PreviewExports.GameStoppedProof))]
[JsonSerializable(typeof(PreviewExports.AtomicMountSelfTestResult))]
[JsonSerializable(typeof(PreviewExports.Issue039StateResult))]
[JsonSerializable(typeof(PreviewExports.Issue040AudioStateResult))]
[JsonSerializable(typeof(Dictionary<string, ContentValidator.SelfTestCaseResult>))]
[JsonSerializable(typeof(Dictionary<string, WavToXnb.WavSelfTestCaseResult>))]
[JsonSerializable(typeof(Dictionary<string, ImageContent.ImageSelfTestCaseResult>))]
internal sealed partial class PreviewProofJsonContext : JsonSerializerContext;

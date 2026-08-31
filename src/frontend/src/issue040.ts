/**
 * Issue 040: Activate, play, and stop a Web-profile SoundEffect in fresh previews.
 *
 * Runs the full production pipeline twice, in two independently created isolated
 * preview windows, proving that audio activation is re-established from scratch
 * every time a preview is recreated (issue 25's clean-restart contract):
 *
 *   1. Mount the committed Web-profile SoundEffect `.xnb` through issue 39's
 *      validation/mount pipeline (raw binary transport, no Base64/JSON arrays).
 *   2. Compile and start a test game that loads it via `Content.Load<SoundEffect>`.
 *   3. Deliver a real, trusted platform key press (Space) to the preview window.
 *      That single gesture both unlocks the WebView audio context and reaches the
 *      game through MonoGame's input path, which calls `SoundEffectInstance.Play()`.
 *   4. Measure real audio output: an AnalyserNode spliced in front of the preview's
 *      audio destination reports non-silent sample windows while the sound plays.
 *   5. Deliver a trusted Escape key press, so the game calls `Stop()`, and measure
 *      that the analyser returns to silence and the instance reports `Stopped`.
 *   6. Destroy the preview, create a brand-new one, and repeat every check.
 */

import { compileToBuffers, preparePackagedProofRuntime } from "./issue21";
import { createIsolatedPreview, storeBinaryTransfer } from "./issue38-bridge";
import type { IsolatedPreviewContext } from "./issue38-bridge";
import {
  sha256,
  standaloneBuffer,
  validateAssetMountResponse,
  validatePreviewLoadResponse,
  validatePreviewStartResponse,
  validatePreviewStopResponse,
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

const PROTOCOL_VERSION = 1;
const createUuid = () => crypto.randomUUID() as UuidV4;
const wait = (ms: number) => new Promise<void>(resolve => globalThis.setTimeout(resolve, ms));

export { ISSUE040_EXPECTED_VALIDATOR_CASES, ISSUE040_GAME_SOURCE };

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION: ${message}`);
}

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

      // A brand-new isolated preview window: new realm, new WASM runtime, new
      // audio context — exactly the issue 25 clean-restart shape.
      const ctx: IsolatedPreviewContext = await createIsolatedPreview(invoke, {
        proofFlags: { issue024Proof: true, issue039Proof: true, issue040Proof: true },
      });
      const instanceRecord: Record<string, unknown> = {
        instanceIndex,
        previewId: ctx.previewId,
        generation: ctx.generation,
        label: ctx.label,
      };

      try {
        await storeBinaryTransfer(invoke, ctx.transferToken, compiled.assembly, compiled.pdb);
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

        // ── Mount the SoundEffect fixture through the issue 39 pipeline ──
        const mountId = createUuid();
        const mountCorrelationId = createUuid();
        const assetTransferToken = createUuid().replace(/-/g, "");
        const mountBuffer = standaloneBuffer(new Uint8Array(fixture));
        const mountHash = await sha256(mountBuffer);
        assert(mountHash === ISSUE040_FIXTURE_SHA256, `${tag}: mount buffer hash mismatch`);

        await invoke("issue039_store_asset", new Uint8Array(mountBuffer), {
          headers: {
            "x-token": assetTransferToken,
            "x-generation": ctx.generation,
            "x-index": "0",
            "x-path": ISSUE040_FIXTURE_ASSET_PATH,
            "x-sha256": mountHash,
          },
        });

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
              assetManifest: [{
                index: 0,
                path: ISSUE040_FIXTURE_ASSET_PATH,
                sha256: mountHash,
                byteLength: fixture.length,
              }],
            },
          } as any,
          "asset.mount.response",
          (value: any) => validateAssetMountResponse(value, mountCorrelationId, ctx.previewId, mountId),
          [],
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

        // ── Load and start the game ──
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
          (value: any) => validatePreviewLoadResponse(
            value, loadCorrelationId, ctx.previewId, compiled.compileId),
          [],
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
        const playDispatch = JSON.parse(await invoke("issue040_dispatch_preview_input", {
          generation: ctx.generation, kind: "space-down",
        }) as string);
        await wait(500);
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
        await invoke("issue040_dispatch_preview_input", {
          generation: ctx.generation, kind: "escape-down",
        });
        await wait(400);
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
        const transferState = JSON.parse(
          await invoke("issue039_transfer_state", { token: assetTransferToken }) as string);
        assert(!transferState.exists, `${tag}: asset transfer not cleared by lifecycle`);
        instanceRecord.retirement = { windowGone, assetTransferCleared: !transferState.exists };
        await cp(`${tag}:retired`);
      } finally {
        await ctx.forceDestroyAndRetire(`${tag}-cleanup`).catch(() => {});
      }

      instances.push(instanceRecord);
      await invoke("issue038_destroy_all_previews");
      await wait(1_000);
    }

    const [first, second] = instances;
    const freshPreview =
      first.previewId !== second.previewId &&
      first.generation !== second.generation &&
      first.realmToken !== second.realmToken &&
      first.label !== second.label;
    assert(freshPreview, "second preview was not a brand-new isolated instance");

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
    await invoke("issue038_destroy_all_previews").catch(() => {});
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

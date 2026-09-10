// PROOF-only preview audio instrumentation module (issue 040).
//
// Deployed ONLY by the PROOF staging profile (see Playground.Preview.csproj /
// stage-preview.mjs). Owns the proof-only Web Audio probe for this preview
// document: the AudioContext/AudioNode.connect interposition, trusted-input
// resume instrumentation, the audio snapshot, and the analyser-tap output
// sampler. The PRODUCT preview never loads this module, so the shipped preview
// carries no `installIssue040AudioProbe`, audio probe, or analyser tap.
//
// Loaded by preview-proof-extension.js (the one proof entry module) after the
// state module so `globalThis.previewIssue040Proof` exists before install runs.
// Behavior is preserved byte-for-byte from the former monolithic
// preview-proof-extension.js.

export function createPreviewProofAudio() {
  // ── Issue 040: proof-only audio instrumentation for this preview document ──
  const issue040AudioTracking = [];
  let issue040AudioStartedAt = 0;

  function issue040RelativeMilliseconds() {
    return Math.round((performance.now() - issue040AudioStartedAt) * 1000) / 1000;
  }

  function installIssue040AudioProbe() {
    const proof = globalThis.previewIssue040Proof;
    if (!proof.enabled) return false;
    if (proof.installed) return true;

    const NativeAudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (typeof NativeAudioContext !== "function") {
      proof.errors.push("Web Audio AudioContext is unavailable in the preview realm.");
      return false;
    }

    issue040AudioStartedAt = performance.now();
    proof.installed = true;

    const trackContext = context => {
      const record = {
        index: issue040AudioTracking.length,
        createdAtMs: issue040RelativeMilliseconds(),
        initialState: context.state,
        sampleRate: context.sampleRate,
        transitions: [{ state: context.state, atMs: issue040RelativeMilliseconds() }],
      };
      proof.contexts.push(record);
      issue040AudioTracking.push({ context, record, analyser: null });
      context.addEventListener("statechange", () => {
        record.transitions.push({ state: context.state, atMs: issue040RelativeMilliseconds() });
      });
    };

    class ProbedAudioContext extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        try {
          trackContext(this);
        } catch (error) {
          proof.errors.push(`context-track: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    globalThis.AudioContext = ProbedAudioContext;
    if (typeof globalThis.webkitAudioContext === "function")
      globalThis.webkitAudioContext = ProbedAudioContext;

    const nativeConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function issue040Connect(destination, ...rest) {
      try {
        const entry = issue040AudioTracking.find(item => destination === item.context.destination);
        if (entry && this !== entry.analyser) {
          if (!entry.analyser) {
            const analyser = entry.context.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0;
            nativeConnect.call(analyser, entry.context.destination);
            entry.analyser = analyser;
            proof.analyserInstalled = true;
          }
          proof.destinationConnections += 1;
          return nativeConnect.call(this, entry.analyser);
        }
      } catch (error) {
        proof.errors.push(`connect-probe: ${error instanceof Error ? error.message : String(error)}`);
      }
      return nativeConnect.call(this, destination, ...rest);
    };

    const recordInput = event => {
      if (proof.inputEvents.length < 256) {
        proof.inputEvents.push({
          type: event.type,
          key: typeof event.key === "string" ? event.key : null,
          code: typeof event.code === "string" ? event.code : null,
          button: typeof event.button === "number" ? event.button : null,
          trusted: event.isTrusted === true,
          atMs: issue040RelativeMilliseconds(),
        });
      }
      if (event.isTrusted !== true) return;
      for (const entry of issue040AudioTracking) {
        if (entry.context.state !== "suspended") continue;
        const attempt = {
          contextIndex: entry.record.index,
          gesture: event.type,
          atMs: issue040RelativeMilliseconds(),
          settled: null,
          stateAfter: null,
        };
        if (proof.resumeAttempts.length < 64) proof.resumeAttempts.push(attempt);
        entry.context.resume().then(
          () => {
            attempt.settled = "resolved";
            attempt.stateAfter = entry.context.state;
          },
          error => {
            attempt.settled = "rejected";
            attempt.stateAfter = entry.context.state;
            proof.errors.push(`resume: ${error instanceof Error ? error.message : String(error)}`);
          },
        );
      }
    };
    for (const type of ["keydown", "keyup", "mousedown", "mouseup", "pointerdown", "click"])
      addEventListener(type, recordInput, true);

    return true;
  }

  function issue040AudioSnapshot() {
    const proof = globalThis.previewIssue040Proof;
    const activation = typeof navigator.userActivation === "undefined"
      ? null
      : { isActive: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive };
    return {
      installed: proof.installed,
      analyserInstalled: proof.analyserInstalled,
      destinationConnections: proof.destinationConnections,
      contextCount: issue040AudioTracking.length,
      contexts: issue040AudioTracking.map(entry => ({
        ...entry.record,
        state: entry.context.state,
        currentTime: entry.context.currentTime,
        analyserAttached: entry.analyser !== null,
      })),
      inputEvents: proof.inputEvents,
      resumeAttempts: proof.resumeAttempts,
      userActivation: activation,
      errors: proof.errors,
      documentHasFocus: document.hasFocus(),
      visibilityState: document.visibilityState,
    };
  }

  async function issue040SampleAudioOutput(payload) {
    const entry = issue040AudioTracking.find(item => item.analyser !== null)
      ?? issue040AudioTracking[0];
    if (!entry) throw new Error("No AudioContext has been created in this preview.");
    if (!entry.analyser) throw new Error("No analyser is spliced in front of the audio destination.");

    const durationMs = Math.min(Math.max(Number(payload?.durationMs) || 500, 50), 5_000);
    const label = typeof payload?.label === "string" ? payload.label.slice(0, 64) : "sample";
    const buffer = new Float32Array(entry.analyser.fftSize);
    const samples = [];
    const startedAt = performance.now();
    let maxPeak = 0;
    let maxRms = 0;
    let nonSilentWindows = 0;

    while (performance.now() - startedAt < durationMs) {
      entry.analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      let sumSquares = 0;
      for (const value of buffer) {
        const magnitude = Math.abs(value);
        if (magnitude > peak) peak = magnitude;
        sumSquares += value * value;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      if (peak > maxPeak) maxPeak = peak;
      if (rms > maxRms) maxRms = rms;
      if (peak > 0.0005) nonSilentWindows += 1;
      if (samples.length < 120) {
        samples.push({ atMs: issue040RelativeMilliseconds(), peak, rms });
      }
      await new Promise(resolve => setTimeout(resolve, 16));
    }

    return {
      label,
      durationMs,
      windowCount: samples.length,
      nonSilentWindows,
      maxPeak,
      maxRms,
      contextState: entry.context.state,
      contextCurrentTime: entry.context.currentTime,
      samples,
    };
  }

  return {
    tracking: issue040AudioTracking,
    relativeMilliseconds: issue040RelativeMilliseconds,
    install: installIssue040AudioProbe,
    snapshot: issue040AudioSnapshot,
    sample: issue040SampleAudioOutput,
  };
}

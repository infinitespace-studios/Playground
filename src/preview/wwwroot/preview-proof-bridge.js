// PROOF-only preview bridge action dispatch module.
//
// Deployed ONLY by the PROOF staging profile (see Playground.Preview.csproj /
// stage-preview.mjs). Owns the proof `bridgeAction` dispatcher: snapshot reads,
// the issue-040 audio arm/lock/sample actions, the issue-023/027/028/029 proof
// self-tests, the issue-033/034/035 security self-test instrumentation, and the
// bounded animation-frame / WebGL sampling actions. The PRODUCT preview never
// loads this module, so the shipped preview carries none of these bridge
// actions, the `Issue034FileSystemProbe` reference, or the `ANIMATION_FRAME_TIMEOUT`
// sampler.
//
// Loaded by preview-proof-extension.js (the one proof entry module). The
// dispatcher reads the proof globals installed by preview-proof-state.js, the
// deferred self-test globals installed by preview-proof-lifecycle.js, and the
// audio instrumentation returned by preview-proof-audio.js. Behavior is
// preserved byte-for-byte from the former monolithic preview-proof-extension.js.

export function createPreviewProofBridge(ctx, audio) {
  const { controls } = ctx;
  const getExports = () => controls.exportsPromise;

  const issue040AudioSnapshot = audio.snapshot;
  const installIssue040AudioProbe = audio.install;
  const issue040SampleAudioOutput = audio.sample;
  const issue040AudioTracking = audio.tracking;
  const issue040RelativeMilliseconds = audio.relativeMilliseconds;

  async function sha256Buffer(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  async function executeBridgeAction(action, payload, bootstrapData) {
    const exportsPromise = getExports();
    if (action === "snapshot") {
      const name = payload?.name;
      if (name === "proof") return globalThis.previewProof;
      if (name === "issue21") return globalThis.previewIssue21Proof;
      if (name === "issue22") return globalThis.previewIssue22Proof;
      if (name === "issue023") return globalThis.previewIssue023Proof;
      if (name === "issue024") return globalThis.previewIssue024Snapshot?.() ?? null;
      if (name === "endpoint") return globalThis.previewIssue023EndpointSnapshot?.() ?? null;
      if (name === "native") return globalThis.previewIssue028Snapshot?.() ?? null;
      if (name === "pixels") return globalThis.previewIssue030PixelProof?.() ?? null;
      if (name === "issue039") return globalThis.previewIssue039Proof;
      if (name === "issue039-gate") {
        const admission = controls.preStartAdmission;
        return { held: admission.isHeld(), owner: admission.currentOwner() };
      }
      if (name === "issue039-state") {
        const exports = await exportsPromise;
        return typeof exports.QueryIssue039State === "function"
          ? JSON.parse(exports.QueryIssue039State())
          : null;
      }
      if (name === "issue039-validator-test") {
        if (!globalThis.previewIssue039Proof.enabled)
          throw new Error("issue039 proof is not enabled");
        const exports = await exportsPromise;
        return typeof exports.RunContentValidatorSelfTest === "function"
          ? JSON.parse(exports.RunContentValidatorSelfTest())
          : null;
      }
      if (name === "issue039-atomic-test") {
        if (!globalThis.previewIssue039Proof.enabled)
          throw new Error("issue039 proof is not enabled");
        const exports = await exportsPromise;
        return typeof exports.RunAtomicMountSelfTest === "function"
          ? JSON.parse(exports.RunAtomicMountSelfTest())
          : null;
      }
      if (name === "issue040-audio") {
        if (!globalThis.previewIssue040Proof.enabled)
          throw new Error("issue040 proof is not enabled");
        return issue040AudioSnapshot();
      }
      if (name === "issue040-managed-audio") {
        if (!globalThis.previewIssue040Proof.enabled)
          throw new Error("issue040 proof is not enabled");
        const exports = await exportsPromise;
        return typeof exports.QueryIssue040AudioState === "function"
          ? JSON.parse(exports.QueryIssue040AudioState())
          : null;
      }
      if (name === "mount") {
        const exports = await exportsPromise;
        return typeof exports.QueryMountState === "function"
          ? JSON.parse(exports.QueryMountState())
          : null;
      }
      if (name === "errors") {
        return [
          ...(globalThis.previewProof?.errors ?? []),
          ...(globalThis.previewIssue21Proof?.errors ?? []),
          ...(globalThis.previewIssue023Proof?.errors ?? []),
        ];
      }
      throw new Error("Unknown preview snapshot.");
    }
    if (action === "issue040-audio-arm") {
      if (!globalThis.previewIssue040Proof.enabled)
        throw new Error("issue040 proof is not enabled");
      const installed = installIssue040AudioProbe();
      return { installed, ...issue040AudioSnapshot() };
    }
    if (action === "issue040-audio-lock") {
      if (!globalThis.previewIssue040Proof.enabled)
        throw new Error("issue040 proof is not enabled");
      // Reproduce the autoplay-locked state deterministically: suspend every
      // context the runtime opened so the only path back to "running" is a real
      // user gesture arriving in this document.
      const results = [];
      for (const entry of issue040AudioTracking) {
        const before = entry.context.state;
        let error = null;
        try {
          await entry.context.suspend();
        } catch (suspendError) {
          error = suspendError instanceof Error ? suspendError.message : String(suspendError);
        }
        results.push({ contextIndex: entry.record.index, before, after: entry.context.state, error });
        entry.record.lockedAtMs = issue040RelativeMilliseconds();
      }
      return { locked: results, snapshot: issue040AudioSnapshot() };
    }
    if (action === "issue040-audio-sample") {
      if (!globalThis.previewIssue040Proof.enabled)
        throw new Error("issue040 proof is not enabled");
      return await issue040SampleAudioOutput(payload);
    }
    if (action === "issue023-query") return globalThis.previewIssue023Query();
    if (action === "issue023-self-test") return globalThis.previewIssue023RunnerSelfTest();
    if (action === "issue027-writer-test") return globalThis.previewIssue027WriterSelfTest();
    if (action === "issue029-quiescent") return globalThis.previewIssue029QuiescentProof();
    if (action === "issue028-emit") {
      globalThis.previewIssue028EmitNativePaths();
      return true;
    }
    if (action === "issue22-teardown") return globalThis.previewIssue22Teardown();
    if (action === "issue033-security" && globalThis.previewIssue033Proof.enabled) {
      const violations = [];
      const onViolation = event => violations.push({
        effectiveDirective: event.effectiveDirective,
        blockedUri: event.blockedURI,
      });
      addEventListener("securitypolicyviolation", onViolation);
      let parentDomDenied = false;
      try { void parent.document.body; } catch { parentDomDenied = true; }
      let evalDenied = false;
      try { globalThis.eval("1 + 1"); } catch { evalDenied = true; }
      const inlineScript = document.createElement("script");
      inlineScript.textContent = "globalThis.__issue033InlineRan = true";
      document.body.append(inlineScript);
      const inlineStyle = document.createElement("style");
      inlineStyle.textContent = "body { outline: 1px solid red; }";
      document.head.append(inlineStyle);
      const frame = document.createElement("iframe");
      frame.src = "data:text/html,blocked";
      document.body.append(frame);
      const object = document.createElement("object");
      object.data = "data:text/html,blocked";
      document.body.append(object);
      const base = document.createElement("base");
      base.href = "https://example.invalid/issue033-base/";
      document.head.append(base);
      const popupDenied = window.open("https://example.invalid/issue033-navigation") === null;
      const form = document.createElement("form");
      form.action = "https://example.invalid/issue033-form";
      form.target = "_self";
      let formSubmitEventObserved = false;
      form.addEventListener("submit", () => { formSubmitEventObserved = true; });
      document.body.append(form);
      form.requestSubmit();
      let fetchDenied = false;
      try { await fetch("https://example.invalid/issue033"); } catch { fetchDenied = true; }
      await new Promise(resolve => setTimeout(resolve, 50));
      removeEventListener("securitypolicyviolation", onViolation);
      const baseUriDenied =
        !document.baseURI.startsWith("https://example.invalid/issue033-base");
      const formRemainedInDocument = document.contains(form);
      const formCspViolationObserved = violations.some(item =>
        item.effectiveDirective === "form-action" &&
        item.blockedUri === "https://example.invalid/issue033-form");
      frame.remove();
      object.remove();
      base.remove();
      form.remove();
      inlineScript.remove();
      inlineStyle.remove();
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      oscillator.connect(audio.destination);
      oscillator.start();
      oscillator.stop();
      await audio.close();
      return {
        serializedOrigin: location.origin,
        parentDomDenied,
        evalDenied,
        inlineScriptDenied: globalThis.__issue033InlineRan !== true,
        fetchDenied,
        audioClosed: audio.state === "closed",
        baseUriDenied,
        popupSandboxDenied: popupDenied,
        formSubmitEventObserved,
        formRemainedInDocument,
        formCspViolationObserved,
        formSandboxBlockedBeforeCsp:
          formSubmitEventObserved && formRemainedInDocument && !formCspViolationObserved,
        evalViolationObserved: violations.some(item =>
          item.effectiveDirective.startsWith("script-src") && item.blockedUri === "eval"),
        violations,
      };
    }
    if (action === "issue034-security" && globalThis.previewIssue034Proof.enabled) {
      const internals = globalThis.__TAURI_INTERNALS__;
      const webkitHandlers = globalThis.webkit?.messageHandlers;
      const handlerNames = webkitHandlers && typeof webkitHandlers === "object"
        ? Object.getOwnPropertyNames(webkitHandlers)
        : [];
      let directInvoke = "unreachable";
      if (typeof internals?.invoke === "function") {
        try {
          await internals.invoke("issue034_trusted_marker");
          directInvoke = "unexpected-success";
        } catch {
          directInvoke = "rejected";
        }
      }
      const rawIpc = {
        windowIpc: typeof globalThis.ipc,
        windowIpcPostMessage: typeof globalThis.ipc?.postMessage,
        webkitIpcPostMessage: typeof webkitHandlers?.ipc?.postMessage,
        submitted: 0,
        rejected: 0,
        malformedProbeCount: 0,
      };
      const ipcHandler = webkitHandlers?.ipc;
      const probes = Array.isArray(payload?.ipcProbes) ? payload.ipcProbes : [];
      if (probes.length > 256)
        throw new Error("Issue 034 raw IPC probe count exceeds its bound.");
      for (const probe of probes) {
        if (!probe || typeof probe.envelope !== "string" ||
            probe.envelope.length > 4_096 ||
            !Number.isInteger(probe.repetitions) ||
            probe.repetitions < 1 || probe.repetitions > 2) {
          rawIpc.malformedProbeCount += 1;
          continue;
        }
        for (let attempt = 0; attempt < probe.repetitions; attempt += 1) {
          try {
            if (typeof ipcHandler?.postMessage !== "function")
              throw new Error("WebKit IPC handler is unavailable.");
            ipcHandler.postMessage(probe.envelope);
            rawIpc.submitted += 1;
          } catch {
            rawIpc.rejected += 1;
          }
        }
      }
      const urls = [
        "file:///issue034-controlled-canary.txt",
        "tauri://localhost/tests/security/fixtures/issue034-canary.txt",
        "asset://localhost/tests/security/fixtures/issue034-canary.txt",
        "http://ipc.localhost/issue034_trusted_marker",
        "ipc://localhost/issue034_trusted_marker",
        "playground-preview://localhost/%2e%2e/tests/security/fixtures/issue034-canary.txt",
      ];
      const customProtocolProbe = probes.find(probe =>
        probe && typeof probe === "object" &&
        probe.command === "issue034_trusted_marker" &&
        probe.variant === "wrong-key");
      const customProtocolHeaders = customProtocolProbe
        ? {
            "Content-Type": "application/json",
            "Tauri-Callback": String(customProtocolProbe.callback),
            "Tauri-Error": String(customProtocolProbe.error),
            "Tauri-Invoke-Key": "issue034-deliberately-invalid-invoke-key",
          }
        : {};
      const fetchResults = await Promise.all(urls.map(async (url, probe) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2_000);
        try {
          const ipc = url.startsWith("ipc:") || url.startsWith("http://ipc.");
          const response = await fetch(url, {
            method: ipc ? "POST" : "GET",
            body: ipc ? "{}" : undefined,
            headers: ipc ? customProtocolHeaders : undefined,
            credentials: "omit",
            signal: controller.signal,
          });
          const text = (await response.text()).slice(0, 256);
          const bodyBytes = new TextEncoder().encode(text);
          return {
            probe,
            resolved: true,
            status: response.status,
            bodySha256: await sha256Buffer(bodyBytes.buffer),
            bodyBytes: bodyBytes.byteLength,
          };
        } catch (error) {
          return {
            probe,
            resolved: false,
            error: error instanceof Error ? error.name : "Error",
            bodySha256: null,
            bodyBytes: 0,
          };
        } finally {
          clearTimeout(timer);
        }
      }));
      const xhrResults = await Promise.all(urls.map((url, probe) =>
        new Promise(resolve => {
          const request = new XMLHttpRequest();
          let settled = false;
          const finish = async (resolved, error) => {
            if (settled) return;
            settled = true;
            let text = "";
            try {
              text = typeof request.responseText === "string"
                ? request.responseText.slice(0, 256)
                : "";
            } catch {
              text = "";
            }
            const bodyBytes = new TextEncoder().encode(text);
            try {
              resolve({
                probe,
                resolved,
                status: request.status,
                error,
                bodySha256: await sha256Buffer(bodyBytes.buffer),
                bodyBytes: bodyBytes.byteLength,
              });
            } catch {
              resolve({
                probe,
                resolved: false,
                status: request.status,
                error: "digest-error",
                bodySha256: null,
                bodyBytes: bodyBytes.byteLength,
              });
            }
          };
          request.timeout = 2_000;
          request.onload = () => finish(true, null);
          request.onerror = () => finish(false, "error");
          request.ontimeout = () => finish(false, "timeout");
          try {
            request.open(
              url.startsWith("ipc:") || url.startsWith("http://ipc.") ? "POST" : "GET",
              url,
            );
            request.withCredentials = false;
            if (url.startsWith("ipc:") || url.startsWith("http://ipc.")) {
              for (const [name, value] of Object.entries(customProtocolHeaders))
                request.setRequestHeader(name, value);
            }
            request.send(
              url.startsWith("ipc:") || url.startsWith("http://ipc.") ? "{}" : null);
          } catch {
            finish(false, "exception");
          }
        })));
      const exports = await exportsPromise;
      if (typeof exports.Issue034FileSystemProbe !== "function")
        throw new Error("Issue 034 managed filesystem probe is unavailable.");
      return {
        globals: {
          tauri: typeof globalThis.__TAURI__,
          internals: typeof internals,
          isTauri: typeof globalThis.isTauri,
          invoke: typeof internals?.invoke,
          transformCallback: typeof internals?.transformCallback,
          convertFileSrc: typeof internals?.convertFileSrc,
          internalsKeys: internals && typeof internals === "object"
            ? Object.keys(internals).sort()
            : [],
          webkit: typeof globalThis.webkit,
          webkitMessageHandlers: typeof webkitHandlers,
          webkitHandlerNames: handlerNames.sort(),
        },
        directInvoke,
        rawIpc,
        fetchResults,
        xhrResults,
        managedFileSystem: JSON.parse(exports.Issue034FileSystemProbe()),
      };
    }
    if (action === "issue035-security" && globalThis.previewIssue035Proof.enabled) {
      const violations = [];
      const onViolation = event => violations.push({
        effectiveDirective: event.effectiveDirective,
        blockedUri: event.blockedURI,
        disposition: event.disposition,
      });
      addEventListener("securitypolicyviolation", onViolation);

      let fetchBlocked = false;
      let fetchError = null;
      try {
        await fetch("https://example.com/issue035-probe");
      } catch (error) {
        fetchBlocked = true;
        fetchError = error instanceof Error ? error.message : String(error);
      }

      let topLocationBefore = null;
      let topLocationDenied = false;
      try { topLocationBefore = parent.location.href; } catch { topLocationBefore = "cross-origin-denied"; }
      try {
        parent.location.href = "https://example.com/issue035-top-nav";
        topLocationDenied = false;
      } catch {
        topLocationDenied = true;
      }
      let topLocationAfter = null;
      try { topLocationAfter = parent.location.href; } catch { topLocationAfter = "cross-origin-denied"; }

      let windowOpenResult = null;
      try {
        windowOpenResult = window.open("https://example.com/issue035-popup", "_blank");
      } catch {
        windowOpenResult = "exception";
      }
      const popupDenied = windowOpenResult === null || windowOpenResult === "exception";

      let windowOpenTopResult = null;
      try {
        windowOpenTopResult = window.open("https://example.com/issue035-popup-top", "_top");
      } catch {
        windowOpenTopResult = "exception";
      }
      const popupTopDenied = windowOpenTopResult === null || windowOpenTopResult === "exception";

      await new Promise(resolve => setTimeout(resolve, 100));
      removeEventListener("securitypolicyviolation", onViolation);

      const connectViolation = violations.find(item =>
        item.effectiveDirective.startsWith("connect-src") &&
        item.blockedUri === "https://example.com/issue035-probe");

      return {
        fetchBlocked,
        fetchError,
        connectSrcViolationObserved: !!connectViolation,
        topLocationBefore,
        topLocationAfter,
        topLocationDenied,
        topLocationUnchanged: topLocationBefore === topLocationAfter,
        popupDenied,
        popupTopDenied,
        violations,
        serializedOrigin: location.origin,
      };
    }
    if (action === "wait-animation-frame") {
      return await boundedAnimationFrame("wait-animation-frame");
    }
    if (action === "frame-readiness") {
      const first = await boundedAnimationFrame("frame-readiness:first");
      const second = await boundedAnimationFrame("frame-readiness:second");
      const canvas = document.querySelector("#canvas");
      const rect = canvas?.getBoundingClientRect();
      return {
        first,
        second,
        progressed: second > first,
        visibilityState: document.visibilityState,
        innerWidth,
        innerHeight,
        canvasWidth: rect?.width ?? 0,
        canvasHeight: rect?.height ?? 0,
      };
    }
    if (action === "sample-texture-grid") {
      const canvas = document.querySelector("#canvas");
      const gl = canvas?.getContext("webgl2");
      if (!canvas || !gl) throw new Error("Preview canvas WebGL2 context is unavailable.");
      await boundedAnimationFrame("sample-texture-grid");
      const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.finish();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const grid = [];
      for (let row = 0; row < 4; row++) {
        const gridRow = [];
        for (let col = 0; col < 4; col++) {
          const x = Math.floor((col + 0.5) * w / 4);
          const y = Math.floor((3.5 - row) * h / 4);
          const pixel = new Uint8Array(4);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          gridRow.push([...pixel]);
        }
        grid.push(gridRow);
      }
      const glError = gl.getError();
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      return {
        sampledAt: performance.now(),
        drawingBuffer: { width: w, height: h },
        grid,
        glError,
        contextLost: gl.isContextLost(),
      };
    }
    if (action === "sample-webgl") {
      const canvas = document.querySelector("#canvas");
      const gl = canvas?.getContext("webgl2");
      if (!canvas || !gl) throw new Error("Preview canvas WebGL2 context is unavailable.");
      await boundedAnimationFrame("sample-webgl");
      const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.finish();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const points = [
        [Math.floor(width / 2), Math.floor(height / 2)],
        [1, 1],
        [Math.max(0, width - 2), 1],
        [1, Math.max(0, height - 2)],
        [Math.max(0, width - 2), Math.max(0, height - 2)],
      ];
      const pixels = points.map(([x, y]) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      });
      const glError = gl.getError();
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      return {
        sampledAt: performance.now(),
        canvasBacking: { width: canvas.width, height: canvas.height },
        drawingBuffer: { width, height },
        pixels,
        glError,
        contextLost: gl.isContextLost(),
      };
    }

    function boundedAnimationFrame(label, timeoutMilliseconds = 5_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(
          `ANIMATION_FRAME_TIMEOUT:${JSON.stringify({
            label,
            timeoutMilliseconds,
            visibilityState: document.visibilityState,
            innerWidth,
            innerHeight,
            hasFocus: document.hasFocus(),
            canvasConnected: document.querySelector("#canvas")?.isConnected === true,
          })}`)), timeoutMilliseconds);
        requestAnimationFrame(timestamp => {
          clearTimeout(timer);
          resolve(timestamp);
        });
      });
    }
    if (action === "register-expectation" && bootstrapData?.issue021Proof === true)
      return globalThis.previewIssue21RegisterExpectation?.(payload);
    if (action === "remove-expectation" && bootstrapData?.issue021Proof === true)
      return globalThis.previewIssue21RemoveExpectation?.(payload?.correlationId);
    throw new Error("Preview bridge action is not authorized.");
  }

  return { bridgeAction: executeBridgeAction };
}

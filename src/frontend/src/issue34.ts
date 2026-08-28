import { compileLoadStartIssue23, preparePackagedProofRuntime } from "./issue21";

const ISSUE034_CANARY_SHA256 =
  "ef5368ada37a4cddc5bda46069fd7b3ad51b30b5dab1697a58ae9816154f2372";

export const ISSUE034_APPROVED_COMMANDS = [
  "issue009_is_proof_enabled",
  "issue009_emit_report",
  "issue011_is_proof_enabled",
  "issue011_set_outer_size",
  "issue011_outer_bounds",
  "issue011_emit_report",
  "issue010_is_proof_enabled",
  "issue010_emit_report",
  "issue020_is_proof_enabled",
  "issue020_emit_checkpoint",
  "issue020_emit_report",
  "issue021_is_proof_enabled",
  "issue021_is_locked_session_proof",
  "issue021_emit_report",
  "issue022_is_proof_enabled",
  "issue022_emit_report",
  "issue023_is_proof_enabled",
  "issue024_is_proof_enabled",
  "issue025_is_proof_enabled",
  "issue027_is_proof_enabled",
  "issue028_is_proof_enabled",
  "issue029_is_proof_enabled",
  "issue030_is_proof_enabled",
  "issue031_is_proof_enabled",
  "issue032_is_proof_enabled",
  "issue033_is_proof_enabled",
  "issue033_is_no_wasm_eval_proof_enabled",
  "issue034_is_proof_enabled",
  "issue034_trusted_marker",
  "issue034_trusted_marker_calls",
  "issue033_emit_checkpoint",
  "prepare_packaged_proof_window",
  "issue023_emit_checkpoint",
  "issue023_emit_report",
  "issue024_emit_report",
  "issue025_emit_report",
  "issue027_emit_report",
  "issue028_emit_report",
  "issue029_emit_report",
  "issue030_emit_report",
  "issue031_emit_report",
  "issue032_emit_report",
  "issue033_emit_report",
  "issue033_emit_no_wasm_eval_report",
  "issue034_emit_report",
] as const;

const source = `
using System;
using System.Threading;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

public sealed class Issue034Game : Game
{
    private readonly GraphicsDeviceManager graphics;
    private static int frameCount;
    private static int disposeCount;
    public static int FrameCount => Volatile.Read(ref frameCount);
    public static int DisposeCount => Volatile.Read(ref disposeCount);
    public Issue034Game()
    {
        graphics = new GraphicsDeviceManager(this);
        Console.WriteLine("issue034-managed-ready");
    }
    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        Interlocked.Increment(ref frameCount);
        base.Draw(gameTime);
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) Interlocked.Increment(ref disposeCount);
        base.Dispose(disposing);
    }
}`;

interface SecurityProbe {
  globals: {
    tauri: string;
    internals: string;
    isTauri: string;
    invoke: string;
    transformCallback: string;
    convertFileSrc: string;
    internalsKeys: string[];
    webkit: string;
    webkitMessageHandlers: string;
    webkitHandlerNames: string[];
  };
  directInvoke: string;
  rawIpc: {
    windowIpc: string;
    windowIpcPostMessage: string;
    webkitIpcPostMessage: string;
    submitted: number;
    rejected: number;
    malformedProbeCount: number;
  };
  fetchResults: Array<{
    probe: number;
    resolved: boolean;
    status?: number;
    bodySha256: string | null;
    bodyBytes: number;
    error?: string;
  }>;
  xhrResults: Array<{
    probe: number;
    resolved: boolean;
    status: number;
    bodySha256: string | null;
    bodyBytes: number;
    error: string | null;
  }>;
  managedFileSystem: {
    currentDirectory: string;
    anyRead: boolean;
    results: Array<{ probe: number; read: boolean; error: string | null }>;
  };
}

async function start(assemblyName: string) {
  return compileLoadStartIssue23({
    assemblyName,
    sourcePath: "src/Issue034Game.cs",
    sourceText: source,
    proofMode: true,
    issue034Proof: true,
  });
}

interface IpcProbe {
  command: string;
  variant: "absent-key" | "wrong-key" | "replay-wrong-key";
  callback: number;
  error: number;
  envelope: string;
  repetitions: 1 | 2;
}

async function collect(assemblyName: string, ipcProbes: IpcProbe[] = []) {
  const preview = await start(assemblyName);
  const deadline = performance.now() + 10_000;
  let state = await preview.query();
  while (Number(state.frameCount) < 3 && performance.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 50));
    state = await preview.query();
  }
  const security = await preview.proof<SecurityProbe>(
    "issue034-security", { ipcProbes });
  const pixels = await preview.proof<{
    pixels: number[][];
    glError: number;
    contextLost: boolean;
  }>("sample-webgl");
  const output = preview.outputEvents.filter(event =>
    event.payload.source === "managed" &&
    event.payload.stream === "stdout" &&
    event.payload.text === "issue034-managed-ready");
  return { preview, state, security, pixels, output };
}

function assertPreviewDenied(result: Awaited<ReturnType<typeof collect>>): void {
  const { preview, state, security, pixels, output } = result;
  const globals = security.globals;
  const customTraversal = security.fetchResults.find(item => item.probe === 5);
  const customTraversalXhr = security.xhrResults.find(item => item.probe === 5);
  if (globals.tauri !== "undefined" || globals.internals !== "undefined" ||
      globals.isTauri !== "undefined" || globals.invoke !== "undefined" ||
      globals.transformCallback !== "undefined" ||
      globals.convertFileSrc !== "undefined" ||
      globals.internalsKeys.length !== 0 ||
      globals.webkitHandlerNames.includes("ipc") ||
      security.directInvoke !== "unreachable" ||
      security.rawIpc.windowIpc !== "undefined" ||
      security.rawIpc.windowIpcPostMessage !== "undefined" ||
      security.rawIpc.webkitIpcPostMessage !== "function" ||
      security.rawIpc.rejected !== 0 ||
      security.rawIpc.malformedProbeCount !== 0 ||
      security.fetchResults.some(item => item.bodySha256 === ISSUE034_CANARY_SHA256) ||
      security.fetchResults.some(item => item.resolved && item.probe !== 5) ||
      ![400, 404].includes(customTraversal?.status ?? 0) ||
      ![9, 11].includes(customTraversal?.bodyBytes ?? 0) ||
      security.xhrResults.some(item => item.bodySha256 === ISSUE034_CANARY_SHA256) ||
      security.xhrResults.some(item => item.resolved && item.probe !== 5) ||
      ![400, 404].includes(customTraversalXhr?.status ?? 0) ||
      ![9, 11].includes(customTraversalXhr?.bodyBytes ?? 0) ||
      security.managedFileSystem.anyRead ||
      security.managedFileSystem.results.some(item => item.read) ||
      Number(state.frameCount) < 3 || output.length !== 1 ||
      pixels.glError !== 0 || pixels.contextLost ||
      pixels.pixels.some(pixel =>
        pixel[0] !== 100 || pixel[1] !== 149 || pixel[2] !== 237 || pixel[3] !== 255) ||
      preview.frame.getAttribute("sandbox") !== "allow-scripts") {
    throw new Error(`Issue 034 preview denial failed: ${JSON.stringify({
      state, security, pixels, output, frameReadiness: preview.frameReadiness,
    })}`);
  }
}

interface IpcCallbackObservation {
  command: string;
  variant: IpcProbe["variant"];
  outcome: "success" | "error";
  value: string;
}

function boundedCallbackValue(value: unknown): string {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return String(serialized).slice(0, 512);
  } catch {
    return "<unserializable>";
  }
}

function createRawIpcProbes(internals: Record<string, unknown>) {
  const transform = internals.transformCallback as
    (callback: (value: unknown) => void, once?: boolean) => number;
  const unregister = internals.unregisterCallback as (id: number) => void;
  if (typeof transform !== "function" || typeof unregister !== "function")
    throw new Error("Top-level callback transport is unavailable.");
  const observations: IpcCallbackObservation[] = [];
  const callbackIds: number[] = [];
  const probes: IpcProbe[] = [];
  for (const command of ISSUE034_APPROVED_COMMANDS) {
    for (const variant of
      ["absent-key", "wrong-key", "replay-wrong-key"] as const) {
      const callback = transform(value => {
        observations.push({
          command, variant, outcome: "success", value: boundedCallbackValue(value),
        });
      }, true);
      const error = transform(value => {
        observations.push({
          command, variant, outcome: "error", value: boundedCallbackValue(value),
        });
      }, true);
      callbackIds.push(callback, error);
      const envelope: Record<string, unknown> = {
        cmd: command,
        callback,
        error,
        options: {
          customProtocolIpcBlocked: true,
          headers: { "x-issue034-proof": variant },
        },
        payload: {},
      };
      if (variant !== "absent-key")
        envelope.__TAURI_INVOKE_KEY__ = "issue034-deliberately-invalid-invoke-key";
      probes.push({
        command,
        variant,
        callback,
        error,
        envelope: JSON.stringify(envelope),
        repetitions: variant === "replay-wrong-key" ? 2 : 1,
      });
    }
  }
  return {
    probes,
    observations,
    callbackCount: callbackIds.length,
    cleanup: () => callbackIds.forEach(id => unregister(id)),
  };
}

export async function runIssue034AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue034_is_proof_enabled"))) return;
  const readiness = await preparePackagedProofRuntime();
  const internals = window.__TAURI_INTERNALS__ as unknown as Record<string, unknown>;
  const topLevel = {
    tauri: typeof window.__TAURI__,
    internals: typeof internals,
    isTauri: typeof window.isTauri,
    invoke: typeof internals.invoke,
    transformCallback: typeof internals.transformCallback,
    convertFileSrc: typeof internals.convertFileSrc,
    keys: Object.keys(internals).sort(),
    ownProperties: Object.getOwnPropertyNames(internals).sort(),
    prototypeProperties: Object.getOwnPropertyNames(
      Object.getPrototypeOf(internals) ?? {}).sort(),
    invokeProperties: Object.getOwnPropertyNames(
      (internals.invoke as object) ?? {}).sort(),
    currentWindowLabel:
      (internals.metadata as { currentWindow?: { label?: string } } | undefined)
        ?.currentWindow?.label,
  };
  const marker = await invoke<string>("issue034_trusted_marker");
  const windowBeforeRawIpc = { width: outerWidth, height: outerHeight };
  const rawIpc = createRawIpcProbes(internals);
  const expectedParserErrors: { remaining: number; observed: string[] } = {
    remaining: ISSUE034_APPROVED_COMMANDS.length,
    observed: [] as string[],
  };
  window.__ISSUE034_EXPECTED_IPC_ERRORS__ = expectedParserErrors;
  const first = await collect("Issue034First", rawIpc.probes);
  assertPreviewDenied(first);
  const callbackDeadline = performance.now() + 10_000;
  while (rawIpc.observations.length < rawIpc.probes.length &&
         performance.now() < callbackDeadline) {
    await new Promise(resolve => window.setTimeout(resolve, 25));
  }
  rawIpc.cleanup();
  delete window.__ISSUE034_EXPECTED_IPC_ERRORS__;
  const callbackErrors = rawIpc.observations.filter(item => item.outcome === "error");
  const callbackSuccesses = rawIpc.observations.filter(item => item.outcome === "success");
  const rejectedIdentities = new Set(callbackErrors.map(item =>
    `${item.command}:${item.variant}`));
  const windowAfterRawIpc = { width: outerWidth, height: outerHeight };
  await new Promise(resolve => window.setTimeout(resolve, 100));
  const callsAfterFirst = await invoke<number>("issue034_trusted_marker_calls");
  const firstStop = await first.preview.stop("user");
  const second = await collect("Issue034Second");
  assertPreviewDenied(second);
  await new Promise(resolve => window.setTimeout(resolve, 100));
  const callsAfterRestart = await invoke<number>("issue034_trusted_marker_calls");
  const secondStop = await second.preview.stop("user");
  if (topLevel.tauri !== "undefined" || topLevel.internals !== "object" ||
      topLevel.isTauri !== "boolean" || topLevel.invoke !== "function" ||
      topLevel.transformCallback !== "function" ||
      topLevel.currentWindowLabel !== "main" ||
      marker !== "issue034-main-frame-marker-v1" ||
      rawIpc.probes.length !== ISSUE034_APPROVED_COMMANDS.length * 3 ||
      first.security.rawIpc.submitted !== ISSUE034_APPROVED_COMMANDS.length * 4 ||
      callbackSuccesses.length !== 0 ||
      expectedParserErrors.remaining !== 0 ||
      expectedParserErrors.observed.length !== ISSUE034_APPROVED_COMMANDS.length ||
      rawIpc.observations.length !== 0 ||
      callbackErrors.length !== 0 || rejectedIdentities.size !== 0 ||
      windowAfterRawIpc.width !== windowBeforeRawIpc.width ||
      windowAfterRawIpc.height !== windowBeforeRawIpc.height ||
      callsAfterFirst !== 1 || callsAfterRestart !== 1 ||
      (firstStop.runtime as { stop?: { disposeAttempts?: number } })
        ?.stop?.disposeAttempts !== 1 ||
      (secondStop.runtime as { stop?: { disposeAttempts?: number } })
        ?.stop?.disposeAttempts !== 1) {
    throw new Error(`Issue 034 trusted/restart evidence failed: ${JSON.stringify({
      topLevel, marker, rawIpc: {
        probes: rawIpc.probes.length,
        observations: rawIpc.observations,
      }, callsAfterFirst, callsAfterRestart, firstStop, secondStop,
    })}`);
  }
  await invoke("issue034_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE034_PROOF=1",
      readiness,
      topLevel,
      marker,
      markerCalls: { afterFirst: callsAfterFirst, afterRestart: callsAfterRestart },
      rawIpc: {
        commandCount: ISSUE034_APPROVED_COMMANDS.length,
        variants: ["absent-key", "wrong-key", "replay-wrong-key"],
        serializedEnvelopeShape: {
          fields: [
            "cmd", "callback", "error", "options", "payload",
            "__TAURI_INVOKE_KEY__ (wrong/replay only)",
          ],
          contentType: "application/json",
          maximumEnvelopeCharacters: 4_096,
        },
        submittedMessages: first.security.rawIpc.submitted,
        expectedRejections: rawIpc.probes.length,
        parserErrors: expectedParserErrors.observed.length,
        parserErrorExample: expectedParserErrors.observed[0],
        authenticationCallbacks: rawIpc.observations.length,
        callbackIdsInstalledAndRetired: rawIpc.callbackCount,
        rejectionClassification: {
          absentKey: "parser-schema-rejection-with-native-console-error",
          wrongKey: "invoke-key-authentication-silent-drop-after-bounded-timeout",
          replayWrongKey: "invoke-key-authentication-silent-drop-after-bounded-timeout",
          aclReached: false,
        },
        observedSuccesses: callbackSuccesses.length,
        rejectionValues: [...new Set(callbackErrors.map(item => item.value))],
        sideEffectEvidence: {
          markerCalls: callsAfterFirst,
          windowBefore: windowBeforeRawIpc,
          windowAfter: windowAfterRawIpc,
          applicationRemainedResponsive: true,
        },
      },
      first: {
        frameReadiness: first.preview.frameReadiness,
        state: first.state,
        security: first.security,
        pixels: first.pixels,
        output: first.output[0],
        stop: firstStop,
      },
      restart: {
        frameReadiness: second.preview.frameReadiness,
        state: second.state,
        security: second.security,
        pixels: second.pixels,
        output: second.output[0],
        stop: secondStop,
      },
      commandInventory: {
        capabilities: ["main"],
        plugins: [],
        prohibitedPlugins: [
          "fs", "shell", "process", "opener", "dialog", "clipboard-manager",
        ],
      },
    }),
  });
}

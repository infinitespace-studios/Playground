/**
 * Issue 038: Editor-side bridge for the isolated preview WebviewWindow.
 *
 * Communication paths:
 *   Editor → Rust → Preview:  issue038_relay_to_preview (evaluate_script)
 *   Preview → Rust → Editor:  GET /_bridge/send → issue038_collect_bridge_messages
 *   Binary DLL/PDB:           issue038_store_transfer → GET /_transfer/{token}/
 *
 * The polling loop detects window disappearance and surfaces a terminal event
 * so cleanup happens exactly once without depending on hung preview JS.
 */

import type { UuidV4 } from "../../shared/MessageContracts";
import { ProtocolPortClient } from "./protocol";
import type { PreviewBridge } from "./preview-frame";

const createUuid = () => crypto.randomUUID() as UuidV4;

export interface IsolatedPreviewContext {
  readonly generation: string;
  readonly label: string;
  readonly previewId: UuidV4;
  readonly contextGeneration: UuidV4;
  readonly protocolClient: ProtocolPortClient;
  readonly bridge: PreviewBridge;
  readonly transferToken: string;
  readonly retired: boolean;
  /** Wait for the preview runtime to signal readiness. */
  waitForReady(): Promise<Record<string, unknown>>;
  /** Force-destroy and retire — awaitable, exactly-once. Returns true if window existed. */
  forceDestroyAndRetire(reason: unknown): Promise<boolean>;
  /** Check whether the preview window still exists. */
  exists(): Promise<boolean>;
  /** Promise that resolves when the context is retired (by any cause). */
  readonly onRetired: Promise<{ reason: string }>;
}

interface PendingBridgeRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: number;
}

export async function createIsolatedPreview(
  invoke: Function,
  opts: {
    previewId?: UuidV4;
    proofFlags?: Record<string, boolean>;
    runtimeCase?: string;
  } = {},
): Promise<IsolatedPreviewContext> {
  const contextGeneration = createUuid();
  const previewId = opts.previewId ?? createUuid();
  const generation = contextGeneration.replace(/-/g, "").slice(0, 32);
  const transferToken = createUuid().replace(/-/g, "");

  // Create the isolated WebviewWindow
  const label = await invoke("issue038_create_preview_window", { generation }) as string;

  // Wait for window to load _isolated.html
  await new Promise(resolve => globalThis.setTimeout(resolve, 1500));

  // Editor-side channels: port1 for ProtocolPortClient/Bridge, port2 for relay
  const protocolChannel = new MessageChannel();
  const bridgeChannel = new MessageChannel();

  const protocolClient = new ProtocolPortClient(protocolChannel.port1, createUuid());

  // Bridge setup
  const bridgePending = new Map<string, PendingBridgeRequest>();
  let bridgeReadyResolve!: (value: Record<string, unknown>) => void;
  let bridgeReadyReject!: (reason: Error) => void;
  const bridgeReady = new Promise<Record<string, unknown>>((resolve, reject) => {
    bridgeReadyResolve = resolve;
    bridgeReadyReject = reject;
  });
  let bridgeClosed = false;

  bridgeChannel.port1.addEventListener("message", event => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "preview.bridge.ready") {
      bridgeReadyResolve(message.payload ?? {});
      return;
    }
    if (message.type !== "preview.bridge.response" || typeof message.id !== "string") return;
    const request = bridgePending.get(message.id);
    if (!request) return;
    bridgePending.delete(message.id);
    globalThis.clearTimeout(request.timer);
    if (message.success === true) request.resolve(message.result);
    else request.reject(new Error(String(message.error ?? "Preview bridge request failed.")));
  });
  bridgeChannel.port1.start();

  const bridge: PreviewBridge = {
    childPort: bridgeChannel.port2,
    ready: bridgeReady,
    request<T>(action: string, payload?: unknown): Promise<T> {
      if (bridgeClosed) return Promise.reject(new Error("Preview bridge is closed."));
      const id = crypto.randomUUID();
      return new Promise<T>((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
          bridgePending.delete(id);
          reject(new Error(`Preview bridge action timed out: ${action}`));
        }, 30_000);
        bridgePending.set(id, {
          resolve: value => resolve(value as T),
          reject,
          timer,
        });
        bridgeChannel.port1.postMessage({ type: "preview.bridge.request", id, action, payload });
      });
    },
    close() {
      if (bridgeClosed) return;
      bridgeClosed = true;
      const error = new Error("Preview bridge is closed.");
      bridgeReadyReject(error);
      for (const request of bridgePending.values()) {
        globalThis.clearTimeout(request.timer);
        request.reject(error);
      }
      bridgePending.clear();
      bridgeChannel.port1.close();
    },
  };

  // Relay: editor port2 → Rust → preview
  protocolChannel.port2.addEventListener("message", event => {
    const payload = JSON.stringify({ channel: "protocol", data: event.data });
    invoke("issue038_relay_to_preview", { generation, message: payload }).catch(() => {});
  });
  protocolChannel.port2.start();

  bridgeChannel.port2.addEventListener("message", event => {
    const payload = JSON.stringify({ channel: "bridge", data: event.data });
    invoke("issue038_relay_to_preview", { generation, message: payload }).catch(() => {});
  });
  bridgeChannel.port2.start();

  // Retirement state — exactly once
  let retired = false;
  let retiredResolve!: (value: { reason: string }) => void;
  const onRetired = new Promise<{ reason: string }>(resolve => { retiredResolve = resolve; });

  async function doRetire(reason: string): Promise<boolean> {
    if (retired) return false;
    retired = true;
    polling = false;
    const error = new Error(reason);
    protocolClient.close(error);
    bridge.close();
    // Destroy window and clear transfers
    let existed = false;
    try {
      existed = await invoke("issue038_destroy_preview_window", { generation }) as boolean;
    } catch { /* window may already be gone */ }
    try {
      await invoke("issue038_clear_transfer", { token: transferToken });
    } catch { /* ignore */ }
    retiredResolve({ reason });
    return existed;
  }

  // Polling loop with window-disappearance detection
  let polling = true;
  let pollInterval = 10;
  const poll = async () => {
    let consecutiveEmpty = 0;
    let disappearanceChecks = 0;
    while (polling) {
      try {
        const messages = await invoke("issue038_collect_bridge_messages", { generation }) as string[];
        if (messages.length > 0) {
          consecutiveEmpty = 0;
          pollInterval = 10;
          for (const raw of messages) {
            try {
              const envelope = JSON.parse(raw);
              if (envelope.channel === "bridge") {
                bridgeChannel.port2.postMessage(envelope.data);
              } else {
                protocolChannel.port2.postMessage(envelope.data);
              }
            } catch { /* malformed */ }
          }
        } else {
          consecutiveEmpty++;
          pollInterval = Math.min(80, 10 * Math.pow(2, Math.min(consecutiveEmpty, 3)));
          // Periodically check if window still exists (every ~5 empty polls)
          if (consecutiveEmpty % 5 === 0 && !retired) {
            disappearanceChecks++;
            try {
              const exists = await invoke("issue038_preview_window_exists", { generation }) as boolean;
              if (!exists) {
                void doRetire("preview window disappeared");
                return;
              }
            } catch { /* ignore check failures */ }
          }
        }
      } catch {
        if (!retired) void doRetire("polling error");
        return;
      }
      await new Promise(resolve => globalThis.setTimeout(resolve, pollInterval));
    }
  };
  void poll();

  // Bootstrap injection with retry
  const bootstrapData: Record<string, unknown> = {
    contextGeneration,
    bridgeGeneration: generation,
    previewId,
    transferToken,
    issue021Proof: opts.proofFlags?.issue021Proof ?? false,
    issue022Proof: false,
    issue023Proof: opts.proofFlags?.issue023Proof ?? false,
    issue024Proof: opts.proofFlags?.issue024Proof ?? false,
    issue028Proof: opts.proofFlags?.issue028Proof ?? false,
    issue030Proof: opts.proofFlags?.issue030Proof ?? false,
    issue033Proof: opts.proofFlags?.issue033Proof ?? false,
    issue034Proof: opts.proofFlags?.issue034Proof ?? false,
    issue035Proof: opts.proofFlags?.issue035Proof ?? false,
    issue036Proof: opts.proofFlags?.issue036Proof ?? false,
    runGamePipeline: true,
    issue023Case: opts.runtimeCase ?? "normal",
  };

  const bootstrapJson = JSON.stringify(bootstrapData);
  const bootstrapDeadline = Date.now() + 10_000;
  while (Date.now() < bootstrapDeadline) {
    await invoke("issue038_bootstrap_preview", { generation, bootstrapJson });
    await new Promise(resolve => globalThis.setTimeout(resolve, 500));
    const messages = await invoke("issue038_collect_bridge_messages", { generation }) as string[];
    let gotReady = false;
    for (const raw of messages) {
      try {
        const envelope = JSON.parse(raw);
        if (envelope.channel === "bridge") {
          bridgeChannel.port2.postMessage(envelope.data);
          if (envelope.data?.type === "preview.bridge.ready") gotReady = true;
        } else {
          protocolChannel.port2.postMessage(envelope.data);
        }
      } catch { /* malformed */ }
    }
    if (gotReady) break;
  }

  return {
    generation,
    label,
    previewId,
    contextGeneration,
    protocolClient,
    bridge,
    transferToken,
    get retired() { return retired; },
    waitForReady() { return bridgeReady; },
    async forceDestroyAndRetire(reason: unknown) {
      return doRetire(reason instanceof Error ? reason.message : String(reason));
    },
    async exists() {
      return invoke("issue038_preview_window_exists", { generation }) as Promise<boolean>;
    },
    onRetired,
  };
}

/** Store binary DLL/PDB for transfer to isolated preview. */
export async function storeBinaryTransfer(
  invoke: Function,
  token: string,
  assembly: ArrayBuffer,
  pdb: ArrayBuffer,
): Promise<void> {
  await invoke("issue038_store_transfer", {
    token,
    assembly: Array.from(new Uint8Array(assembly)),
    pdb: Array.from(new Uint8Array(pdb)),
  });
}

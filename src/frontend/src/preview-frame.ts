export const PREVIEW_SANDBOX = "allow-scripts";
export const PREVIEW_CSP = "default-src 'none'; script-src playground-preview: 'wasm-unsafe-eval'; style-src playground-preview:; connect-src playground-preview:; img-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL =
  PREVIEW_CSP.replace(" 'wasm-unsafe-eval'", "");

function previewDocument(csp: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="playground-parent-origin" content="${globalThis.location?.origin ?? "tauri://localhost"}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview runtime</title>
<link rel="stylesheet" href="playground-preview://localhost/preview.css">
</head><body>
<canvas id="canvas" width="640" height="360" aria-label="MonoGame preview render surface"></canvas>
<button id="ping" type="button" disabled>Prove preview runtime</button>
<p id="status" role="status" aria-live="polite">Booting one Release .NET runtime...</p>
<pre id="proof-state" aria-label="Preview proof state"></pre>
<script src="playground-preview://localhost/issue033-negative-observer.js"></script>
<script type="module" src="playground-preview://localhost/preview.js"></script>
</body></html>`;
}

export const PREVIEW_DOCUMENT = previewDocument(PREVIEW_CSP);
export const ISSUE033_NO_WASM_EVAL_DOCUMENT =
  PREVIEW_DOCUMENT.replace(" 'wasm-unsafe-eval'", "");

interface PendingBridgeRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: number;
}

export interface PreviewBridge {
  readonly childPort: MessagePort;
  readonly ready: Promise<Record<string, unknown>>;
  request<T = unknown>(action: string, payload?: unknown): Promise<T>;
  close(): void;
}

const bridges = new WeakMap<HTMLIFrameElement, PreviewBridge>();

export function configurePreviewIframe(frame: HTMLIFrameElement): HTMLIFrameElement {
  frame.setAttribute("sandbox", PREVIEW_SANDBOX);
  return frame;
}

export function loadPreviewIframe(frame: HTMLIFrameElement): void {
  configurePreviewIframe(frame);
  frame.srcdoc = PREVIEW_DOCUMENT;
}

export function loadIssue033NoWasmEvalPreviewIframe(frame: HTMLIFrameElement): void {
  configurePreviewIframe(frame);
  frame.srcdoc = ISSUE033_NO_WASM_EVAL_DOCUMENT;
}

export function createPreviewIframe(): HTMLIFrameElement {
  return configurePreviewIframe(document.createElement("iframe"));
}

export function createPreviewBridge(frame: HTMLIFrameElement): PreviewBridge {
  configurePreviewIframe(frame);
  const channel = new MessageChannel();
  const pending = new Map<string, PendingBridgeRequest>();
  let readyResolve!: (value: Record<string, unknown>) => void;
  let readyReject!: (reason: Error) => void;
  const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let closed = false;

  channel.port1.addEventListener("message", event => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "preview.bridge.ready") {
      readyResolve(message.payload ?? {});
      return;
    }
    if (message.type !== "preview.bridge.response" || typeof message.id !== "string") return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    window.clearTimeout(request.timer);
    if (message.success === true) request.resolve(message.result);
    else request.reject(new Error(String(message.error ?? "Preview bridge request failed.")));
  });
  channel.port1.start();

  const bridge: PreviewBridge = {
    childPort: channel.port2,
    ready,
    request<T>(action: string, payload?: unknown): Promise<T> {
      if (closed) return Promise.reject(new Error("Preview bridge is closed."));
      const id = crypto.randomUUID();
      return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Preview bridge action timed out: ${action}`));
        }, 30_000);
        pending.set(id, {
          resolve: value => resolve(value as T),
          reject,
          timer,
        });
        channel.port1.postMessage({
          type: "preview.bridge.request",
          id,
          action,
          payload,
        });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      const error = new Error("Preview bridge is closed.");
      readyReject(error);
      for (const request of pending.values()) {
        window.clearTimeout(request.timer);
        request.reject(error);
      }
      pending.clear();
      channel.port1.close();
    },
  };
  bridges.set(frame, bridge);
  return bridge;
}

export function previewBridgeFor(frame: HTMLIFrameElement): PreviewBridge {
  const bridge = bridges.get(frame);
  if (!bridge) throw new Error("Preview iframe has no private bridge.");
  return bridge;
}

export function assertPreviewSandbox(frame: HTMLIFrameElement): void {
  // In the isolated WebviewWindow architecture, there is no sandbox attribute.
  // Security is via process isolation + ACL + CSP.
  if (frame.className === "issue038-isolated-preview") return;
  const tokens = [...frame.sandbox].sort();
  if (frame.getAttribute("sandbox") !== PREVIEW_SANDBOX ||
      tokens.length !== 1 ||
      tokens[0] !== PREVIEW_SANDBOX ||
      frame.sandbox.contains("allow-same-origin")) {
    throw new Error(`Preview sandbox drifted: ${frame.getAttribute("sandbox") ?? "<missing>"}`);
  }
}

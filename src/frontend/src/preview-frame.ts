export const PREVIEW_SANDBOX = "allow-scripts";
export const PREVIEW_CSP = "default-src 'none'; script-src playground-preview: 'wasm-unsafe-eval'; style-src playground-preview:; connect-src playground-preview:; img-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL =
  PREVIEW_CSP.replace(" 'wasm-unsafe-eval'", "");

// Build-profile flag (statically replaced by Vite's `define`). The PROOF build
// sets it true so the preview srcdoc additionally loads the proof-only runtime
// extension, proof DOM, and negative observer; the PRODUCT build leaves it
// false (also the fallback under tsc/node) so the shipping preview document
// references none of the proof surface. Declared as an ambient global so
// typecheck and node test runs (where the define is absent) compile with the
// safe PRODUCT default.
declare const __MONOGAME_PREVIEW_PROOF__: boolean | undefined;
const PREVIEW_PROOF_PROFILE =
  typeof __MONOGAME_PREVIEW_PROOF__ !== "undefined" && __MONOGAME_PREVIEW_PROOF__ === true;

// Proof-only preview document fragments. Empty strings in the PRODUCT build, so
// its srcdoc loads only the neutral preview runtime (no proof extension, no
// #ping / #proof-state DOM, no negative observer). The extension module is
// listed BEFORE preview.js so it registers the neutral extension seam before
// the runtime evaluates.
const PROOF_PREVIEW_DOM = PREVIEW_PROOF_PROFILE
  ? `\n<button id="ping" type="button" disabled>Prove preview runtime</button>` +
    `\n<pre id="proof-state" aria-label="Preview proof state"></pre>`
  : "";
const PROOF_PREVIEW_SCRIPTS = PREVIEW_PROOF_PROFILE
  ? `\n<script src="playground-preview://localhost/issue033-negative-observer.js"></script>` +
    `\n<script type="module" src="playground-preview://localhost/preview-proof-extension.js"></script>`
  : "";

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
<p id="status" role="status" aria-live="polite">Booting one Release .NET runtime...</p>${PROOF_PREVIEW_DOM}${PROOF_PREVIEW_SCRIPTS}
<script type="module" src="playground-preview://localhost/preview.js"></script>
</body></html>`;
}

export const PREVIEW_DOCUMENT = previewDocument(PREVIEW_CSP);
// Responsibility-neutral name (Stage 6 remediation): the preview document with
// the `wasm-unsafe-eval` source stripped from its CSP, used to prove the
// runtime refuses to boot without WASM compilation. Historical issue-numbered
// callers live only in the proof module (issue21.ts).
export const PREVIEW_DOCUMENT_WITHOUT_WASM_EVAL =
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

export function loadPreviewIframeWithoutWasmEval(frame: HTMLIFrameElement): void {
  configurePreviewIframe(frame);
  frame.srcdoc = PREVIEW_DOCUMENT_WITHOUT_WASM_EVAL;
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
  // The embedded proof adapter frame (compileLoadStartIssue23) is a lightweight
  // stand-in object for the real opaque-origin sandboxed iframe managed by
  // createEmbeddedProofPreview; it carries no sandbox attribute because the real
  // sandbox lives on the embedded iframe. Skip the attribute assertion for it.
  if (frame.className === "embedded-proof-adapter-frame") return;
  const tokens = [...frame.sandbox].sort();
  if (frame.getAttribute("sandbox") !== PREVIEW_SANDBOX ||
      tokens.length !== 1 ||
      tokens[0] !== PREVIEW_SANDBOX ||
      frame.sandbox.contains("allow-same-origin")) {
    throw new Error(`Preview sandbox drifted: ${frame.getAttribute("sandbox") ?? "<missing>"}`);
  }
}

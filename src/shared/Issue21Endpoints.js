import {
  isUuidV4,
  utf8Length,
  validateCompileRequest,
  validatePreviewLoadRequest,
  validatePreviewStartRequest,
  validatePreviewStopRequest,
  validateAssetMountRequest,
} from "./ProtocolRuntime.js";

const envelopeErrors = new Set([
  "MISSING_PROTOCOL_VERSION", "MALFORMED_ENVELOPE",
  "UNSUPPORTED_PROTOCOL_VERSION", "MESSAGE_ROUTE_REJECTED",
]);

function errorCode(error, fallback) {
  return error instanceof Error && /^[A-Z_]+$/.test(error.message)
    ? error.message
    : fallback;
}

function rejectedIdentity(raw) {
  const value = raw !== null && typeof raw === "object" ? raw : null;
  let type = null;
  try {
    if (value && Object.hasOwn(value, "type") &&
        typeof value.type === "string" && utf8Length(value.type) <= 128) type = value.type;
  } catch {
    type = null;
  }
  return {
    correlationId: value && Object.hasOwn(value, "correlationId") &&
      isUuidV4(value.correlationId) ? value.correlationId : null,
    type,
  };
}

function protocolError(code, text, identity) {
  return {
    protocolVersion: 1,
    correlationId: crypto.randomUUID(),
    type: "protocol.error",
    payload: {
      error: { code, message: text },
      ...(identity.correlationId ? { rejectedCorrelationId: identity.correlationId } : {}),
      ...(identity.type ? { rejectedType: identity.type } : {}),
    },
  };
}

function terminalFailure(type, correlationId, code, text) {
  return {
    protocolVersion: 1,
    correlationId,
    type,
    result: { success: false, error: { code, message: text } },
  };
}

function createEndpoint({
  port,
  responseType,
  requestType,
  validate,
  execute,
  fallbackCode,
  // Optional, responsibility-neutral lifecycle observer/telemetry sink. The
  // PRODUCT endpoints (preview.js / compiler-harness.js) never supply it, so
  // this shared plumbing carries no proof-specific vocabulary. Only the proof
  // extensions and tests pass a collector to record terminals/events/closes.
  observer,
  expectations,
  contextGeneration,
  portIdentity,
  resolveRoute,
}) {
  const completed = new Set();
  const inFlight = new Set();
  let closed = false;
  const close = reason => {
    if (closed) return;
    closed = true;
    observer?.closes?.push(reason);
    port.close();
  };
  const post = (message, transfer = []) => {
    if (closed) throw new Error("MESSAGE_SOURCE_REJECTED");
    port.postMessage(message, transfer);
    if (transfer.some(buffer => buffer.byteLength !== 0)) {
      close("sender-detach-failure");
      throw new Error("MESSAGE_SOURCE_REJECTED");
    }
  };
  const handle = async event => {
    const raw = event?.data;
    const identity = rejectedIdentity(raw);
    let acceptedCorrelation = null;
    let reserved = false;
    let terminalSent = false;
    let activeRequestType = requestType;
    let activeResponseType = responseType;
    let activeFallbackCode = fallbackCode;
    try {
      const route = resolveRoute?.(raw) ??
        { requestType, responseType, validate, execute, fallbackCode };
      activeRequestType = route.requestType;
      activeResponseType = route.responseType;
      activeFallbackCode = route.fallbackCode;
      const validated = route.validate(raw);
      const message = validated.message;
      acceptedCorrelation = message.correlationId;
      if (inFlight.has(acceptedCorrelation) || completed.has(acceptedCorrelation)) {
        post(protocolError(
          "DUPLICATE_CORRELATION_ID",
          "Request correlation ID was already observed.",
          { correlationId: acceptedCorrelation, type: message.type },
        ));
        observer?.duplicateControls?.push(acceptedCorrelation);
        return;
      }
      inFlight.add(acceptedCorrelation);
      reserved = true;
      const outcome = await route.execute(message, validated.observation);
      if (outcome.result?.success === false) {
        expectations?.consume({
          contextGeneration,
          portIdentity,
          correlationId: acceptedCorrelation,
          requestType: activeRequestType,
          responseType: activeResponseType,
          probePhase: outcome.probePhase ?? expectations.phaseFor(acceptedCorrelation),
          code: outcome.result.error?.code,
        });
      }
      const response = {
        protocolVersion: 1,
        correlationId: acceptedCorrelation,
        type: activeResponseType,
        result: outcome.result,
      };
      post(response, outcome.transfer ?? []);
      terminalSent = true;
      observer?.terminals?.push(acceptedCorrelation);
      for (const lifecycleEvent of outcome.events ?? []) {
        post(lifecycleEvent);
        observer?.events?.push({
          type: lifecycleEvent.type,
          correlationId: lifecycleEvent.correlationId,
          sequence: lifecycleEvent.payload?.sequence,
        });
      }
      for (const delayed of outcome.delayedEvents ?? []) {
        globalThis.setTimeout(() => {
          try {
            if (delayed.shouldPost && !delayed.shouldPost()) return;
            post(delayed.event);
            observer?.events?.push({
              type: delayed.event.type,
              correlationId: delayed.event.correlationId,
              sequence: delayed.event.payload?.sequence,
            });
            delayed.afterPost?.();
          } catch {
            close("delayed-event-post-failure");
          }
        }, delayed.delayMs);
      }
      outcome.afterPost?.();
      if (outcome.closeAfterResponse) {
        setTimeout(() => close(outcome.closeReason ?? "post-mutation-taint"), 25);
      }
    } catch (error) {
      const code = errorCode(error, activeFallbackCode);
      if (terminalSent) {
        close("post-terminal-failure");
        return;
      }
      if (expectations) {
        expectations.consume({
          contextGeneration,
          portIdentity,
          correlationId: acceptedCorrelation ?? identity.correlationId,
          requestType: activeRequestType,
          responseType: activeResponseType,
          probePhase: expectations.phaseFor(acceptedCorrelation ?? identity.correlationId),
          code,
        });
      } else {
        observer?.errors?.push(code);
      }
      if (closed) return;
      try {
        if (acceptedCorrelation ||
            (identity.correlationId && identity.type === activeRequestType && !envelopeErrors.has(code))) {
          const terminalCorrelation = acceptedCorrelation ?? identity.correlationId;
          post(terminalFailure(activeResponseType, terminalCorrelation, code,
            activeResponseType === "compile.response"
              ? "Compiler protocol request rejected."
              : activeResponseType === "asset.mount.response"
                ? "Asset mount request rejected."
                : activeResponseType === "preview.start.response"
                ? "Preview start request rejected."
                : activeResponseType === "preview.stop.response"
                  ? "Preview stop request rejected."
                : "Preview load request rejected."));
          observer?.terminals?.push(terminalCorrelation);
          if (code === "MESSAGE_SOURCE_REJECTED") close("message-source-rejected");
          if (code === "INTERNAL_ERROR" && activeRequestType === "preview.start.request") {
            close("unexpected-start-boundary");
          }
        } else {
          post(protocolError(code, "Protocol envelope rejected.", identity));
          if (code === "MESSAGE_SOURCE_REJECTED") close("message-source-rejected");
        }
      } catch {
        close("rejection-post-failure");
      }
    } finally {
      if (reserved) {
        inFlight.delete(acceptedCorrelation);
        completed.add(acceptedCorrelation);
      }
    }
  };
  const emitEvent = message => {
    post(message);
    observer?.events?.push({
      type: message.type,
      correlationId: message.correlationId,
      sequence: message.payload?.sequence,
    });
  };
  return { handle, close, emitEvent, completed, inFlight, get closed() { return closed; } };
}

export function createCompilerEndpoint(options) {
  return createEndpoint({
    ...options,
    responseType: "compile.response",
    requestType: "compile.request",
    validate: validateCompileRequest,
    fallbackCode: "INTERNAL_ERROR",
  });
}

export function createPreviewEndpoint(options) {
  return createEndpoint({
    ...options,
    responseType: "preview.load.response",
    requestType: "preview.load.request",
    validate: value => validatePreviewLoadRequest(value, options.previewId),
    fallbackCode: "PREVIEW_LOAD_FAILED",
    resolveRoute: raw => raw?.type === "asset.mount.request"
      ? {
          requestType: "asset.mount.request",
          responseType: "asset.mount.response",
          validate: value => validateAssetMountRequest(value, options.previewId),
          execute: options.executeMount ?? (() => { throw new Error("INVALID_STATE"); }),
          fallbackCode: "PREVIEW_LOAD_FAILED",
        }
      : raw?.type === "preview.start.request"
      ? {
          requestType: "preview.start.request",
          responseType: "preview.start.response",
          validate: value => validatePreviewStartRequest(value, options.previewId),
          execute: options.executeStart ?? (() => { throw new Error("INVALID_STATE"); }),
          fallbackCode: "PREVIEW_START_FAILED",
        }
      : raw?.type === "preview.stop.request"
        ? {
            requestType: "preview.stop.request",
            responseType: "preview.stop.response",
            validate: value => validatePreviewStopRequest(value, options.previewId),
            execute: options.executeStop ?? (() => { throw new Error("INVALID_STATE"); }),
            fallbackCode: "PREVIEW_STOP_FAILED",
          }
      : {
          requestType: "preview.load.request",
          responseType: "preview.load.response",
          validate: value => validatePreviewLoadRequest(value, options.previewId),
          execute: options.execute,
          fallbackCode: "PREVIEW_LOAD_FAILED",
        },
  });
}

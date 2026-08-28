export const NATIVE_OUTPUT_BUFFER_LIMITS = Object.freeze({
  messages: 128,
  utf8Bytes: 64 * 1024,
  messageUtf8Bytes: 16 * 1024,
});

const encoder = new TextEncoder();

export function normalizeUnicodeScalars(value) {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
      if (next >= 0xDC00 && next <= 0xDFFF) {
        normalized += value[index] + value[index + 1];
        index += 1;
      } else {
        normalized += "\uFFFD";
      }
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      normalized += "\uFFFD";
    } else {
      normalized += value[index];
    }
  }
  return normalized;
}

function normalizeArgument(value) {
  try {
    return normalizeUnicodeScalars(typeof value === "string" ? value : String(value));
  } catch {
    return "<unprintable>";
  }
}

export function normalizeNativeOutputArguments(args) {
  return Array.from(args, normalizeArgument).join(" ");
}

function splitUtf8(text, maximumBytes) {
  if (encoder.encode(text).byteLength <= maximumBytes) return [text];
  const chunks = [];
  let chunk = "";
  let bytes = 0;
  for (const scalar of text) {
    const scalarBytes = encoder.encode(scalar).byteLength;
    if (bytes + scalarBytes > maximumBytes) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += scalar;
    bytes += scalarBytes;
  }
  if (chunk || chunks.length === 0) chunks.push(chunk);
  return chunks;
}

export function createNativeOutputCapture({
  teeOut = (...args) => console.log(...args),
  teeErr = (...args) => console.error(...args),
  limits = NATIVE_OUTPUT_BUFFER_LIMITS,
} = {}) {
  let authenticatedGeneration = null;
  let flushed = false;
  let retired = false;
  let liveEmitter = null;
  let bufferedBytes = 0;
  const buffer = [];
  const observations = {
    callbackCalls: 0,
    acceptedPrePortMessages: 0,
    acceptedPrePortUtf8Bytes: 0,
    droppedOverflowMessages: 0,
    droppedOverflowUtf8Bytes: 0,
    rejectedAfterRetirement: 0,
    flushCalls: 0,
    emittedMessages: 0,
    teeErrors: 0,
    emitErrors: 0,
  };

  const capture = (stream, tee, args) => {
    const normalizedArguments = Array.from(args, normalizeArgument);
    try {
      tee(...normalizedArguments);
    } catch {
      observations.teeErrors += 1;
    }
    observations.callbackCalls += 1;
    if (retired) {
      observations.rejectedAfterRetirement += 1;
      return;
    }
    const normalized = normalizedArguments.join(" ");
    for (const text of splitUtf8(normalized, limits.messageUtf8Bytes)) {
      const utf8Bytes = encoder.encode(text).byteLength;
      if (flushed && liveEmitter) {
        try {
          liveEmitter({ stream, category: "runtime", text });
          observations.emittedMessages += 1;
        } catch {
          observations.emitErrors += 1;
        }
        continue;
      }
      if (buffer.length >= limits.messages ||
          bufferedBytes + utf8Bytes > limits.utf8Bytes) {
        observations.droppedOverflowMessages += 1;
        observations.droppedOverflowUtf8Bytes += utf8Bytes;
        continue;
      }
      buffer.push({ stream, category: "startup", text, utf8Bytes });
      bufferedBytes += utf8Bytes;
      observations.acceptedPrePortMessages += 1;
      observations.acceptedPrePortUtf8Bytes += utf8Bytes;
    }
  };

  return {
    print(...args) {
      capture("stdout", teeOut, args);
    },
    printErr(...args) {
      capture("stderr", teeErr, args);
    },
    authenticate(generation) {
      if (retired || flushed || typeof generation !== "string" || generation.length === 0)
        return false;
      if (authenticatedGeneration !== null)
        return authenticatedGeneration === generation;
      authenticatedGeneration = generation;
      return true;
    },
    flush(generation, emit) {
      if (retired || flushed || authenticatedGeneration !== generation ||
          typeof emit !== "function") return false;
      flushed = true;
      liveEmitter = emit;
      observations.flushCalls += 1;
      const queued = buffer.splice(0);
      bufferedBytes = 0;
      for (const { stream, category, text } of queued) {
        try {
          emit({ stream, category, text });
          observations.emittedMessages += 1;
        } catch {
          observations.emitErrors += 1;
        }
      }
      return true;
    },
    retire(generation) {
      if (retired || authenticatedGeneration !== generation) return false;
      retired = true;
      liveEmitter = null;
      buffer.length = 0;
      bufferedBytes = 0;
      return true;
    },
    snapshot() {
      return Object.freeze({
        ...observations,
        authenticated: authenticatedGeneration !== null,
        flushed,
        retired,
        bufferedMessages: buffer.length,
        bufferedUtf8Bytes: bufferedBytes,
        limits: Object.freeze({ ...limits }),
      });
    },
  };
}

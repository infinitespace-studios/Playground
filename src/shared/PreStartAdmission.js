/**
 * Shared pre-start operation admission for the preview runtime.
 *
 * Serializes mount, load, and start so that:
 * - Only one mount, load, or start can be active at a time
 * - Each wrapper synchronously acquires the owner before any await
 * - Release is guaranteed via finally in every wrapper method
 * - Owner identity prevents accidental cross-release
 *
 * Production preview.js delegates its entire execute* body to these methods.
 */

export function createPreStartAdmission() {
  let owner = null; // null | { kind: string, id: string }

  function isHeld() { return owner !== null; }
  function currentOwner() { return owner ? { kind: owner.kind, id: owner.id } : null; }

  function acquire(kind, id) {
    if (owner !== null) return false;
    owner = { kind, id };
    return true;
  }

  function release(kind, id) {
    if (owner === null) return false;
    if (owner.kind !== kind || owner.id !== id) return false;
    owner = null;
    return true;
  }

  const invalidStateBusy = () => ({
    result: {
      success: false,
      error: {
        code: "INVALID_STATE",
        message: "Another pre-start operation is in progress.",
      },
    },
  });

  async function runMount(correlationId, allowedStates, currentState, operation) {
    if (!allowedStates.includes(currentState)) throw new Error("INVALID_STATE");
    if (!acquire("mount", correlationId)) return invalidStateBusy();
    try {
      return await operation();
    } finally {
      release("mount", correlationId);
    }
  }

  async function runLoad(correlationId, currentState, operation) {
    if (currentState !== "stopped") throw new Error("INVALID_STATE");
    if (!acquire("load", correlationId)) throw new Error("INVALID_STATE");
    try {
      return await operation();
    } finally {
      release("load", correlationId);
    }
  }

  async function runStart(correlationId, currentState, operation) {
    if (currentState !== "loaded") throw new Error("INVALID_STATE");
    if (!acquire("start", correlationId)) throw new Error("INVALID_STATE");
    try {
      return await operation();
    } finally {
      release("start", correlationId);
    }
  }

  return Object.freeze({
    runMount,
    runLoad,
    runStart,
    isHeld,
    currentOwner,
  });
}

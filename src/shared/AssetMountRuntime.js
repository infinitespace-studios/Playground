/**
 * Issue 039: Asset mount executor for the preview runtime.
 *
 * Handles asset.mount.request messages by validating assets, transferring
 * binary data to the managed runtime, and writing to the MEMFS virtual
 * filesystem where MonoGame's ContentManager resolves them.
 */

export function createAssetMountExecutor({
  getState,
  getExports,
  sha256,
  previewId,
  recordMount,
  recordMountFailure,
}) {
  const committedMountIds = new Set();
  let totalMountedFiles = 0;
  let totalMountedBytes = 0;

  return async (message, observation) => {
    const state = getState();

    // Mount only allowed in stopped (before start) or loaded (after load, before start) states
    if (state !== "stopped" && state !== "loaded") {
      return {
        result: {
          success: false,
          error: {
            code: "INVALID_STATE",
            message: `Assets cannot be mounted in preview state '${state}'.`,
          },
        },
      };
    }

    const { previewId: reqPreviewId, mountId, assets, contentRootDirectory } = message.payload;

    // Validate previewId
    if (reqPreviewId !== previewId) {
      throw new Error("MESSAGE_SOURCE_REJECTED");
    }

    // Validate mountId uniqueness
    if (committedMountIds.has(mountId)) {
      return {
        result: {
          success: false,
          error: {
            code: "DUPLICATE_MOUNT_ID",
            message: "This mount ID has already been used.",
          },
        },
      };
    }

    // Validate asset count
    if (!Array.isArray(assets) || assets.length === 0) {
      return {
        result: {
          success: false,
          error: {
            code: "MALFORMED_PAYLOAD",
            message: "At least one asset is required.",
          },
        },
      };
    }

    if (assets.length > 256) {
      return {
        result: {
          success: false,
          error: {
            code: "TOO_MANY_ASSETS",
            message: `Asset count ${assets.length} exceeds the limit of 256.`,
          },
        },
      };
    }

    // Independent ArrayBuffer validation at mount boundary (before any side effects)
    // Even after protocol validation, re-check to guard against races/detachment
    for (const asset of assets) {
      const bytes = asset.bytes;
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
        return {
          result: {
            success: false,
            error: {
              code: "MALFORMED_PAYLOAD",
              message: `Asset '${asset.path}' has empty or invalid bytes.`,
            },
          },
        };
      }
      // Reject SharedArrayBuffer
      if (typeof SharedArrayBuffer !== "undefined" && bytes instanceof SharedArrayBuffer) {
        return {
          result: {
            success: false,
            error: {
              code: "MALFORMED_PAYLOAD",
              message: `Asset '${asset.path}' uses SharedArrayBuffer, which is not allowed.`,
            },
          },
        };
      }
      // Reject typed-array views (must be plain ArrayBuffer)
      if (ArrayBuffer.isView(bytes)) {
        return {
          result: {
            success: false,
            error: {
              code: "MALFORMED_PAYLOAD",
              message: `Asset '${asset.path}' is a typed-array view, not an ArrayBuffer.`,
            },
          },
        };
      }
    }

    // Check for aliased buffers (same ArrayBuffer in multiple assets)
    const seenBuffers = new Set();
    for (const asset of assets) {
      if (seenBuffers.has(asset.bytes)) {
        return {
          result: {
            success: false,
            error: {
              code: "MALFORMED_PAYLOAD",
              message: "Multiple assets share the same ArrayBuffer instance.",
            },
          },
        };
      }
      seenBuffers.add(asset.bytes);
    }

    // Validate individual assets and compute SHA-256
    let aggregateBytes = 0;
    const assetEntries = [];

    for (const asset of assets) {
      if (!(asset.bytes instanceof ArrayBuffer) || asset.bytes.byteLength === 0) {
        return {
          result: {
            success: false,
            error: {
              code: "MALFORMED_PAYLOAD",
              message: `Asset '${asset.path}' has empty or invalid bytes.`,
            },
          },
        };
      }

      if (asset.bytes.byteLength > 16 * 1024 * 1024) {
        return {
          result: {
            success: false,
            error: {
              code: "ASSET_TOO_LARGE",
              message: `Asset '${asset.path}' exceeds the 16 MiB individual limit.`,
            },
          },
        };
      }

      aggregateBytes += asset.bytes.byteLength;
      if (aggregateBytes > 24 * 1024 * 1024) {
        return {
          result: {
            success: false,
            error: {
              code: "ASSET_TOTAL_TOO_LARGE",
              message: "Aggregate asset size exceeds the 24 MiB limit.",
            },
          },
        };
      }

      const assetSha256 = await sha256(asset.bytes);
      assetEntries.push({
        path: asset.path,
        bytes: new Uint8Array(asset.bytes),
        sha256: assetSha256,
        byteLength: asset.bytes.byteLength,
      });
    }

    // Call managed mount: validate all paths first, then write one at a time
    // using Uint8Array → byte[] marshaling (no JSON number arrays)
    const exports = await getExports();
    if (typeof exports.MountContentAssets !== "function" ||
        typeof exports.MountSingleAsset !== "function") {
      throw new Error("INTERNAL_ERROR");
    }

    // Resolve content root directory: use request value or default to "Content"
    const resolvedRoot = (typeof contentRootDirectory === "string" && contentRootDirectory.length > 0)
      ? contentRootDirectory
      : "Content";

    // Phase 1: Validate all assets (paths, XNB headers) without writing
    const pathsJson = JSON.stringify(assetEntries.map(a => ({
      path: a.path,
      byteLength: a.byteLength,
      sha256: a.sha256,
    })));

    let managed;
    try {
      managed = JSON.parse(exports.MountContentAssets(
        mountId,
        resolvedRoot,
        pathsJson,
      ));
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "PREVIEW_LOAD_FAILED";
      return {
        result: {
          success: false,
          error: {
            code,
            message: "Managed asset mount failed.",
          },
        },
      };
    }

    // Phase 2: Stage each asset via validation and staging (no writes yet)
    if (managed.success && managed.phase === "validated") {
      try {
        for (let i = 0; i < assetEntries.length; i++) {
          const stageResult = JSON.parse(exports.MountSingleAsset(
            mountId,
            resolvedRoot,
            assetEntries[i].path,
            assetEntries[i].bytes,
            assetEntries[i].sha256,
          ));
          if (!stageResult.success) {
            managed = stageResult;
            break;
          }
          managed = stageResult;
        }

        // Phase 3: If all assets staged, commit atomically
        if (managed.success && managed.phase === "staged") {
          if (typeof exports.CommitMount !== "function") {
            throw new Error("INTERNAL_ERROR");
          }
          managed = JSON.parse(exports.CommitMount(mountId));
        }
      } catch (error) {
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : "PREVIEW_LOAD_FAILED";
        return {
          result: {
            success: false,
            error: { code, message: "Managed asset mount failed." },
          },
        };
      }
    }

    if (!managed.success) {
      const mountRecord = {
        mountId,
        success: false,
        error: managed.error,
        diagnostic: managed.diagnostic,
      };
      recordMountFailure?.(mountRecord);
      const error = {
        code: managed.error?.code ?? "PREVIEW_LOAD_FAILED",
        message: managed.error?.message ?? "Asset mount validation failed.",
      };
      if (managed.diagnostic) {
        error.diagnostics = [{
          origin: "playground",
          severity: "error",
          id: managed.diagnostic.id,
          message: managed.diagnostic.message,
          file: "",
          line: 0,
          column: 0,
        }];
      }
      return { result: { success: false, error } };
    }

    // Record successful mount
    committedMountIds.add(mountId);
    totalMountedFiles += managed.mountedFileCount;
    totalMountedBytes += managed.mountedByteLength;

    const mountRecord = {
      mountId,
      success: true,
      mountedFileCount: managed.mountedFileCount,
      mountedByteLength: managed.mountedByteLength,
      contentRootDirectory: managed.contentRootDirectory,
      mountedFiles: managed.mountedFiles,
      assetSha256s: assetEntries.map(a => a.sha256),
    };
    recordMount?.(mountRecord);

    return {
      result: {
        success: true,
        data: {
          previewId,
          mountId,
          mountedFileCount: managed.mountedFileCount,
          mountedByteLength: managed.mountedByteLength,
        },
      },
    };
  };
}

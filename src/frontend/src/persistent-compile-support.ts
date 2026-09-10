// ── Persistent compiler / compile-buffer support ────────────────────────────
//
// Proof-only support module (never imported by the product graph). Split out of
// the former mixed scenario-toolkit.ts by responsibility: it owns the proofs'
// direct use of the persistent Roslyn compiler context — compiling C# through
// the same warm compiler the product uses and returning either a structured
// report (digests, diagnostics, binary proof) or the raw DLL/PDB buffers for a
// caller to mount INLINE over an embedded preview's protocol port. It also owns
// the two benchmark preconditions (cold compiler boot timing and shell
// steady-state) that must be timed/excluded separately from a compile.
//
// It drives the shared compiler context (ensureContexts/compilerClient) and the
// protocol validators only; it never mounts a preview iframe and never imports
// scenario-toolkit, so it introduces no import cycle.

import {
  PROTOCOL_VERSION,
  type BinaryProof,
  type CompileRequest,
  type UuidV4,
} from "../../shared/MessageContracts";
import {
  sha256,
  standaloneBuffer,
  validateCompileResponse,
} from "./protocol";
import {
  compilerClient,
  compilerFrame,
  createUuid,
  ensureContexts,
  waitForTopRuntime,
} from "./compiler-context";

export async function compileSourcesThroughPersistentCompiler(input: {
  assemblyName: string;
  sources: readonly { path: string; text: string }[];
  primarySourcePath: string;
}): Promise<Record<string, unknown>> {
  await ensureContexts(false, true);
  const compileId = createUuid();
  const correlationId = createUuid();
  const request: CompileRequest = {
    protocolVersion: PROTOCOL_VERSION,
    correlationId,
    type: "compile.request",
    payload: {
      compileId,
      assemblyName: input.assemblyName,
      sources: [...input.sources],
      primarySourcePath: input.primarySourcePath,
      timeoutMs: 30_000,
      settings: {
        languageVersion: "13.0",
        nullable: "disable",
        optimization: "debug",
        allowUnsafe: false,
        warningsAsErrors: false,
      },
    },
  };
  const response = await compilerClient.request(
    request,
    "compile.response",
    value => validateCompileResponse(value, correlationId, compileId, {
      assemblyName: input.assemblyName,
      sourcePaths: input.sources.map(source => source.path),
      primarySourcePath: input.primarySourcePath,
    }),
    [],
    30_000,
  ) as ReturnType<typeof validateCompileResponse>;
  if (!response.message.result.success) {
    return {
      compileId,
      correlationId,
      success: false,
      error: response.message.result.error,
    };
  }
  const data = response.message.result.data;
  return {
    compileId,
    correlationId,
    success: true,
    diagnostics: data.diagnostics,
    binaryProof: data.binaryProof,
    assemblySha256: await sha256(data.assembly),
    pdbSha256: await sha256(data.pdb),
    assemblyByteLength: data.assembly.byteLength,
    pdbByteLength: data.pdb.byteLength,
  };
}

/** Issue 041: boot the persistent compiler context through exactly the path a
 *  compile request takes, without issuing a compile. This lets the benchmark
 *  harness time cold compiler initialisation separately from the first
 *  compilation of a project. */
export async function prepareCompilerContextForBenchmark(): Promise<number> {
  await ensureContexts(false, true);
  return compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts ?? 0;
}

/** Issue 041: wait for the shell's own top-level runtime to reach its rendering
 *  steady state. The benchmark treats this as a precondition (a person clicking
 *  Run on a settled shell) and excludes it from every reported sample. */
export async function waitForShellSteadyStateForBenchmark(): Promise<void> {
  await waitForTopRuntime();
}


/** Compile C# source through the persistent Roslyn compiler and return the
 *  raw DLL/PDB buffers.  Does NOT create a preview iframe — callers mount the
 *  compiled binaries INLINE over the embedded preview's protocol port. */
export async function compileToBuffers(input: {
  assemblyName: string;
  sourcePath: string;
  sourceText: string;
  sources?: readonly { path: string; text: string }[];
  primarySourcePath?: string;
}): Promise<{
  compileId: UuidV4;
  assembly: ArrayBuffer;
  pdb: ArrayBuffer;
  binaryProof: BinaryProof;
  diagnostics: readonly unknown[];
}> {
  await ensureContexts(false, true);
  const compileId = createUuid();
  const compileCorrelationId = createUuid();
  const compileSources = input.sources ?? [{
    path: input.sourcePath,
    text: input.sourceText,
  }];
  const primarySourcePath = input.primarySourcePath ?? input.sourcePath;
  const compileRequest: CompileRequest = {
    protocolVersion: PROTOCOL_VERSION,
    correlationId: compileCorrelationId,
    type: "compile.request",
    payload: {
      compileId,
      assemblyName: input.assemblyName,
      sources: [...compileSources],
      primarySourcePath,
      timeoutMs: 30_000,
      settings: {
        languageVersion: "13.0",
        nullable: "disable",
        optimization: "debug",
        allowUnsafe: false,
        warningsAsErrors: false,
      },
    },
  };
  const compiled = await compilerClient.request(
    compileRequest,
    "compile.response",
    value => validateCompileResponse(value, compileCorrelationId, compileId, {
      assemblyName: input.assemblyName,
      sourcePaths: compileSources.map(source => source.path),
      primarySourcePath,
    }),
    [],
    30_000,
  ) as ReturnType<typeof validateCompileResponse>;
  if (!compiled.message.result.success) {
    throw new Error(`${compiled.message.result.error.code}: ${compiled.message.result.error.message}`);
  }
  const data = compiled.message.result.data;
  return {
    compileId,
    assembly: standaloneBuffer(new Uint8Array(data.assembly)),
    pdb: standaloneBuffer(new Uint8Array(data.pdb)),
    binaryProof: data.binaryProof,
    diagnostics: data.diagnostics,
  };
}

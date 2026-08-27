#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const framework = resolve(process.argv[2] ??
  join(root, "src/preview/bin/Release/net9.0/publish/wwwroot/_framework"));
const wasmFiles = readdirSync(framework)
  .filter(name => /^dotnet\.native\..+\.wasm$/.test(name))
  .sort();
if (wasmFiles.length !== 1) {
  throw new Error(`Expected exactly one fingerprinted dotnet.native wasm; found ${wasmFiles.length}.`);
}

const wasmPath = join(framework, wasmFiles[0]);
const bytes = readFileSync(wasmPath);
const module = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(module);
const schedulerImports = imports.filter(entry =>
  entry.name === "sched_get_priority_max" || entry.name === "sched_get_priority_min");

let offset = 8;
const memories = [];
const readU32 = () => {
  let value = 0;
  let shift = 0;
  while (true) {
    const byte = bytes[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value >>> 0;
    shift += 7;
    if (shift > 35) throw new Error("Invalid unsigned LEB128 in wasm.");
  }
};
const readName = () => {
  const length = readU32();
  offset += length;
};
const readLimits = source => {
  const flags = readU32();
  const memory64 = (flags & 0x04) !== 0;
  if (memory64) throw new Error("Unexpected memory64 preview module.");
  const minimum = readU32();
  const maximum = (flags & 0x01) !== 0 ? readU32() : null;
  memories.push({ source, shared: (flags & 0x02) !== 0, minimum, maximum });
};

while (offset < bytes.length) {
  const id = bytes[offset++];
  const length = readU32();
  const end = offset + length;
  if (id === 2) {
    const count = readU32();
    for (let index = 0; index < count; index++) {
      readName();
      readName();
      const kind = bytes[offset++];
      if (kind === 0) readU32();
      else if (kind === 1) {
        offset++;
        readLimits("imported-table");
        memories.pop();
      } else if (kind === 2) readLimits("import");
      else if (kind === 3) offset += 2;
      else if (kind === 4) {
        readU32();
        readU32();
      } else throw new Error(`Unsupported wasm import kind ${kind}.`);
    }
  } else if (id === 5) {
    const count = readU32();
    for (let index = 0; index < count; index++) readLimits("defined");
  }
  offset = end;
}

const appRoot = dirname(framework);
const files = [];
const walk = directory => {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
};
walk(appRoot);
const workerAssets = files
  .filter(path => /worker/i.test(basename(path)))
  .map(path => path.slice(appRoot.length + 1));
const workerConstructorFiles = files
  .filter(path => path.endsWith(".js") && /\bnew\s+(?:globalThis\.)?Worker\s*\(/.test(readFileSync(path, "utf8")))
  .map(path => path.slice(appRoot.length + 1));
const nativeJsFiles = files.filter(path => /dotnet\.native\..+\.js$/.test(basename(path)));
if (nativeJsFiles.length !== 1) {
  throw new Error(`Expected exactly one fingerprinted dotnet.native JS file; found ${nativeJsFiles.length}.`);
}
const nativeJs = readFileSync(nativeJsFiles[0], "utf8");
const schedulerShimDefinitions = {
  max: /_sched_get_priority_max=policy=>policy===1\|\|policy===2\?99:0/.test(nativeJs),
  min: /_sched_get_priority_min=policy=>policy===1\|\|policy===2\?1:0/.test(nativeJs),
};

const wasmOpt = process.env.WASM_OPT ||
  (process.env.EMSDK ? join(process.env.EMSDK, "upstream/bin/wasm-opt") : "");
if (!wasmOpt || !existsSync(wasmOpt)) {
  throw new Error("Set EMSDK or WASM_OPT to the sourced Emscripten 3.1.56 toolchain.");
}
const featureOutput = execFileSync(wasmOpt, [
  "--enable-bulk-memory",
  "--enable-threads",
  "--enable-exception-handling",
  "--enable-multivalue",
  "--enable-reference-types",
  "--enable-simd",
  "--print-features",
  wasmPath,
  "-o",
  process.platform === "win32" ? "NUL" : "/dev/null",
], { encoding: "utf8" });
const features = featureOutput.split(/\r?\n/)
  .filter(line => line.startsWith("--enable-"))
  .sort();

const report = {
  wasmPath: wasmPath.slice(root.length + 1),
  wasmBytes: bytes.length,
  features,
  atomicInstructionsPresent: features.includes("--enable-threads"),
  memories,
  sharedMemory: memories.some(memory => memory.shared),
  schedulerWasmImports: schedulerImports,
  schedulerShimDefinitions,
  unresolvedSchedulerImports: schedulerImports
    .filter(entry => !schedulerShimDefinitions[
      entry.name === "sched_get_priority_max" ? "max" : "min"]),
  workerAssets,
  workerConstructorFiles,
};
if (memories.length !== 1 ||
    report.sharedMemory ||
    schedulerImports.length !== 2 ||
    !schedulerShimDefinitions.max ||
    !schedulerShimDefinitions.min ||
    workerAssets.length !== 0 ||
    workerConstructorFiles.length !== 0 ||
    !report.atomicInstructionsPresent) {
  console.error(JSON.stringify(report, null, 2));
  throw new Error("Preview wasm native/thread/import contract failed.");
}
console.log(JSON.stringify(report, null, 2));

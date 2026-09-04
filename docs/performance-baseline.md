# Performance baseline

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with: node scripts/measure-performance.mjs
     Machine-readable source of truth: docs/performance-baseline.json -->

**Report schema version:** 2

**Generated:** 2026-09-04T20:06:00.477Z

**Issue:** 041 — measure startup/compile/preview/Stop timings (PRD 17, 20.2)

**Overall verdict:** FAIL

## Reference machine

| Property | Value | Source |
| --- | --- | --- |
| Model name | MacBook Pro | system_profiler -json SPHardwareDataType (machine_name) |
| Model identifier | Mac17,6 | system_profiler -json SPHardwareDataType (machine_model) |
| CPU | Apple M5 Max | system_profiler -json SPHardwareDataType (chip_type) |
| CPU cores | 18 logical (6 performance + 12 efficiency) | sysctl -n hw.ncpu hw.perflevel0.logicalcpu hw.perflevel1.logicalcpu |
| CPU cores visible to the WebView | 8 | navigator.hardwareConcurrency read inside the running application webview |
| RAM | 128 GB (137438953472 bytes) | system_profiler -json SPHardwareDataType (physical_memory) / sysctl -n hw.memsize |
| GPU | Apple M5 Max (40 cores, sppci_vendor_Apple) | system_profiler -json SPDisplaysDataType |
| WebGL implementation (as the preview sees it) | WebGL 2.0 — renderer "WebKit WebGL", unmasked "Apple GPU" | WebGL VERSION/RENDERER parameters read inside the running application webview |
| Operating system | macOS 26.6.2 (build 25G83) | sw_vers -productVersion / -buildVersion |
| WebView engine (system WebKit framework) | WebKit.framework CFBundleShortVersionString 21624, CFBundleVersion 21624.5.1.11.3 | defaults read /System/Library/Frameworks/WebKit.framework/Resources/Info CFBundleShortVersionString / CFBundleVersion |
| WebView engine (user agent reported by the app's WKWebView) | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) | navigator.userAgent read inside the running application webview |
| Storage (volume the repository and binary live on) | Solid state, Apple Fabric bus | diskutil info -plist / (SolidState / BusProtocol / MediaName keys) |
| Storage device | APPLE SSD AP4096Z (4 TB) | system_profiler -json SPNVMeDataType |

### Evidence notes

- Every value above is the verbatim output of the listed command on the measurement machine; nothing is inferred from model marketing names.
- The application embeds no browser engine: it hosts the operating system's WKWebView, so the WebView engine is identified both by the system WebKit framework's own bundle version and by the user agent that the running application's webview reports. Apple does not expose a separate WebKit build number through WKWebView, so no upstream WebKit revision is claimed.

## Methodology

- 1 attempt(s) were made. Each attempt is one cold application launch, preceded by a 5 s idle cooling gap with no application process running, immediately followed by one warm launch started as soon as the previous process exited.
- Each cold launch boots the persistent compiler context once, compiles the committed five-file fixture once cold and 10 times warm, then runs 2 full Run→Stop preview cycles (cycle 1 cold, later cycles warm).
- Every timestamp is taken on a monotonic clock at the point being measured: `std::time::Instant` in Rust for process start, `performance.now()` in the shell for compile/preview/Stop, and `process.hrtime.bigint()` in this driver for the wall-clock bracket around each process launch. No sample is a sleep, a wall-clock difference across processes, or a value inferred from another measurement.
- The application shell's own top-level demo runtime is allowed to reach its rendering steady state before the compile/preview/Stop phases begin; that wait is a precondition and is excluded from every reported sample.
- The preview-startup sample is the first frame the running Game itself reports having drawn, observed by polling the preview bridge every 5 ms, with a hard 20 s bound measured from `preview.started`. An observed sample is an upper bound on the true first-frame instant; a sample that hits the bound is recorded as a right-censored lower bound. Both directions are stated explicitly wherever the sample is used.
- The driver regenerates `docs/performance-baseline.json` and `docs/performance-baseline.md` from the raw samples on every run; neither file is edited by hand.

### Percentile method

Deterministic nearest-rank, no interpolation: samples are sorted ascending and the reported percentile is the element at 1-based rank `ceil(p/100 x n)`, so every reported percentile is an observed sample. For n = 10 this makes p50 the 5th smallest sample (the lower median) and p95 the largest sample. Censored samples participate with their bound value; a percentile that selects one is marked `>=` and treated as a lower bound. The same method is applied to every phase, and `scripts/performance-report.test.mjs` pins it.

### Threshold inclusivity

Each threshold uses exactly the inclusivity PRD section 17 words. "Warm compilation p95 under 2 seconds" and "cold compiler initialization p95 under 5 seconds" are strict (`p95 < threshold`); "application shell visible within 3 seconds", "preview visibly active within 3 seconds" and "Stop returning control to the editor within 2 seconds" are inclusive (`p95 <= threshold`). A p95 exactly equal to a strict threshold is therefore recorded as FAIL, and exactly equal to an inclusive threshold as PASS. When the p95 is a censored lower bound, a breach is still a definitive FAIL but a value inside the threshold is reported as INDETERMINATE, never as a PASS.

### Benchmark project

- `tests/integration/fixtures/perf-benchmark/` — five C# source files (`Game1.cs`, `Entity.cs`, `World.cs`, `MathUtilities.cs`, `Telemetry.cs`) forming a small but realistic MonoGame project: a Game subclass driving a 64-entity simulation with per-frame loops, shared math helpers and a bounded telemetry ring buffer.
- The same five files are used for every compilation sample and for the preview cycles, so compile and preview measurements describe the same project.
- Every compilation in this report produced the same assembly digest (1 distinct digest(s) across all runs), which is evidence the compiler did the same work each time rather than short-circuiting.

### Run plan

- Launches: 3 total (1 full, 1 shell-only, 1 memory-baseline) across 1 attempt(s) within a budget of 3.
- Hard timeouts: 300 s per full launch, 120 s per shell-only launch, 600 s per memory-baseline launch, 20 s per first-frame observation (censoring bound), and a 300 s whole-harness budget inside each launch.
- Process discipline: only the exact PIDs this driver spawned are ever signalled (SIGTERM, then SIGKILL after a 5 s grace); `pkill` and `killall` are never used; the driver refuses to start if an application process it does not own is already running.
- Orphan application processes after the run: none.

### How samples are treated

- No sample is dropped because a later phase of the same launch failed. Each launch contributes every phase it actually completed: a launch that breaks in its second preview cycle still contributes its shell-startup sample, all of its compilation samples and its first preview and Stop samples.
- A preview that reports no drawn frame within the hard 20 s first-frame bound (measured from `preview.started`) is recorded as a right-censored sample whose value is the elapsed time from the compile response to the moment observation was abandoned. That value is at least the bound, the sample counts towards the preview-startup distribution and verdict, and the whole launch is kept.
- A percentile that lands on a censored sample is reported as a lower bound (`>=`). Such a phase can be a definitive FAIL when the bound already breaches the threshold, but it can never be a PASS; it is reported as INDETERMINATE instead.
- Stop samples are kept whenever a Stop actually ran, including the Stop of a preview that had drawn no frame, because that is still a real Stop of a started preview. Both subsets are published separately in the supplementary table so the distribution can be read either way without any sample being hidden.
- Samples that could not exist (a phase a launch never reached) are listed individually with the reason, and are the only cause of an additional attempt.
- Attempts continue until every phase and kind holds 1 sample(s), bounded by a finite budget of 3 attempt(s) (the default budget is 3x the 1 nominal attempts). No attempt is ever discarded because its numbers were slow or unwelcome: every attempt made is in the attempt inventory.

## Results against PRD section 17 thresholds

| Phase | Kind | n | censored | p50 | p95 | Threshold | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Application shell startup | cold | 1 | 0 | 350.8 ms | 350.8 ms | p95 <= 3000.0 ms | **PASS** |
| Application shell startup | warm | 1 | 0 | 299.0 ms | 299.0 ms | p95 <= 3000.0 ms | **PASS** |
| Compilation of the five-file benchmark project | cold | 1 | 0 | 1271.0 ms | 1271.0 ms | p95 < 5000.0 ms | **PASS** |
| Compilation of the five-file benchmark project | warm | 10 | 0 | 185.0 ms | 246.0 ms | p95 < 2000.0 ms | **PASS** |
| Preview visibly active after successful compilation | cold | 1 | 0 | 12345.0 ms | 12345.0 ms | p95 <= 3000.0 ms | **FAIL** |
| Preview visibly active after successful compilation | warm | 1 | 0 | 12342.0 ms | 12342.0 ms | p95 <= 3000.0 ms | **FAIL** |
| Stop returns control to the editor | cold | 1 | 0 | 282.0 ms | 282.0 ms | p95 <= 2000.0 ms | **PASS** |
| Stop returns control to the editor | warm | 1 | 0 | 241.0 ms | 241.0 ms | p95 <= 2000.0 ms | **PASS** |

`>=` marks a statistic that lands on a right-censored sample: the true value is at least the number shown. A phase whose p95 is a censored lower bound can be a definitive FAIL (the bound already breaches the threshold) but can never be a PASS; such a phase is reported as INDETERMINATE.

## Per-phase detail

### Application shell startup

- **Measured:** Driver wall clock from `spawn()` of the packaged binary to the shell's `ISSUE041_SHELL_READY` line (DOM parsed, all five shell controls present, two animation frames painted, main thread servicing a fresh macrotask, and the native window reported visible by Rust at that instant).

#### cold samples (n = 1, 0 right-censored)

- **PRD 17 requirement:** application shell visible within 3 seconds
- **Threshold applied:** p95 <= 3000.0 ms
- **"cold" means:** Fresh process launch preceded by an enforced idle cooling gap with no instance of the application running and no application process having run during the gap.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
350.8
```

Sorted ascending (ms):

```
350.8
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 350.8 ms | 350.8 ms | 350.8 ms | 350.8 ms | 350.8 ms | **PASS** | 2649.2 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 350.8 ms | no | 1 | driver wall clock: spawn() → ISSUE041_SHELL_READY |

#### warm samples (n = 1, 0 right-censored)

- **PRD 17 requirement:** application shell visible within 3 seconds
- **Threshold applied:** p95 <= 3000.0 ms
- **"warm" means:** Fresh process launch started immediately (< 1 s) after a preceding launch of the same binary exited, so the OS page cache, the dyld shared cache and WebKit's caches are warm.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
299.0
```

Sorted ascending (ms):

```
299.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 299.0 ms | 299.0 ms | 299.0 ms | 299.0 ms | 299.0 ms | **PASS** | 2701.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 299.0 ms | no | 1 | driver wall clock: spawn() → ISSUE041_SHELL_READY |

### Compilation of the five-file benchmark project

- **Measured:** `compile.request` sent on the persistent compiler protocol port until the validated `compile.response` carrying the DLL and PDB resolves, measured with `performance.now()` in the shell. The cold sample additionally includes the compiler-context boot that precedes it (compiler iframe load, .NET WASM runtime boot, Roslyn context creation, protocol bootstrap).

#### cold samples (n = 1, 0 right-censored)

- **PRD 17 requirement:** cold compiler initialization p95 under 5 seconds for a project of up to five source files
- **Threshold applied:** p95 < 5000.0 ms
- **"cold" means:** Compiler-context boot in a fresh application process plus the first compilation of the five-file fixture in that context. A process can produce exactly one such sample, so each cold sample comes from its own application launch.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
1271.0
```

Sorted ascending (ms):

```
1271.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 1271.0 ms | 1271.0 ms | 1271.0 ms | 1271.0 ms | 1271.0 ms | **PASS** | 3729.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 1271.0 ms | no | 1 | compiler-context boot + first compilation in that context |

#### warm samples (n = 10, 0 right-censored)

- **PRD 17 requirement:** warm compilation p95 under 2 seconds for a project of up to five source files
- **Threshold applied:** p95 < 2000.0 ms
- **"warm" means:** Any later compilation of the same five-file fixture through the same retained compiler context in the same process.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
246.0, 219.0, 201.0, 197.0, 192.0, 185.0, 177.0, 178.0, 171.0, 174.0
```

Sorted ascending (ms):

```
171.0, 174.0, 177.0, 178.0, 185.0, 192.0, 197.0, 201.0, 219.0, 246.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 171.0 ms | 185.0 ms | 194.0 ms | 246.0 ms | 246.0 ms | **PASS** | 1754.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 246.0 ms | no | 1 | warm compilation #1 in the retained context |
| 2 | 219.0 ms | no | 1 | warm compilation #2 in the retained context |
| 3 | 201.0 ms | no | 1 | warm compilation #3 in the retained context |
| 4 | 197.0 ms | no | 1 | warm compilation #4 in the retained context |
| 5 | 192.0 ms | no | 1 | warm compilation #5 in the retained context |
| 6 | 185.0 ms | no | 1 | warm compilation #6 in the retained context |
| 7 | 177.0 ms | no | 1 | warm compilation #7 in the retained context |
| 8 | 178.0 ms | no | 1 | warm compilation #8 in the retained context |
| 9 | 171.0 ms | no | 1 | warm compilation #9 in the retained context |
| 10 | 174.0 ms | no | 1 | warm compilation #10 in the retained context |

### Preview visibly active after successful compilation

- **Measured:** From the validated `compile.response` for the fixture to the first frame the running Game itself reports having drawn (`FrameCount >= 1`, read through the preview bridge). The `preview.started` lifecycle event is reported separately as a lower bound.

#### cold samples (n = 1, 0 right-censored)

- **PRD 17 requirement:** preview visibly active within 3 seconds after successful compilation at p95
- **Threshold applied:** p95 <= 3000.0 ms
- **"cold" means:** First preview start in a fresh application process: no preview window, preview runtime or preview asset has been instantiated in the process yet.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
12345.0
```

Sorted ascending (ms):

```
12345.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 12345.0 ms | 12345.0 ms | 12345.0 ms | 12345.0 ms | 12345.0 ms | **FAIL** | -9345.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 12345.0 ms | no | 1 | preview cycle 0: compile response → first drawn frame |

#### warm samples (n = 1, 0 right-censored)

- **PRD 17 requirement:** preview visibly active within 3 seconds after successful compilation at p95
- **Threshold applied:** p95 <= 3000.0 ms
- **"warm" means:** A later preview start in the same process, after a previous preview was started and stopped, so the isolated preview runtime assets are already in the process's caches.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
12342.0
```

Sorted ascending (ms):

```
12342.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 12342.0 ms | 12342.0 ms | 12342.0 ms | 12342.0 ms | 12342.0 ms | **FAIL** | -9342.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 12342.0 ms | no | 1 | preview cycle 1: compile response → first drawn frame |

### Stop returns control to the editor

- **Measured:** Shell wall clock around the issue 024 Run/Stop control's `stop()`: from the call the Stop button makes until the controller has returned to `idle` and the editor's Run control is enabled again.

#### cold samples (n = 1, 0 right-censored)

- **PRD 17 requirement:** Stop returning control to the editor within 2 seconds
- **Threshold applied:** p95 <= 2000.0 ms
- **"cold" means:** Stop of the first preview in a fresh application process.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
282.0
```

Sorted ascending (ms):

```
282.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 282.0 ms | 282.0 ms | 282.0 ms | 282.0 ms | 282.0 ms | **PASS** | 1718.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 282.0 ms | no | 1 | preview cycle 0: Stop → controller idle |

#### warm samples (n = 1, 0 right-censored)

- **PRD 17 requirement:** Stop returning control to the editor within 2 seconds
- **Threshold applied:** p95 <= 2000.0 ms
- **"warm" means:** Stop of a later preview in the same process.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
241.0
```

Sorted ascending (ms):

```
241.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 241.0 ms | 241.0 ms | 241.0 ms | 241.0 ms | 241.0 ms | **PASS** | 1759.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 241.0 ms | no | 1 | preview cycle 1: Stop → controller idle |

## Supplementary measurements (not PRD thresholds)

| Measurement | n | p50 | p95 | Note |
| --- | --- | --- | --- | --- |
| Shell startup measured inside the process (Rust process-start instant → shell ready) | 2 | 293.6 ms | 333.8 ms | Excludes exec/dyld time before `main`; the PASS/FAIL phase above uses the driver's wall clock from `spawn()`, which is the strict superset. |
| Compiler-context boot alone (no compilation) | 1 | 348.0 ms | 348.0 ms | The cold compilation phase above is this value plus the first compile. |
| Compile response → `preview.started` lifecycle event (cold) | 1 | 12175.0 ms | 12175.0 ms | Measured lower bound on preview startup: the Game cannot have drawn before it was started. The PASS/FAIL phase uses the first frame the Game reports drawing. |
| Compile response → `preview.started` lifecycle event (warm) | 1 | 12193.0 ms | 12193.0 ms | Measured lower bound on preview startup: the Game cannot have drawn before it was started. The PASS/FAIL phase uses the first frame the Game reports drawing. |
| Issue 024 in-protocol Stop latency (cold) | 1 | 281.0 ms | 281.0 ms | Stop request sent → `preview.stopped` observed and resources released, inside the shell. |
| Issue 024 in-protocol Stop latency (warm) | 1 | 241.0 ms | 241.0 ms | Stop request sent → `preview.stopped` observed and resources released, inside the shell. |
| Stop latency restricted to previews that had drawn frames | 2 | 241.0 ms | 282.0 ms | Same measurement as the Stop phase above, restricted to cycles whose preview was confirmed drawing. Published so the Stop distribution can be read with and without the non-rendering cycles; the PASS/FAIL phase above includes every Stop. |
| Measured lower bound on the first-frame instant (compile response → `preview.start.request`) | 2 | 12023.0 ms | 12083.0 ms | The Game cannot draw before the start request leaves the shell, so the true first-frame time is bracketed between this row and the reported first-frame sample. |
| Frame-rate corrected estimate of the first-frame instant | 2 | 12136.2 ms | 12139.2 ms | The reported sample minus (frames already drawn at the first observation - 1) divided by the frame rate measured immediately afterwards. An estimate only: no verdict uses it. |
| Frame rate of the running preview (frames per second) | 2 | 49.3 ms | 57.5 ms | Measured after the first-frame sample was taken, over a 250 ms window, from the Game's own frame counter. Used only to quantify the first-frame overshoot. |
| Bridge round trip of the observation that saw the first frame | 2 | 43.0 ms | 85.0 ms | The preview-bridge round trip that returned the observation, plus one 5 ms poll interval when polling was needed. This bounds only the latency of the final observation, not the whole overshoot: frames drawn before that observation are accounted for by the frame-rate corrected estimate above. |
| Preview startup breakdown: `issue038_create_preview_window` invoke | 2 | 39.0 ms | 46.0 ms | Creating the isolated preview WebviewWindow through the Rust command. |
| Preview startup breakdown: fixed settle delay | 2 | 1515.0 ms | 1518.0 ms | Unconditional 1500 ms sleep in `createIsolatedPreview` after the window is created. |
| Preview startup breakdown: real preview-runtime work (settle → `preview.bridge.ready`) | 2 | 65.0 ms | 88.0 ms | Measured on the bridge-readiness promise itself, observed passively inside `createIsolatedPreview`, so it is the instant the preview .NET/MonoGame WASM runtime actually reported readiness. |
| Preview startup breakdown: bootstrap-loop wait after the runtime was already ready | 2 | 10261.0 ms | 10312.0 ms | `createIsolatedPreview` starts a background message drain before its bootstrap loop, and that drain consumes `preview.bridge.ready`. The bootstrap loop therefore never sees the readiness message it polls for and can only exit when its fixed 10 000 ms deadline expires. This row is that fixed wait, not preview runtime work and not poll quantisation. |
| Preview startup breakdown: whole bootstrap interval (settle → loop exit) | 2 | 10349.0 ms | 10377.0 ms | The sum of the two rows above: real runtime readiness plus the fixed deadline the bootstrap loop waits out. |
| Preview startup breakdown: assembly load + start → `preview.started` | 2 | 262.0 ms | 262.0 ms | Everything after the preview runtime is ready: DLL/PDB transfer, `preview.load` and `preview.start`. |

## Memory baseline (Issue 042 — RSS stability after 100 compiles and 20 preview cycles)

**Runs:** 1 | **Compilations:** 100 | **Preview cycles:** 20

### Compiler RSS after 100 compilations

- **Threshold:** p95 growth ≤ 10%
- **Verdict:** **PASS**
- **Sample count:** 10
- **First RSS:** 215024.0 KB
- **Last RSS:** 213808.0 KB
- **Growth:** -0.57%

| min | p50 | mean | p95 | max | Growth% | Verdict |
| --- | --- | ---- | --- | --- | ------- | ------- |
| 213808.0 KB | 214736.0 KB | 214388.8 KB | 215072.0 KB | 215072.0 KB | -0.57% | **PASS** |

### Preview RSS after 20 Run/Stop cycles

- **Threshold:** p95 growth ≤ 20%
- **Verdict:** **PASS**
- **Sample count:** 20
- **First RSS:** 192688.0 KB
- **Last RSS:** 199504.0 KB
- **Growth:** 3.54%

| min | p50 | mean | p95 | max | Growth% | Verdict |
| --- | --- | ---- | --- | --- | ------- | ------- |
| 178256.0 KB | 192688.0 KB | 191006.4 KB | 198768.0 KB | 199504.0 KB | 3.54% | **PASS** |

### Resource cleanup verification

- **All checks passed:** yes

- Audio contexts: suspended
- Animation frames observed: 0
- WebGL contexts: 1
- Message ports: 2
- Detail: AudioContext: ok (state=${audioContextState}) | WebGL: ok | Animation frames observed: 0 | MessagePort objects created/closed: 2 (ok) | All cleanup checks passed



## Release Package Size (Issue 043)

- **Total compressed size:** 84.41 MB
- **100 MB target:** PASS
- **Debug symbols:** stripped

### Category breakdown (uncompressed)

| Category | Size |
| --- | --- |
| Shell native binary | 109.51 MB |
| Frontend shell (HTML/JS/CSS) | 0.15 MB |
| Compiler runtime (Roslyn WASM + refs) | 37.81 MB |
| Preview runtime (Blazor WASM + MonoGame) | 43.79 MB |
| MonoGame managed assemblies | 1.23 MB |
| .NET runtime (shared _framework) | 14.23 MB |
| Audio dependencies | 3.64 MB |

### Fixture verification (Release build)

| Fixture | Description | Result |
| --- | --- | --- |
| issue030 | Two-file cross-call compile/run | PASS |
| issue031 | Policy rejection (supported API) | PASS |
| issue032 | Policy rejection (native JS interop) | PASS |
| issue039 | Texture2D content validation | FAIL |
| issue040 | SoundEffect playback | FAIL |

## Caveats and known gaps

- Cold shell samples in this report span 351-351 ms. The slowest cold launch is normally the first launch after the binary is rebuilt, when its pages are not yet in the operating system's file cache; later cold launches read a cached binary. A true first-ever launch on a given machine can therefore be slower than the median cold sample here.
- Cold/warm for the shell phase is defined by process and cache state that this driver controls: cold launches are preceded by an enforced idle gap with no application process running, warm launches start immediately after the previous process exited. The OS page cache cannot be purged without root, so "cold" here means cold application state, not a cold file cache.
- Preview startup includes a fixed 1500 ms settle delay that the current isolated-preview implementation performs after creating the preview window (`createIsolatedPreview` in `src/frontend/src/issue38-bridge.ts`). It is production code on the measured path, so it is measured; removing it is optimization work and is out of scope for this measurement issue (PRD 24 / issue 44 gate).
- Preview startup also includes a fixed 10 000 ms bootstrap wait, and this report measures it as such rather than describing it as runtime work or poll quantisation. `createIsolatedPreview` starts a background message drain before its bootstrap loop; the drain consumes the `preview.bridge.ready` message, so the loop that polls for that same message never observes it and exits only when its fixed 10 000 ms deadline expires. Measured passively on the readiness promise itself, the preview runtime is actually ready 65 ms (p50) after the settle delay, while the bootstrap loop then waits a further 10261 ms (p50) / 10312 ms (p95) with the runtime already ready. 2 of 2 measured cycles exited that loop on the deadline rather than on the message. Removing the race is optimization work and is out of scope here (PRD 24 / issue 44 gate).
- The measured Run path enables the issue 021/023/024 preview proof instrumentation, because the frame counters that prove the preview is visibly active are exposed by that instrumentation. Each reported sample therefore contains that instrumentation's own cost, so as an estimate of the same phase in an uninstrumented build every observed sample is an upper bound. This is a separate statement from the observation bounds above: a censored sample is a lower bound on the instrumented run itself and implies nothing about an uninstrumented one.
- The benchmark harness and its Tauri commands are inert unless `MONOGAME_ISSUE041_BENCHMARK=1` is set in the process environment.
- Uncensored preview-startup samples are upper bounds on the true first-frame instant: the observation is a poll through the preview bridge, and the Game had already drawn 11-13 frames when the observation landed. The overshoot is therefore larger than the bridge round trip alone. It is quantified in the supplementary table by the frame-rate corrected estimate (measured frame rate p50 49.3 fps), and the true first-frame instant is bracketed below by the measured compile-response to `preview.start.request` interval. Censored samples are the opposite case: they are lower bounds, and are marked as such wherever they appear.
- Samples were collected on one machine in one session; they are a feasibility baseline, not a cross-machine guarantee.
- At least one threshold FAILED. Per this issue's scope, no optimization was attempted; the failure is recorded as a known gap for the issue 044 feasibility gate review.

## Censored samples

No sample in this report is censored: every measured phase completed inside its observation bound.

## Attempt inventory

- Nominal attempts: 1; attempts made: 1; finite attempt budget: 3.
- Stop reason: memory-baseline completed after 1 attempt(s); standard phases reached 1 sample(s) each
- Budget rule: attempts continue until standard phases hold 1 sample(s) each, up to 3x the nominal attempt count (overridable with --max-attempts); the budget is finite so a persistently broken build cannot loop.

| Attempt | Launches | Outcomes | Samples contributed | Censored | Retry reason |
| --- | --- | --- | --- | --- | --- |
| 1 | full/cold, shell-only/warm, memory-baseline/baseline | ok, ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |

### Launch failures and partial launches

Every launch in this report completed its whole programme.

### Samples that could not be taken

Every launch produced every sample its mode is capable of producing.

## Reproducing this report

```sh
npm --prefix src/frontend run build
npm --prefix src/desktop run tauri -- build
caffeinate -di node scripts/measure-performance.mjs --runs 1 --memory-baseline --warm-compiles-baseline 99 --preview-cycles-baseline 20 --cooling-seconds 5 --max-attempts 3
node --test scripts/performance-report.test.mjs scripts/measure-performance.test.mjs
```

- The driver requires the macOS packaged release binary at `src/desktop/src-tauri/target/release/monogame-playground`.
- Run it under `caffeinate -di` on an unlocked console session: the measured Run path requires the application window to activate and paint, which macOS suppresses while the display sleeps or the screen is locked. The driver reads the console session state before every attempt and refuses to measure a locked or off-console session.
- The driver publishes a run whose launches failed, provided every phase still reached its required sample count: the failures, the censored samples and the attempts are all part of the report. It refuses to publish only when a phase is short of samples or the report fails schema validation, in which case it writes `artifacts/issue041/rejected-report.json` and leaves the committed documents untouched.
- Per-launch stdout is written to `artifacts/issue041/attempt-NN-<mode>-<kind>.log`.
- Re-running the driver overwrites both `docs/performance-baseline.json` and `docs/performance-baseline.md`; absolute numbers vary between sessions and machines.

## Launch inventory

| Attempt | Mode | Shell launch kind | Exit code | Duration | Outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | full | cold | 0 | 30110.2 ms | ok |
| 1 | shell-only | warm | 0 | 305.8 ms | ok |
| 1 | memory-baseline | baseline | 0 | 280342.0 ms | ok |

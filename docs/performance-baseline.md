# Performance baseline

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with: node scripts/measure-performance.mjs
     Machine-readable source of truth: docs/performance-baseline.json -->

**Report schema version:** 2

**Generated:** 2026-09-03T21:36:25.342Z

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

- 10 attempt(s) were made. Each attempt is one cold application launch, preceded by a 5 s idle cooling gap with no application process running, immediately followed by one warm launch started as soon as the previous process exited.
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

- Launches: 20 total (10 full, 10 shell-only) across 10 attempt(s) within a budget of 30.
- Hard timeouts: 300 s per full launch, 120 s per shell-only launch, 20 s per first-frame observation (censoring bound), and a 300 s whole-harness budget inside each launch.
- Process discipline: only the exact PIDs this driver spawned are ever signalled (SIGTERM, then SIGKILL after a 5 s grace); `pkill` and `killall` are never used; the driver refuses to start if an application process it does not own is already running.
- Orphan application processes after the run: none.

### How samples are treated

- No sample is dropped because a later phase of the same launch failed. Each launch contributes every phase it actually completed: a launch that breaks in its second preview cycle still contributes its shell-startup sample, all of its compilation samples and its first preview and Stop samples.
- A preview that reports no drawn frame within the hard 20 s first-frame bound (measured from `preview.started`) is recorded as a right-censored sample whose value is the elapsed time from the compile response to the moment observation was abandoned. That value is at least the bound, the sample counts towards the preview-startup distribution and verdict, and the whole launch is kept.
- A percentile that lands on a censored sample is reported as a lower bound (`>=`). Such a phase can be a definitive FAIL when the bound already breaches the threshold, but it can never be a PASS; it is reported as INDETERMINATE instead.
- Stop samples are kept whenever a Stop actually ran, including the Stop of a preview that had drawn no frame, because that is still a real Stop of a started preview. Both subsets are published separately in the supplementary table so the distribution can be read either way without any sample being hidden.
- Samples that could not exist (a phase a launch never reached) are listed individually with the reason, and are the only cause of an additional attempt.
- Attempts continue until every phase and kind holds 10 samples, bounded by a finite budget of 30 attempt(s) (the default budget is 3x the 10 nominal attempts). No attempt is ever discarded because its numbers were slow or unwelcome: every attempt made is in the attempt inventory.

## Results against PRD section 17 thresholds

| Phase | Kind | n | censored | p50 | p95 | Threshold | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Application shell startup | cold | 10 | 0 | 359.9 ms | 1448.4 ms | p95 <= 3000.0 ms | **PASS** |
| Application shell startup | warm | 10 | 0 | 302.1 ms | 313.1 ms | p95 <= 3000.0 ms | **PASS** |
| Compilation of the five-file benchmark project | cold | 10 | 0 | 1237.0 ms | 1284.0 ms | p95 < 5000.0 ms | **PASS** |
| Compilation of the five-file benchmark project | warm | 100 | 0 | 182.0 ms | 233.0 ms | p95 < 2000.0 ms | **PASS** |
| Preview visibly active after successful compilation | cold | 10 | 0 | 12336.0 ms | 12453.0 ms | p95 <= 3000.0 ms | **FAIL** |
| Preview visibly active after successful compilation | warm | 10 | 0 | 12259.0 ms | 13563.0 ms | p95 <= 3000.0 ms | **FAIL** |
| Stop returns control to the editor | cold | 10 | 0 | 300.0 ms | 313.0 ms | p95 <= 2000.0 ms | **PASS** |
| Stop returns control to the editor | warm | 10 | 0 | 261.0 ms | 333.0 ms | p95 <= 2000.0 ms | **PASS** |

`>=` marks a statistic that lands on a right-censored sample: the true value is at least the number shown. A phase whose p95 is a censored lower bound can be a definitive FAIL (the bound already breaches the threshold) but can never be a PASS; such a phase is reported as INDETERMINATE.

## Per-phase detail

### Application shell startup

- **Measured:** Driver wall clock from `spawn()` of the packaged binary to the shell's `ISSUE041_SHELL_READY` line (DOM parsed, all five shell controls present, two animation frames painted, main thread servicing a fresh macrotask, and the native window reported visible by Rust at that instant).

#### cold samples (n = 10, 0 right-censored)

- **PRD 17 requirement:** application shell visible within 3 seconds
- **Threshold applied:** p95 <= 3000.0 ms
- **"cold" means:** Fresh process launch preceded by an enforced idle cooling gap with no instance of the application running and no application process having run during the gap.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
1448.4, 363.0, 359.9, 354.1, 354.6, 355.4, 366.3, 349.8, 367.1, 367.1
```

Sorted ascending (ms):

```
349.8, 354.1, 354.6, 355.4, 359.9, 363.0, 366.3, 367.1, 367.1, 1448.4
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 349.8 ms | 359.9 ms | 468.6 ms | 1448.4 ms | 1448.4 ms | **PASS** | 1551.6 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 1448.4 ms | no | 1 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 2 | 363.0 ms | no | 2 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 3 | 359.9 ms | no | 3 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 4 | 354.1 ms | no | 4 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 5 | 354.6 ms | no | 5 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 6 | 355.4 ms | no | 6 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 7 | 366.3 ms | no | 7 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 8 | 349.8 ms | no | 8 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 9 | 367.1 ms | no | 9 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 10 | 367.1 ms | no | 10 | driver wall clock: spawn() → ISSUE041_SHELL_READY |

#### warm samples (n = 10, 0 right-censored)

- **PRD 17 requirement:** application shell visible within 3 seconds
- **Threshold applied:** p95 <= 3000.0 ms
- **"warm" means:** Fresh process launch started immediately (< 1 s) after a preceding launch of the same binary exited, so the OS page cache, the dyld shared cache and WebKit's caches are warm.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
302.1, 301.0, 303.2, 302.1, 302.6, 294.4, 300.1, 300.3, 308.8, 313.1
```

Sorted ascending (ms):

```
294.4, 300.1, 300.3, 301.0, 302.1, 302.1, 302.6, 303.2, 308.8, 313.1
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 294.4 ms | 302.1 ms | 302.8 ms | 313.1 ms | 313.1 ms | **PASS** | 2686.9 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 302.1 ms | no | 1 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 2 | 301.0 ms | no | 2 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 3 | 303.2 ms | no | 3 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 4 | 302.1 ms | no | 4 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 5 | 302.6 ms | no | 5 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 6 | 294.4 ms | no | 6 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 7 | 300.1 ms | no | 7 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 8 | 300.3 ms | no | 8 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 9 | 308.8 ms | no | 9 | driver wall clock: spawn() → ISSUE041_SHELL_READY |
| 10 | 313.1 ms | no | 10 | driver wall clock: spawn() → ISSUE041_SHELL_READY |

### Compilation of the five-file benchmark project

- **Measured:** `compile.request` sent on the persistent compiler protocol port until the validated `compile.response` carrying the DLL and PDB resolves, measured with `performance.now()` in the shell. The cold sample additionally includes the compiler-context boot that precedes it (compiler iframe load, .NET WASM runtime boot, Roslyn context creation, protocol bootstrap).

#### cold samples (n = 10, 0 right-censored)

- **PRD 17 requirement:** cold compiler initialization p95 under 5 seconds for a project of up to five source files
- **Threshold applied:** p95 < 5000.0 ms
- **"cold" means:** Compiler-context boot in a fresh application process plus the first compilation of the five-file fixture in that context. A process can produce exactly one such sample, so each cold sample comes from its own application launch.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
1284.0, 1237.0, 1248.0, 1252.0, 1253.0, 1253.0, 1138.0, 1174.0, 1141.0, 1235.0
```

Sorted ascending (ms):

```
1138.0, 1141.0, 1174.0, 1235.0, 1237.0, 1248.0, 1252.0, 1253.0, 1253.0, 1284.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 1138.0 ms | 1237.0 ms | 1221.5 ms | 1284.0 ms | 1284.0 ms | **PASS** | 3716.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 1284.0 ms | no | 1 | compiler-context boot + first compilation in that context |
| 2 | 1237.0 ms | no | 2 | compiler-context boot + first compilation in that context |
| 3 | 1248.0 ms | no | 3 | compiler-context boot + first compilation in that context |
| 4 | 1252.0 ms | no | 4 | compiler-context boot + first compilation in that context |
| 5 | 1253.0 ms | no | 5 | compiler-context boot + first compilation in that context |
| 6 | 1253.0 ms | no | 6 | compiler-context boot + first compilation in that context |
| 7 | 1138.0 ms | no | 7 | compiler-context boot + first compilation in that context |
| 8 | 1174.0 ms | no | 8 | compiler-context boot + first compilation in that context |
| 9 | 1141.0 ms | no | 9 | compiler-context boot + first compilation in that context |
| 10 | 1235.0 ms | no | 10 | compiler-context boot + first compilation in that context |

#### warm samples (n = 100, 0 right-censored)

- **PRD 17 requirement:** warm compilation p95 under 2 seconds for a project of up to five source files
- **Threshold applied:** p95 < 2000.0 ms
- **"warm" means:** Any later compilation of the same five-file fixture through the same retained compiler context in the same process.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
240.0, 217.0, 206.0, 196.0, 186.0, 179.0, 171.0, 182.0, 172.0, 173.0, 232.0, 210.0, 193.0, 193.0, 183.0, 176.0, 168.0, 168.0, 164.0, 166.0, 236.0, 209.0, 192.0, 195.0, 184.0, 176.0, 168.0, 169.0, 163.0, 167.0, 236.0, 213.0, 197.0, 191.0, 184.0, 177.0, 169.0, 172.0, 165.0, 167.0, 232.0, 209.0, 196.0, 189.0, 182.0, 175.0, 170.0, 168.0, 164.0, 165.0, 231.0, 209.0, 196.0, 188.0, 184.0, 176.0, 169.0, 168.0, 163.0, 169.0, 234.0, 210.0, 196.0, 188.0, 183.0, 175.0, 168.0, 167.0, 163.0, 166.0, 233.0, 211.0, 193.0, 194.0, 182.0, 176.0, 169.0, 169.0, 163.0, 165.0, 234.0, 209.0, 191.0, 193.0, 184.0, 174.0, 168.0, 168.0, 162.0, 168.0, 232.0, 210.0, 200.0, 188.0, 184.0, 175.0, 169.0, 170.0, 164.0, 167.0
```

Sorted ascending (ms):

```
162.0, 163.0, 163.0, 163.0, 163.0, 164.0, 164.0, 164.0, 165.0, 165.0, 165.0, 166.0, 166.0, 167.0, 167.0, 167.0, 167.0, 168.0, 168.0, 168.0, 168.0, 168.0, 168.0, 168.0, 168.0, 168.0, 169.0, 169.0, 169.0, 169.0, 169.0, 169.0, 169.0, 170.0, 170.0, 171.0, 172.0, 172.0, 173.0, 174.0, 175.0, 175.0, 175.0, 176.0, 176.0, 176.0, 176.0, 177.0, 179.0, 182.0, 182.0, 182.0, 183.0, 183.0, 184.0, 184.0, 184.0, 184.0, 184.0, 186.0, 188.0, 188.0, 188.0, 189.0, 191.0, 191.0, 192.0, 193.0, 193.0, 193.0, 193.0, 194.0, 195.0, 196.0, 196.0, 196.0, 196.0, 197.0, 200.0, 206.0, 209.0, 209.0, 209.0, 209.0, 210.0, 210.0, 210.0, 211.0, 213.0, 217.0, 231.0, 232.0, 232.0, 232.0, 233.0, 234.0, 234.0, 236.0, 236.0, 240.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 162.0 ms | 182.0 ms | 186.2 ms | 233.0 ms | 240.0 ms | **PASS** | 1767.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 240.0 ms | no | 1 | warm compilation #1 in the retained context |
| 2 | 217.0 ms | no | 1 | warm compilation #2 in the retained context |
| 3 | 206.0 ms | no | 1 | warm compilation #3 in the retained context |
| 4 | 196.0 ms | no | 1 | warm compilation #4 in the retained context |
| 5 | 186.0 ms | no | 1 | warm compilation #5 in the retained context |
| 6 | 179.0 ms | no | 1 | warm compilation #6 in the retained context |
| 7 | 171.0 ms | no | 1 | warm compilation #7 in the retained context |
| 8 | 182.0 ms | no | 1 | warm compilation #8 in the retained context |
| 9 | 172.0 ms | no | 1 | warm compilation #9 in the retained context |
| 10 | 173.0 ms | no | 1 | warm compilation #10 in the retained context |
| 11 | 232.0 ms | no | 2 | warm compilation #1 in the retained context |
| 12 | 210.0 ms | no | 2 | warm compilation #2 in the retained context |
| 13 | 193.0 ms | no | 2 | warm compilation #3 in the retained context |
| 14 | 193.0 ms | no | 2 | warm compilation #4 in the retained context |
| 15 | 183.0 ms | no | 2 | warm compilation #5 in the retained context |
| 16 | 176.0 ms | no | 2 | warm compilation #6 in the retained context |
| 17 | 168.0 ms | no | 2 | warm compilation #7 in the retained context |
| 18 | 168.0 ms | no | 2 | warm compilation #8 in the retained context |
| 19 | 164.0 ms | no | 2 | warm compilation #9 in the retained context |
| 20 | 166.0 ms | no | 2 | warm compilation #10 in the retained context |
| 21 | 236.0 ms | no | 3 | warm compilation #1 in the retained context |
| 22 | 209.0 ms | no | 3 | warm compilation #2 in the retained context |
| 23 | 192.0 ms | no | 3 | warm compilation #3 in the retained context |
| 24 | 195.0 ms | no | 3 | warm compilation #4 in the retained context |
| 25 | 184.0 ms | no | 3 | warm compilation #5 in the retained context |
| 26 | 176.0 ms | no | 3 | warm compilation #6 in the retained context |
| 27 | 168.0 ms | no | 3 | warm compilation #7 in the retained context |
| 28 | 169.0 ms | no | 3 | warm compilation #8 in the retained context |
| 29 | 163.0 ms | no | 3 | warm compilation #9 in the retained context |
| 30 | 167.0 ms | no | 3 | warm compilation #10 in the retained context |
| 31 | 236.0 ms | no | 4 | warm compilation #1 in the retained context |
| 32 | 213.0 ms | no | 4 | warm compilation #2 in the retained context |
| 33 | 197.0 ms | no | 4 | warm compilation #3 in the retained context |
| 34 | 191.0 ms | no | 4 | warm compilation #4 in the retained context |
| 35 | 184.0 ms | no | 4 | warm compilation #5 in the retained context |
| 36 | 177.0 ms | no | 4 | warm compilation #6 in the retained context |
| 37 | 169.0 ms | no | 4 | warm compilation #7 in the retained context |
| 38 | 172.0 ms | no | 4 | warm compilation #8 in the retained context |
| 39 | 165.0 ms | no | 4 | warm compilation #9 in the retained context |
| 40 | 167.0 ms | no | 4 | warm compilation #10 in the retained context |
| 41 | 232.0 ms | no | 5 | warm compilation #1 in the retained context |
| 42 | 209.0 ms | no | 5 | warm compilation #2 in the retained context |
| 43 | 196.0 ms | no | 5 | warm compilation #3 in the retained context |
| 44 | 189.0 ms | no | 5 | warm compilation #4 in the retained context |
| 45 | 182.0 ms | no | 5 | warm compilation #5 in the retained context |
| 46 | 175.0 ms | no | 5 | warm compilation #6 in the retained context |
| 47 | 170.0 ms | no | 5 | warm compilation #7 in the retained context |
| 48 | 168.0 ms | no | 5 | warm compilation #8 in the retained context |
| 49 | 164.0 ms | no | 5 | warm compilation #9 in the retained context |
| 50 | 165.0 ms | no | 5 | warm compilation #10 in the retained context |
| 51 | 231.0 ms | no | 6 | warm compilation #1 in the retained context |
| 52 | 209.0 ms | no | 6 | warm compilation #2 in the retained context |
| 53 | 196.0 ms | no | 6 | warm compilation #3 in the retained context |
| 54 | 188.0 ms | no | 6 | warm compilation #4 in the retained context |
| 55 | 184.0 ms | no | 6 | warm compilation #5 in the retained context |
| 56 | 176.0 ms | no | 6 | warm compilation #6 in the retained context |
| 57 | 169.0 ms | no | 6 | warm compilation #7 in the retained context |
| 58 | 168.0 ms | no | 6 | warm compilation #8 in the retained context |
| 59 | 163.0 ms | no | 6 | warm compilation #9 in the retained context |
| 60 | 169.0 ms | no | 6 | warm compilation #10 in the retained context |
| 61 | 234.0 ms | no | 7 | warm compilation #1 in the retained context |
| 62 | 210.0 ms | no | 7 | warm compilation #2 in the retained context |
| 63 | 196.0 ms | no | 7 | warm compilation #3 in the retained context |
| 64 | 188.0 ms | no | 7 | warm compilation #4 in the retained context |
| 65 | 183.0 ms | no | 7 | warm compilation #5 in the retained context |
| 66 | 175.0 ms | no | 7 | warm compilation #6 in the retained context |
| 67 | 168.0 ms | no | 7 | warm compilation #7 in the retained context |
| 68 | 167.0 ms | no | 7 | warm compilation #8 in the retained context |
| 69 | 163.0 ms | no | 7 | warm compilation #9 in the retained context |
| 70 | 166.0 ms | no | 7 | warm compilation #10 in the retained context |
| 71 | 233.0 ms | no | 8 | warm compilation #1 in the retained context |
| 72 | 211.0 ms | no | 8 | warm compilation #2 in the retained context |
| 73 | 193.0 ms | no | 8 | warm compilation #3 in the retained context |
| 74 | 194.0 ms | no | 8 | warm compilation #4 in the retained context |
| 75 | 182.0 ms | no | 8 | warm compilation #5 in the retained context |
| 76 | 176.0 ms | no | 8 | warm compilation #6 in the retained context |
| 77 | 169.0 ms | no | 8 | warm compilation #7 in the retained context |
| 78 | 169.0 ms | no | 8 | warm compilation #8 in the retained context |
| 79 | 163.0 ms | no | 8 | warm compilation #9 in the retained context |
| 80 | 165.0 ms | no | 8 | warm compilation #10 in the retained context |
| 81 | 234.0 ms | no | 9 | warm compilation #1 in the retained context |
| 82 | 209.0 ms | no | 9 | warm compilation #2 in the retained context |
| 83 | 191.0 ms | no | 9 | warm compilation #3 in the retained context |
| 84 | 193.0 ms | no | 9 | warm compilation #4 in the retained context |
| 85 | 184.0 ms | no | 9 | warm compilation #5 in the retained context |
| 86 | 174.0 ms | no | 9 | warm compilation #6 in the retained context |
| 87 | 168.0 ms | no | 9 | warm compilation #7 in the retained context |
| 88 | 168.0 ms | no | 9 | warm compilation #8 in the retained context |
| 89 | 162.0 ms | no | 9 | warm compilation #9 in the retained context |
| 90 | 168.0 ms | no | 9 | warm compilation #10 in the retained context |
| 91 | 232.0 ms | no | 10 | warm compilation #1 in the retained context |
| 92 | 210.0 ms | no | 10 | warm compilation #2 in the retained context |
| 93 | 200.0 ms | no | 10 | warm compilation #3 in the retained context |
| 94 | 188.0 ms | no | 10 | warm compilation #4 in the retained context |
| 95 | 184.0 ms | no | 10 | warm compilation #5 in the retained context |
| 96 | 175.0 ms | no | 10 | warm compilation #6 in the retained context |
| 97 | 169.0 ms | no | 10 | warm compilation #7 in the retained context |
| 98 | 170.0 ms | no | 10 | warm compilation #8 in the retained context |
| 99 | 164.0 ms | no | 10 | warm compilation #9 in the retained context |
| 100 | 167.0 ms | no | 10 | warm compilation #10 in the retained context |

### Preview visibly active after successful compilation

- **Measured:** From the validated `compile.response` for the fixture to the first frame the running Game itself reports having drawn (`FrameCount >= 1`, read through the preview bridge). The `preview.started` lifecycle event is reported separately as a lower bound.

#### cold samples (n = 10, 0 right-censored)

- **PRD 17 requirement:** preview visibly active within 3 seconds after successful compilation at p95
- **Threshold applied:** p95 <= 3000.0 ms
- **"cold" means:** First preview start in a fresh application process: no preview window, preview runtime or preview asset has been instantiated in the process yet.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
12266.0, 12311.0, 12302.0, 12354.0, 12426.0, 12417.0, 12453.0, 12336.0, 12223.0, 12354.0
```

Sorted ascending (ms):

```
12223.0, 12266.0, 12302.0, 12311.0, 12336.0, 12354.0, 12354.0, 12417.0, 12426.0, 12453.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 12223.0 ms | 12336.0 ms | 12344.2 ms | 12453.0 ms | 12453.0 ms | **FAIL** | -9453.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 12266.0 ms | no | 1 | preview cycle 0: compile response → first drawn frame |
| 2 | 12311.0 ms | no | 2 | preview cycle 0: compile response → first drawn frame |
| 3 | 12302.0 ms | no | 3 | preview cycle 0: compile response → first drawn frame |
| 4 | 12354.0 ms | no | 4 | preview cycle 0: compile response → first drawn frame |
| 5 | 12426.0 ms | no | 5 | preview cycle 0: compile response → first drawn frame |
| 6 | 12417.0 ms | no | 6 | preview cycle 0: compile response → first drawn frame |
| 7 | 12453.0 ms | no | 7 | preview cycle 0: compile response → first drawn frame |
| 8 | 12336.0 ms | no | 8 | preview cycle 0: compile response → first drawn frame |
| 9 | 12223.0 ms | no | 9 | preview cycle 0: compile response → first drawn frame |
| 10 | 12354.0 ms | no | 10 | preview cycle 0: compile response → first drawn frame |

#### warm samples (n = 10, 0 right-censored)

- **PRD 17 requirement:** preview visibly active within 3 seconds after successful compilation at p95
- **Threshold applied:** p95 <= 3000.0 ms
- **"warm" means:** A later preview start in the same process, after a previous preview was started and stopped, so the isolated preview runtime assets are already in the process's caches.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
12385.0, 12138.0, 12276.0, 12243.0, 12235.0, 12228.0, 12375.0, 12335.0, 12259.0, 13563.0
```

Sorted ascending (ms):

```
12138.0, 12228.0, 12235.0, 12243.0, 12259.0, 12276.0, 12335.0, 12375.0, 12385.0, 13563.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 12138.0 ms | 12259.0 ms | 12403.7 ms | 13563.0 ms | 13563.0 ms | **FAIL** | -10563.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 12385.0 ms | no | 1 | preview cycle 1: compile response → first drawn frame |
| 2 | 12138.0 ms | no | 2 | preview cycle 1: compile response → first drawn frame |
| 3 | 12276.0 ms | no | 3 | preview cycle 1: compile response → first drawn frame |
| 4 | 12243.0 ms | no | 4 | preview cycle 1: compile response → first drawn frame |
| 5 | 12235.0 ms | no | 5 | preview cycle 1: compile response → first drawn frame |
| 6 | 12228.0 ms | no | 6 | preview cycle 1: compile response → first drawn frame |
| 7 | 12375.0 ms | no | 7 | preview cycle 1: compile response → first drawn frame |
| 8 | 12335.0 ms | no | 8 | preview cycle 1: compile response → first drawn frame |
| 9 | 12259.0 ms | no | 9 | preview cycle 1: compile response → first drawn frame |
| 10 | 13563.0 ms | no | 10 | preview cycle 1: compile response → first drawn frame |

### Stop returns control to the editor

- **Measured:** Shell wall clock around the issue 024 Run/Stop control's `stop()`: from the call the Stop button makes until the controller has returned to `idle` and the editor's Run control is enabled again.

#### cold samples (n = 10, 0 right-censored)

- **PRD 17 requirement:** Stop returning control to the editor within 2 seconds
- **Threshold applied:** p95 <= 2000.0 ms
- **"cold" means:** Stop of the first preview in a fresh application process.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
260.0, 309.0, 313.0, 267.0, 303.0, 312.0, 263.0, 300.0, 310.0, 287.0
```

Sorted ascending (ms):

```
260.0, 263.0, 267.0, 287.0, 300.0, 303.0, 309.0, 310.0, 312.0, 313.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 260.0 ms | 300.0 ms | 292.4 ms | 313.0 ms | 313.0 ms | **PASS** | 1687.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 260.0 ms | no | 1 | preview cycle 0: Stop → controller idle |
| 2 | 309.0 ms | no | 2 | preview cycle 0: Stop → controller idle |
| 3 | 313.0 ms | no | 3 | preview cycle 0: Stop → controller idle |
| 4 | 267.0 ms | no | 4 | preview cycle 0: Stop → controller idle |
| 5 | 303.0 ms | no | 5 | preview cycle 0: Stop → controller idle |
| 6 | 312.0 ms | no | 6 | preview cycle 0: Stop → controller idle |
| 7 | 263.0 ms | no | 7 | preview cycle 0: Stop → controller idle |
| 8 | 300.0 ms | no | 8 | preview cycle 0: Stop → controller idle |
| 9 | 310.0 ms | no | 9 | preview cycle 0: Stop → controller idle |
| 10 | 287.0 ms | no | 10 | preview cycle 0: Stop → controller idle |

#### warm samples (n = 10, 0 right-censored)

- **PRD 17 requirement:** Stop returning control to the editor within 2 seconds
- **Threshold applied:** p95 <= 2000.0 ms
- **"warm" means:** Stop of a later preview in the same process.

Raw samples in collection order (ms, `>=` marks a censored lower bound):

```
266.0, 333.0, 249.0, 287.0, 250.0, 242.0, 252.0, 304.0, 261.0, 303.0
```

Sorted ascending (ms):

```
242.0, 249.0, 250.0, 252.0, 261.0, 266.0, 287.0, 303.0, 304.0, 333.0
```

| min | p50 | mean | p95 | max | Verdict | Margin to threshold |
| --- | --- | --- | --- | --- | --- | --- |
| 242.0 ms | 261.0 ms | 274.7 ms | 333.0 ms | 333.0 ms | **PASS** | 1667.0 ms |

Sample provenance (which attempt and launch produced each sample):

| # | Value | Censored | Attempt | Source |
| --- | --- | --- | --- | --- |
| 1 | 266.0 ms | no | 1 | preview cycle 1: Stop → controller idle |
| 2 | 333.0 ms | no | 2 | preview cycle 1: Stop → controller idle |
| 3 | 249.0 ms | no | 3 | preview cycle 1: Stop → controller idle |
| 4 | 287.0 ms | no | 4 | preview cycle 1: Stop → controller idle |
| 5 | 250.0 ms | no | 5 | preview cycle 1: Stop → controller idle |
| 6 | 242.0 ms | no | 6 | preview cycle 1: Stop → controller idle |
| 7 | 252.0 ms | no | 7 | preview cycle 1: Stop → controller idle |
| 8 | 304.0 ms | no | 8 | preview cycle 1: Stop → controller idle |
| 9 | 261.0 ms | no | 9 | preview cycle 1: Stop → controller idle |
| 10 | 303.0 ms | no | 10 | preview cycle 1: Stop → controller idle |

## Supplementary measurements (not PRD thresholds)

| Measurement | n | p50 | p95 | Note |
| --- | --- | --- | --- | --- |
| Shell startup measured inside the process (Rust process-start instant → shell ready) | 20 | 307.0 ms | 349.1 ms | Excludes exec/dyld time before `main`; the PASS/FAIL phase above uses the driver's wall clock from `spawn()`, which is the strict superset. |
| Compiler-context boot alone (no compilation) | 10 | 347.0 ms | 363.0 ms | The cold compilation phase above is this value plus the first compile. |
| Compile response → `preview.started` lifecycle event (cold) | 10 | 12182.0 ms | 12288.0 ms | Measured lower bound on preview startup: the Game cannot have drawn before it was started. The PASS/FAIL phase uses the first frame the Game reports drawing. |
| Compile response → `preview.started` lifecycle event (warm) | 10 | 12094.0 ms | 12266.0 ms | Measured lower bound on preview startup: the Game cannot have drawn before it was started. The PASS/FAIL phase uses the first frame the Game reports drawing. |
| Issue 024 in-protocol Stop latency (cold) | 10 | 300.0 ms | 312.0 ms | Stop request sent → `preview.stopped` observed and resources released, inside the shell. |
| Issue 024 in-protocol Stop latency (warm) | 10 | 261.0 ms | 333.0 ms | Stop request sent → `preview.stopped` observed and resources released, inside the shell. |
| Stop latency restricted to previews that had drawn frames | 20 | 287.0 ms | 313.0 ms | Same measurement as the Stop phase above, restricted to cycles whose preview was confirmed drawing. Published so the Stop distribution can be read with and without the non-rendering cycles; the PASS/FAIL phase above includes every Stop. |
| Measured lower bound on the first-frame instant (compile response → `preview.start.request`) | 20 | 12031.0 ms | 12150.0 ms | The Game cannot draw before the start request leaves the shell, so the true first-frame time is bracketed between this row and the reported first-frame sample. |
| Frame-rate corrected estimate of the first-frame instant | 20 | 12137.4 ms | 12271.8 ms | The reported sample minus (frames already drawn at the first observation - 1) divided by the frame rate measured immediately afterwards. An estimate only: no verdict uses it. |
| Frame rate of the running preview (frames per second) | 20 | 55.7 ms | 65.8 ms | Measured after the first-frame sample was taken, over a 250 ms window, from the Game's own frame counter. Used only to quantify the first-frame overshoot. |
| Bridge round trip of the observation that saw the first frame | 20 | 65.0 ms | 91.0 ms | The preview-bridge round trip that returned the observation, plus one 5 ms poll interval when polling was needed. This bounds only the latency of the final observation, not the whole overshoot: frames drawn before that observation are accounted for by the frame-rate corrected estimate above. |
| Preview startup breakdown: `issue038_create_preview_window` invoke | 20 | 43.0 ms | 52.0 ms | Creating the isolated preview WebviewWindow through the Rust command. |
| Preview startup breakdown: fixed settle delay | 20 | 1507.0 ms | 1518.0 ms | Unconditional 1500 ms sleep in `createIsolatedPreview` after the window is created. |
| Preview startup breakdown: real preview-runtime work (settle → `preview.bridge.ready`) | 20 | 65.0 ms | 87.0 ms | Measured on the bridge-readiness promise itself, observed passively inside `createIsolatedPreview`, so it is the instant the preview .NET/MonoGame WASM runtime actually reported readiness. |
| Preview startup breakdown: bootstrap-loop wait after the runtime was already ready | 20 | 10288.0 ms | 10403.0 ms | `createIsolatedPreview` starts a background message drain before its bootstrap loop, and that drain consumes `preview.bridge.ready`. The bootstrap loop therefore never sees the readiness message it polls for and can only exit when its fixed 10 000 ms deadline expires. This row is that fixed wait, not preview runtime work and not poll quantisation. |
| Preview startup breakdown: whole bootstrap interval (settle → loop exit) | 20 | 10355.0 ms | 10468.0 ms | The sum of the two rows above: real runtime readiness plus the fixed deadline the bootstrap loop waits out. |
| Preview startup breakdown: assembly load + start → `preview.started` | 20 | 259.0 ms | 263.0 ms | Everything after the preview runtime is ready: DLL/PDB transfer, `preview.load` and `preview.start`. |

## Caveats and known gaps

- Cold shell samples in this report span 350-1448 ms. The slowest cold launch is normally the first launch after the binary is rebuilt, when its pages are not yet in the operating system's file cache; later cold launches read a cached binary. A true first-ever launch on a given machine can therefore be slower than the median cold sample here.
- Cold/warm for the shell phase is defined by process and cache state that this driver controls: cold launches are preceded by an enforced idle gap with no application process running, warm launches start immediately after the previous process exited. The OS page cache cannot be purged without root, so "cold" here means cold application state, not a cold file cache.
- Preview startup includes a fixed 1500 ms settle delay that the current isolated-preview implementation performs after creating the preview window (`createIsolatedPreview` in `src/frontend/src/issue38-bridge.ts`). It is production code on the measured path, so it is measured; removing it is optimization work and is out of scope for this measurement issue (PRD 24 / issue 44 gate).
- Preview startup also includes a fixed 10 000 ms bootstrap wait, and this report measures it as such rather than describing it as runtime work or poll quantisation. `createIsolatedPreview` starts a background message drain before its bootstrap loop; the drain consumes the `preview.bridge.ready` message, so the loop that polls for that same message never observes it and exits only when its fixed 10 000 ms deadline expires. Measured passively on the readiness promise itself, the preview runtime is actually ready 65 ms (p50) after the settle delay, while the bootstrap loop then waits a further 10288 ms (p50) / 10403 ms (p95) with the runtime already ready. 20 of 20 measured cycles exited that loop on the deadline rather than on the message. Removing the race is optimization work and is out of scope here (PRD 24 / issue 44 gate).
- The measured Run path enables the issue 021/023/024 preview proof instrumentation, because the frame counters that prove the preview is visibly active are exposed by that instrumentation. Each reported sample therefore contains that instrumentation's own cost, so as an estimate of the same phase in an uninstrumented build every observed sample is an upper bound. This is a separate statement from the observation bounds above: a censored sample is a lower bound on the instrumented run itself and implies nothing about an uninstrumented one.
- The benchmark harness and its Tauri commands are inert unless `MONOGAME_ISSUE041_BENCHMARK=1` is set in the process environment.
- Uncensored preview-startup samples are upper bounds on the true first-frame instant: the observation is a poll through the preview bridge, and the Game had already drawn 4-13 frames when the observation landed. The overshoot is therefore larger than the bridge round trip alone. It is quantified in the supplementary table by the frame-rate corrected estimate (measured frame rate p50 55.7 fps), and the true first-frame instant is bracketed below by the measured compile-response to `preview.start.request` interval. Censored samples are the opposite case: they are lower bounds, and are marked as such wherever they appear.
- Samples were collected on one machine in one session; they are a feasibility baseline, not a cross-machine guarantee.
- At least one threshold FAILED. Per this issue's scope, no optimization was attempted; the failure is recorded as a known gap for the issue 044 feasibility gate review.

## Censored samples

No sample in this report is censored: every measured phase completed inside its observation bound.

## Attempt inventory

- Nominal attempts: 10; attempts made: 10; finite attempt budget: 30.
- Stop reason: every phase and kind reached 10 samples after 10 attempt(s)
- Budget rule: attempts continue until every phase and kind holds 10 samples, up to 3x the nominal attempt count (overridable with --max-attempts); the budget is finite so a persistently broken build cannot loop.

| Attempt | Launches | Outcomes | Samples contributed | Censored | Retry reason |
| --- | --- | --- | --- | --- | --- |
| 1 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 2 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 3 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 4 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 5 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 6 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 7 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 8 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 9 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |
| 10 | full/cold, shell-only/warm | ok, ok | shell-startup/cold: 1; compilation/cold: 1; compilation/warm: 10; preview-start/cold: 1; stop/cold: 1; preview-start/warm: 1; stop/warm: 1; shell-startup/warm: 1 | none | — |

### Launch failures and partial launches

Every launch in this report completed its whole programme.

### Samples that could not be taken

Every launch produced every sample its mode is capable of producing.

## Reproducing this report

```sh
npm --prefix src/frontend run build
npm --prefix src/desktop run tauri -- build
caffeinate -di node scripts/measure-performance.mjs --runs 10 --warm-compiles 10 --preview-cycles 2 --cooling-seconds 5 --max-attempts 30
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
| 1 | full | cold | 0 | 31101.5 ms | ok |
| 1 | shell-only | warm | 0 | 309.3 ms | ok |
| 2 | full | cold | 0 | 29750.6 ms | ok |
| 2 | shell-only | warm | 0 | 308.5 ms | ok |
| 3 | full | cold | 0 | 29881.9 ms | ok |
| 3 | shell-only | warm | 0 | 310.6 ms | ok |
| 4 | full | cold | 0 | 29979.6 ms | ok |
| 4 | shell-only | warm | 0 | 309.3 ms | ok |
| 5 | full | cold | 0 | 29971.9 ms | ok |
| 5 | shell-only | warm | 0 | 310.2 ms | ok |
| 6 | full | cold | 0 | 29952.2 ms | ok |
| 6 | shell-only | warm | 0 | 301.8 ms | ok |
| 7 | full | cold | 0 | 30099.9 ms | ok |
| 7 | shell-only | warm | 0 | 307.5 ms | ok |
| 8 | full | cold | 0 | 30007.5 ms | ok |
| 8 | shell-only | warm | 0 | 307.3 ms | ok |
| 9 | full | cold | 0 | 29775.6 ms | ok |
| 9 | shell-only | warm | 0 | 315.9 ms | ok |
| 10 | full | cold | 0 | 31266.9 ms | ok |
| 10 | shell-only | warm | 0 | 320.5 ms | ok |

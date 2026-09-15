# Roslyn IntelliSense feasibility

**Spike:** issue 070  
**Status:** PROOF-only experiment; no PRODUCT adoption  
**Roslyn:** 4.12.0  
**Target:** `net9.0/browser-wasm`  
**Date:** 2026-09-15

## Executive recommendation

**NO-GO for the current Roslyn Workspaces/Features browser-WASM architecture.**
A follow-up design issue may investigate a smaller or explicitly rooted MEF
composition, but the current package set must not enter PRODUCT.

The browser proof successfully boots the runtime and runs the existing Roslyn
context, reference, and diagnostics proofs. However, the language-service
experiment fails during `MefHostServices.Create` before the first completion
request with:

```text
CompositionFailedException:
TypeInspector_ContractNotAssignable,
IAsynchronousOperationListenerProvider,
AsynchronousOperationListenerProvider
```

This is a hard feasibility failure for the current unmodified Workspaces/
Features composition, not merely a performance concern. The proof dependency
set also adds approximately **11.4 MiB raw** and **4.4 MiB tar+gzip** to the
staged compiler payload, retains approximately **42.5 MiB** of additional heap
in the desktop fallback measurement, and emits IL trimming warnings for
Roslyn/Workspaces/MEF assemblies.

## Reproduction

Build the isolated proof compiler and stage it:

```bash
MONOGAME_FRONTEND_PROFILE=proof \
  dotnet build src/compiler/Playground.Compiler.csproj -c Release

MONOGAME_FRONTEND_PROFILE=proof \
  npm --prefix src/frontend run stage:compiler:proof
```

Open the staged PROOF compiler page from a static server. The proof page loads
`compiler-proof-extension.js` before `compiler-harness.js`; wait for the runtime
to become ready, then click **Run IntelliSense feasibility spike**. The result
is JSON in the **Structured proof state** block and contains correctness cases,
latency percentiles, heap measurements, cancellation behavior, and the
recommendation.

A deterministic desktop fallback invocation of the same proof export (useful
for CI/build validation, but not a substitute for browser timing) is:

```bash
# Build the proof compiler first, then invoke RunLanguageServiceSpike from a
# small net9.0 console harness referencing the built Playground.Compiler.dll
# and the three proof-only Roslyn packages at version 4.12.0.
```

The source entry point is
`CompilerExports.RunLanguageServiceSpike()` in
`src/compiler/CompilerExports.Proof.cs`.

## Correctness fixture

The spike uses one persistent `AdhocWorkspace`, one C# project, two documents,
and the current 13-entry browser reference allowlist. It makes 30 completion
requests (six repetitions of five cases):

| Case | Expected completion |
|---|---|
| Completion after `.` | `ToString` |
| Statement context (`Con`) | `Console` |
| Generic type context (`Str`) | `String` |
| Incomplete syntax after `value.` | `ToString` |
| Cross-file `Player` member | `Score` |

The experiment also performs a canceled completion request. The result marks
`cancellationObserved` and records that stale-result suppression is still
required at the editor/protocol layer: each request must carry a generation or
sequence number, and late results must be discarded.

## Raw local measurements

These measurements came from the same Release-built proof export using the
same spike method outside a browser runtime. They establish the fallback
baseline. The browser run is recorded separately below because the current
browser composition fails before completion begins.

```text
success=true
recommendation=go
Roslyn=4.12.0
target=net9.0/browser-wasm
referenceCount=13
documentCount=2
hostInitializationMs=278.8636
firstCompletionMs=259.7568
documentUpdateP50Ms=0.0554
completionP50Ms=2.4600
completionP95Ms=26.9280
completionRequestCount=30
gcBytesBefore=151000
gcBytesAfter=44724952
gcDeltaBytes=44573952 (~42.5 MiB)
rssMeasured=false
cancellationObserved=true
staleResultSuppressionRequired=true
all five correctness targets found=true
```

The desktop fallback is intentionally labeled: browser scheduling, runtime
startup, and browser memory accounting can differ. It is useful evidence that
the fixture and API usage are otherwise valid, but it does not override the
browser MEF failure.

## Browser proof result

The human verifier ran the staged page at `http://localhost:4176/index.html`
and clicked all four proof controls. The existing runtime proofs passed:

```text
ready=true
successfulRuntimeStarts=1
ping: call=1, Roslyn Microsoft.CodeAnalysis.CSharp 4.12.0.0
reference proof: trivial=true, MonoGame.Game=true
structured diagnostics: 5 cases, all assertions passed
```

The IntelliSense spike returned:

```text
success=false
recommendation=no-go
completionRequests=0
error=CompositionFailedException: TypeInspector_ContractNotAssignable,
       IAsynchronousOperationListenerProvider,
       AsynchronousOperationListenerProvider
```

The failure occurs while constructing the MEF host, before `AdhocWorkspace`
can create its project/documents. Therefore no browser completion latency or
browser completion correctness numbers are claimed. This is the primary
browser-WASM feasibility result for issue 070.

## Package-size delta

Measured from fresh `stage:compiler` and `stage:compiler:proof` outputs. Raw
bytes are the sum of staged files; the compressed figure is a reproducible
`tar | gzip` stream of the staged compiler directory.

| Profile | Raw staged bytes | tar+gzip bytes |
|---|---:|---:|
| PRODUCT | 18,063,292 | 6,591,021 |
| PROOF | 30,031,630 | 11,190,088 |
| Delta | **11,968,338** | **4,599,067** |

The proof-only framework includes:

- `Microsoft.CodeAnalysis.CSharp.Workspaces`
- `Microsoft.CodeAnalysis.CSharp.Features`
- `Microsoft.CodeAnalysis.Features`
- Workspaces/MEF dependencies

The proof publish reports IL2104 trim warnings for Roslyn, Workspaces, and MEF
assemblies. The warnings are acceptable for this feasibility spike but are a
shipping blocker until the dependency graph is either rooted and size-bounded
or replaced with a smaller service.

## Cancellation and responsiveness architecture

Roslyn accepts a cancellation token and the spike observes cancellation for an
already-canceled request. That alone is insufficient for an editor: a request
that completes after a newer document version must not overwrite newer
completion results. The follow-up protocol should include:

1. A monotonically increasing document version/generation.
2. A request ID bound to that generation.
3. Cancellation of the prior request when a new edit arrives.
4. A final generation check before publishing results to Monaco.
5. A bounded debounce so typing is never synchronously blocked by completion.

## Unsupported API assessment

The spike uses the existing 13-entry reference allowlist and does not widen the
supported API policy. Completion suggestions therefore reflect only symbols
available through the same references used by the compiler. Roslyn may expose
framework members that are not suitable for the playground's policy; completion
must remain advisory, and every Run still goes through the existing compiler
allowlist and `PolicyAnalyzer` enforcement. IntelliSense must not become a
security boundary.

## Profile boundary

- The Workspaces/Features package references are conditional on
  `MonoGameCompilerProfile == proof`.
- The experiment lives in `CompilerExports.Proof.cs`.
- The proof button and results exist only in `index.proof.html` and
  `compiler-proof-extension.js`.
- The PRODUCT compiler remains on the existing retained-binary path and does
  not link the language-service spike.

## Direct SemanticModel backend result (070A)

A follow-up proof bypassed Workspaces and MEF entirely. It used the existing
browser-safe `CSharpCompilation` path and queried a `SemanticModel` for a
cross-file member completion. The human verifier ran the staged browser page
and observed:

```text
Direct completion success=true
expected=Score
found=true
elapsedMs=81.6
recommendation=go
trusted=true
```

The fixture contains `Game.cs` referencing a `Player` declared in `Player.cs`.
The returned items include `Jump` and `Score`. The source intentionally ends at
`player.` because completion requests occur at incomplete syntax; compiler
syntax diagnostics in that fixture are expected and do not prevent semantic
member discovery.

## Decision

The full Roslyn Workspaces/Features architecture remains **NO-GO** in browser
WASM because its MEF composition fails. A constrained direct `CSharpCompilation`
+ `SemanticModel` backend is **GO for a follow-up protocol prototype**. Issue
071 may proceed, but its contracts must remain backend-neutral and its first
implementation should target bounded semantic-model completion rather than
assume an `AdhocWorkspace`/MEF service.

Do **not** add Workspaces/Features to PRODUCT. Any later design must still
include lazy/debounced requests, cancellation, document-generation checks,
deterministic ordering, and a product-size budget.

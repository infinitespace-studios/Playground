# Compiler and Preview Protocol

This document is the normative wire contract for protocol version 1. It is the
only application communication allowed among the trusted top-level host, the
persistent compiler context, and an isolated preview context. File access,
shell IPC, network access, and compiler-to-preview communication are not
protocol extensions and are forbidden.

`MessageContracts.ts` is the normative TypeScript mirror. Its
`RequestPayloadByType`, `ResponseDataByType`, `EventPayloadByType`, and
`MessageByType` maps provide a mechanically inspectable one-to-one inventory.

## 1. Participants and transport

The participants are:

- **host**: trusted top-level TypeScript application; creates contexts, owns
  project data, and is the only router.
- **compiler**: persistent, less-trusted compiler worker or sandboxed context.
- **preview**: less-trusted, fresh sandboxed iframe with an opaque or distinct
  origin. It contains untrusted user code and is destroyed after each run.

Each compiler or preview context gets one private, dedicated `MessagePort`.
The host transfers the port during context bootstrap and calls `port.start()`.
All protocol traffic after bootstrap uses that port and structured clone.
Ports must never be shared between contexts or exposed to user code. Compiler
and preview never communicate directly.

For an opaque-origin iframe, the one bootstrap `window.postMessage` may require
`targetOrigin: "*"`. The host must address the exact newly-created
`contentWindow`, transfer only the new port, accept no data from the bootstrap
message, and then reject all later window messages. If a non-opaque distinct
origin is used, bootstrap must additionally use its exact origin. A receiver
must check the expected port identity and context generation. Window
`event.origin === "null"` is never proof of preview identity.

Allowed routes are exact:

| Sender | Receiver | Types |
| --- | --- | --- |
| host | compiler | `compile.request`, `compile.cancel.request`, `protocol.error` |
| compiler | host | `compile.response`, `compile.cancel.response`, `protocol.error` |
| host | preview | `asset.mount.request`, `preview.load.request`, `preview.start.request`, `preview.stop.request`, `protocol.error` |
| preview | host | `asset.mount.response`, `preview.load.response`, `preview.start.response`, `preview.stop.response`, `preview.started`, `preview.stopped`, `preview.exited`, `preview.failed`, `preview.output`, `protocol.error` |

Either endpoint may send `protocol.error` to its connected peer as a rejection;
it is control traffic, not request/response traffic. Any other
sender/receiver/type combination is `MESSAGE_ROUTE_REJECTED`. Traffic on an
unexpected source, stale port, stale context generation, or non-port transport
is `MESSAGE_SOURCE_REJECTED`; close the offending port. Do not reply to an
untrusted global source merely to report an error.

## 2. Envelope and correlation

Protocol version is the JSON number literal `1`. Requests and events use
`payload`; responses use `result`:

```text
Request/Event = {
  protocolVersion: 1,
  correlationId: UUIDv4,
  type: exact literal,
  payload: type-specific object
}

Response = {
  protocolVersion: 1,
  correlationId: UUIDv4,
  type: exact literal,
  result:
    | { success: true, data: type-specific object }
    | { success: false, error: ProtocolError }
}
```

All envelope members are required. `protocolVersion` must be an integer.
`correlationId`, `previewId`, `compileId`, and `mountId` are canonical,
lowercase RFC 4122 UUID version 4 strings: 36 ASCII characters, hyphens at
8/13/18/23, `4` at position 15, and one of `8`, `9`, `a`, or `b` at position
20. UUIDs are opaque and are compared byte-for-byte.

The requester generates a correlation ID that has never appeared on that port.
Exactly one terminal response uses the request's correlation ID and the
matching response type:

| Request | Terminal response |
| --- | --- |
| `compile.request` | `compile.response` |
| `compile.cancel.request` | `compile.cancel.response` |
| `asset.mount.request` | `asset.mount.response` |
| `preview.load.request` | `preview.load.response` |
| `preview.start.request` | `preview.start.response` |
| `preview.stop.request` | `preview.stop.response` |

The receiver retains completed correlation IDs for the life of the port.
The receiver atomically reserves a validated request ID before any awaited
work and moves it from in-flight to completed on every terminal path. Reusing
an in-flight or completed ID performs no work and receives one fresh-ID
`protocol.error` control event with `DUPLICATE_CORRELATION_ID`,
`rejectedCorrelationId`, and `rejectedType`; it never produces a second
terminal response with the reused ID.
Requesters retain pending and completed IDs for the life of the port. The first
matching terminal response settles a request. A duplicate or response for an
unknown/completed ID is logged and discarded without changing state. A
response after timeout/cancellation is therefore late and discarded. A
response with the right ID but wrong response type is malformed and closes the
port. `protocol.error` is a control event, not a response, and never settles a
request.

Event correlation IDs do not consume the request namespace. A causally related
`preview.started`, `preview.stopped`, or `preview.failed` copies the initiating
start/stop/request correlation ID. `preview.exited` and spontaneous runtime
failures use a new preview-generated UUID. All output for a run uses the start
request's correlation ID. A `protocol.error` always uses a fresh UUID generated
by the rejecting endpoint and identifies the rejected message separately in
its payload when that message supplied valid identifiers. `sequence` is a
preview-local unsigned safe integer, starts at 1 for each `previewId`, and
strictly increases across all preview lifecycle/output events; duplicates or
regressions are discarded. Control events do not carry a sequence.

## 3. Results and errors

Expected domain failures use `success: false`; transport success does not imply
operation success. `ProtocolError` is:

```text
{
  code: ProtocolErrorCode,
  message: string,
  details?: { [key: string]: string | number | boolean | null },
  diagnostics?: Diagnostic[]
}
```

`message` is safe for display and must not contain source text, host paths,
stacks with host paths, secrets, or exception object serialization. `details`
contains at most 32 own entries and only the scalar values above. Diagnostics
are present only when relevant, normally `COMPILE_FAILED` or a preview
validation failure. A code outside the table below is a malformed v1 result;
`INTERNAL_ERROR` is the sanitized code a sender uses for an unexpected failure.

Stable v1 codes:

| Code | Meaning |
| --- | --- |
| `MISSING_PROTOCOL_VERSION` | Envelope has no own `protocolVersion` |
| `UNSUPPORTED_PROTOCOL_VERSION` | Version is not exactly `1` |
| `MALFORMED_ENVELOPE` | Envelope member/type/correlation/result shape invalid |
| `MALFORMED_PAYLOAD` | Known type has an invalid payload/data field |
| `UNKNOWN_MESSAGE_TYPE` | `type` is not a listed exact literal |
| `MESSAGE_SOURCE_REJECTED` | Source, origin, port, or generation check failed |
| `MESSAGE_ROUTE_REJECTED` | Type is not allowed on this participant route |
| `DUPLICATE_CORRELATION_ID` | Request correlation ID was already observed |
| `INVALID_STATE` | Valid request is illegal in the current lifecycle state |
| `TIMEOUT` | Operation exceeded its effective timeout |
| `CANCELLED` | Operation was cancelled before its commit point |
| `MESSAGE_TOO_LARGE` | Total measured message exceeds the message limit |
| `FIELD_TOO_LARGE` | A bounded string or details object exceeds its limit |
| `SOURCE_TOO_LARGE` | One source or aggregate source text exceeds a limit |
| `TOO_MANY_SOURCE_FILES` | Source count exceeds the limit |
| `TOO_MANY_DIAGNOSTICS` | A diagnostic collection exceeds the limit |
| `ASSEMBLY_TOO_LARGE` | Assembly exceeds its individual limit |
| `PDB_TOO_LARGE` | PDB exceeds its individual limit |
| `BINARY_PAYLOAD_TOO_LARGE` | Assembly plus PDB exceeds its aggregate limit |
| `TOO_MANY_ASSETS` | Asset count exceeds the limit |
| `ASSET_TOO_LARGE` | One asset exceeds its individual limit |
| `ASSET_TOTAL_TOO_LARGE` | Aggregate assets exceed the limit |
| `ASSET_PATH_INVALID` | Asset path is invalid or traverses |
| `ASSET_PATH_DUPLICATE` | Two paths in one request normalize to the same path |
| `DUPLICATE_MOUNT_ID` | A mount ID was already used by this preview |
| `ASSET_PATH_ALREADY_MOUNTED` | A canonical path is already mounted |
| `COMPILE_FAILED` | Roslyn or playground diagnostics prevented emission |
| `PREVIEW_LOAD_FAILED` | Assembly, PDB, dependency, or type validation failed |
| `PREVIEW_START_FAILED` | Game construction/start failed |
| `PREVIEW_STOP_FAILED` | Cooperative stop failed; forced teardown follows |
| `PREVIEW_RUNTIME_FAILED` | Unhandled game/runtime/content/shader failure |
| `INTERNAL_ERROR` | Sanitized unexpected implementation failure |

`protocol.error` is a non-terminal control event with payload:

```text
{
  error: ProtocolError,
  rejectedCorrelationId?: UUIDv4,
  rejectedType?: string
}
```

It is used only when no normal response type can safely be selected, including
a missing/unsupported version, invalid correlation ID, unknown type, or route
rejection, and an in-flight/completed duplicate correlation. Its envelope
always uses version 1 and a fresh, valid correlation
UUID. `rejectedCorrelationId` is included only when the rejected value was
itself a valid UUID; `rejectedType` is included only when the rejected value
was a string within its 128-byte UTF-8 limit. It does not settle a pending
request. A known request with a valid type and correlation but invalid payload
instead receives its matching terminal response with `success: false`.
Receiving an invalid `protocol.error`, or an error about `protocol.error`, is
logged and discarded without replying, preventing rejection loops. A source
rejected before a private channel is established receives no event.

## 4. Validation and unknown fields

Receivers validate without invoking application code, in this order:

1. Verify transport, exact port/window source, expected origin where usable,
   participant identity, and current context generation.
2. Reject a structured-clone failure; compute total message size and enforce
   the outer limit.
3. Require a plain object with own envelope fields; reject accessors,
   prototypes other than `Object.prototype`/`null`, cycles, symbols,
   functions, `SharedArrayBuffer`, typed-array/DataView aliases, and unexpected
   transferable/object kinds.
4. Check `protocolVersion` presence, integer type, then exact support.
5. Validate canonical correlation UUID and exact string `type`.
6. Enforce the route and request/response correlation rules.
7. Validate the `payload` or `result` discriminant and all known nested fields,
   scalar types, finite/safe integer ranges, counts, UTF-8 lengths, and buffer
   type/non-aliasing rules. Booleans are not numbers.
8. Normalize and validate paths, then enforce type-specific aggregate limits.
9. Enforce lifecycle state and only then perform work.

Known required fields may not be missing or `undefined`. Known fields with the
wrong type are rejected. Within v1, unknown own string-keyed fields in plain
objects are counted toward limits and ignored after the known schema validates;
they must still satisfy step 3. This is the sole forward-compatibility
mechanism for additive optional fields. Unknown message `type` values are never
ignored. Receivers must make decisions only from fields known to them.

All string limits are UTF-8 byte counts after requiring valid Unicode scalar
values (no unpaired surrogates). All byte totals use checked safe-integer
addition. All numeric counts, line/column values, sequence values, exit codes,
and timeouts must be finite integers. Lines and columns are 1-based; a
non-file/global diagnostic uses `file: ""`, `line: 0`, `column: 0`.

## 5. Normative v1 limits

These limits are provisional pending Phase 1 measurements, but are mandatory
for every v1 sender and receiver until a compatible release changes them.
Senders must not emit over-limit messages. Receivers must reject them.

The **measured message size** is the sum of:

- UTF-8 byte lengths of every own string key and string value, recursively;
- every transferred `ArrayBuffer.byteLength`;
- 8 bytes per number, 1 per boolean, and 1 per null;
- 16 bytes per object/array plus 8 bytes per own property/array element.

Unknown fields count. The envelope has one **32 MiB** maximum. Inner binary
allowances are deliberately below it:

| Item | v1 maximum |
| --- | ---: |
| Entire measured message | 32 MiB |
| Source files per compile | 64 |
| One source file text | 1 MiB UTF-8 |
| Aggregate source text | 4 MiB UTF-8 |
| Assembly | 8 MiB |
| PDB | 8 MiB |
| Assembly plus PDB | 12 MiB |
| Assets per mount request | 256 |
| One asset | 16 MiB |
| Aggregate assets per mount request | 24 MiB |
| Logical/asset path | 512 UTF-8 bytes |
| `protocol.error.rejectedType` | 128 UTF-8 bytes |
| Assembly name | 128 UTF-8 bytes |
| Diagnostics per result/error | 2,000 |
| One diagnostic message | 4 KiB UTF-8 |
| One output event text | 16 KiB UTF-8 |
| Error message | 1 KiB UTF-8 |
| Serialized error details by measured-size rules | 16 KiB |
| Error detail entries/key/string value | 32 / 64 B / 1 KiB UTF-8 |

An empty source list, empty source text, empty assembly, empty PDB, empty asset,
or empty asset path is invalid. Diagnostic IDs are 1-64 printable ASCII bytes.
Assembly names are 1-128 ASCII characters matching
`[A-Za-z_][A-Za-z0-9_.-]*`. Output producers split longer output on Unicode
scalar boundaries into ordered events; they must not truncate silently.

Every request payload accepts optional `timeoutMs`. It is an integer at least
100. Omission uses the default below; values above the maximum are malformed,
not clamped.

| Request | Default | Maximum |
| --- | ---: | ---: |
| `compile.request` | 10,000 ms | 30,000 ms |
| `compile.cancel.request` | 2,000 ms | 2,000 ms |
| `asset.mount.request` | 10,000 ms | 10,000 ms |
| `preview.load.request` | 10,000 ms | 10,000 ms |
| `preview.start.request` | 10,000 ms | 10,000 ms |
| `preview.stop.request` | 2,000 ms | 2,000 ms |

Timeout starts when the receiver accepts the validated request, not while bytes
are waiting in the transport. For a serialized preview pre-start operation,
acceptance is admission to the shared load/mount queue, so queue wait counts.
The timeout ends when the terminal response is posted. The requester may also
enforce the same deadline from send time. On requester timeout it settles
locally as `TIMEOUT`, requests cancellation/teardown where applicable, and
discards a later response. Preview startup remains subject to the PRD's 3
second p95 target; the larger protocol deadline is a failure ceiling. Stop must
complete or enter forced teardown within the PRD's 2 second ceiling.

## 6. Diagnostics

Both diagnostic variants contain:

```text
origin, severity ("error" | "warning" | "info"), id, message,
file, line, column
```

`CompilerDiagnostic.origin` is `compiler`; its `id` is the stable Roslyn ID.
`PlaygroundDiagnostic.origin` is `playground`; its IDs are:

- `PG0001_NO_GAME_SUBCLASS`
- `PG0002_MULTIPLE_GAME_SUBCLASSES`
- `PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR`
- `PG0004_UNSUPPORTED_ASSEMBLY`
- `PG0005_UNSUPPORTED_NAMESPACE`
- `PG0006_UNSUPPORTED_API`
- `PG0007_DLLIMPORT_NOT_ALLOWED`
- `PG0008_UNMANAGED_CALLERS_ONLY_NOT_ALLOWED`
- `PG0009_UNSAFE_NATIVE_CALL_NOT_ALLOWED`
- `PG0010_CONTENT_PLATFORM_MISMATCH`
- `PG0101` (supported-API policy: `DllImport`)
- `PG0102` (supported-API policy: `UnmanagedCallersOnly`)
- `PG0103` (supported-API policy: unsafe syntax)
- `PG0104` (supported-API policy: direct
  `System.Runtime.InteropServices.JavaScript` use)
- `PG0105` (supported-API policy: framework `Marshal` use)
- `PG0106` (supported-API policy: unmanaged function pointers)

Paths use the source logical-path rules in section 8. Messages are display-safe
plain text subject to the diagnostic limit. Diagnostics must be sorted by
logical path (ordinal), line, column, severity, then ID for deterministic
results.

## 7. Message schemas

Fields shown are the complete v1 known fields. `timeoutMs?` has section 5
semantics.

### Compiler

`compile.request` payload:

```text
{
  compileId: UUIDv4,
  assemblyName: string,
  sources: [{ path: string, text: string }, ...],
  primarySourcePath: string,
  settings?: {
    languageVersion: "13.0",
    nullable: "disable",
    optimization: "debug",
    allowUnsafe: false,
    warningsAsErrors: false
  },
  timeoutMs?: integer
}
```

Omitted settings select the pinned v1 values represented above, including C#
13.0, DLL output, and portable PDB emission. No other language version or
setting value is valid. `primarySourcePath` must exactly equal one `sources`
path and identifies the document that the preview must bind to visible
sequence points. `compile.response` success data:

```text
{
  compileId: UUIDv4,
  assembly: ArrayBuffer,
  pdb: ArrayBuffer,
  diagnostics: Diagnostic[],
  binaryProof: BinaryProof
}
```

`BinaryProof` is a required immutable v1 object:

```text
{
  assemblySha256: 64 lowercase hexadecimal SHA-256 characters,
  pdbSha256: 64 lowercase hexadecimal SHA-256 characters,
  assemblyByteLength: integer,
  pdbByteLength: integer,
  assemblyName: string,
  sourcePaths: canonical logical source paths in compile-request order,
  primarySourcePath: one exact member of sourcePaths
}
```

The lengths must exactly equal the two standalone buffers. `assemblyName` and
`sourcePaths` must exactly equal the accepted compile request. The compiler
chooses `primarySourcePath` from that request; for issue 021 it is
`src/Foo.cs`. Every receiver recomputes both digests before using the bytes.
The host forwards the same proof unchanged in `preview.load.request`; neither
unknown fields nor locally reconstructed identity may drive a production
decision.

Warnings/info may accompany success. Any error diagnostic prevents binary
success and returns `COMPILE_FAILED` with diagnostics on the error; partial
binaries are never returned.

`compile.cancel.request` payload is
`{ targetCorrelationId, compileId, timeoutMs? }`.
`compile.cancel.response` data is
`{ compileId, accepted, alreadyCompleted }`. The target must identify a
compile request on the same compiler port and match its `compileId`.

Cancellation is cooperative until the compiler's emission commit point. If
accepted before that point, the original compile request terminates exactly
once with `CANCELLED` and no binaries. If compile wins the race, its ordinary
response is authoritative and cancellation returns
`accepted: false, alreadyCompleted: true`. Repeating cancellation is
idempotent. Cancellation never terminates the persistent compiler context.

### Assets and preview commands

`asset.mount.request` payload:

```text
{
  previewId: UUIDv4,
  mountId: UUIDv4,
  contentRootDirectory: string,
  assets: [{ path: string, bytes: ArrayBuffer }, ...],
  timeoutMs?: integer
}
```

`contentRootDirectory` is the MonoGame `Content.RootDirectory` value used to
resolve asset paths. It must be a valid canonical logical path per section 8.
It defaults to `"Content"` when absent for backward compatibility with the
initial protocol revision; receivers treat omission as `"Content"`.

Its success data is
`{ previewId, mountId, mountedFileCount, mountedByteLength }`. Mount is
transactional and serialized per preview. After envelope/payload validation,
the receiver uses the shared preview lifecycle/pre-start-mutation critical
section to check that lifecycle is exactly `stopped` and teardown has not
begun, then admits the request to the single arrival-order pre-start queue
shared with load. Admission and that state check are atomic. A request arriving
in any other state receives its matching `asset.mount.response` with
`INVALID_STATE`. At most one load or mount operation is active. Its timeout
starts at admission, so queue wait counts; an expired queued mount is removed
and receives its matching response with `TIMEOUT`.

The active transaction validates every path and limit against committed state,
then creates directories and files in private staging storage that is not
visible through `/assets/`, and builds a new immutable asset-index snapshot.
Its final commit reacquires the shared critical section and atomically rechecks
that lifecycle is still `stopped`, teardown has not begun, this operation is
still the active queue token, the deadline has not expired, and `mountId` and
every canonical path remain absent from committed state. It then swaps the
active asset-index reference to the new snapshot before releasing the section.
That single swap simultaneously makes every staged file visible and records
the mount ID and paths before dequeuing the next operation. No start admission,
load/mount admission, teardown, or pre-start commit may interleave with that
section. Failure or timeout before the swap discards all staging and
publishes/records nothing.

A failed deadline recheck returns `TIMEOUT`; a teardown/lifecycle recheck
failure for an already-admitted mount returns `CANCELLED`; mount-ID and path
recheck failures return `DUPLICATE_MOUNT_ID` or
`ASSET_PATH_ALREADY_MOUNTED`, respectively. Each is the failed result of the
original request's matching `asset.mount.response`; each clears the active
token and dequeues the operation before the next operation begins.

Mount has no explicit cancellation message. The deadline is checked during
staging and immediately before commit. Commit is the point of no cancellation:
once it succeeds, the mount remains committed and the success response is
authoritative at the receiver. If the requester times out first and therefore
cannot know whether commit won the race, it must destroy that preview context
and discard any late response; it must not continue using a potentially
mounted preview.

`mountId` is unique for the lifetime of its preview. A mount ID is recorded
only when its transaction commits. Reusing a committed mount ID with any
correlation ID is rejected with `DUPLICATE_MOUNT_ID`; it never replays or
overwrites files. Retransmitting the original request with its original
correlation ID is handled by the correlation duplicate rule and also performs
no work. A failed mount leaves its mount ID reusable because it committed
nothing.

The `/assets/` namespace is immutable for the preview lifetime. Before commit,
the receiver compares every canonical request path with every previously
mounted canonical path. Any collision rejects the whole request with
`ASSET_PATH_ALREADY_MOUNTED`; byte equality does not make it idempotent.

`preview.load.request` payload is
`{ previewId, compileId, assembly, pdb, binaryProof, timeoutMs? }`. Its success data is
`{ previewId, compileId }`. It loads exactly one emitted DLL and its matching
portable PDB plus only pinned runtime dependencies.

Load uses the same arrival-order pre-start queue as mount. Admission acquires
the shared critical section and atomically requires lifecycle `stopped`, no
teardown, no prior committed load, and no reserved load token (queued or
active). It reserves a unique internal load token and enqueues it before
releasing the section. A concurrent or second load receives its matching
`preview.load.response` with `INVALID_STATE`. A queued or reversibly active
load whose deadline expires is removed, its reservation is cleared, and it
receives `TIMEOUT`.

Before managed runtime mutation begins, load may validate and stage the
assembly, PDB, dependency identities, and game-type metadata. A failure during
only that reversible work clears the load reservation, returns
`PREVIEW_LOAD_FAILED`, dequeues the operation, and permits retry because the
runtime remains provably clean. Calling into the runtime to load the assembly
is the irreversible mutation boundary. The receiver records that boundary
against the active load token before making the call.

On successful return from the runtime, load reacquires the shared critical
section and atomically requires lifecycle still `stopped`, no teardown, an
unexpired deadline, and the same active load token. Only then does it record
exactly one committed successful load with its `compileId`, clear the active
token, and dequeue the operation before sending success. Start cannot observe
success before that commit. A mismatched token or teardown/lifecycle failure
returns `CANCELLED`; an expired deadline returns `TIMEOUT`; neither may record
loaded state or later send success.

That atomic loaded-state record is the protocol commit boundary. It is distinct
from the earlier irreversible runtime-mutation boundary: cancellation before
protocol commit is still honored, but crossing the mutation boundary means
honoring it requires destruction rather than rollback.

Any timeout, cancellation, or failure after the irreversible mutation boundary
taints the runtime and forces teardown; retry in that preview is forbidden.
The original `preview.load.response` fails with `TIMEOUT`, `CANCELLED`, or
`PREVIEW_LOAD_FAILED`, matching the cause, and can never later change to
success. If forced destruction prevents posting it, the host records that same
terminal failure locally.
If the requester times out while completion/commit is racing, it destroys the
preview and discards a late response rather than using uncertain loaded state.
Once the atomic load commit wins, its receiver-side success is authoritative,
but requester-side timeout still destroys the preview.

Beginning cooperative or forced teardown acquires the shared critical section,
sets an irreversible teardown flag, removes every queued pre-start operation,
and marks the active mount or load token cancelled before releasing the
section. Queued operations and an active uncommitted mount discard staging and
receive their matching response with `CANCELLED`. An active load that has not
crossed the mutation boundary does the same and clears its reservation. An
active load at or beyond that boundary forces preview destruction and can never
commit success. If destruction prevents posting a response, the host settles
each known pending request locally as `CANCELLED` and discards late responses.
A mount or load whose atomic commit won before teardown keeps its ordinary
receiver-side success; the host still destroys the context if teardown or a
requester-side timeout has already won.

Mount and load never execute concurrently: both are pre-start mutations in one
arrival-order queue. This avoids asset-index publication racing dependency/type
inspection or irreversible assembly load. Mounts may be ordered before or
after the one load, but start rejects until the entire queue is empty.

`preview.start.request` payload is `{ previewId, timeoutMs? }`. Its response
data is `{ previewId, accepted: true }`; this acknowledges command acceptance,
not running state. `preview.started` is the running-state event.

`preview.stop.request` payload is
`{ previewId, reason, timeoutMs? }`, where reason is `user`, `restart`,
`exit-cleanup`, or `failure-cleanup`. Its response data is
`{ previewId, accepted, alreadyStopped }`; `preview.stopped` reports cleanup
completion. Stop is idempotent.

Stop admission also uses the shared critical section and sets the teardown flag
before releasing it. If lifecycle is `stopped` but pre-start work is queued or
active, stop returns `accepted: true, alreadyStopped: false`, cancels that work
as above, and tears down the context. If it is cleanly stopped with no work,
stop returns `accepted: false, alreadyStopped: true`, but still retires the
context after posting the response so a racing later start/load/mount cannot
use it. In starting/running/failed it returns
`accepted: true, alreadyStopped: false` and begins normal cleanup. Whichever of
stop, start, load admission, mount admission, or a pre-start commit first
acquires the critical section establishes the state observed by the next; no
check-and-transition pair is split.

Every preview command must match the port's immutable `previewId`. A mismatch
is `MESSAGE_SOURCE_REJECTED`. `compileId` must match the assembly/PDB pair
received from the corresponding compile success.

### Preview events

- `preview.started`: `{ previewId, sequence }`
- `preview.stopped`: `{ previewId, sequence, reason }`, where reason is
  `requested`, `forced`, `failed`, or `exited`
- `preview.exited`: `{ previewId, sequence, exitCode }`
- `preview.failed`: `{ previewId, sequence, phase, error }`, where phase is
  `load`, `start`, `running`, or `stop`
- `preview.output`:
  `{ previewId, sequence, source, stream, category, text }`

Output `source` is exactly `managed` for redirected .NET
`Console.Out`/`Console.Error`, or `native` for Emscripten
`Module.print`/`Module.printErr`. `stream` is `stdout` or `stderr`; `category`
is `console`, `startup`, `runtime`, `content`, or `shader`. Runtime exceptions,
content failures, and shader failures emit output for display and also emit
`preview.failed` if they terminate the game.

`preview.failed` is a lifecycle event, not a substitute for a request's
terminal response. If a request directly fails, send its failed response first,
then the correlated failed event when lifecycle state changes.

## 8. Path normalization

Source and asset paths are logical, never host filesystem paths. Normalize
before sending and repeat validation on receipt:

1. Require a non-empty valid-Unicode string and normalize it to NFC.
2. Replace every `\` with `/`.
3. Reject a leading `/`, `//`, drive/URI prefix (a `:` in any segment), NUL,
   ASCII controls, percent (`%`), query/hash delimiters (`?`, `#`), and a
   trailing `/`.
4. Split on `/`. Remove empty and `.` segments. Reject any segment exactly
   `..` before or after normalization.
5. Join with `/` and enforce the path byte limit.

The wire path must already equal this canonical result; otherwise reject it.
Comparisons are ordinal and case-sensitive. Reject duplicate canonical paths
within one request with `ASSET_PATH_DUPLICATE`; reject paths already present
from a committed mount with `ASSET_PATH_ALREADY_MOUNTED`. Asset files are
rooted under a private virtual `/assets/` mount and each segment must be
URL-encoded independently when exposed as a URL; no URL decoding participates
in normalization. Receivers recursively create parent directories only after
all assets validate. Source paths use the same algorithm but are not mounted.

## 9. Binary transfer and ownership

Assembly, PDB, and asset byte fields are JavaScript `ArrayBuffer` values, never
Base64, `SharedArrayBuffer`, `Blob`, typed arrays, or JSON number arrays.

Sender obligations are normative: each non-empty buffer must appear in exactly
one binary field and exactly once in the
`postMessage(message, transferList)` transfer list. The sender must treat
successful posting as an ownership transfer, assert locally that each sent
buffer is detached (`byteLength === 0`), clear its references, and never read
or resend it. A sender-side failure to detach is an implementation error and
the sender must close the port rather than continue with ambiguous ownership.

The transfer list and sender detachment history are not observable through
`MessageEvent`; a receiver must not claim to validate either. The enforceable
receiver rule is that every binary field is an attached, ordinary
`ArrayBuffer`, is not shared, has a valid bounded `byteLength`, and is not the
same object as any other binary field in that message. Structured clone gives
the receiver ownership of the value whether the sender transferred or
incorrectly cloned it.

The receiver may transfer an owned buffer onward, which detaches it locally. A
host that needs assembly/PDB in both compiler result processing and preview
loading must finish inspection first or make an explicit bounded copy before
transferring to preview. Copies count against the same limits. Do not cache
detached buffers.

## 10. Lifecycle, timeout, and race rules

A new preview port begins `stopped`, with no load reserved or committed. Load
and asset mount are allowed only while stopped and are serialized in the shared
pre-start queue. Exactly one successful load must commit, and any number of
unique transactional mounts may commit, before start. Start transitions:

```text
stopped -> starting -> running -> stopping -> stopped
                         |           `-> forced-stopping -> stopped
                         `-> failed -> stopping/forced-stopping -> stopped
```

A stop/teardown while pre-start work is pending follows
`stopped -> stopping/forced-stopping -> stopped` without ever starting.

`preview.started` is emitted exactly once on `starting -> running`.
`preview.start.response` must precede it. Output is allowed only from accepted
start through stopped cleanup. A start failure emits the failed start response,
then `preview.failed`, then cleanup and `preview.stopped`.

Lifecycle state, teardown flag, load reservation/committed state, shared
pre-start queue/active token, and asset-index commit are guarded by one shared
preview lifecycle/pre-start-mutation critical section. A start request acquires
it and atomically requires lifecycle `stopped`, no teardown, exactly one
committed successful load, no active load token, and an empty pre-start queue
with no active mount. If any check fails, including a queued or active load or
mount, the matching `preview.start.response` has `success: false` with
`INVALID_STATE`, and no transition occurs. Otherwise that same critical
section changes `stopped -> starting` before it is released. From that point no
load or mount can be admitted or committed. Start never waits behind pre-start
operations and cannot pass one admitted earlier.

The first valid stop request in starting/running/failed wins and initiates
cooperative cleanup; later stops are idempotent. Every stop/teardown transition
uses the shared critical section before cleanup, so it blocks new pre-start
admission and invalidates uncommitted active tokens as specified in section 7.
Stop cancels the Emscripten loop, releases audio and WebGL, closes
runtime-owned ports, revokes object URLs, and emits `preview.stopped` only
after cleanup. If cooperative cleanup misses 2 seconds, the host enters
`forced-stopping`, destroys the iframe, closes the port, and synthesizes the
stopped state with reason `forced`; no event from the destroyed context is
trusted.

`Game.Exit()` emits `preview.exited` exactly once, selects `exited` as the
termination cause if no earlier cause won, and then follows the same stop path
with reason `exit-cleanup`. An already-racing user stop still performs cleanup
only once.

Termination-cause selection and cleanup completion are separate. The first
valid `preview.exited` or terminating `preview.failed` selects the immutable
cause; later cause events are discarded. It does not consume or replace
`preview.stopped`. After cleanup completes, the preview must emit exactly one
`preview.stopped`, using reason `exited` or `failed` for that selected cause (or
`requested` for an earlier stop). Only duplicate `preview.stopped` events are
discarded. If forced destruction prevents the wire event, the host records
exactly one equivalent stopped completion with reason `forced` immediately
after closing the port and destroying the iframe. For cooperative cleanup, the
host closes the port and destroys the iframe only after receiving the one
required `preview.stopped`. Restart always creates a new context, port, preview
UUID, runtime, canvas, and sequence; assemblies are never unloaded and replaced
in an existing preview.

Preview requests have no generic cancellation message. `preview.stop.request`
is the cancellation and cleanup operation. A timed-out load/start forces
teardown. A timed-out stop forces teardown. Timeout/cancel races use the first
timeout/cancel outcome recorded by the host; a later response or cause event
cannot undo it. This rule never suppresses the required stopped completion.

## 11. Compatibility

Protocol version `1` denotes these semantics. Within v1, compatible evolution
may only add optional fields whose absence preserves existing behavior. Old
receivers ignore such fields under section 4; new receivers must accept their
absence. Existing fields, literals, defaults, limits, route meanings, and
requiredness may not change. New message types may be added only when peers
negotiate support out of band as part of the pinned application build; an
unrecognized type is always rejected.

Removing/renaming a field or type, changing meaning or representation, making
an optional field required, widening a trust route, or changing a discriminant
requires a new protocol version. There is no implicit downgrade. A missing
version receives `MISSING_PROTOCOL_VERSION`; any value other than `1` receives
`UNSUPPORTED_PROTOCOL_VERSION`, subject to the safe-response rules in section
3. All participants in a packaged build must use the same generated contract
revision.

## 12. Enforcement verification

Every validation rule from sections 1–11 is exercised by unit tests and
a packaged proof (issue 036). The coverage includes:

- **Bootstrap boundary**: wrong `event.source`, wrong `event.origin`, missing
  ports, non-plain-object data, wrong `type`, missing `contextGeneration`,
  non-`Object.prototype` prototypes, and post-bootstrap window messages from
  the expected source (which close the accepted port).
- **Envelope validation**: missing `protocolVersion`, unsupported version
  (integer non-`1`, non-integer, string, boolean, null), missing or non-UUIDv4
  `correlationId`, unknown `type`, route mismatch, non-object envelope.
- **Payload validation**: wrong `previewId` (`MESSAGE_SOURCE_REJECTED`),
  oversized source files and aggregate, binary size limits (assembly, PDB,
  aggregate), empty buffers, aliased `assembly === pdb`, timeout above maximum,
  sparse arrays, path traversal (`..`), oversized output text, unpaired
  surrogates.
- **Structural clone safety**: `SharedArrayBuffer`, typed-array views, cyclic
  references, accessor properties, symbol keys, function values, non-plain
  prototypes, `Infinity`/`NaN`/`BigInt`, `undefined` values.
- **Correlation and state**: duplicate correlation IDs, stale responses after
  timeout, `protocol.error` control events (discarded without crash).
- **Live packaged attacks**: `postMessage` to running preview's
  `contentWindow` during active game rendering, with before/after state
  capture proving no assembly load, no game start, no state mutation, and
  continued CornflowerBlue pixel rendering.

Rejections produce structured `protocol.error` or terminal `success: false`
responses. They are bounded (one rejection per invalid message, no
amplification), do not crash handlers, and cause no unintended side effects.
An invalid `protocol.error` is logged and discarded without reply, preventing
rejection loops.

## 13. Content validation and mounting

Asset files carried by `asset.mount.request` must be valid MonoGame XNB files
built for the Web content profile. The receiver validates each file's binary
header before writing to the virtual filesystem:

### XNB header validation

| Offset | Size | Field | Required value |
|--------|------|-------|----------------|
| 0–2 | 3 | Magic | `XNB` (0x58 0x4E 0x42) |
| 3 | 1 | Platform | `b` (0x62 = `TargetPlatform.Web`) |
| 4 | 1 | Version | 5 (current) or 4 (legacy) |
| 5 | 1 | Flags | Bit 6 (LZ4) and bit 7 (LZX) must be 0 |
| 6–9 | 4 | File size | LE int32, ≥ 10, ≤ actual byte length |
| 10+ | var | Readers | 7-bit reader count > 0, first reader type string |

### Content diagnostics

| ID | Meaning |
|----|---------|
| `PG0010_CONTENT_PLATFORM_MISMATCH` | Platform byte is not `b` (Web). Message instructs rebuilding with `MonoGamePlatform=Web`. |
| `PG0201_CONTENT_INVALID_HEADER` | Missing or invalid XNB magic header |
| `PG0202_CONTENT_UNSUPPORTED_VERSION` | Unsupported XNB format version |
| `PG0203_CONTENT_COMPRESSED` | Compressed content (LZ4 or LZX); initial subset requires uncompressed |
| `PG0204_CONTENT_SIZE_MISMATCH` | Declared file size mismatches actual byte length |
| `PG0205_CONTENT_MALFORMED_READERS` | Truncated or malformed reader metadata |
| `PG0206_CONTENT_UNSUPPORTED_TYPE` | Unsupported content type reader or payload format (only uncompressed `Texture2D` and non-streaming PCM `SoundEffect` are supported) |

### Virtual filesystem mounting

Valid assets are written to the Emscripten MEMFS virtual filesystem at paths
resolved by MonoGame's `ContentManager`:

```
{Content.RootDirectory}/{assetLogicalPath}
```

where `Content.RootDirectory` defaults to `Content` and the asset path
includes the `.xnb` extension. The receiver creates parent directories
recursively before writing. The mounted path matches what
`ContentManager.OpenStream(assetName)` resolves via
`Path.Combine(RootDirectory, assetName) + ".xnb"`.

### Supported content subset

The initial v1 subset supports uncompressed `Texture2D` content (reader type
`Microsoft.Xna.Framework.Content.Texture2DReader`) and non-streaming
`SoundEffect` content (reader type
`Microsoft.Xna.Framework.Content.SoundEffectReader`), matching PRD section 15.
Both reader type strings are pinned to the exact
`MonoGame.Framework, Version=3.8.5.1, Culture=neutral, PublicKeyToken=null`
identity, a single reader, zero shared resources, and root reader selector 1.
All other content types are rejected with `PG0206_CONTENT_UNSUPPORTED_TYPE`
before the game starts.

`SoundEffect` payloads are validated field by field against the pinned
`SoundEffectWriter` layout (`int32` format size, `WAVEFORMATEX`, `int32` data
size, PCM data, `int32` loop start, `int32` loop length, `int32` duration in
milliseconds):

| Field | Accepted values |
|-------|-----------------|
| Format size | exactly 18 (`WAVEFORMATEX` including `cbSize`) |
| `wFormatTag` | 1 (uncompressed PCM) |
| `nChannels` | 1 or 2 |
| `wBitsPerSample` | 8 or 16 |
| `nSamplesPerSec` | 8,000–48,000 Hz |
| `nBlockAlign` | `nChannels * wBitsPerSample / 8` |
| `nAvgBytesPerSec` | `nSamplesPerSec * nBlockAlign` |
| `cbSize` | 0 |
| Data size | > 0, ≤ 8 MiB, block aligned, within the remaining bytes |
| Loop start/length | ≥ 0 and within the decoded sample count |
| Duration | > 0 and within 50 ms of `samples * 1000 / sampleRate` |
| Trailing bytes | none |

Anything outside these bounds fails closed with
`PG0206_CONTENT_UNSUPPORTED_TYPE` (unsupported shape) or
`PG0205_CONTENT_MALFORMED_READERS` (structural inconsistency) before the game
is started.

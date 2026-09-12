# Odin engine interface v2

This replaces the spike API for production. It does not modify ABI v1.

## Lifecycle API

```c
EngineStatus oe_engine_create(const EngineCreateInfo*, EngineHandle*, ErrorSpan*);
EngineStatus oe_engine_capabilities(EngineHandle, ByteSpan*);
EngineStatus oe_map_prepare(EngineHandle, const MapPrepareInfo*, MapHandle*, ErrorSpan*);
EngineStatus oe_map_describe(EngineHandle, MapHandle, ByteSpan*);
EngineStatus oe_map_retain(EngineHandle, MapHandle);
EngineStatus oe_map_release(EngineHandle, MapHandle);
EngineStatus oe_session_create(EngineHandle, MapHandle, const SessionCreateInfo*, SessionHandle*, ErrorSpan*);
EngineStatus oe_session_inputs(EngineHandle, SessionHandle, const ByteSpan* records, ErrorSpan*);
EngineStatus oe_session_advance(EngineHandle, SessionHandle, f64 target_ms, OutputBatch*);
EngineStatus oe_session_snapshot(EngineHandle, SessionHandle, f64 presentation_ms, OutputBatch*);
EngineStatus oe_session_pause(EngineHandle, SessionHandle, f64 at_ms, OutputBatch*);
EngineStatus oe_session_resume(EngineHandle, SessionHandle, const ClockAnchor*);
EngineStatus oe_session_reset(EngineHandle, SessionHandle, f64 lead_in_ms);
EngineStatus oe_session_result(EngineHandle, SessionHandle, ByteSpan*);
EngineStatus oe_session_release(EngineHandle, SessionHandle);
EngineStatus oe_engine_release(EngineHandle);
```

Handles encode table index and generation; zero is invalid. Calls validate engine ownership. `release` is idempotent only for the immediately repeated same handle; later stale generations return `STALE_HANDLE`.

## Buffer ownership

Input records are borrowed only for the call. Prepared-map descriptor spans remain valid until map release or a documented memory-growing call. `OutputBatch` spans belong to the session frame arena and remain valid until the next mutating/session-output call. The caller copies anything it retains. No engine pointer is valid after engine release. JavaScript must reacquire `memory.buffer` after `prepare`, `session_create`, explicit reserve, or any call advertising `MAY_GROW`.

Large input uses caller-reserved WASM inbox spans:

```c
oe_buffer_reserve(engine, INPUT, byte_count, &span);
// caller copies bytes
oe_session_inputs_from_reserved(..., span.token, record_count, ...);
```

Tokens prevent arbitrary pointer submission. Output overflow never truncates silently: return `OUTPUT_REQUIRED` with required bytes; the caller reserves and retries the idempotent snapshot/read. `advance` retains undrained outputs internally until acknowledged by batch token.

## Core records

All records use `{type,version,byte_size}`. Variable arrays are `{offset:u32,count:u32,stride:u32}` relative to the containing span, with checked bounds/alignment.

`InputSnapshotV1`:

```text
sequence:u64 raw_time_ms:f64 effective_time_ms:f64
x:f64 y:f64 action_bits:u32 source:u16 focus_epoch:u16 flags:u32
```

The caller sets raw time and coordinates; engine sets/validates effective time according to the immutable clock contract. Unknown action bits reject the whole batch transactionally.

`JudgementEventV1`:

```text
sequence:u64 time_ms:f64 object_id:u32 component_id:u32
result:u16 cause:u16 time_offset_ms:f64 flags:u32
combo_before:u32 combo_after:u32 health_before:f64 health_after:f64
score_after:i64
```

Result enum includes `GREAT`, `OK`, `MEH`, `MISS`, large/small tick hit/miss, slider-tail hit, small/large bonus, ignore hit/miss, combo break, and reserved profile-specific values. Cause distinguishes input, deadline, forced note-lock, tracking, spinner threshold, and replay restore.

`AudioEventV1`:

```text
sequence:u64 epoch:u32 kind:u16 policy:u16 beatmap_time_ms:f64
voice_id:u64 asset_id:u64 volume:f32 pan:f32 rate:f32
duration_ms:f32 ramp_kind:u16 flags:u16
```

`kind` is one-shot, loop-start, loop-stop or parameter-ramp. Voice IDs make stop/ramp explicit. Asset candidate descriptors are exposed at map preparation; JS reports availability before session start.

`PresentationBatchV1` contains a frame header, ordered draw batches, static/dynamic buffer spans, texture asset IDs, transforms, clip rectangles and HUD snapshot. It contains spinner progress and slider tracking/ball state; it never contains mutable pointers to gameplay structures.

`FinalResultV1` contains map/raw/prepared digests, behavior/rules/ABI versions, replay digest, score values, accuracy fraction and f64 value, rank, combo, all result counts/max counts, health, terminal reason/time, applied offsets/rate and ordered hit-event digest.

## Errors and diagnostics

Statuses include `OK`, `INVALID_ARGUMENT`, `INVALID_STATE`, `UNSUPPORTED`, `QUOTA_EXCEEDED`, `MALFORMED_MAP`, `MISSING_ASSET`, `LATE_INPUT`, `OUTPUT_REQUIRED`, `STALE_HANDLE`, `OUT_OF_MEMORY`, and `INTERNAL`. Error records contain stable code, severity, source line/column or record index, related ID, requested/limit values and UTF-8 message. Messages are diagnostic; tests assert codes/fields.

Preparation warnings are retained on the map and queryable. Unsupported gameplay objects are fatal. Missing cosmetic data may warn. A failed operation is transactional unless explicitly documented otherwise.

## Capabilities and versioning

Capability records identify ABI major/minor, engine build, supported map versions, behavior profiles, rulesets, mods/settings, replay schemas, presentation protocols, render requirements, numeric modes, quotas and optional imports. Browser startup intersects these with WebGL/WebAudio/assets. A replay is verified only if all identity capabilities match.

Within ABI major 2, record fields append and readers honor `byte_size`; enum values never change meaning. Breaking ownership, ordering or result semantics increments the major. Gameplay profile updates can occur without ABI change but produce a new behavior ID/prepared digest.

## Historical mapping from v1

| v1 | v2 successor |
|---|---|
| one engine owns map + play | separate engine/map/session handles |
| fixed text/input pointers | tokenized reserve/copy spans |
| f64 descriptor indices | typed size/version records |
| experimental ten result kinds | full production result enum/event |
| no spinner | spinner prepared/session/presentation/audio records |
| head metrics | normalized lazer score/health/final result |
| string rules version | behavior + rules + ABI + prepared digest |
| ephemeral draw f32 array | versioned static/dynamic render batches |
| sample events only | candidate assets, one-shots, loops and ramps |

## M0 foundation transport

The concrete layouts are defined in [`engine/abi/records.json`](../../engine/abi/records.json), which generates Odin constants, a C header and TypeScript readers. `npm --prefix engine run generate:abi` updates them; tests reject stale generated files. Records are little-endian, have the specified u16/u16/u32 header, and are aligned to eight bytes. Native C layout assertions and a linked C consumer exercise the same exported functions as WASM.

M0 implements only an explicitly requested **foundation** capability, flag `1`, on engine/map/session creation. Map flag `2` additionally requests M1 preparation; other flags/settings return `UNSUPPORTED`. `oe_map_prepare` in this mode owns decoded text/records and resolved legacy control points; it does not advertise a playable prepared map. Sessions own reusable zeroed arenas and retain map storage. Gameplay, scoring, replay, presentation, audio, mods, and asset capability bits are absent. Their session calls validate handles and return `UNSUPPORTED` without accessing payload/output addresses. M1 preparation/identity is implemented as described below; gameplay belongs to M2.

The capability record reports ABI 2.0, foundation build serial `1`, source behavior identifier `202608042` (the pinned lazer baseline), numeric mode `3` (source-specific f32 and f64), map-version support and raw/arena quotas. The behavior identifier names the target; it is not a gameplay compatibility certificate. All ABI-created M0 engines use default quotas. The internal native lifecycle API additionally supports lowered quotas.

### Bootstrap and spans

`oe_abi_control()` returns the address of an instance-owned, 16-byte-aligned, 1,024-byte mailbox. It does not allocate. Calls are confined to one thread per instance. The caller must use these exact locations:

| Mailbox offset | Use |
|---|---|
| 0–255 | Creation record; type/version/size validated before reading fields. Appended fields are ignored within a known version, up to 256 bytes, with an eight-byte size multiple. |
| 256–279 | Handle or `ByteSpan` result. A failed operation leaves it unchanged. |
| 320–383 | `ErrorV1` record: status/code, location, requested/limit, severity, related ID and optional UTF-8 message span. M0 emits empty messages and asserts structured fields. |
| 512–575 | Capability record; read-only to the caller. |

Other addresses supplied as creation or result pointers return `INVALID_ARGUMENT` without dereferencing them. If the error pointer itself is invalid, only the returned status is available. Input records and result/error slots cannot overlap. The bootstrap mailbox is required on native as well as WASM so untrusted C addresses receive identical validation.

`ByteSpan` is an auxiliary 24-byte descriptor: `address:u64, count:u32, reserved:u32, token:u64`. On WASM the address is a checked linear-memory offset; on native it is a caller-readable address. It is not an owning allocation. Map descriptors belong to the map; the mailbox result descriptor belongs to the call. Never return a stored native pointer as serialized compatibility evidence.

`oe_buffer_reserve(engine, 1 /* INPUT */, byte_count, out_span)` allocates a candidate inbox, then replaces the previous inbox and increments its token only after success. `MapPrepareV1` contains that token and checked offset/count into the inbox. Tokens are scoped by engine; they grant no access to another engine's bytes. Failed reserve preserves the previous token/bytes. Successful reserve invalidates the previous token. Zero-length input remains a decode error rather than an unchecked pointer read.

Reserve, engine creation, map preparation and session creation may grow memory. Reacquire all JavaScript views after them, even if a call fails after a candidate allocation. Reset, retain, release, describe/capabilities and unsupported session calls do not allocate. Map release ends the public handle when its external reference count reaches zero; internal session references retain storage. Engine release cascades through sessions, external map references and inboxes. The bounded instance registry remains allocated until instance disposal and preserves generations across engine releases.

For future session payloads, `oe_session_inputs` takes a **pointer to** the span descriptor, rather than a by-value platform-dependent aggregate. Reserved-token input remains the preferred WASM path. This concretizes the pointer calling convention; no input capability is currently advertised. See the [ADR-005 foundation refinement](adr-005-interface-extensions.md#m0-foundation-refinement).

## M1 prepared-map transport

`oe_preparation_capabilities(engine, out_span)` uses the same mailbox output span
and returns kind `14`, version `1`: preparation version `2`, behavior ID `202608042`
and numeric mode `3`. The existing foundation capability record is unchanged;
callers can discover the additional export without reinterpreting old flags.
Engine and session creation still use flag `1`. Map preparation flag `2` enables
complete preparation; flag `1` retains the M0 descriptor/behavior.

For flag `2`, `oe_map_describe` returns an immutable byte span headed by kind `8`.
The complete layout is generated from
[`records.json`](../../engine/abi/records.json) into C/Odin/TypeScript definitions:

| Kind | Record |
|---|---|
| 8 | Map behavior/numeric identity, object/schedule spans, raw/prepared SHA-256, total bytes and difficulty inputs |
| 9 | Object scalar fields plus vertex, cumulative-length, sample and component spans |
| 10 | Component identity, kind, prepared/event times, span/progress, position and samples |
| 11 | Sample name/bank/suffix, volume, beatmap/layered flags and ordered candidates |
| 12 | Candidate UTF-8 name span |
| 13 | Schedule time, object index and component index |
| 14 | Preparation capability record |
| 15 | Break start/end times |
| 16 | Resolved control-point values and source ID |
| 17 | Playback settings and owned audio filename |

Every record begins with the v2 `{type, version, byte_size}` header. Every embedded
span is `{offset:u32,count:u32,stride:u32}` relative to the start of the returned
blob. Records and array starts are aligned to 8 bytes. UTF-8 has stride `1`,
vertices contain two little-endian f64 coordinates at stride `16`, and cumulative
lengths have stride `8`. Strings have no terminating NUL. Empty spans have count
zero and a valid aligned offset; they must not be dereferenced. Padding is zero.
Read fields by the generated offsets, not native Odin struct layout.

Object kinds are circle `1`, slider `2`, spinner `8`. Component kinds are head `0`,
tick `1`, repeat `2`, tail `3`, legacy-last-tick `4`, spinner tick `5`, spinner bonus
`6`. Boolean fields encode `0`/`1`; stack/combo/spin/volume fields use signed i32
bit patterns in their schema u32 slots. Source object IDs remain stable through
sorting. Component IDs are ordinals within their object. Schedules sort by time,
then object index, then component order; `component_index=0xffffffff` denotes the
top-level arrival and precedes children of that object at equal time. These are
preparation records, not M2 judgement events. `event_time_ms` preserves the upstream
generator timestamp; repeat child `time_ms` preserves the distinct upstream
operation order used when constructing the actual nested object. Legacy markers never represent a
scoring child.

The prepared digest uses the explicitly ordered, allocation-free binary writer in
[`prepared/identity.odin`](../../engine/prepared/identity.odin). Its profile label is
`tapweave:lazer-2026.804.2:prepared-v2`; v1 identities are intentionally incompatible.
The SHA-256 input starts with the UTF-8 profile label and 32 raw-input SHA-256 bytes.
Integers, counts, enum values and booleans occupy eight little-endian bytes; signed
32-bit values preserve their u32 bit pattern, zero-extended to eight bytes. f64
values contribute their eight IEEE-754 bytes. Strings have a u64 UTF-8 byte length
followed by bytes; arrays have a u64 count followed by ordered elements. Positions
are x then y. No pointers, padding, Odin field names, reflection, allocation sizes,
or timing measurements enter the digest.

The fixed top-level order is format version; difficulty (HP, CS, OD, AR, slider
multiplier, tick rate); stack leniency; playback settings; breaks; timing,
difficulty, sample and effect points; objects; schedule. The explicit per-record
orders are the `identity_*` procedures. Changing those orders, widths or included
semantics requires a new profile and golden digest. Internal field renaming and
reordering do not. The empty `osu file format v14\n` map has v2 digest
`f19964fa850ba0ad2d99728afddafad0247495d50e867e8e1260d489a7fa74de`.
Binary-description digests remain conformance checks, not behavior identity.

Preparation v2 appends six spans and the source format version to kind 8, growing
its record from 168 to 248 bytes. Existing fields retain their offsets and record
version. The spans expose breaks, four control-point arrays and one playback
record. Old readers can skip the appended fields using `byte_size`; new readers
require the extended descriptor and preparation capability version 2. Fields in
kind 9, including `combo_offset`, keep their original offsets. Odin writers use
generated field-offset constants from the same schema as C and TypeScript.

Descriptions remain owned by the map/session references. A final external map
release invalidates the handle while existing sessions retain the backing data.
Consumers must not use any borrowed view after the last owning reference is gone.
Preparation counts and allocates a separate candidate; failed creation does not
replace or mutate previous maps. The combined raw/control-point/prepared/description
storage respects the engine quota. Reacquire WASM views after allocating calls,
even when preparation fails. Describing an already published map does not allocate.

## M2 headless session transport

Discover `oe_simulation_capabilities(engine, out_span)`: kind 25 reports session
version 1, recording/rules version 1, flags 1 (headless sessions), and the maximum
live input capacity. The legacy kind-4 gameplay field remains 0 because it denotes
the full gameplay/presentation/browser capability set. Existing foundation
sessions continue returning `UNSUPPORTED` for simulation calls.

Create a gameplay session by putting kind 18/version 1/size 40 in the bootstrap
input slot and calling `oe_session_create`. Fields are flags=2, reserved=0,
`arena_bytes:u64`, finite `lead_in_ms:f64`, `input_capacity:u32`, reserved=0.
The map must have been prepared with flag 2 and contain at least one object.
Lead-in cannot exceed the first object's start. Capacity bounds total accepted live input. Recording/input storage also reserves
important judgement and pause frames. Creation requires
`2 * input_capacity + maximum_judgements + 2 <= 1,000,000`, subject to memory quotas.
The arena budget includes all mutable state, complete result/audio journals,
recording frames, candidate availability and reusable serialization buffers.
No advance, snapshot, pause, resume, reset, replay export or seek allocates.

The concrete records are generated from `engine/abi/records.json`:

| Kind | Meaning |
|---|---|
| 18 | Explicit gameplay session creation |
| 19 | Committed HUD/status, presentation time, object/judgement/audio spans, batch token |
| 20 | Object identity, parent/head outcomes and times, tracking, rotation and sampled position |
| 21 | Ordered judgement, cause, timing offset, score/combo/health before and after |
| 22 | Resume beatmap/audio anchor, rate=1, flags/reserved=0 |
| 23 | Input snapshot; source/focus epoch packed into one u32, flags/reserved=0 |
| 24 | Terminal reason/time, score/rank/health, counts, raw/prepared/judgement digests, profile and clock settings |
| 25 | Headless session capabilities |
| 26 | Actual and maximum counts for each stable result ID |
| 27 | One-shot audio intent; asset 0/flags 1 explicitly indicates missing sample |
| 28 | Candidate asset availability by object/component/sample/candidate ordinal |

States are READY=0, RUNNING=1, PAUSED=2, PASSED=3, FAILED=4. The first advance
starts a READY session. Time is finite and monotonic; pause freezes advancement;
terminal sessions retain their terminal time/results. The resume anchor validates
audio seconds but does not store a browser clock mapping; the browser owns that
mapping. Snapshot accepts any finite
presentation time but never judges or advances health. It samples committed object
state and slider position, not a WebGL presentation batch. Object IDs remain source
IDs; component ID `0xffffffff` means the parent. Result IDs retain `Hit_Result`
values 0–16. Causes are input=0, deadline=1, note-lock=2, tracking=3, spinner=4.

All output pointers must be the mailbox span slot at offset 256. Snapshots own
session-backed relative spans; copy retained bytes before the next output call.
`oe_session_acknowledge(engine, session, batch_token)` acknowledges the events
included in that snapshot. Repeated snapshots keep pending events until ack.
Tokens are nonzero, scoped to the session, and invalidated by reset/new snapshots.
Acknowledging the same current token twice is safe. Final results are available
only after pass/failure, remain immutable, and include a SHA-256 over the prepared
identity followed by canonical kind-21 judgement bytes. Output buffers are sized
at creation for the entire bounded journal, so there is no mid-transition loss.

Copy an array of exact 64-byte kind-23 records into the reserved inbox, then call
`oe_session_inputs_from_reserved(engine, session, token, record_count, error)`.
`oe_session_inputs` alternatively accepts a ByteSpan at mailbox offset 0 naming
that same inbox address, byte count and token. Unknown records, bits, non-finite
values, sequence/time disorder, stale tokens and late inputs reject the whole
batch. Coordinates are logical osu! pixels; raw and effective time must match.
Rate=1 and all four offsets=0 are the current clock profile. Future inputs stay
queued. Input equal to committed time is admitted; only earlier input is late.
Both input exports validate the error mailbox address but currently return status
only; they do not publish a fresh `ErrorV1`. Consumers must not read stale error
contents for these calls.

`oe_session_bind_sample(engine, session, mailbox)` consumes kind 28 before start.
Each call reports availability of one prepared candidate (`asset_id=0` removes
it). Odin chooses the first nonzero candidate in prepared order. A successful
reset retains the availability table and reopens READY configuration. First
advance or replay load freezes availability. Tail hits request their sample at
nominal tail time even when judgement happened early.
Missing candidates emit diagnostic silence; no browser audio resource is owned.

Replay extensions use the same checked engine inbox and output span:

```c
uint32_t oe_session_replay_load(oe_handle engine, oe_handle session, uint64_t token, uint32_t bytes);
uint32_t oe_session_replay_export(oe_handle engine, oe_handle session, uintptr_t output);
uint32_t oe_session_replay_seek(oe_handle engine, oe_handle session, double time_ms, uintptr_t output);
```

Load requires a fresh READY session with no queued/recorded input. It validates
checksum, complete profile/raw/prepared identity and every frame before publishing.
Export requires terminal state and writes replay v2 with rules version 1.
All frames have flags=0 and represent actual input/judgement/pause times. The recorded final digest is metadata for consumers to compare with
recomputed results, not an authenticity claim. Seek restores the READY checkpoint
and resimulates; it suppresses historical output and increments the output epoch.
Seek cost is proportional to events before the target, not elapsed milliseconds.

The WASM host must now provide `odin_env.pow` alongside the existing math/import
functions, because production scoring is linked. Browser rendering, audio loops,
asset loading and synchronized playback remain M3. Whole-scenario upstream gates
are tracked separately in the [headless session status](../status.md#m2-headless-sessions).

## Browser foundation bindings

The existing mailbox and auxiliary ByteSpan offsets are also named under
`transport` in the ABI schema. `records.mjs` is the shared executable binding;
`records.ts` re-exports it with generated `records.d.mts` declarations. Generated
writers validate complete scalar input before modifying a record. The browser
bridge copies retained map descriptions and reacquires views after WASM calls.
This transport refinement changes no offsets, record kinds or capability bits.

## Production coordinate conversion

`oe_playfield_transform(engine, viewport_mailbox, output_mailbox)` consumes kind
29 and returns kind 30. Both are version 1 and append to the schema without
changing kinds 1–28. The viewport contains CSS left/top/width/height and DPR as
f64. Positive dimensions/DPR and finite coefficients are required. The result
contains scale, client origin and six inverse affine coefficients in DOM order.
DPR does not enter CSS input conversion. Call again when placement or size changes.

This operation does not allocate. It validates handles, exact mailbox addresses,
record version/size and numeric inputs before publication. Failure leaves prior
output bytes/span unchanged. The output uses mailbox bytes 672–751 and expires
on the next transform call. Copy coefficients immediately; never retain a WASM
view across potentially growing calls. Export discovery indicates coordinate
support only; full presentation and gameplay capability remain unavailable.

Remaining [render resources](adr-003-rendering.md#remaining-resource-protocol),
[audio records](adr-004-audio.md#remaining-audio-protocol) and
[clock mapping](adr-004-audio.md#receipt-time-conversion) are specified in their ADRs.

## Compact gameplay output and active projection

Kinds 31–34 append transport support while preserving kinds 1–30 and all existing
exports. `oe_output_capabilities(engine, output_mailbox)` returns kind 34 from
mailbox bytes 752–775. Compact-output and active-projection versions are 1; flags
are zero. This does not advertise animation, WebGL resources, audio voices or
integrated Play. All new output arguments require the mailbox span slot.

`oe_session_advance_output(engine, session, time_ms, output_mailbox)` shares the
existing simulation advance and emits kind 31. Its 120-byte summary intentionally
has the same fields and offsets as kind 19, enforced by the binding generator.
The object span is empty; kind-21 judgements and kind-27 one-shots follow directly.
Work to serialize output depends on unacknowledged events, not map object count.
The simulation completion check uses its existing completed-object counter.
Input-driven simulation still has separate full-map scans; this is not a claim
that all simulation work is now proportional to active objects.

Kind 31 shares the diagnostic output buffer and acknowledgement contract. A new
kind-19 or kind-31 publication invalidates the previous batch token. Repeating
acknowledgement of the current token is safe. Rejected calls preserve publication;
reset invalidates tokens. Failed browser admission must leave the token
unacknowledged, then retry admission before consuming another output publication.
This transport does not implement durable browser audio admission itself.

`oe_session_presentation(engine, session, presentation_ms, output_mailbox)` emits
kind 32 with a relative array of kind-33 active object projections. Records expose
committed outcomes, slider position at the requested time, rotation, tracking,
source identity, radius and preempt. Cursor coordinates are committed input
coordinates. These are projection records, **not** animation/draw commands.
Animation, meshes, atlas/shaders and voice/loop records remain to be appended.

Projection storage is separate from gameplay/replay/result output. A presentation
call changes neither gameplay bytes, pending output token, journal cursors nor
simulation. Its bytes last until the next presentation call, reset/seek or session
release. Gameplay calls do not overwrite these bytes, although their contents
then describe an older committed state. Mailbox spans themselves are overwritten
by subsequent successful output calls. Browser readers must consume/copy any
needed span metadata immediately and reacquire views after memory growth.

Creation checks addressable sizes and reserves reveal keys, active indices and
projection output in the session arena. Reveal keys are sorted once; ordinary
monotonic reads visit retained active objects and newly revealed entries. Source
order is stable even when reveal order differs. Judged objects remain candidates
through result time plus 800 ms, a conservative lifetime bound from pinned
`DrawableHitCircle`, not an accepted animation policy. Journal acknowledgement
cannot erase this committed feedback. Backwards diagnostic reads and changed
simulation epochs rebuild the active set; their cost can include all preceding
reveals. Counters expose visited/revealed work. No allocation occurs in these Odin
reads. Generated `readRecordInto` and reusable browser output readers avoid
per-record object containers and full-buffer copies; JavaScript VM scalar and
iterator allocation behavior has not been certified as allocation-free.

## Minimal immutable render attachment

Kind 35/version 1 is an executable W01 resource container. Call
`oe_map_render_resources(engine, map, mailbox_output)` during preparation. The
first call allocates a complete candidate under the remaining combined map quota;
subsequent calls return the same immutable bytes. Failure leaves the output slot
and map publication unchanged. Reacquire WASM views even after a failed candidate.
`oe_session_render_resources(engine, session, mailbox_output)` only borrows an
already-published attachment and never allocates. An absent attachment returns
`INVALID_STATE`; foundation maps return `UNSUPPORTED` from creation.

The header contains a logical resource ID (the original generation-checked map
handle), attachment version, prepared digest, total bytes, five relative spans
and RGBA atlas dimensions. This identity remains usable through retained sessions
after the external map handle is released; it cannot be used as a new map handle.
The last map/session owner frees the attachment. Browser GPU generations are
independent and are never serialized. Resource reads do not replace frame output
or gameplay acknowledgement tokens.

Span starts are eight-byte aligned and non-overlapping. Vertices are pairs of
finite little-endian f64 coordinates (stride 16); indices are u32 (stride 4), in
triangle groups, and must reference an existing vertex. Atlas bytes are RGBA8
(stride 1); shader sources are UTF-8 GLSL ES 3.00 (stride 1). Atlas dimensions are
positive and bounded by 4096 in each axis; byte count must equal width*height*4.
Every reserved field and flags field is zero; unknown attachment versions reject.
An empty span has a valid aligned offset and is never dereferenced. Shader spans
must be nonempty. The current payload is a unit quad and one white pixel, with
original transform/colour shaders. It does not implement slider tessellation or
advertise final draw/animation/WebGL capability. W04 extends the payload producer.

The browser `Audio_Admission` owns one session's retained engine-epoch/sequence
watermark. It validates and admits the entire new kind-27 suffix before calling
acknowledge. If acknowledgement fails, a new compact snapshot may be admitted:
already-admitted sequences are skipped and the latest token is acknowledged.
Queue rejection preserves engine pending events and the watermark. Dispatch
cancellation retains the watermark, so an acknowledgement retry cannot replay
cancelled one-shots. A new engine epoch resets sequence admission; browser epoch
changes require an explicit clock mapping and do not themselves reset admission.
Kind-27 events retain their exact nominal times and silence flags. Immediate late
one-shot execution is a provisional diagnostic policy pending H11; this adapter
does not enable production Play or voice/loop capability. Its staging and executor
queues still allocate JS objects; allocation-free browser ingestion is not claimed.

## Reserved circle draw transport

Kinds 36–40 add a separate diagnostic circle draw path. It returns explicit
instances and batches, not kind-32/33 projections. Complete animation/draw/Play
capability remains unavailable: reserve rejects maps containing sliders/spinners.
W03 still requires those families, complete feedback, cursor/trail/follow points,
HUD glyphs and broader A22 evidence. The frame header already carries authoritative
score/accuracy/health/combo/status; browser scoring is never required.

`oe_session_render_reserve(engine, session, request, mailbox_output)` accepts
kind 36: `arena_bytes:u64`, `instance_capacity:u32`, flags/reserved zero. Both
pointers must be the documented mailbox slots. A zero instance request queries
kind 37 without allocation. The recommendation is 24 instances per object, a
conservative circle digit/primitive count, not a performance threshold. A caller
may reserve less and receive an exact per-frame `OUTPUT_REQUIRED` later. Reserve
accepts READY/PAUSED only, requires an existing map attachment, caps requested
instances at 1,000,000 and total base-session plus draw-arena bytes at the engine
arena quota. Checked sizing also enforces WASM32 addressability. Candidate failure
leaves prior draw storage and output descriptor unchanged; success replaces it.
Reacquire WASM views after reserve, including failure. Reset reuses storage and
changes the engine epoch; final session disposal releases it.

`oe_session_draw(engine, session, time_ms, viewport, mailbox_output)` accepts the
existing kind-29 viewport. It refreshes active indices, counts primitives, checks
capacity, fills reserved instances, orders them and writes batches. No gameplay
advance, acknowledgement, allocation or memory growth occurs. Insufficient
capacity returns status 8 and kind 37 with exact required instances/bytes while
preserving the previous frame bytes. Resource and gameplay-journal lifetimes are
independent of draw output. Successful draw calls replace the previous frame;
reset/seek invalidate its semantic epoch. Nonfinite time/viewport rejects.

Kind 38 contains epoch/state, resource ID, requested and committed milliseconds,
playfield-to-CSS scale/translation, authoritative HUD values, relative instance/
batch spans and total bytes. Each array starts at an eight-byte aligned offset
with generated stride and validated, nonoverlapping bounds. Empty arrays have
count zero and valid aligned offsets. Kind 39 contains primitive/layer,
source object/component/ordinal, position in osu! pixels, radii/scales in pixels,
rotation in degrees, alpha/progress in [0,1], packed little-endian RGBA8 colour,
glyph ID and bounded index range. Reserved/flags are zero. Current emitted
primitives are disc=1, ring=2 and numeric glyph=3 (ASCII 48–57); all reference the
quad's index range. Layers 20/30/40 are object/approach/feedback. Original glyph
atlas and analytic shaders still belong to W04; no GPU execution is advertised.

Order is strictly `(layer, source object ID, component ID, primitive ordinal)`.
Kind 40 groups consecutive matching layer/primitive instances using first/count;
batches cover the entire instance span exactly once. Readers reject unknown
versions/primitive kinds, stale resource/epoch identity, nonfinite parameters,
invalid alpha/progress/index ranges and inconsistent ordering/batch coverage.
Source IDs and quad data are never WebGL handles. Viewport scale and translation
are carried in the same frame as the sampled state, so browser animation decisions
are unnecessary.

Circle approach alpha and vector-scale arithmetic preserve the pinned framework's
distinct f64/f32 interpolation paths. The count/fill producer preserves readonly
past reads and hit feedback after journal acknowledgement. Its source-derived
40 ms hide, 400 ms expansion, hit lifetime and 100 ms miss fade are separate
policies; the active set's 800 ms conservative retention is not used as a generic
animation duration. Sixty feedback observations match selected alpha/scale curves
at equal elapsed time after results; full A22 remains open. Draw reserve includes
feedback/cursor membership indices and source-ID-indexed expiry policy, with
watermarks separate from gameplay/audio acknowledgement. Repeated reads cannot
append duplicate semantic history; backward reads and epoch changes rebuild it.
## Voice transport and narrow capabilities

Kind 41 (`transport_capabilities`, 40 bytes) reports independent resource,
circle-animation, draw and voice versions (currently 1). `flags=1` means the draw
producer is circle-only; `voice_command_mask=15` exposes one-shot, loop-start,
loop-stop and parameter-ramp production. The full journal is opt-in through
kind-42 flag 1; flag zero preserves the legacy one-shot projection. `max_draw_instances=1000000`; reserved fields are
zero. These declarations do not enable aggregate Play or claim full A22/H11.

`oe_session_voice_reserve` accepts kind 42 (32 bytes): `arena_bytes` is a u64 byte
quota and `command_capacity` a u32 count; flag 1 requests the authoritative
journal, flag zero the legacy projection; reserved must be zero. Zero count
queries kind 43 (32 bytes), containing requested/required counts, required arena
bytes and session epoch. Legacy count derives from one-shot sample capacity.
The authoritative count includes input/pause capacity, maximum concurrent loop
samples and scheduled transitions; its byte count also includes journal, loop
state and indexed deadlines. Legacy reserve requires READY or PAUSED; enabling
or replacing authoritative storage requires READY. Draw and voice storage jointly count
against the engine's session arena quota. Candidate failure preserves prior
storage. Counts above 1,000,000 and non-WASM32 byte sizes return typed quota errors.

`oe_session_voice_output` writes kind 44 (64 bytes) plus a relative, aligned span
of kind-45 records. The header contains epoch, committed map time, latest batch
token, command offset/count/stride and total bytes; flag 1 identifies an
authoritative journal, flag zero a legacy projection; reserved is zero.
Insufficient capacity returns OUTPUT_REQUIRED and kind 43 without overwriting the
previous voice frame. No gameplay advancement, allocation or memory growth occurs.

Kind 45 (`voice_command`, 112 bytes) contains:

| Fields | Semantics |
|---|---|
| sequence, epoch, voice_id | Positive sequence/epoch and nonzero u64 logical voice identity |
| command_kind | 1 one-shot, 2 loop-start, 3 loop-stop, 4 parameter-ramp |
| time_ms, asset_id | Finite nominal beatmap time and host-owned asset ID; time is never clamped |
| volume, pan, rate | Finite volume 0–1, pan −1–1 and positive playback rate |
| duration_ms, parameter_mask | Nonnegative ramp duration; mask bits 0/1/2 select volume/pan/rate. Ramps require a nonzero mask; other commands require zero mask/duration |
| late_policy, lateness_threshold_ms | 1 immediate or 2 drop; finite nonnegative threshold in milliseconds |
| object_id, component_id | Existing stable source identities; all-ones component denotes the parent |
| flags, reserved | Flag 1 means missing asset/explicit silence and requires asset ID zero; otherwise asset ID is nonzero. Reserved is zero |

The writer, validator and reader cover all four command shapes. The opt-in
producer records semantic commands in Odin; frame reads only serialize retained
commands. The default exporter translates the existing one-shot journal. The
immediate late policy remains provisional pending broader H11. Legacy kind-27
output remains unchanged. Loop sample bindings use component `0xfffffffe` with
the prepared auxiliary sample ordinal; auxiliary tail copies are excluded.

Voice frames own a separate output lifetime: gameplay/draw/result reads do not
overwrite them. Another successful voice read, reserve replacement or session
release invalidates the borrowed frame; reset/seek require a fresh epoch binding.
Gameplay and voice reads share latest-token acknowledgement, so either can make
the other's token stale. Voice-only acknowledgement consumes audio, not unseen
judgements. All audio consumers for a session use the same `Audio_Admission`
watermark, admitting a complete suffix before acknowledgement. Admission rejection
retains pending output; an acknowledgement retry cannot enqueue it twice.

Ordinary pause preserves queued and scheduled future one-shots under a bounded
retention limit and lets already-started one-shots finish. Resume requires a fresh
clock mapping for the same engine epoch and restores retained nominal times once.
Reset/replacement/failure cancel instead. Loop suspension is explicitly unsupported
until its producer/executor contract is enabled. The full player lifecycle remains
W07 work.

See [W05 audio execution](adr-004-audio.md#w05-opt-in-audio-execution) for allocation,
asset availability, separate journal sequences and pause reconstruction rules.

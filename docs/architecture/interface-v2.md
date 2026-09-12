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

## Browser foundation bindings

The existing mailbox and auxiliary ByteSpan offsets are also named under
`transport` in the ABI schema. `records.mjs` is the shared executable binding;
`records.ts` re-exports it with generated `records.d.mts` declarations. Generated
writers validate complete scalar input before modifying a record. The browser
bridge copies retained map descriptions and reacquires views after WASM calls.
This transport refinement changes no offsets, record kinds or capability bits.

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
EngineStatus oe_session_inputs(EngineHandle, SessionHandle, ByteSpan records, ErrorSpan*);
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

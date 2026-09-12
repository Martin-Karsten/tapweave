# ADR-001: Data ownership and memory

Status: accepted.

## Context and evidence

A single maximum-sized mutable allocation wastes memory on small maps and prevents sharing prepared data across sessions. WebAssembly linear memory grows by pages and does not shrink when an allocation is freed; retaining JavaScript views across growth is unsafe.

## Alternatives

1. Keep one maximum fixed block: simple cleanup and stable pointers, excessive per-session memory.
2. General-purpose heap allocation per object: compact average usage, fragmented ownership and difficult partial-failure cleanup.
3. Lifetime arenas with a count/validate pass: bounded, right-sized, transactional, and cheap reset/disposal.

## Decision

Use option 3. Decoding has a bounded scan/count pass, quota validation, then one prepared-map arena sized with checked arithmetic. A second fill pass builds immutable records, strings, geometry and schedules. Failure drops the candidate arena atomically. A reference-counted `PreparedMap` handle may serve multiple sessions.

Each `PlaySession` owns a right-sized mutable arena: per-object/component state, event heap/cursors, score/health, replay cursor, and checkpoints. Each call receives reusable transient scratch/output arenas owned by the session; `end_frame` invalidates their spans. Asset bytes, decoded audio/images and GPU resources belong to the JavaScript map asset scope, keyed by engine asset IDs.

```text
engine lifetime: allocator + handle tables + capability state
map lifetime:    raw text/strings + prepared objects/geometry/samples
session lifetime:mutable results + input/replay + score/health/checkpoints
frame lifetime:  judgement/audio/draw/error spans
JS asset scope:  archive blobs + decoded media + WebGL/WebAudio handles
```

Quotas cover raw bytes, lines, control points, objects, components, vertices, samples, duration, replay frames, output events, checkpoints and total arena bytes. Defaults accept known ranked maps with headroom; callers may lower them but not exceed compile-time safety ceilings. Errors include requested/limit values.

Before any allocation or offset computation, use checked `u64` arithmetic and verify WASM32 addressability. Grow memory only during map/session creation or explicit output-reserve calls, never inside `advance`/`render_snapshot`. JavaScript recreates every typed view after a call that may grow memory.

## Consequences

Small maps/sessions are cheap and prepared maps are shareable. Reset is deterministic and allocation-free. Preparation requires two passes and explicit arena offset/fixup discipline. Freed linear memory may remain committed inside the instance, so long-running apps should reuse size-class arenas or dispose/reinstantiate after a configurable high-water threshold; diagnostics report live arena bytes and linear-memory pages separately.

## Acceptance

Fifty alternating small/large loads, four parallel sessions on one map, failed replacement, reset loops, disposal in every lifecycle state, and forced memory growth must show no live-owned-byte increase after scope release. No pointer/span may remain valid past its declared lifetime.

## M1 review refinement

`prepared.Map` owns the immutable breaks, control-point arrays and playback
settings required by future scoring and presentation. They do not borrow decoder
or `osu_prepare` storage; their portable descriptions count against the same map
quota. Runtime may retain raw records for diagnostics, but downstream packages
consume `prepared` records without importing decoder/preparation/runtime packages.

A shared 100,000,000-unit work budget covers control-point insertion, both M1
passes, geometry, record/string reservations, node preparation, stacking and a
conservative schedule-sort allowance. Geometry retains its caller-specified
per-build ceiling and also debits the shared budget. Exhaustion rejects the
candidate with a typed `PREPARATION_WORK` error; no reduced accuracy is used.
Node sample lists are scanned once per object/pass. Scratch uses the same checked,
aligned count/fill reservations as map storage, and every reservation is checked.
Work units are deterministic resource accounting, not a wall-clock deadline;
preparation and asset work still belong outside real-time gameplay callbacks.

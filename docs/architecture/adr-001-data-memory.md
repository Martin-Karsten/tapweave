# ADR-001: Data ownership and memory

Status: accepted.

## Context and evidence

The spike stores text, prepared objects, session mutation, inputs, events, and draw buffers in one ~39.84 MiB fixed allocation even when populated fields are ~153 KiB. It is bounded and allocation-free during play, but each instance pays every maximum and cannot share a prepared map. The C# comparison already identified this maintainability issue ([audit](../compatibility/spike-audit.md)). WebAssembly linear memory grows by pages and does not shrink merely because an Odin allocation is freed; retaining views across growth is unsafe.

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

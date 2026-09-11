# ADR-002: Deterministic scheduling and replay

Status: accepted.

## Context and evidence

Pinned lazer judges through drawable updates: slider tracking and spinner angle accumulation can reflect update cadence. The spike replaces this with exact events plus a fixed 1 ms tracking loop. That loop is deterministic but not upstream law, scales with duration, and still approximates a frame-driven system.

## Alternatives

1. Reproduce the browser RAF cadence: closest to one run, replays differ across devices/stalls.
2. Fixed 1 ms simulation: deterministic and simple, unnecessary work and arbitrary sampling.
3. Event-driven simulation with explicit live/replay cursor semantics: deterministic, efficient, and makes upstream frame differences measurable.

## Decision

Use option 3. Simulation time is f64 beatmap milliseconds but must be finite and monotonic. The ordered key is:

```text
(time, phase, topLevelIndex, componentIndex, inputSequence)
phase: input snapshot -> tracking recompute -> scheduled judgement
       -> forced/automatic parent result -> score/health -> output
```

All equal-time input records are applied before automatic deadlines. A press edge may select at most one head. Live cursor is sample-and-hold; replay cursor linearly interpolates. Slider tracking predicates are evaluated at input times and exact child deadlines. Spinner deltas are input-segment based with recorder subdivision. Presentation samples arbitrary time but receives readonly committed state.

The browser uses the Web Audio anchor conversion in ADR-004. It batches DOM inputs before `advance(target)`. Input time earlier than committed time is rejected as `LATE_INPUT`; no hidden clamp, rollback, or changed accuracy. An input beyond the target remains queued. Pause emits release-all, commits pause time, freezes the anchor, increments epoch; resume establishes a new epoch. Rate/offset cannot change while running.

Replay validation occurs before session start. Rendering stalls only make `advance` consume a larger event interval. Seeking restores the nearest deterministic checkpoint and resimulates. Final digest hashes canonical discrete outputs and score state, not presentation floats.

## Consequences

Native/WASM and rendering rates can match exactly. Some slider tracking transition timestamps or spinner totals may differ from a particular lazer frame schedule; these are explicit OD findings, not accidental drift. Compatibility tests still require exact discrete results wherever all tested upstream schedules agree.

## Acceptance

Run every replay at direct-final advance, 30/60/120/144 Hz and with 50/100/250 ms stalls. Judgement/audio-intent/final digests are byte-identical within Odin. Equal-time and late-input fixtures prove phase order and no mutation on rejection.

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

The browser uses the Web Audio anchor conversion in ADR-004: each DOM handler stamps input with the audio clock directly, and one coordinator collects inputs, submits them, then advances, so results never depend on which RAF callback ran first. Input time earlier than committed time is rejected as `LATE_INPUT`; no hidden clamp, rollback, or changed accuracy. Input time equal to committed time, and equal-time inputs among themselves, keep sequence order and precede automatic deadlines. An input beyond the target remains queued. Pause retains the current action state, commits pause time, freezes the anchor, and increments epoch; resume establishes a new epoch, and input carrying a closed epoch is rejected rather than remapped. Rate/offset cannot change while running.

Replay validation occurs before session start. Rendering stalls only make `advance` consume a larger event interval. Seeking restores the nearest deterministic checkpoint and resimulates. Final digest hashes canonical discrete outputs and score state, not presentation floats.

## Consequences

Native/WASM and rendering rates can match exactly. Some slider tracking transition timestamps or spinner totals may differ from a particular lazer frame schedule; these are explicit OD findings, not accidental drift. Compatibility tests still require exact discrete results wherever all tested upstream schedules agree.

## Acceptance

Run every replay at direct-final advance, 30/60/120/144 Hz and with 50/100/250 ms stalls. Judgement/audio-intent/final digests are byte-identical within Odin. Equal-time and late-input fixtures prove phase order and no mutation on rejection.

## M2 session implementation

The implementation must follow the decisions above. Input equal to committed time
is admitted; only earlier input is late. Pause retains actions at the requested
time and retains queued future inputs. Resume synchronizes releases from retained
physical sources, updates cursor position, and forwards the actual resume event
before the first resumed advance; unrelated newly held paused sources remain
inactive until release/repress. A consumed resume press updates held state
without dispatching a hit. It must not
shift input to adjacent floating-point timestamps or change replay interpolation
to make live/replay comparisons pass.

The session recorder stores ordinary frames at actual input and judgement times,
including the retained action state at pause time. Rules version 2 additionally
records a one-shot resume-blocker marker in input flags, so replay preserves the
difference between an action becoming held and a press reaching hit objects. Replay positions use the pinned framework's
`Vector2` interpolation precision. Full recorder sampling/subdivision and
whole-drawable schedule comparisons remain acceptance gates; local round trips
are not evidence of upstream compatibility.

Circle miss deadlines encode the strict hit-window comparison using the first
representable timestamp outside the window. Health integration and slider/spinner
sampling follow the event-driven design above, but their whole-session agreement
with the pinned player remains unverified. These are implementation claims to
validate, not additional gameplay rules or accepted compatibility divergences.

## M3 input delivery divergence

The scenario delivery diagnostic (`npm --prefix engine run
compare:scenario-delivery`) ran the controlled drawable host's actual delivery
times through Odin: every selected `ordered result`/`score`/`combo` difference
between the receipt-time run and the pinned host is eliminated when each input
is applied at the first declared upstream update at or after its receipt time.
The pinned framework queues each input into the next drawable update, so its
effective input time is frame-quantised; ADR-002 applies inputs at their own
receipt timestamps. The pinned host itself produces different selected results
across the executed 30/60/144 Hz schedules and injected stalls (a subset of the
full schedule/stall matrix in [reference-harness](../compatibility/reference-harness.md#schedule-and-stall-matrix)),
so no single frame schedule is an exact oracle for these fields.

Decision: production keeps receipt-time semantics. Quantising input to an
advance or frame grid would reintroduce the cadence dependence this ADR exists
to remove. The delivery-time difference for those frame-dependent selected
fields is therefore an accepted deterministic divergence. `m3-scenarios.json`
findings carry `divergence_disposition: 'accepted-input-delivery'` only where
the executed delivery diagnostic eliminated the original difference; residual
differences without eliminating evidence remain open.

This amendment is scoped to the input delivery divergence. It does not relax
the M2 session implementation rules above, does not retime production inputs
or replay timestamps, and does not accept any other frame-dependent quantity:
wherever every tested upstream schedule agrees, exact matching is still
required, and the voice-intent command-time differences stay open pending H11
because loop/ramp production is unimplemented.

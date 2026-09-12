# M2 headless session integration

Production `oe_session_advance`, `oe_session_snapshot`, `oe_session_pause`, resume,
inputs and final-result calls now operate on explicit gameplay sessions. Foundation
sessions remain unchanged. This is headless Odin gameplay; Tapweave still has no
playable browser presentation/audio client.

## Implemented

- Prepared-map-backed object/component state and retained immutable map ownership.
- Creation-time arenas, bounded input queues, complete judgement/audio journals,
  checked quotas, transactional creation and allocation-free hot paths/reset.
- Event-driven circle misses, press edges, equal-time inputs and start-time note
  lock; default lazer slider heads, tracking/key restriction, children, early tail,
  late-head catch-up and ignored parent result; spinner history, bonus ticks and
  final thresholds. Legacy-last-tick preparation markers are not judged.
- Maximum-result recursion, normalized scoring, result counts, combo/accuracy,
  health calibration, merged no-drain intervals, combo health, failure freeze and
  terminal results. Health is anchored at semantic judgements to avoid render-rate
  rounding differences.
- Readonly object/HUD snapshots, acknowledged output batches, canonical result
  digests, pause/resume epochs and reset without preparation or allocation.
- Frozen per-candidate availability, engine-ordered sample fallback, explicit
  missing-sample silence and nominal-tail one-shot timestamps.
- Replay identity/checksum validation, ordinary frames recorded at input/judgement times,
  export/import and backwards resimulation from initial state. The existing rules
  version 1 is used; there are no interpolation-only frames.

See the [ABI](../architecture/interface-v2.md#m2-headless-session-transport) and
[ADR-002](../architecture/adr-002-scheduling.md#m2-session-implementation)
for exact creation, lifetime, phase and recording contracts.

## Validation and evidence classification

`npm --prefix engine test` covers native allocation-tracked gameplay tests and a
native C/WASM production consumer. The same mixed map/inputs produce identical
binary final results at direct advance and 30/60/120/144 Hz, with intervening
snapshots. The native/WASM mixed map includes a five-spin spinner, a tracked
slider with early tail, circles, ignored spinner children and normalized scoring.
Tests additionally exercise strict circle boundaries, note-lock forced misses,
equal-time edges, failure freeze, sparse live/replay slider input, pause/resume,
reset, stale output tokens/handles, invalid addresses/tokens/inputs, acknowledged
one-shots, replay round trips/seeking and failed creation/arena quotas. Panic
allocators and unchanged WASM memory buffers check the exercised hot paths.

The [local finding index](../../engine/reference/findings/m2-sessions.json) records
source revisions, map/input/final-record hashes, partial acceptance IDs and the
reproduction command. The [pinned correction probes](../../engine/reference/findings/m2-session-corrections.json)
record actual upstream result-minimum, slider-position and replay-interpolation
comparisons. No full acceptance ID is closed by either index.

The existing 88 decoder, 74 geometry plus four local failures, 101 preparation and
104 M2 primitive fixtures remain in the suite. The pinned upstream component run
also passes its 72 comparisons, using real locked restore/build and the existing
H06/H08/H09/H10 projections plus real replay-handler interpolation and repeated
slider curve-position probes. Result-property checks include upstream minimum
results, notably `SliderTailHit → IgnoreMiss`. That run is **component evidence**, not new integrated
session or drawable acceptance. No source hashes or upstream goldens were refreshed
to make this implementation pass.

Behavior was inspected in the clean pinned osu checkout at
`3c1c96f742e7aae2ff67a7361e058fe91ca3b955` and framework checkout at
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`, including `DrawableHitCircle`,
`StartTimeOrderedHitPolicy`, `SliderInputManager`, `DrawableSlider`,
`DrawableSpinner`, `SpinnerRotationTracker`, `OsuHealthProcessor`,
`DrainingHealthProcessor`, `HealthProcessor`, `JudgementProcessor`, `Player` and
framework `Precision`. Source inspection is not an executed drawable oracle.

## Remaining milestone gates and limits

Full A13–A20/A23 acceptance remains open. New integrated drawable observations for
H05/H06/H07/H08, player-level H09 comparisons, sample H11 comparisons, dense/long
workload measurements and the whole upstream schedule/stall matrix are not claimed.
The bounded local cases above establish implementation regressions and consistency.
They do not certify every map or source-specific frame-dependent transition.

Recording/input capacity is fixed at creation. Exhaustion rejects incoming batches;
callers must choose a sufficient arena/capacity before play. Journals reserve their
complete bounded maximum. Seek currently uses the initial checkpoint, so long replay
seeks replay all preceding events. More frequent checkpoint caching is not implemented.
Replay final digests are exported for comparison; imported metadata is not trusted
as a verified result. No mods, legacy replay containers, rate/offset changes, browser
presentation/WebGL, music playback or audio loop/voice execution is added.

## Correction of unsupported assumptions

The initial implementation's closed-timestamp input admission, adjacent-timestamp
pause releases, future-input cancellation and profile-2 interpolation anchors were
removed. They contradicted the accepted scheduling/replay contract. Source checks
also corrected the slider-tail minimum result, late-head catch-up position test,
last-object note lock, repeated-slider endpoint arithmetic, f32 follow-radius and
spinner-progress arithmetic, and framework f32 replay interpolation. Ordinary
replay frames are recorded at actual times; recordings are not rewritten to hide
live/replay differences. Complete recorder cadence/angular subdivision and actual
player/drawable integration still require upstream acceptance work.

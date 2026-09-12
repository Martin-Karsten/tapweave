# M2 — Complete unmodded simulation and scoring

Status: independent primitives implemented and imported into main; M1 is now complete. See
[M2 implementation status](m2.md) for executed evidence and blocked integration.

## Objective and dependency gates

Build a headless Odin engine that consumes a prepared map and timestamped inputs
and produces deterministic judgements, score, health, sample intent, replay data,
and immutable final results. Provide readonly gameplay state for M3.

The target is the unmodded osu!standard profile pinned in the source manifest.
Classic, other mods, legacy `.osr`, DOM input, browser rendering/audio, accounts,
and submission are outside M2. Production rate is 1.

Independent reference experiments, trace tools, result/scoring primitives,
input/event queues and replay envelope validation may proceed while M1 is
unfinished. That prerequisite is now complete, as recorded in [current status](../status.md).
Synthetic inputs must remain explicit fixtures, never an alternative
preparation implementation or evidence of integrated gameplay.

Before integrating each consumer, verify its M1 contract:

| Consumer | Required preparation output |
|---|---|
| Circles/note lock | stable object IDs/order, stacked positions, radius, time and difficulty |
| Sliders | final paths, span timing, child schedules, scoring/legacy marker distinction |
| Spinners | start/end, required spins and maximum bonuses |
| Scoring | complete maximum judgement stream and nested/parent identity |
| Health | difficulty, breaks, timing and combo-end metadata |
| Samples | ordered candidates, component associations and nominal sample times |
| Replay | raw/prepared digest and implemented behavior identity |
| Runtime | immutable shared ownership, descriptors and resource quotas |

Reconcile against M1's completed records before integration. Missing information
remains M1 work. Full M2 acceptance requires M1 A08–A11 and H03/H04, not just local
native/WASM preparation parity.

## Evidence and trace infrastructure

Extend the existing real pinned reference host; preserve checkout verification,
source notices, actual locked restore and fixture hashes. Never generate oracle
values from a reimplementation.

- H05: slider tracking, action lock, child results and cadence differences.
- H06: inclusive/strict boundaries, circle input selection and equal-time edges.
- H07: nested/top-level coincidence, forced misses and health/score delivery.
- H08: signed spinner history, thresholds, interval clipping and sample density.
- H09: drain calibration, break boundaries, result health and failure triggers.
- H10: all result properties, maxima, combo/accuracy, rounding, integer score/rank.
- H11 subset: A20 sample selection, eligibility and requested timestamps. Full
  loop/browser audio acceptance remains M3.

Add canonical trace records for input, judgements, tracking/spinner state,
score/health, sample intent, completion and digests. Shared native/WASM
serialization must retain floating values accurately enough to test boundaries.
Reports include source and fixture hashes, adapter scope, schedule, first
mismatch, nearby events and numeric diagnostics. Component-only observations
must not close whole acceptance scenarios.

Evidence discovered during implementation supersedes incorrect earlier prose:
`HitWindows.ResultFor` classifies offsets through ±400 as Miss, whereas
`DrawableHitCircle` automatically misses when `CanBeHit` becomes false, strictly
after the Meh window. Do not implement the old +400 automatic deadline.

Drain search and failure are separate: the pinned draining processor exempts
bonus judgements and IgnoreHit from default failure checks. H09 must establish
the actual player failure timing before implementing an automatic drain-crossing
failure event; do not assume every zero-health transition immediately fails.

## Implementation sequence

### 1. Production results and standalone scoring

Define stable results and an explicit property table. Cover basic, tick, tail,
bonus, ignored and combo-break results; reject the legacy padding result.
Implement ordered counts, combo/highest combo, accuracy fractions, combo/bonus
portions, normalized score, midpoint-even rounding and rank. Include the
failure-triggering judgement and suppress subsequent score changes.

Use the same accumulator for perfect maxima and actual play. Integrate maximum
stream generation only after M1 provides complete components; follow pinned
upstream enumeration order rather than an object-count approximation.

### 2. Session arenas, scheduler and input

Follow the architecture dependency table. Session state owns mutable object and
component outcomes, queued inputs, schedule cursors, score/health, replay cursor,
recording/checkpoints and pending outputs. Runtime remains a thin transport.

Allocate during creation/reserve using checked sizing and quotas. Advance,
snapshot and reset must not allocate or grow memory. Order events by ADR-002's
`(time, phase, topLevelIndex, componentIndex, inputSequence)`; inputs have no
selected target until dispatch and retain sequence order. Apply input edges
before equal-time automatic deadlines.

Validate whole batches before publication: records/spans/tokens, finite values,
known actions/flags, sequence and time order, clock conversion, lateness and
capacity. Retain future inputs. Live cursor is sample-and-hold; replay cursor
interpolates with stepwise actions. No fixed-millisecond or RAF judgement loop.

Reserve capacity for complete transition groups before commitment. Preserve
undrained outputs until acknowledged; capacity errors cannot lose, duplicate or
half-apply a judgement. Resolve same-committed-time input admission in the
session phase contract before exposing production inputs.

### 3. Circle, slider and spinner rules

Circles: exact windows/radius, held versus press edges, one head per edge, default
note lock, forced-miss order and simultaneous heads. Test actual drawable/policy
behavior beyond the standalone hit-window predicate.

Sliders: head accuracy, acquisition/expanded follow radius, loss/recovery, action
ownership/release rules, late-head catch-up, child deadlines, repeats, tail and
parent completion. Consume M1 geometry/schedules without rebuilding them. Keep
legacy markers and Classic fraction scoring out of default scoring.

Spinners: preserve source-specific arithmetic, signed history, centre/angle wrap,
start/end clipping, held-action gating, tick/bonus emission and exact final
thresholds. Sparse endpoints cannot reconstruct missing revolutions; use H08 to
validate recording/subdivision density and document limitations.

### 4. Health, completion, samples and snapshots

Calibrate drain during creation from the verified perfect result stream. Port
search precision/convergence and derive no-drain intervals from pinned evidence.
Integrate health over semantic boundaries independently of render requests.
Wire result health before score, apply combo-end bonuses, and freeze terminal
results after pass/failure/abort. Verify the player-level failure trigger with
H09 before implementing its event.

Resolve prepared candidates using a validated, frozen availability table. Emit
eligible one-shots with selected asset, requested time and epoch, including a
future nominal-tail request. Missing candidates fall through to silence with a
diagnostic. Maintain logical loop/voice/epoch state without owning audio nodes.

Readonly state exposes committed outcomes/timestamps, slider tracking, spinner
progress, HUD score/health and session status. Snapshot sampling must neither
judge nor duplicate one-shots. M3 owns animation and draw-command generation.

### 5. Replay, checkpoints and runtime integration

Validate replay v2 identity, supported profile/coordinates, raw/prepared hashes,
clock metadata, checksum, frame order/actions and quotas before playback. Keep
frames beatmap-relative and the mod list empty. Canonical serialization never
includes pointers, padding or native allocation sizes.

Record action transitions, important judgement frames, spinner samples and
hold-preserving frames where necessary. Demonstrate live-record-export-import
result equality; interpolation must not silently change live judgements.

Checkpoints contain the complete mutable session, including action locks,
spinner history, event/replay cursors, health/score and digest state. Use bounded
storage and restore/resimulate, not inverse judgements. Seeking creates a fresh
output epoch and suppresses historical one-shots; checkpoint caches are excluded
from replay identity.

Expose explicit ready/start/running/pause/resume/terminal/reset transitions,
replay load/export/seek, availability submission and output reserve/drain/ack.
Extend ADR-005, ABI records and generated Odin/C/TypeScript bindings together.
Preserve foundation behavior, checked handles/spans, retained map ownership and
transactional errors. Advertise only implemented capabilities; M3 drawing and
WebGL remain unavailable. Headless silent fixtures use explicit diagnostics.

## Validation and milestone completion

- Exact and adjacent representable rule boundaries; note-lock ordering; slider
  action/radius/child cases; spinner thresholds/reversal/density/bonuses.
- Every result property, perfect maxima, nested counts, normalized integer
  scores, rounding, rank, HP0/5/10, breaks and failure-triggering results.
- Direct-final and event stepping, 30/60/120/144 Hz, and 50/100/250 ms stalls
  before/at/after critical events. Require exact native/WASM discrete traces.
- Whole/split input batches, late/malformed rejection, future retention, output
  capacity retries, replay corruption/identity rejection and checkpoint seeks.
- Four shared sessions, failed create/reserve/import, external map release,
  reset/disposal, stale handles, WASM growth and allocation failure. Prove hot
  paths allocate nothing.
- Preserve upstream tolerances: health 1e-9, spinner rotation 1e-4 degrees, audio
  requested time 0.25 ms. Discrete results/order/counts/score remain exact; report
  bias and classify observed frame dependence without widening tolerances.

Run the existing engine suite plus the extended pinned comparisons in CI.
Measure event workload, creation/calibration/advance time, live/peak arena bytes,
output/checkpoint high water and WASM pages using dense, long and 10,000-object
fixtures. No elapsed-millisecond workload is allowed.

Complete A13–A20 and A23, resolve/classify H05–H10 and the required A20 sample
observations, and retain no unexplained discrete differences. Publish executed
checks and remaining M3 boundaries in the implementation report. Local parity,
standalone primitives and a passing synthetic oracle subset do not complete M2.

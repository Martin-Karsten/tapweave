# Traceability matrix

M0 rows below describe the tested foundation matrix; the [M0 report](../status.md) and [hashed findings](../../engine/reference/findings/m0.json) define its bounded coverage. M1 rows link to the complete-preparation findings. M2 has independent component evidence and locally tested [headless sessions](../status.md#m2-headless-sessions); whole-scenario upstream acceptance remains open.

`unsupported` means the current engine does not implement that capability; design descriptions are not implementation evidence.

| ID | Behavior | Pinned evidence | Odin today | Known deviation | Acceptance |
|---|---|---|---|---|---|
| FMT-01 | v1–14/v128 defaults and <5 offset | `LegacyDecoder`, `LegacyBeatmapDecoder`, encoder | M0 matrix passes on the supported-version projection | explicit version/header policy; supported-version policy | A01–A04 exact on supported projection; documented policy deviations excluded |
| FMT-02 | malformed numeric/sections | decoder + parsing tests | M0 matrix passes | transactional rejection differs from upstream partial-map recovery | A05 exact error code/line |
| CP-01 | coincident control-point precedence | `LegacyBeatmapDecoder.add/flushControlPoints` | M0 H02 matrix passes on the bounded permutation set | bounded permutations and replacement fixtures | A06 permutation dump exact on covered permutations |
| CP-02 | sample/difficulty fallback | `LegacyControlPointInfo` | M0 H02 query matrix passes | final sample candidates pass the M1 projection | A07 exact selected IDs |
| GEO-01 | Path types and mixed segments | `SliderPath`, framework `PathApproximator` | M1 H03 passes | bounded synthetic/upstream corpus; existing numeric tolerances | A08 |
| GEO-02 | Declared lengths and degeneracy | `SliderPath.calculateLength` | M1 H03 passes | upstream duplicate-tail behavior preserved | A09 |
| OBJ-01 | Stable order, combo and old/modern stacking | decoder, `OsuBeatmapProcessor` | M1 projection passes | source IDs retained; spinner handling matches each algorithm | A10 |
| OBJ-02 | Slider/spinner components and markers | `Slider`, `Spinner`, `SliderEventGenerator` | M1 H04 passes except documented canonicalisation | zero-duration legacy-marker progress canonicalised to 0 | A11 exact except canonicalised marker |
| IN-01 | 512×384 coordinate inverse | playfield adjustment | native/WASM and browser coordinate checks | physical/gameplay input integration open | A12 point round-trip ≤1e-6 |
| IN-02 | inclusive windows | `OsuHitWindows`, `HitWindows` | headless integration; local regressions | full upstream scenario gate open | A13 ±boundary and next float exact result |
| IN-03 | equal-time/start-time note lock | policy + tests | headless integration; local regressions | full upstream scenario gate open | A14 exact judgement sequence |
| SL-01 | tracking loss/recovery/action lock | `SliderInputManager` + tests | headless integration; local regressions | full upstream scenario gate open | A15 discrete results exact; history classified |
| SP-01 | spinner requirement/history/result | spinner sources/tests | headless integration; local regressions | full upstream scenario gate open | A16 exact spins/ticks/results; rotation tolerance |
| SC-01 | result properties/combo/accuracy | `HitResult`, `ScoreProcessor` | headless integration; local regressions | full upstream scenario gate open | A17 exact counts/combo/accuracy |
| SC-02 | lazer normalized score | `ScoreProcessor` | headless integration; local regressions | full upstream scenario gate open | A18 exact integer totals |
| HP-01 | drain search/result health/fail | health processors | headless integration; local regressions | full upstream scenario gate open | A19 result/fail exact; health tolerance |
| AU-01 | Sample lookup and tail timing | decoder/sample/slider sources | M1 candidate/tail projection passes (preparation scope) | headless one-shot intent implemented locally; playback/H11 gate open | A20 remains M2: projection pass is not acceptance |
| AU-02 | loops/music/pause/resume | drawable slider/spinner + framework audio | W05 services and W07 lifecycle integrated; local regressions | physical output and full H11 acceptance open | A21 timing/lifecycle integration within the zero-offset production profile (any nonzero profile needs the clock/creation extension in the browser plan) |
| AU-03 | combo-break (`Gameplay/combobreak`) sample | `ComboEffects`, `DrawableHitObject`, `OsuConfigManager` | upstream trigger pinned (combo zero after >20 or first break with `AlwaysPlayFirstComboBreak` default true; skipped while rewinding/sample playback disabled) | not implemented: no engine one-shot, no global/skin sample binding (kind-28 is per-object), no browser fallback | open until ABI gains a global sample slot, engine emission and a synthesized fallback exist; no acceptance claimed |
| PR-01 | preempt/fade/slider progress | pinned drawable adapter + snaking test port | mixed scenes and WebGL2 executor; bounded clipping comparisons | spinner differences and nested/cursor/follow feedback evidence open | A22 remains open |
| RP-01 | recording/interpolation/actions | replay recorder/handler | headless integration; local regressions | full upstream scenario gate open | A23 replay schedule matrix exact |
| MEM-01 | replacement/reset/disposal | design quotas; spike lifecycle tests | M0 native/WASM ownership matrix passes (foundation scope) | browser asset/context lifetimes remain M3 | A24 leak/high-water/repeated load (foundation scope passes; complete row including browser resources stays open) |
| ABI-01 | typed versioned lifecycle | `interface-v2.md` | M0 versioned lifecycle/C/WASM matrix passes | explicit foundation/preparation/headless session capabilities; integrated conformance added | A25 native/WASM conformance |

All source symbols named without links above are linked in the corresponding reference chapter. Machine-readable test results must include these IDs so coverage can be computed without parsing Markdown.

## Matching policy

- **Exact:** object/component order and IDs, control-point selection, child type/timestamps when upstream produces integral/deterministic values, judgement type/order, combo/counts, integer score, failure result, sample candidate order, lifecycle/error codes, and native/WASM outputs.
- **Numeric tolerance:** path vertices `max(1e-4 osu! px, 4 ULP of reference f32)`, cumulative path length `1e-4 px`, position transforms `1e-6 osu! px`, health `1e-9`, spinner total rotation `1e-4°`, audio scheduling request `0.25 ms`. A tolerance is not permission for systematic bias; mean signed error is reported.
- **Frame-dependent:** slider tracking transition times, spinner visual damping, and animation samples obtained from drawable update schedules. Compare invariants and envelopes with direct event-boundary stepping and presentation requests at 30/60/120/144 Hz, injecting 50/100/250 ms stalls before/between/after critical events (the schedule/stall matrix in [reference-harness](reference-harness.md#schedule-and-stall-matrix)); do not turn one cadence into a universal oracle.

If an exact field fails but the source establishes genuine frame dependence, change its classification only by adding a documented experiment result and ADR amendment. The input delivery-time difference for scenario selected fields has been reclassified this way: the executed delivery diagnostic plus the [ADR-002 M3 amendment](../architecture/adr-002-scheduling.md#m3-input-delivery-divergence) record it as an accepted deterministic divergence, and only findings whose differences the diagnostic eliminated carry `divergence_disposition: 'accepted-input-delivery'`.


## M0 observations and policies

The real pinned decoder produced 83 H01/H02 observations: 65 exact matches for the selected M0 fields and 18 explicit policy findings, with no unexplained differences. The selected fields include defaults/metadata/difficulty, raw object positions and combo flags, breaks, resolved points and 512 query-time records. Native/WASM traces match across 88 fixtures. Fixture and observation hashes, both source commits, dependency-lock digest and local error expectations are retained in the finding index.

The four unsupported-version fixtures, missing-header fallback, hold-object scope, and twelve malformed-line fixtures are **not** exact upstream matches. Upstream can accept unsupported version values or a missing header and can swallow line exceptions; Tapweave's documented profile rejects those candidates transactionally. Upstream exception types/line text are recorded independently from Tapweave status/code/location. None of these observations certifies M1 path/duration/stacking/sample-candidate behavior or later gameplay.

## M1 observations

The [M1 findings](../../engine/reference/findings/m1.json) retain complete-map
H03/H04 observations, per-fixture hashes, classifications, numeric error summaries,
local lifetime/ABI evidence and stage measurements. The separate geometry runner
covers explicit typed paths; the integrated runner also exercises raw legacy path
conversion and final optimised paths. Byte-identical native/WASM traces and binary
digests are a separate check from the pinned upstream projection.

## Gameplay evidence

The [component findings](../../engine/reference/findings/m2-primitives.json) retain
pinned result/scoring, hit-window, forward spin-history and drain-calibration
subsets. [Correction probes](../../engine/reference/findings/m2-session-corrections.json)
cover result minima, framework replay interpolation and repeated-slider positions.
H06 predicates do not establish circle/note-lock dispatch; H08 history does not
establish complete spinner judgement; H09 calibration does not establish failure.

The [session findings](../../engine/reference/findings/m2-sessions.json) retain
local production ABI, cadence, ownership, replay and one-shot regressions.
These findings do not close whole A13–A20/A23 scenarios. The
[reference harness](reference-harness.md#remaining-gameplay-adapters) tracks missing
whole-drawable/player entry points.

## Browser evidence

The [browser session findings](../../engine/reference/findings/m3-browser-sessions.json)
retain coordinate conversion, session/replay/lifecycle checks and local synthetic
cadence/stall evidence. The [output findings](../../engine/reference/findings/m3-output-transport.json)
cover diagnostic/compact parity across 34 schedules, independent projection/journal
lifetimes and a 10,000-object active-work regression. These are local transport
checks; the existing 72 pinned component comparisons add no whole-session oracle.

A12 requires physical/gameplay input integration. A21/A22 and H11 remain open;
mock audio and a preparation shell do not establish audio-backed gameplay. See
[current status](../status.md) for implemented coverage and validation limits.

## Bounded gameplay backfill evidence

[Gameplay findings](../../engine/reference/findings/m2-gameplay-backfill.json)
map 116 integrated fixtures to A13–A20/A23, including pinned test methods and
source-derived boundary cases. They also retain 36 added health component cases
and two local workloads. These supplement the rows above without closing their
full scenario gates. [Coverage and adaptations](gameplay-tests.md) distinguish
ordered drawable results, real Player health/failure, recorder action assertions,
discrete audio delivery, local cadence invariance and remaining browser work.


## Mixed-scene presentation increment

[Scene findings](../../engine/reference/findings/m3-scene-presentation.json) map
`TestSceneSliderSnaking.TestSnakingEnabled(0,1,2)` to the native/WASM
`scene_snaking_enabled_upstream_assertion_port` and record the pinned test search.
The real drawable adapter executes 96 schedule cases with default snaking enabled;
visible slider clipping and ball positions match in the compared cases, while
spinner-motion progress and post-stall tracking differences were unresolved at
that increment. The [correction investigation](scene-corrections.md) repairs the
adapter layout and closes those bounded findings with 128 runs / 81,528
comparisons: zero unexplained differences, 1,150 raw progress/rotation sampling
differences and 12 raw tracking-feedback differences under explicit ADR-002
dispositions. The original index stays unchanged. Inputs use declared delivery updates, so
these comparisons do not establish original receipt-time gameplay equivalence.

[Local renderer findings](../../engine/reference/findings/m3-renderer.json) retain
report/source hashes and unapproved workload measurements. Local scene tests cover
immutable attachment failure/ownership, degeneracies,
legacy contract preservation, mixed instance/resource parity, repeated/backward
reads, four-session sharing, and browser frame rejection/recovery. Original glyphs,
cursor trail sampling and unsmoothed repeat-arrow orientation are presentation
policies, not upstream matches. Complete child transforms, tracking feedback,
follow points, HUD, graphics coverage and measured limits remain A22/W04 gates.


## W07 lifecycle evidence

The [lifecycle findings](../../engine/reference/findings/m3-lifecycle.json) link
production-WASM controller, Chromium UI/recovery tests and the executed pinned
Player failure adapters. A19 has selected HP0/5/10 source-derived comparisons;
A21/A23/A24 have bounded local lifecycle evidence. The six pinned osu!standard pause-input methods are now executed by the
[resume host](pause-resume.md); complete pause UI coverage,
physical input/audible output and the complete release/resource matrix remain
open. Play exposes a validation build, not an assertion that these rows pass.

## Original private rooms with local maps

[MP-01–MP-11](multiplayer.md) track the original social coordination contract.
These checks do not close any lazer gameplay compatibility row. Physical public
two-device/audio-output acceptance remains separate.

# Traceability matrix

M0 rows below describe the tested foundation matrix; the [M0 report](../status.md) and [hashed findings](../../engine/reference/findings/m0.json) define its bounded coverage. M1 rows link to the complete-preparation findings. Later milestones remain unimplemented.

`unsupported` means the current engine does not implement that capability; design descriptions are not implementation evidence.

| ID | Behavior | Pinned evidence | Odin today | Known deviation | Acceptance |
|---|---|---|---|---|---|
| FMT-01 | v1–14/v128 defaults and <5 offset | `LegacyDecoder`, `LegacyBeatmapDecoder`, encoder | M0 matrix passes | explicit version/header policy; supported-version policy | A01–A04 exact prepared fields/errors |
| FMT-02 | malformed numeric/sections | decoder + parsing tests | M0 matrix passes | transactional rejection differs from upstream partial-map recovery | A05 exact error code/line |
| CP-01 | coincident control-point precedence | `LegacyBeatmapDecoder.add/flushControlPoints` | M0 H02 matrix passes | bounded permutations and replacement fixtures | A06 permutation dump exact |
| CP-02 | sample/difficulty fallback | `LegacyControlPointInfo` | M0 H02 query matrix passes | final sample candidates pass the M1 projection | A07 exact selected IDs |
| GEO-01 | Path types and mixed segments | `SliderPath`, framework `PathApproximator` | M1 H03 passes | bounded synthetic/upstream corpus; existing numeric tolerances | A08 |
| GEO-02 | Declared lengths and degeneracy | `SliderPath.calculateLength` | M1 H03 passes | upstream duplicate-tail behavior preserved | A09 |
| OBJ-01 | Stable order, combo and old/modern stacking | decoder, `OsuBeatmapProcessor` | M1 projection passes | source IDs retained; spinner handling matches each algorithm | A10 |
| OBJ-02 | Slider/spinner components and markers | `Slider`, `Spinner`, `SliderEventGenerator` | M1 H04 passes | zero-duration legacy-marker progress canonicalised to 0 | A11 |
| IN-01 | 512×384 coordinate inverse | playfield adjustment | unsupported | later milestone | A12 point round-trip ≤1e-6 |
| IN-02 | inclusive windows | `OsuHitWindows`, `HitWindows` | unsupported | later milestone | A13 ±boundary and next float exact result |
| IN-03 | equal-time/start-time note lock | policy + tests | unsupported | later milestone | A14 exact judgement sequence |
| SL-01 | tracking loss/recovery/action lock | `SliderInputManager` + tests | unsupported | later milestone | A15 discrete results exact; history classified |
| SP-01 | spinner requirement/history/result | spinner sources/tests | unsupported | later milestone | A16 exact spins/ticks/results; rotation tolerance |
| SC-01 | result properties/combo/accuracy | `HitResult`, `ScoreProcessor` | unsupported | later milestone | A17 exact counts/combo/accuracy |
| SC-02 | lazer normalized score | `ScoreProcessor` | unsupported | later milestone | A18 exact integer totals |
| HP-01 | drain search/result health/fail | health processors | unsupported | later milestone | A19 result/fail exact; health tolerance |
| AU-01 | Sample lookup and tail timing | decoder/sample/slider sources | M1 candidates/tail preparation passes | runtime sound intent and playback remain unsupported | A20 remains M2 |
| AU-02 | loops/music/pause/resume | drawable slider/spinner + framework audio | unsupported | later milestone | A21 timing/lifecycle integration |
| PR-01 | preempt/fade/slider progress | drawable sources | unsupported | later milestone | A22 sampled state tolerance |
| RP-01 | recording/interpolation/actions | replay recorder/handler | unsupported | later milestone | A23 replay schedule matrix exact |
| MEM-01 | replacement/reset/disposal | design quotas; spike lifecycle tests | M0 native/WASM ownership matrix passes | browser asset/context lifetimes remain M3 | A24 leak/high-water/repeated load |
| ABI-01 | typed versioned lifecycle | `interface-v2.md` | M0 versioned lifecycle/C/WASM matrix passes | explicit foundation/preparation capabilities; gameplay unsupported | A25 native/WASM conformance |

All source symbols named without links above are linked in the corresponding reference chapter. Machine-readable test results must include these IDs so coverage can be computed without parsing Markdown.

## Matching policy

- **Exact:** object/component order and IDs, control-point selection, child type/timestamps when upstream produces integral/deterministic values, judgement type/order, combo/counts, integer score, failure result, sample candidate order, lifecycle/error codes, and native/WASM outputs.
- **Numeric tolerance:** path vertices `max(1e-4 osu! px, 4 ULP of reference f32)`, cumulative path length `1e-4 px`, position transforms `1e-6 osu! px`, health `1e-9`, spinner total rotation `1e-4°`, audio scheduling request `0.25 ms`. A tolerance is not permission for systematic bias; mean signed error is reported.
- **Frame-dependent:** slider tracking transition times, spinner visual damping, and animation samples obtained from drawable update schedules. Compare invariants and envelopes across 30/60/144 Hz plus stalls; do not turn one cadence into a universal oracle.

If an exact field fails but the source establishes genuine frame dependence, change its classification only by adding a documented experiment result and ADR amendment.


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

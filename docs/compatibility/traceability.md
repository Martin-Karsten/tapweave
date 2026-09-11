# Traceability matrix

Status values: `spike` means partially present only in the historical engine; `none` means not present; `design` means specified here but not implemented.

| ID | Behavior | Pinned evidence | Odin today | Known deviation | Acceptance |
|---|---|---|---|---|---|
| FMT-01 | v1–14/v128 defaults and <5 offset | `LegacyDecoder`, `LegacyBeatmapDecoder`, encoder | v14 spike | historic/lazer-native branches absent | A01–A04 exact prepared fields/errors |
| FMT-02 | malformed numeric/sections | decoder + parsing tests | partial | policy/caps differ | A05 exact error code/line |
| CP-01 | coincident control-point precedence | `LegacyBeatmapDecoder.add/flushControlPoints` | partial | not exhaustive | A06 permutation dump exact |
| CP-02 | sample/difficulty fallback | `LegacyControlPointInfo` | partial | before-first gaps | A07 exact selected IDs |
| GEO-01 | four path types/segments | `SliderPath`, framework `PathApproximator` | spike | independent Bézier; mixed rejected | A08 vertices tolerant, length/end exact/tolerant |
| GEO-02 | declared-length adjustment/degeneracy | `SliderPath.calculateCumulativeLength` | spike | narrow fixture set | A09 path corpus |
| OBJ-01 | stable sort/combo/stacking v<6 and >=6 | decoder, `OsuBeatmapProcessor` | partial | modern only/coverage gap | A10 exact order/stack heights |
| OBJ-02 | slider children/tail -36 ms | `Slider`, `SliderEventGenerator` | spike | incomplete markers | A11 exact child kind/time/order |
| IN-01 | 512×384 coordinate inverse | playfield adjustment | demo | resize/shift incomplete | A12 point round-trip ≤1e-6 |
| IN-02 | inclusive windows | `OsuHitWindows`, `HitWindows` | circles | local boundaries only | A13 ±boundary and next float exact result |
| IN-03 | equal-time/start-time note lock | policy + tests | spike | forced-miss order unverified | A14 exact judgement sequence |
| SL-01 | tracking loss/recovery/action lock | `SliderInputManager` + tests | spike | fixed 1 ms approximation | A15 discrete results exact; history classified |
| SP-01 | spinner requirement/history/result | spinner sources/tests | none | unsupported | A16 exact spins/ticks/results; rotation tolerance |
| SC-01 | result properties/combo/accuracy | `HitResult`, `ScoreProcessor` | experimental | wrong production meaning | A17 exact counts/combo/accuracy |
| SC-02 | lazer normalized score | `ScoreProcessor` | none | absent | A18 exact integer totals |
| HP-01 | drain search/result health/fail | health processors | none | absent | A19 result/fail exact; health tolerance |
| AU-01 | sample lookup and tail timing | decoder/sample/slider sources | spike | missing full fallback and loops | A20 exact candidate/event sequence |
| AU-02 | loops/music/pause/resume | drawable slider/spinner + framework audio | none | absent | A21 timing/lifecycle integration |
| PR-01 | preempt/fade/slider progress | drawable sources | demo subset | no full presentation | A22 sampled state tolerance |
| RP-01 | recording/interpolation/actions | replay recorder/handler | spike envelope | incomplete identity/results | A23 replay schedule matrix exact |
| MEM-01 | replacement/reset/disposal | design quotas; spike lifecycle tests | fixed block | 39.84 MiB/session | A24 leak/high-water/repeated load |
| ABI-01 | typed versioned lifecycle | `interface-v2.md` | packed f64 ABI v1 | unsafe/manual/incomplete | A25 native/WASM conformance |

All source symbols named without links above are linked in the corresponding reference chapter. Machine-readable test results must include these IDs so coverage can be computed without parsing Markdown.

## Matching policy

- **Exact:** object/component order and IDs, control-point selection, child type/timestamps when upstream produces integral/deterministic values, judgement type/order, combo/counts, integer score, failure result, sample candidate order, lifecycle/error codes, and native/WASM outputs.
- **Numeric tolerance:** path vertices `max(1e-4 osu! px, 4 ULP of reference f32)`, cumulative path length `1e-4 px`, position transforms `1e-6 osu! px`, health `1e-9`, spinner total rotation `1e-4°`, audio scheduling request `0.25 ms`. A tolerance is not permission for systematic bias; mean signed error is reported.
- **Frame-dependent:** slider tracking transition times, spinner visual damping, and animation samples obtained from drawable update schedules. Compare invariants and envelopes across 30/60/144 Hz plus stalls; do not turn one cadence into a universal oracle.

If an exact field fails but the source establishes genuine frame dependence, change its classification only by adding a documented experiment result and ADR amendment.

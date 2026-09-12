# Implementation status

M0 (compatibility foundation) and M1 (beatmap preparation) are implemented for
unmodded osu!standard against osu!lazer **2026.804.2**, commit
`3c1c96f742e7aae2ff67a7361e058fe91ca3b955`, and framework **2026.731.0**, commit
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`. Tapweave is not yet playable.
M2 now connects those primitives to prepared maps through headless gameplay sessions.
[Session integration](implementation/m2-sessions.md) is locally validated; full
upstream M2 acceptance and browser gameplay remain open.

## M0: foundation

The owned decoder supports versions 1–14 and 128, defaults, gameplay metadata,
breaks, stable ordering, sample validation and legacy syntax. Control-point
resolution handles coincident precedence, redundancy, fallback, clamping and
NaN tick disabling. ABI v2 provides generation-checked engine/map/session
lifetimes, tokenized inputs, typed failures and transactional candidate creation.

The [M0 findings](../engine/reference/findings/m0.json) retain 83 real H01/H02
observations: 65 exact projected-record matches and 18 explicit policy findings,
including 512 query-time records. The local suite covers 88 byte-identical
native/WASM decoder traces and A01–A07/A24–A25.

Tapweave deliberately rejects unsupported headers/versions/rulesets and malformed
maps as a whole. Upstream can accept additional versions, infer a missing header,
and recover after line errors. These differences are recorded as policies, not
exact compatibility. M0 foundation mode remains available with map flag `1`.

## M1: preparation

Map flag `2` now constructs an immutable prepared map containing:

- Difficulty inputs and derived scale, radius, preempt and fade times.
- Linear, perfect, Catmull, Bézier/B-spline and mixed paths, cumulative lengths,
  declared-length adjustment, repeat collapse and precision-preserving queries.
- Velocity, span duration, ticks, repeats, legacy-last-tick markers, nominal
  tails, spinner requirements and spinner component schedules.
- Resolved sample properties and ordered lookup candidates for objects, nodes,
  ticks, tails and auxiliary sounds; no audio resources are loaded.
- Combo processing and old/modern stacking, including negative slider-end
  stacks and the upstream spinner behavior in each algorithm.
- Stable source object IDs, per-object component IDs, an ordered timeline,
  behavior-bound SHA-256 identity and a versioned binary description.

Preparation version 2 additionally owns and exposes breaks, resolved control
points and playback settings. The binary descriptor appends those records without
moving existing fields. Identity uses an explicit canonical binary writer and the
`prepared-v2` profile, with a fixed golden; it no longer depends on reflected JSON.
Integer overflow and whitespace regressions, complete ABI scalar checks, and
standalone prepared-data lifetime/work-budget tests accompany the review fixes.

Raw legacy slider paths and final optimised Catmull paths are computed separately
where upstream uses them for different timing/sample decisions. A duplicate final
path vertex can prevent extension. These are compatibility behaviors, not
simplifications chosen by the port.

The [M1 findings](../engine/reference/findings/m1.json) record the executed
H03/H04 comparisons, fixture/observation/lock hashes, numeric error summaries and
native per-stage time/memory measurements. The matrix includes **101 complete-map
fixtures**, of which **11 are pinned upstream test beatmaps**, plus the separate
**74-case geometry matrix** and four local geometry failure cases. Complete-map
JSON and binary-description digests are byte-identical native/WASM. Comparisons
cover vertices/lengths, timing, sample candidates, nested objects, combo and
stacking. A08–A11 pass for this bounded corpus; this is not a claim about every
beatmap in existence.

Allocation-tracked tests inject failure at each map allocation, exercise exact
quota boundaries and duration limits, and verify digest stability and retained-map
lifetimes. Native C and WASM readers validate the generated layouts. WASM checks
cover typed spans, failed replacement, memory growth, shared sessions, reset,
disposal and stale handles. The existing 50-cycle/four-session lifecycle matrix,
4,000 resets and deliberate memory-ceiling failure remain part of the suite.

## M2: independent primitives

The M2 worktree has been integrated into main. It adds explicit result properties,
standalone scoring and drain calibration, hit-window and forward spinner-history
primitives, bounded event/input queues, and replay validation/interpolation/codec.
They are now connected to prepared maps and the production gameplay ABI by the
[headless session integration](implementation/m2-sessions.md).

The [M2 report](implementation/m2.md) records 104 native/WASM primitive fixtures,
including 72 exact pinned component comparisons, with source/fixture/lock hashes.
The suite includes transactional buffer-overlap rejection, framework f32 replay
interpolation and repeated-slider position probes. Overflowing replay intervals
are rejected before state publication.
The 14 allocation-tracked M2 test groups also exercise checksummed malformed
replay payloads and unchanged destinations on rejection.
The [M2 acceptance backlog](implementation/m2-plan.md) tracks whole-scenario
reference adapters, recorder sampling, checkpoint caching and workload measurements.
M1 is complete and its final contracts are consumed by headless sessions. No complete
A13–A20 or A23 acceptance gate is claimed from these component subsets.

## M3: browser foundation and partial W01/W03

The [M3 report](implementation/m3.md) records production-only WASM, shared generated
bindings, local archive/loose loading, transactional difficulty selection, music
cache/transport, bounded shared decoding and independent input/audio services.
The browser bridge exposes headless sessions, replay/results/sample availability
and production coordinate conversion. Review fixes cover cancelled candidates,
ZIP descriptors and audio dispatch recovery.

The [W01 ledger](implementation/m3.md#w01-implementation-ledger--compact-output-and-active-projection)
records compact gameplay output and an arena-backed active projection with
independent output lifetime (kinds 31–34). This is partial W01 and the W03
foundation; object animation, static resources, WebGL2, voice/loop intent and
integrated input/music/lifecycle/results remain work in the [M3 plan](implementation/m3-plan.md).
Play stays disabled; no aggregate gameplay capability is advertised.

Local service, session and Chromium transport checks are retained in the report
and findings. The [contract audit](implementation/m3-contract-audit.md) identifies
missing whole-scenario adapters and remaining protocols. A12/A21/A22, H11 and full
M2 acceptance remain open. Missing Firefox/WebKit executables and installation
timeouts are validation limitations, separate from unfinished implementation.

## Resource contract and limits

Preparation counts output before allocating, builds candidates transactionally,
and hashes canonical fields without a temporary JSON allocation. Scratch is
released before publication; immutable records and their binary description share
the map lifetime. The description duplicates data for a portable ABI representation
and counts against the same map quota. No preparation runs in session reset.

The existing decoder quotas still apply. Preparation additionally bounds each
path to 65,536 control tokens, 100,000 vertices, 64 subdivision frames, and
a shared 100,000,000-unit preparation work budget; a map has at most 1,000,000
components. The budget covers control-point insertion, both preparation passes,
geometry, record/string reservations, node parsing, stacking and schedule sorting. Exhaustion rejects the candidate; it never silently reduces accuracy.
The geometry workspace is reused across objects and count/fill passes. Scratch
sizes use checked aligned reservations, and node lists are parsed once per pass.

A zero-duration slider can produce non-finite progress for upstream's legacy
marker. The canonical profile writes progress `0` for that marker. It is retained
for traceability, excluded from scoring-child comparisons, and is not a gameplay
judgement. Disabled tick distance is encoded as `0` with `generate_ticks=false`.
The preparation schedule describes arrivals/components; integrated M2 sessions
apply the simulation phases and judgement deadlines specified in ADR-002.

Explicit kind-18 gameplay sessions support production simulation, score/health,
replay execution, snapshots and one-shot sample intent. Foundation kind-3 sessions
retain their original ownership-only behavior. Browser rendering and audio playback
remain unsupported. See the [session report](implementation/m2-sessions.md) for limits.
Dynamic-library packaging and integrated browser context-loss recovery are not claimed.
Transactional browser asset replacement is implemented in the M3 foundation.
Validation was executed locally on macOS arm64 with native and WASM builds; CI
results are not implied by this report.

## Reproduce

```sh
npm --prefix engine test
npm --prefix engine run test:reference
npm --prefix engine run test:geometry:upstream
npm --prefix engine run test:prepared:upstream
```

Use the checksum-pinned Odin compiler and Node 24. Upstream runs also require the
[reference host setup](../engine/reference-host/README.md). Generated full traces,
statistics and reports go to ignored `engine/artifacts/`; checked-in finding
indices retain evidence without committing build products.

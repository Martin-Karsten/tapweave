# Implementation status

M0 (compatibility foundation) and M1 (beatmap preparation) are implemented for
unmodded osu!standard against osu!lazer **2026.804.2**, commit
`3c1c96f742e7aae2ff67a7361e058fe91ca3b955`, and framework **2026.731.0**, commit
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`. Tapweave is not yet playable.
Headless gameplay sessions connect preparation to rules, scoring and replay.
Local integration is validated; full upstream M2 acceptance and browser gameplay
remain open.

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

## M2: headless sessions

Prepared-map-backed sessions implement event-driven circles/note lock, default
lazer slider heads/tracking/key restriction/children/early tail, spinner history
and final thresholds, score maxima, normalized score/counts, health calibration,
no-drain intervals, failure freeze and terminal results. Legacy-last-tick markers
are not judged. Health is anchored at semantic judgements to avoid render-rate
rounding differences.

Creation reserves bounded input, state and complete judgement/audio journals in
an arena. Creation failures are transactional; hot paths and reset allocate
nothing. Snapshots expose committed outcomes and HUD state; one-shot samples use
frozen availability and ordered fallback, with explicit missing-sample silence.
See [ABI v2](architecture/interface-v2.md#m2-headless-session-transport) for the
production operations and ownership contract.

Replay records ordinary input/judgement frames and exact-time pause releases.
Playback uses framework f32 interpolation; seeking resimulates from the initial
checkpoint. More frequent bounded checkpoint caching is unimplemented. Input and
recording capacity are fixed at creation; exhaustion rejects batches. Imported
final digests are comparison metadata, not trusted results. Rate is 1, offsets
are zero, and no mods or legacy replay containers are supported.

The [component findings](../engine/reference/findings/m2-primitives.json),
[session findings](../engine/reference/findings/m2-sessions.json) and
[correction probes](../engine/reference/findings/m2-session-corrections.json)
retain source/fixture/lock hashes and evidence classifications. The current
component suite has 104 native/WASM fixtures and 72 pinned comparisons, including
replay-handler interpolation and repeated-slider position probes. Native C/WASM
session tests cover mixed objects across cadences, pause/replay, strict boundaries,
transactional rejection, ownership and output acknowledgement. These are local
session regressions and pinned component evidence, not whole-drawable acceptance.

Full A13–A20/A23 acceptance, recorder sampling and dense/long workload validation
remain open. The [reference harness](compatibility/reference-harness.md#remaining-gameplay-adapters)
identifies the missing whole-drawable/player adapters and observations.

## M3: browser foundation and partial W01/W03

The browser foundation implements production-only WASM, shared generated
bindings, local archive/loose loading, transactional difficulty selection, music
cache/transport, bounded shared decoding and independent input/audio services.
The browser bridge exposes headless sessions, replay/results/sample availability
and production coordinate conversion. Review fixes cover cancelled candidates,
ZIP descriptors and audio dispatch recovery.

The runtime exposes compact gameplay output and an arena-backed active projection
with independent output lifetime (kinds 31–34). This is partial W01 and the W03
foundation; object animation, full static resource generation, WebGL2, voice/loop intent and
integrated input/music/lifecycle/results remain work in the [browser gameplay plan](browser-gameplay.md).
Play stays disabled; no aggregate gameplay capability is advertised.

The [browser session findings](../engine/reference/findings/m3-browser-sessions.json)
and [output findings](../engine/reference/findings/m3-output-transport.json) retain
local service, session and Chromium evidence: 38 service tests, 34 diagnostic/compact
schedules and four Chromium scenarios. These do not establish upstream or audible
output acceptance. The reference harness identifies missing adapters; rendering
and audio ADRs specify remaining protocols. A12/A21/A22, H11 and full
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
remain unsupported in an integrated player.
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

## Current W01–W03 implementation additions

A controlled pinned drawable host now executes six bounded scenarios over 72
cadence/stall runs through actual input, playfield policy, drawable judgement and
score processing. The [scenario findings](../engine/reference/findings/m3-scenarios.json)
record 36 selected result/score/combo matches and 36 differences, retaining actual
update schedules and live-input quantisation. This is additional drawable evidence,
not full Player, replay, health/failure or audio acceptance; W02 remains open.

W01 adds a minimal immutable kind-35 render attachment shared by map/session
owners, transactional publication, native/generated browser validation and
production one-shot admission with acknowledgement retry watermarks. Full dynamic
reserve/draw/voice contracts remain open. The browser admission path still
allocates staging/executor objects, and its late policy is provisional pending H11.

Simulation exposes component and semantic cursor/feedback history independently
of acknowledgement. Per-object sample ranges avoid scanning unrelated objects'
samples on each judgement. Work counters retain input-candidate, predecessor,
tracking and sample-binding visits; input/tracking scans remain to be addressed.
Active projection uses allocation-free heap sorting for adverse reveal bursts.
These are W03 inputs and cost improvements; complete animation, cursor/trail,
follow points and final ordered draw intent remain unimplemented. Play stays off.

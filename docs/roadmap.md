# Validation and implementation roadmap

## Acceptance scenario catalogue

Every scenario runs native and WASM. Discrete traces must be byte-identical; comparison to lazer follows [matching policy](compatibility/traceability.md).

### Decode and preparation

- Minimal maps and every omitted field default; whitespace/BOM/unknown keys.
- Malformed header, numeric overflow/non-finite value, truncated object, invalid type, wrong mode and quota overflow; exact error code/location.
- Format versions 1–14 and 128; rejection of 15–127 and >128; the pre-v5 24 ms offset, v<6 stacking, v128 fractional coordinates, and AR-default-to-OD branches.
- Coincident red/inherited timing permutations, NaN tick-disable marker, before-first sample/difficulty fallback, and ±5/6 ms sample queries.
- Stable source ordering for equal-time objects and correct combo metadata.

### Slider geometry and gameplay

- Linear, perfect, Catmull, Bézier/B-spline and mixed segment markers; repeated/collinear/identical points, invalid arcs, zero-length and 100,000 px boundary.
- Declared path shortening, extension after duplicate tail points, cumulative length/position at 0/1 and segment boundaries.
- Modern/old stacking including slider-end negative stacks and spinners.
- Repeats 1/2/many, ticks near tail, NaN disabled ticks, legacy-last-tick, reverse progress and nominal tail.
- Head early/late/miss; tracking acquisition, expanded radius, loss/recovery, left/right switch lock, held key, late-head catch-up, strict exact child deadlines and tail aggregate fractions.

### Circles, input, spinner, score and health

- Every ±Great/Ok/Meh boundary and adjacent representable value; ±400 user-result and strict post-Meh automatic miss boundaries; clicks outside radius.
- Equal-time circles and inputs, one edge/multiple overlaps, skipped note force-miss, held buttons and source ordinal ties.
- Spinner zero/partial/exactly 75%/above 75%/exactly 90%/above 90%/complete/bonus, direction reversal, dead-centre movement, 180° crossing, rate adjustment and varied input sample density.
- Synthetic result sequences for every result property, combo break/increase, accuracy, midpoint rounding, max simulation, rank, bonus >1M.
- HP0/5/10, breaks, combo-end bonuses, drain calibration, health crossing zero and no post-failure score mutation.

### Replay and scheduling

- Record/export/import/identity mismatch/corruption/unknown capability. Legacy `.osr` conversion with Classic insertion is deferred to M5/H12.
- Direct advance and 30/60/120/144 Hz rendering; 50/100/250 ms injected stalls at input, tick, tail, spinner and completion boundaries.
- Checkpoint seek before/at/after a judgement; replay final digest unchanged.
- Late live input rejects transactionally; inputs batched before an advance remain on their receipt timestamp.

### Browser/audio/lifecycle

- Pause/resume input and the cursor gate are implemented with bounded upstream
  evidence; see [the current contract](compatibility/pause-resume.md). Complete
  audio/device acceptance still includes offset components positive/negative,
  music seek, focus loss/reacquire, context suspend and rate.
- Missing music, missing hitsound with fallback/silence, early tail future sample, slider/spinner loop toggles, scheduling stall and epoch cancellation.
- Repeated loads, failed replacement, small↔large maps, four sessions sharing a map, reset/dispose, WebAssembly memory growth, stale typed views, context loss and asset release.

### Workloads and measurement

Use tiny boundary fixtures, representative ranked-map corpus, long sliders/spinners, a 10,000-object quota-edge synthetic map, dense simultaneous streams, and a three-minute mixed replay. Report cold/warm download+instantiate+prepare separately. During sustained play report simulation, presentation, tessellation, WASM/JS bridge, JS WebGL submission, GPU time when available, audio schedule lateness/drift, RAF distribution, live/peak arena bytes, WASM pages, JS heap and GPU/decoded asset estimates. Never collapse these into one “engine time.”

## Ordered backlog

### M0 — Compatibility foundation

Status: the scoped M0 foundation matrix passes (the H01/H02 83-observation run over 88 fixtures defined in [traceability](compatibility/traceability.md#m0-observations-and-policies)); see the [implementation report](status.md) for executed native/WASM lifecycle checks, pinned H01/H02 observations and classified policy differences. This does not complete gameplay or browser-resource acceptance.

Prerequisites: pinned checkouts/licences and schema tooling.

Deliverables: source-manifest verifier; executable H01/H02 reference host; trace schema/diff tool; two-pass decoder v1–v14 and v128; typed errors/quotas; integrated map/session arenas; ABI handle table; standalone production regression job (historical spikes remain local).

Exit criteria: A01–A07, A24–A25 pass at M0 foundation scope (browser asset/context lifetimes remain M3/M4 work); H01/H02 completed; no leak across lifecycle matrix; exact native/WASM decoder records; every claim carries commit and fixture hash.

### M1 — Beatmap preparation

Status: implemented. The [status report](status.md) records A08–A11/H03–H04
comparisons over synthetic and pinned upstream fixtures, native/WASM parity,
transactional ownership, quotas and stage measurements.

Prerequisites: M0 trace/diff and immutable prepared storage.

Deliverables: all control points/sample candidates; exact framework path algorithms; declared-length handling; slider event generation; v<6/modern stacking; circle/slider/spinner prepared records; prepared digest.

Exit criteria: A08–A11 pass on the bounded generated and upstream corpus defined in [status](status.md)/[traceability](compatibility/traceability.md) (101 complete-map fixtures, 11 pinned upstream beatmaps) — not a claim about every beatmap; H03/H04 resolved; no unexplained geometry failure outside tolerance; preparation fits default quotas and reports per-stage time/memory.

### M2 — Complete unmodded simulation and scoring

Status: [headless sessions and their primitives](status.md#m2-headless-sessions) are implemented. Full upstream M2 acceptance remains open.
Remaining work: [remaining adapter work](compatibility/reference-harness.md#remaining-gameplay-adapters).

Prerequisites: M1 objects/schedules and result tables.

Deliverables: event scheduler; input/note lock; circle/slider/spinner state machines; production result enum; score/max simulation; health/drain/failure; replay v2/checkpoints; complete final results and sample intent.

Exit criteria: A13–A20 and A23 pass; H05–H10 resolved/classified; exact discrete native/WASM traces at every schedule/stall; no 1 ms loop; spinner and failure scenario coverage; replay identity rejects incompatible profiles.

### M3 — Odin presentation and browser runtime

Status: [browser foundation plus W04/W06/W07 validation-player increments](status.md#m3-browser-foundation-and-partial-w01w03) are implemented, with the W07 player UI shipped as the [Solid product shell](status.md#product-shell-adr-006-s0b-promotion); W08–W10, full M3 acceptance and release-browser certification remain open.
Implementation sequence: [browser gameplay plan](browser-gameplay.md).

Prerequisites: M2 readonly snapshot API and audio intent.

Deliverables: presentation state/animation curves; WebGL2 command generation/executor; static slider meshes/atlas; DOM input mapping; archive/assets; Web Audio music, samples and loops; pause/resume/focus/context loss; playable results UI sufficient for validation.

Exit criteria: A12, A21–A22 pass; H11 complete; real mouse/keyboard/touch and audio-backed play in current Chrome/Firefox/Safari desktop release matrix; zero gameplay-trace difference across render rates; p99 bridge/audio/frame metrics recorded without threshold regressions from an approved baseline.

### M4 — Integration hardening

Prerequisites: M3 complete browser path and representative licensed corpus.

Deliverables: fuzzing, fault injection, compatibility dashboard, asset/memory eviction, telemetry hooks, accessibility/control settings, packaging/cache headers, long soak and cross-browser automation.

Exit criteria: 10,000 corpus maps prepare or fail only with classified supported errors; 8-hour repeated-load/play soak has bounded live memory; context/audio/focus recovery passes; no severity-1 unresolved compatibility issue; all traceability rows green or carry an accepted, tested deterministic divergence.

### M5 — Deferred compatibility features

Classic first, then rate/difficulty mods, legacy replay verification, skins/storyboards, remaining mods, difficulty attributes and pp. Each is a behavior-profile or presentation capability with its own trace matrix; none blocks unmodded M4. M5 is deferred scope: it does not move mods into the unmodded M0–M4 target, and `.osr` Classic insertion applies only to the legacy-import profile.

# Implementation status

M0 (compatibility foundation) and M1 (beatmap preparation) are implemented for
unmodded osu!standard against osu!lazer **2026.804.2**, commit
`3c1c96f742e7aae2ff67a7361e058fe91ca3b955`, and framework **2026.731.0**, commit
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`. Tapweave now has an integrated browser validation player.
Headless gameplay sessions connect preparation to rules, scoring and replay.
Local integration is validated; full upstream M2/M3 acceptance and release-browser
certification remain open. The W07 section below supersedes earlier increment
statements that product Play is disabled: the M3, W04, W06 and mixed-scene
sections describe their increments, in which Play stayed disabled; W07 exposes
Play in the validation build.

## M0: foundation

The owned decoder supports versions 1–14 and 128, defaults, gameplay metadata,
breaks, stable ordering (deterministic sort order, not osu!stable), sample validation and legacy syntax. Control-point
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
component suite has 140 native/WASM fixtures and 108 pinned comparisons, including
replay-handler interpolation and repeated-slider position probes. Native C/WASM
session tests cover mixed objects across cadences, pause/replay, strict boundaries,
transactional rejection, ownership and output acknowledgement. These are local
session regressions and pinned component evidence, not whole-drawable acceptance.

The [gameplay backfill findings](../engine/reference/findings/m2-gameplay-backfill.json)
add 116 integrated scenarios, each checked byte-for-byte native/WASM under 17
schedules (direct, 30/60/120/144 Hz and 0/50/100/250 ms stalls). Pinned drawable
adapters compare ordered results and final score state; real Player cases compare
health, breaks, failure and frozen scoring. Two recorder ports retain left/right/
smoke and same-time press/release assertions. Marked circle/slider cases compare
discrete sample requests. The component extension adds 36 health cases, including
18 minimum/maximum-result ports and missed-tail/combo regressions.

Two local workloads exercise every judgement in a 10,000-circle map and a
ten-minute replay under direct and stalled schedules. These are deterministic
capacity regressions, not timing benchmarks or upstream performance acceptance.
All local cases run in `npm --prefix engine test`; independent comparisons use
`test:gameplay:upstream` and `test:simulation:upstream`.

Full A13–A20/A23 acceptance remains open: the Player adapter uses semantic
boundaries and disables audio-clock smoothing, recording assertions do not cover
all adaptive sampling, and discrete requests do not certify audio playback.
See the [backfill scope](compatibility/gameplay-tests.md) for adaptations,
exclusions and remaining work. No browser gate is closed by these results.

## M3: browser foundation and partial W01/W03

The browser foundation implements production-only WASM, shared generated
bindings, local archive/loose loading, transactional difficulty selection, music
cache/transport, bounded shared decoding and independent input/audio services
sharing the single AudioContext clock.
The browser bridge exposes headless sessions, replay/results/sample availability
and production coordinate conversion. Review fixes cover cancelled candidates,
ZIP descriptors and audio dispatch recovery.

The runtime exposes compact gameplay output and an arena-backed active projection
with independent output lifetime (kinds 31–34). This is partial W01 and the W03
foundation. The checkpoint additions below extend it with circle animation,
minimal shared resources and one-shot voice transport. Complete scene resources,
slider/spinner animation, WebGL2, loop/ramp production and integrated
input/music/lifecycle/results remain work in the [browser gameplay plan](browser-gameplay.md).
At this increment Play stays disabled (see the supersession note at the top);
no aggregate gameplay capability is advertised.

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

A controlled pinned drawable host now executes eleven bounded scenarios over 132
cadence/stall runs through actual input, playfield policy, drawable judgement and
score processing. The eleven scenarios include the exact setup/parameter port of
upstream `TestSceneHitCircleArea::TestCircleHitCentre` with its receptor
`HitAction` assertion retained, and `TestSceneSpinnerJudgement::TestHitNothing`
is ported through the real Player adapter in the gameplay corpus with an empty
replay. The [scenario findings](../engine/reference/findings/m3-scenarios.json)
record 85 selected result/score/combo matches and 47 differences, retaining actual
update schedules and live-input quantisation. This is additional drawable evidence,
not full Player, replay, health/failure or audio acceptance; W02 remains open.
The separate [delivery diagnostic](../engine/reference/findings/m3-scenario-delivery.json)
matches selected result/score/combo fields in all 132 runs when Odin inputs use the
host's delivery times. This eliminates the original 47 differences for those
fields under that intervention; original timestamped comparisons and production
input policy remain unchanged. It does not establish full session equivalence.
Under the [ADR-002 M3 amendment](architecture/adr-002-scheduling.md#m3-input-delivery-divergence)
those delivery-eliminated differences are annotated `accepted-input-delivery` in
the scenario findings; residual differences would remain open.
The host explicitly runs ManualClock at rate 1; the earlier spinner-motion run
at its default rate 0 was a host setup defect and has been replaced by verified
rate-1 observations. Twenty-four schedules additionally retain actual silent
channel play/stop calls and drawable-side sound parameter writes in the
[audio findings](../engine/reference/findings/m3-audio-observations.json).

W01 adds a minimal immutable kind-35 render attachment shared by map/session
owners, transactional publication, native/generated browser validation and
authoritative voice admission with acknowledgement retry watermarks. Kinds 41–45
add narrow capabilities, transactional voice reserve, independent voice output and
one-shot/loop/ramp command records. The authoritative journal is the only
producer (capability voice version 2): reserve requires flags 1 at READY with
full command capacity, commands keep their emit-time epochs, and kind-27
one-shot output remains a diagnostic journal that no longer feeds playback.
Loop/ramp gameplay producers and full H11 remain open. Ordinary one-shot pause
retains future nominal requests, lets started samples finish and resumes
retained requests once. The browser validates frame protocol only; the engine
asserts command policy at emit time. The browser admission path still allocates
bounded staging/executor storage (reserved, not per-hit-object), and its
immediate late policy is provisional pending H11. The prepared_sample flags field (bit 0) publishes loop classification so
the browser never re-derives it from sample names.

Simulation exposes component and semantic cursor/feedback history independently
of acknowledgement. Per-object sample ranges avoid scanning unrelated objects'
samples on each judgement. Work counters retain input-candidate, predecessor,
tracking and sample-binding visits. Creation-time minimum-reveal indices replace
full-map candidate/tracking/predecessor scans while retaining judged note-lock
blockers and equal-time ordering. The [input cost findings](../engine/reference/findings/m3-input-cost.json)
measure tiny/dense/sparse workloads, actual visit counts and native/WASM timing;
the dense fixture reaches failure after 151 inputs rather than claiming 1,000.
Active projection uses allocation-free heap sorting for adverse reveal bursts.
Kinds 36–40 now reserve and publish ordered circle draw instances/batches with
independent output lifetime and readonly hit/miss feedback. The [circle findings](../engine/reference/findings/m3-circle-draw.json)
retain 36 exact f32 approach alpha/scale comparisons against pinned drawable
observations. The [feedback findings](../engine/reference/findings/m3-circle-feedback.json)
retain 60 exact comparisons at equal elapsed time after each implementation's
result. There are 135 shared native/WASM circle boundary cases. Reserved semantic
history uses independent watermarks and expiry; epoch/backward reads rebuild it.
Debug projection keeps its existing conservative retention contract.
The [Chromium reader profile](../engine/reference/findings/m3-reader-cost.json)
measures collected as well as live allocations over 5,000 reads and confirms no
WASM growth; reusable readers are not allocation-free.

Full A22 acceptance, slider/spinner draws, cursor/trail, follow points and HUD
glyphs remain open in checkpoints 5–6. Circle-only draw reserve rejects mixed
maps. Full W01/W02/W03 milestones and aggregate Play remain open; the delivered
checkpoint contracts do not imply complete browser gameplay or H11 acceptance.

## Bounded W04 GPU resource increment

The independent browser resource service now uploads the existing kind-35 quad,
white atlas pixel and Odin shaders transactionally into a dedicated WebGL2
context. It enforces separate payload/geometry/texture/shader caps, owns recovery
bytes, reuses unchanged publication, validates resource/context identity at bind,
and handles loss, explicit rebuild, replacement failure and disposal. The
[rendering ADR](architecture/adr-003-rendering.md#bounded-w04-resource-service)
records ownership and limits; [local findings](../engine/reference/findings/m3-webgl-resources.json)
record the executed checks.

Node 24.13.0 and the checksum-pinned Odin compiler passed the full engine suite.
All 53 browser service tests, 34 production-WASM session schedules (exact
judgement/audio/final digests and no growth), and five Chromium scenarios passed.
The inspected diagnostic quad has matching sampled pixels before/after context
recovery and one upload per retained context generation. Firefox/WebKit checks
could not launch because the required Playwright executables were absent.

This completes only the independent resource-lifecycle slice. There is no
production draw-command executor, new atlas/analytic shader, slider tessellation,
or integrated context-loss pause/recovery. No upstream oracle was executed for
this original graphics resource policy. W03, W04 and A22 remain incomplete; at
this increment Play stays disabled (see the supersession note at the top). The tiny/dense/long-overlap/10,000-object/three-minute **rendering**
matrix remains open; existing session schedules are not rendering evidence.

The resource-service review fix unbinds a current program before deletion on
replacement or disposal, allowing its attached shaders to be released. A focused
Chromium regression verifies both cleanup paths and preservation of the bound
program after failed replacement. Shader sources decode once per upload attempt;
compile/link failures retain their stage and driver info log in error details.
The review checks passed all 58 browser service tests, the browser build and both
Chromium resource scenarios. These are local lifecycle checks; the remaining W04
graphics and upstream acceptance gates are unchanged.

## W06 input/frame integration increment

The browser now exposes `Gameplay_Input` and `Gameplay_Frame` for explicitly owned
`Audio_Playback` sessions. They provide DOM key/mouse/primary-touch bindings,
event-time Odin coordinate conversion, immutable receipt/audio mapping, reserved
ABI input staging, one frame callback, input-before-advance ordering and shared
music/audio pumping. Cancellation and rejected input enter explicit pause/recovery;
stale callbacks cannot restart a stopped driver. Terminal output disables input.
The synchronous render callback is the integration point for the remaining W04
executor, not a replacement rendering implementation. At this increment product
Play stays disabled (see the supersession note at the top).

Validation on Node 24.13.0: browser typecheck/build, 74 service tests, 34 existing
production-WASM schedules and all nine Chromium scenarios passed. The new driver
fixture compares complete final records with direct headless submission across
30/60/120/144 Hz and 0/50/100/250 ms stalls, with no WASM growth. A real Chromium
mouse/keyboard fixture checks aggregation, Odin coordinates and Escape release.
These are local regressions; the new driver fixture does not independently compare
all judgement/audio journals or certify physical devices. Full W06 A12/cadence
acceptance, browser allocation profiling, complete rendering and W07 lifecycle
remain open. Firefox/WebKit were not run for this increment.

Pinned test search covered osu! `TestSceneOsuTouchInput` and framework
`KeyBindingInputTest` at the revisions above. `TestSimpleInput` and
`TestPositionalInputUpdatesOnlyFromMostRecentTouch` exercise multiple touches,
whereas the browser plan deliberately accepts only primary touch. Those scenarios
are outside this browser profile and are not claimed as ports or matches.
`TestReleaseAlwaysPressedToOriginalTargets` exercises framework drawable routing,
which has no DOM equivalent here; the local release/aggregation tests validate
our transport policy only. No new upstream adapter was executed, and no upstream
acceptance row is closed by this change.


## Mixed-scene renderer increment (2026-09-13)

The production Odin/WASM path now publishes immutable slider geometry, an
original glyph atlas and analytic shaders, and generates ordered mixed
circle/slider/spinner scenes with cursor/trail, follow points, judgement feedback
and HUD. Append-only ABI kinds 46–51 and `oe_scene_*`/scene session exports retain
kinds 1–45 and the circle diagnostic. Scene output, history and active indices
have independent reserved lifetimes; map/session owners share attachments.

The browser `Renderer` reserves reusable staging, validates complete frames before
submission, batches compatible quads and uses stencil coverage for slider internal
overlaps and clipping caps. It accepts explicit beatmap time and CSS bounds/DPR,
provides synchronous rendering, explicit restoration and disposal, and notifies
the lifecycle owner on context loss. The developer `/renderer-debug.html` fixture
uses production WASM and scripted inputs. At this increment product Play remains
disabled (see the supersession note at the top); automatic player input/audio
pause and resume still belong to the separate lifecycle owner.

Validation: the full engine suite passes (47 foundation tests, geometry/prepared/
simulation/presentation parity and 116 gameplay fixtures across 17 schedules).
The existing circle approach comparison retains 36 exact f32 schedule projections.
The extended real pinned drawable runner executed 96 cases and 43,618 comparisons:
slider clipping and ball positions match the compared fields, while 171 spinner
progress and nine tracking-indicator differences remain. It deliberately exits
with failure for these 180 differences. Idle spinner progress is now compared as
zero, rather than omitted. See the [hashed findings](../engine/reference/findings/m3-scene-presentation.json).

Browser typecheck, 80 service tests and build pass. Chromium passes the existing browser scenarios,
the mixed executor/recovery test, the developer scrubber and a tolerant pixel test
for reversal/duplicate-segment opacity. Required Firefox 1543 and WebKit 2359
executables are unavailable; attempted downloads timed out, so their launch
failures are blockers, not test passes. Five workload smoke cases at 60 Hz with
100 ms stalls passed, including the full three-minute timeline, with one static
upload and no WASM growth. Those timings are unapproved local diagnostics; the
original combined full-matrix attempt timed out and did not produce a complete
report. A separate three-minute 30 Hz/four-stall run also hit its 600-second
timeout under SwiftShader and concurrent development load. Per-workload/cadence
reports now preserve completed measurements. See the [local renderer evidence](../engine/reference/findings/m3-renderer.json)
for report hashes, stage percentiles and explicit coverage limits. Tiny, dense,
long-overlap and 10,000-object maps also passed all four cadences and four stall
values (16 workload/cadence reports, 64 schedule cases). The 10,000-object run
remains a three-second prefix; this does not close the three-minute matrix.

W03/W04/A22 are still open. Remaining work includes complete nested/feedback/
follow/cursor comparisons and pinned ports, resolving the reported semantic
state differences, broader graphics coverage, loaded frame pacing, retained/peak
memory profiling, the full performance matrix and required baseline approval.
Current quotas are conservative admission ceilings, not measured shipping limits.
Original trail sampling and unsmoothed arrow orientation are documented cosmetic
policies. This increment does not close W07/W09 or full M3.


## W07 lifecycle and validation UI

`Gameplay_Controller` integrates the production renderer, input/frame driver,
selection and audio services. Play requires a prepared map, decoded music,
complete scene/voice capabilities and reserved resources; AudioContext resume
runs in the initiating user gesture. One lifecycle owner handles pause, resume,
retry, terminal results, Back, focus/visibility, audio interruption, GPU recovery
and page lifecycle. Rate 1, zero offsets and zero lead-in remain the production
profile. Missing sample candidates warn; missing music blocks Play.

Pause calls Odin at the sampled audio boundary before scheduled boundary
judgements, retains queued future input and nominal future one-shots, and releases
physical input ownership. Suspended audio uses the same engine pause path without
running-audio pumping. Unsafe failures preserve a bounded rejected-input preview
and offer Retry/Back. GPU restoration never resumes automatically. Reset reuses
the session's existing voice arena and renderer resources; it creates fresh
browser input/frame/audio owners. Back retains the selected map and decoded assets.

Terminal results are owned copies of kind 24/26. Successful runs drain existing
sound intent and active tails using the same driver; failure, navigation or
visibility loss cancels playback immediately. No score or result is derived in JS.
Selection, overlays and results provide keyboard focus and navigation.

Validation includes 91 service tests, mixed production-controller/headless final
record parity at 30/60/120/144 Hz with 0/50/100/250 ms stalls, twenty consecutive
retries with no WASM growth and bounded live owners, early slider-tail nominal
scheduling, stale-start cancellation, audio interruption and context restoration.
The full engine suite and 34 production-WASM session-evidence schedules passed.
All 20 Chromium scenarios passed, including the three lifecycle scenarios with
real Web Audio and WebGL2; the final focused UI/input rerun passed eight scenarios.
Firefox/WebKit binaries were unavailable; the attempted Firefox download timed
out. Physical audible output and release-browser certification are unexecuted.

Pinned Player adapters for `player-failure-hp0`, `hp5` and `hp10` were executed
and matched their existing assertions/comparisons. These source-derived fixtures
are not exact pause UI test ports. The [lifecycle finding index](../engine/reference/findings/m3-lifecycle.json)
records hashes, source searches, excluded product policies and remaining pause
adapter blockers. No complete A19/A21/A23/A24 row (beyond A24's M0 foundation scope) or W08–W10 gate closes here.

## Odin policy ownership increment (2026-09-13)

Three upstream-policy leaks that had accumulated in the browser executor were
returned to the engine, per the accepted ownership split (Odin owns gameplay
and presentation policy; JavaScript owns browser resources and executes intent):

- The pinned Skin/SampleStore beatmap sample filename probe order (exact,
  `.wav`, `.mp3`, `.ogg`) is now engine policy: `prepared.SAMPLE_PROBE_EXTENSIONS`
  carries the pinned-source behavior, and the append-only kind-52
  `oe_sample_probe` export publishes it from mailbox bytes [952,1024). The
  browser loader probes files only in the engine-published order and rejects
  substitute lists.
- Scene frames (kind 47, size 160) now carry `uniform_scale_x/scale_y/
  shift_x/shift_y`: the f32-exact NDC viewport uniforms computed by
  `presentation.make_viewport_uniforms` from the same transform and viewport.
  The WebGL executor uploads them directly instead of re-deriving
  presentation math with `Math.fround`.
- The engine now asserts scene instance/command policy at emit time
  (`presentation.validate_scene`: primitive/flag ranges, shared-quad versus
  tessellated geometry, index bounds against the attachment, alpha/scale/
  clip/glyph limits, clipping-cap adjacency and finiteness). A violation
  fails the draw with `INVALID_STATE` and preserves the prior frame. The
  browser executor thinned to transport checks only: identity, capacity,
  finite f32 staging and complete batch coverage.

Browser audio lateness/lookahead mechanics remain executor-owned and
provisional pending H11; moving them was considered and deliberately deferred
because ADR-004 assigns scheduling execution to JavaScript with engine-declared
policy, and no upstream evidence exists yet to relocate that boundary.

Validation: the full engine suite passes (50 foundation tests including the
new probe-policy bytes, 4 viewport fixtures including the new uniform parity
cases, 17 scene-policy rejection cases, geometry/prepared/simulation/
presentation parity and 116 gameplay fixtures across 17 schedules). Browser
typecheck, build and 93 service tests pass, including new engine-backed
sample-probe and uniform-parity regressions against the production WASM.
Firefox/WebKit executables remain unavailable; no new upstream oracle was
executed, and no acceptance gate changes.

## Playback interruption diagnostics
The interruption overlay displays a selectable JSON report with a clipboard
button and manual-copy fallback. Reports include symbolic engine status, stack,
map/browser metadata, lifecycle state and bounded pending-input samples. Rejected
input reports retain receipt and mapped timestamps, the last confirmed committed
time and lateness delta. Playback failures preserve the operation, requested time,
audio state and clock mapping before recovery clears the anchor. Retry clears the
active report; duplicate recovery preserves the original failure.

A local production-WASM regression offsets input and audio timelines by 2 ms and
asserts the retained `LATE_INPUT` evidence. This adds diagnostics only; clock
synchronization and upstream compatibility acceptance are unchanged.

## Debug suite (2026-09-13)

The scattered interruption diagnostics above are consolidated into one optional
typed diagnostics service shared by the bridge, frame driver, audio services,
renderer and lifecycle controller; existing consumers work without supplying it.
Basic recording is always enabled (bounded lifecycle/engine failure/input
batch/clock/audio/graphics/resource events in preallocated 2,048/8,192/2,048-slot
rings with drop counts); detailed mode adds individual inputs and per-frame CPU
stage timings per attempt. Instrumentation is parity-checked: gameplay results,
ordered engine outputs and retained WASM page counts are identical with basic and
detailed capture, matching a direct headless schedule (`tests/debug-scenarios.test.mjs`).
A local micro-measurement on this machine put the always-on frame sample at ~41 ns
per frame and a detailed input record at ~9 ns per input, with fixed retained
storage of 2,048/8,192/2,048 preallocated slots and no diagnostic-driven WASM
growth.

The player gains a Debug button on selection/pause/recovery screens plus a live
non-interactive HUD, both refreshed by the existing frame driver at most four
times per second; opening the panel during play requests the normal pause path.
Reports use the versioned 2 MiB-bounded `tapweave-debug-report` JSON with bigint
identifiers as decimal strings, first-failure preservation before recovery,
bounded secondary failures, timing provenance and explicit unavailable markers.
The latest five persist in IndexedDB with view/copy/download/delete controls;
storage failures keep the in-memory report usable. Exports import for
text-only inspection with size/schema validation. Nothing is uploaded;
beatmap/audio contents, screenshots, absolute paths and unrelated keyboard input
are excluded.

The `/debug.html` developer workspace lists 25 checked-in scenarios (clock
skews ±2/±10 and a −400 ms rejection case with exact mapped timestamps and
lateness, 30/60/120/144 Hz delivery with 0/50/100/250 ms stalls, input
aggregation/repeats/release-all/rejected batches, pause/resume, audio
suspension, rejected audio start, retry isolation, GPU loss/restoration,
scene dispatch failure and capacity exhaustion) with search, Run/Step/Reset/
Run All, declared assertions and report export. Synthetic scenarios use
injected clocks and production WASM and are executed by the Node suite;
graphics and real-audio scenarios run only in the browser workspace, and
Run All reports gesture-gated scenarios as skipped. Fault injection is confined
to the workspace. Structural inspiration is taken from the pinned osu!framework
`LogOverlay`, `PerformanceOverlay`, `GlobalStatisticsDisplay` and `TestBrowser`
(now retained with verified hashes in the source manifest, MIT); the
implementation is original Tapweave work.

Validation executed locally on macOS arm64: `npm --prefix engine test`
(including the 53-file source verification), `npm --prefix platform/browser-js
test` (120 Node tests) and the Playwright suite on Chromium and Firefox
including `tests/browser/debug.spec.mjs`. Limitations: WebKit binaries could
not be downloaded (CDN gateway failure for the pinned build) and remain a
validation blocker recorded here rather than silently omitted; with Firefox
newly installed, one pre-existing Web Audio gap surfaced outside this suite
(`cancelAndHoldAtTime` is unimplemented in Firefox's audio executor param ramps,
reproducing on the prior commit as well) and stays open. Recorded player
reports are diagnostic evidence, not executable reproductions; the suite
diagnoses the clock mismatch without clamping input or changing judgement
timing, and no upstream acceptance gate closes from this work.

## Single gameplay clock (2026-09-13)

Input judgement and engine advancement now share one authoritative clock.
Previously input receipts were extrapolated onto the audio timeline from
`performance.now()` while advancement sampled `AudioContext.currentTime`
directly; Web Audio guarantees no synchronization between those clocks, so
relative drift could reject an input as `LATE_INPUT` even though it was handled
between committed blocks.

Per the amended ADR-004 receipt-time conversion and ADR-002 browser paragraph:

- Every DOM handler in `Gameplay_Input` samples `AudioContext.currentTime`
  first and stores that stamp permanently with the browser clock epoch;
  `performance.now()` receipts are diagnostics only. `Audio_Clock.input_time`
  maps an audio stamp through the running session anchor, rejects stamps below
  the mapping bound, and no longer extrapolates from receipts.
- `Gameplay_Frame.drain` enforces the stamp's epoch against the session mapping
  before conversion: old-epoch input can never be interpreted against a new
  anchor. The coordinator order remains collect, submit, advance; rendering
  only consumes state.
- Equal audio stamps (the common case: audio time advances per render quantum)
  keep arrival sequence order, a stamp equal to the committed boundary is
  admitted, and genuinely invalid stamps still fail visibly with the retained
  rejected-input preview. No tolerance or clamping was added. Sub-block timing
  and output-latency compensation remain future shared-clock enhancements.

Validation on Node 24 after merging with the debug suite: browser
typecheck/build, 126 Node tests and the Chromium/Firefox Playwright suites
(55 scenarios; one WebKit-only skip) pass. The debug clock-skew scenarios now
skew the audio stamp directly and retain their exact mapped timestamps and
lateness; the binding receipt became a wall-clock diagnostic. New regressions:
the previous two-clock failure is replayed (input handled after its block
committed is judged at the boundary and matches a direct headless run
byte-for-byte), equal-stamp batches at the exact committed boundary match
direct submission across the mixed map, deliberately wrong diagnostic receipts
across the 30/60/120/144 Hz and 0/50/100/250 ms stall matrix produce identical
final records without WASM growth, and pre-anchor plus closed-epoch stamps
reject visibly with retained evidence.
The engine-side equal-time audit found input-equal-to-committed, strict
deadline boundaries and equal-time ordering already covered by existing Odin
fixtures and `StartTimeOrderedHitPolicy` ports; no engine change was needed.
Upstream lazer timestamps input during update polls rather than at DOM receipt,
so no pinned equivalent exists; this is recorded as a documented transport
policy, not a port. No acceptance gate changes. WebKit executables remain a
validation blocker.

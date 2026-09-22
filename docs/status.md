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

The final **Known gameplay MVP defects** section supersedes the historical
Firefox ramp failure and unresolved spinner/tracking findings below. It closes
those bounded issues, not full M2/M3 or release certification.

## Static hosting

Production moved to a dedicated Workers Free account on 2026-09-21:
[tapweave.tapweave-game.workers.dev](https://tapweave.tapweave-game.workers.dev).
The old public endpoint is retired and unsupported; old room invites must be
recreated. See the
[hosting budget boundary](hosting.md#durable-objects-budget-boundary).

The product shell has Cloudflare Workers Static Assets configuration for a free
`workers.dev` address, fingerprinted engine loading, explicit SPA route rewrites,
and a CI deployment job gated on all existing validation jobs. Local hosting
checks cover routes, cache headers, missing-asset 404s, engine boot, and demo start.
The first deployment used
[tapweave.mrtnkarsten.workers.dev](https://tapweave.mrtnkarsten.workers.dev),
an endpoint since retired (see below).
Public hosting smoke passed on 2026-09-21, including engine boot and demo start/pause.
GitHub automatic publishing still needs its API-token secret. Physical
audible-output checks remain open. See [hosting](hosting.md).
This adds no multiplayer or upstream compatibility acceptance.

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
moving existing fields. A later append retains decoder-owned `[Metadata]`
strings (title, artist, creator, difficulty version) on the prepared map and
exposes them through one kind-54 `prepared_metadata` record behind a kind-8
span (248 → 264 bytes with a named zero tail). Identity uses an explicit
canonical binary writer and the `prepared-v2` profile, with a fixed golden; it
no longer depends on reflected JSON.
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
no-drain intervals, failure freeze and terminal results. The session create
record additionally offers the pinned multiplayer mark-and-continue fail policy
(`fail_policy=1`): failure latches the F rank and freezes health while scoring
continues to completion. Legacy-last-tick markers
are not judged. Health is anchored at semantic judgements to avoid render-rate
rounding differences.

Creation reserves bounded input, state and complete judgement/audio journals in
an arena. Creation failures are transactional; hot paths and reset allocate
nothing. Snapshots expose committed outcomes and HUD state; one-shot samples use
frozen availability and ordered fallback, with explicit missing-sample silence.
See [ABI v2](architecture/interface-v2.md#m2-headless-session-transport) for the
production operations and ownership contract.

Replay records ordinary input/judgement frames, retained actions at pause, and
one-shot resume-blocker markers under rules version 2.
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
Miss results intentionally emit no object samples: the pinned upstream
`DrawableHitObject` plays an object's samples only on `ArmedState.Hit`, so upstream
misses are silent at the object level. The audible lazer "miss sound" is instead the
skin-provided `Gameplay/combobreak` sample played by
`osu.Game/Screens/Play/ComboEffects.cs` when the combo rolls back to zero with a
previous combo above 20 or on the first break of a run (`AlwaysPlayFirstComboBreak`,
default true), while not rewinding and with sample playback enabled. Tapweave does not
yet emit or bind a combo-break sample: kind-28 bindings are per-object, so delivery
needs a global/skin sample slot in the ABI plus a synthesized browser fallback. That
channel stays open with skin support; no upstream acceptance is claimed for it.

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
storage failures keep the in-memory report usable. Persistence resolves only after
transaction commit and rejects transaction aborts, including aborts after request
success. The reload regression waits for this completion before navigating, so
Firefox cannot cancel an unfinished write during the test. Exports import for
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

## Product shell (ADR-006, S0b promotion)

The Solid spike evidence (A1′–B4′ gates plus the Vue counter-evidence) is
promoted into `platform/product-ui/`, an in-monorepo Solid 1.9 shell with
exact-pinned dependencies and a mandatory `test:gates` suite
(typecheck, expected-errors, build, Vitest and the HMR/B1/B2/B3
probes writing JSON to `artifacts/gates/`). The WASM binary is copied from
`engine/artifacts/` by `scripts/prepare_assets.mjs` into an ignored directory
and is never committed. See [ADR-006](architecture/adr-006-product-shell.md)
for ownership rules: components reach the engine only through `@browser`
services, services contain no reactivity, judgement timestamps stay
audio-clock-owned, and shell updates never enter the engine frame path.

The W07 validation player is re-platformed into the shell. Routes are
`/select`, `/play`, `/results` and `/diagnostics`: selection uses the
generalized virtual list, `/play` is a host element only (the session service
owns the canvas, RAF pump and audio clock; overlays read service state),
results/retry read the authoritative engine record, and diagnostics carries
the engine capabilities panel, gate fixtures, an engine round-trip check, an
input binding fixture and the downloadable player diagnostics report. The
vanilla `browser-js/src/main.ts` UI is retired; `platform/browser-js` remains
the service layer with a minimal harness page, the renderer developer fixture
and the `/debug.html` developer workspace.

The debug suite's player interface is re-homed into the shell (the open item
is closed): `src/services/debug_session.ts` owns the unchanged
`@browser` Diagnostics_Service, IndexedDB report store and report identity;
`src/state/debug_state.ts` converts service publishes into throttled
(≥250 ms) signal bumps whose writes never run inside the frame callback
(`on_frame` only records a timestamp check); `components/debug_dialog.tsx`
provides the Logs/Timing/Audio/Resources tabs with filters, search, freeze,
import/export and stored-report management, and `components/debug_hud.tsx`
the non-interactive play metrics. Recovery views auto-build and persist one
failure report per interruption with the copyable textarea and
clipboard-fallback selection on the lifecycle overlay; opening the panel
during play requests the normal pause path. Ctrl+F10/Ctrl+F11 remain
best-effort shortcuts with visible controls as the required path, and the
retired vanilla `browser-js/src/debug-ui.ts` is deleted. The shell exposes a
`window.__tapweave_player_probe` handle so parity specs can inject
deterministic playback-clock faults through a read-only `playback_clock`
probe.

Validation is local only: `test:gates` (including expected TS2322/TS2769/
TS1484 diagnostics), Vitest component/service tests and the ported Playwright
parity intent (selection, archive difficulty switching, malformed archives,
diagnostics download, engine round-trip, full attempt lifecycle with keyboard
pause/resume/retry/results/back, audio suspension, real GPU restoration,
input aggregation, debug panel/HUD flows, failure-report persistence and the
interruption-report clipboard fallback) pass on Chromium and Firefox against
the production WASM. At that increment, a CDN gateway failure blocked the local
WebKit download; subsequent full WebKit and 60-second B3 results are recorded
under Mirrored pause/resume input below. The product-shell CI job mirrors
browser-foundation. This debugger increment did not change engine behavior or
close upstream acceptance gates.

## Product flow chrome (ADR-007)

The shell now carries the product flow `intro → menu → song select → play →
results`: a boot/disclaimer intro route (`/`) with retry, a main menu
(`/menu`, centered logo plus a live action column with roving keyboard
navigation and a P shortcut), and a reworked song select. Song select follows
the pinned lazer structure as regions: a FilterControl-position top bar (back
to `/menu`, screen title, a working difficulty text filter, and the import
control), the active set as a sheared set panel (set title, difficulty count)
expanded into the virtualized difficulty rows, a BeatmapTitleWedge-position
sheared info panel (`#map-name`, `#map-detail`, object count, CS/AR/OD/HP
from the prepared descriptor, `#play-gate`), and a ScreenFooter-position
action bar (Back, Play, Debug). Import accepts the file input and files
dropped onto the screen; both feed the unchanged transactional `load_files`
path, and the established a11y/test anchors and Play gating/focus behavior
are preserved.

A follow-up increment rebuilt that song select as a full-viewport screen in
the same bar grammar: the FilterControl bar and a full-width
`--footer-bar-height` ScreenFooter bar run edge-to-edge (the top bar's chrome
sheared with counter-sheared contents, like the wedge/footer buttons), and
the bounded middle track stretches the virtualized difficulty list to the
leftover height with the status/error strip pinned beneath it —
`Virtual_List` grew the opt-in `fill_height` mode for this while diagnostics
keeps the fixed window, and narrow viewports keep the stacked
document-scrolling fallback with the fixed list height. The wedge carries a
larger upright title over smaller metadata. Two defects surfaced and were
fixed in the same pass: the top and footer bars now shrink to their grid
track (`min-width: 0`) instead of pushing the stacked narrow layout past the
phone frame, and a stray counter-shear on the upright wedge body (left over
from before the panel chrome went upright) that clipped the title and
metadata at the panel's left edge was removed. Local evidence: `test:gates`
green and the full Playwright suite passes on Chromium and Firefox; WebKit
could not run locally this time (the documented CDN download failure).
No engine, ABI, or service behavior changed and every song-select anchor is
preserved, so upstream acceptance status is unchanged.

The results route is a dedicated screen rather than the shared lifecycle
panel, following the pinned lazer `ResultsScreen` structure
(`osu.Game/Screens/Ranking/ResultsScreen.cs`, `SoloResultsScreen.cs` at
`3c1c96f7`): a scrollable centered presentation — beatmap title/version line
(decoder metadata with the song-select filename-fallback rules), a rank
emblem ring, prominent score, accuracy/max-combo summary and the hit
statistics as a multi-column `#result-stats` grid — over a bottom bar
centering the Retry / Watch replay / Save replay / Back row with
`#replay-status` beneath. Shared result formatting moved into
`src/screens/result_display.ts` (the `result_items` list plus rank and
beatmap-label helpers); the lifecycle panel keeps only the play route's
pause/recovery/transient-terminal overlay. Every established anchor
(`#lifecycle-title` reading Passed/Failed, `#lifecycle-message`,
`#result-stats` with Score first, `#retry`, `#watch-replay`, `#save-replay`,
`#back`, `.results-screen`) is preserved, so the Playwright suite passes
unmodified; the rank palette is per-rank product tokens (documented in
ADR-007 divergence 5), not lazer's colours, and the pinned screen's
statistic-toggle choreography, leaderboard fetch, blur and applause are
deliberately absent. Both Passed and Failed results render, and the
"No result available" fallback panel is retained. Local evidence: `test:gates`
green (including css-lint over the new tokens and stylesheet) and the
unmodified Playwright suite passes on Chromium and Firefox; WebKit could not
run locally (the same CDN download failure as the song-select pass above).

A closing polish pass scaled the menu action column up to lazer-like presence
through CSS only — larger type (`--font-size-menu-action`) over generous
padding with clear hover and focus-visible feedback, plus a static full-bleed
radial-gradient backdrop (`--screen-backdrop`, composed from the palette
tokens) behind the menu and intro screens. The menu grid, roving keyboard
navigation, the P shortcut, the `#menu-play`/`#menu-diagnostics` anchors and
`.menu-logo .brand-mark` are unchanged, so no spec selector moved. The
full-viewport layout itself is now pinned by local assertions: the select
carousel column fills the frame between the bars (bounding-box comparison in
the style of the play-route fullscreen assertions), the results rank emblem
shows the engine's expected rank letter with its token class for both a
passed all-miss run (D) and a drained failure (F), and the slim app footer is
asserted present on menu/select/results. This is product chrome with local
browser evidence only: `test:gates` green and the Playwright suite passing on
Chromium and Firefox; WebKit could not run locally this time either (the
documented CDN download failure).

A theme pass then re-skinned the product chrome from the flat navy lazer look
to an old-osu/anime hybrid through `src/styles/tokens.css` and CSS only:
muted pastel lavender-grey chrome with pastel pink/periwinkle accents, chunky
2px borders, pill buttons, soft drop shadows and halos, a gentle pastel
gradient wash on the Play/demo CTAs, and a static diagonal-stripe backdrop
behind the menu and intro screens. An anime garnish layer adds scattered
static starfield dots on the backdrop screens, a pastel gradient wordmark,
star difficulty markers in the carousel, and pastel-pink eyebrows. The
previously unstyled `.warnings` list and `#watch-banner` badge gained rules.
Layout, DOM, selectors and copy are unchanged, so the Playwright suite passes
unmodified (ADR-007 divergence 1 records the updated palette direction).

A palette expansion then de-violeted that theme in the same files: the chrome
moved from lavender-grey to a neutral cool ink-grey ramp, the mono-pink accent
became a multi-hue pastel set (teal primary accent, amber eyebrows/sparkles,
sky links, coral danger), and the gameplay palette in
`engine/presentation/draw.odin` mirrors it with six pastel combo hues (cyan,
mint, gold, coral, periwinkle, lavender), a teal accent, and a deep
neutral-ink playfield background. The engine starfield gained a gold star
tint alongside teal and mint. Layout, DOM, selectors and copy are unchanged.

Classification is honest and narrow: this is structure-reference chrome, not
upstream acceptance. The structural citations (SongSelect.cs, FilterControl.cs,
BeatmapTitleWedge.cs, PanelBeatmapSet.cs, ScreenFooter.cs, MainMenu.cs,
ResultsScreen.cs, SoloResultsScreen.cs at
pinned commit `3c1c96f7`) and the documented MVP divergences — multi-hue
pastel palette, enter-only transitions, single-set session with filename-derived
titles, the HTML-shell substitutions (including the full-viewport chrome
frame and slim footer bar), and the results rank palette — are
recorded in
[ADR-007](architecture/adr-007-product-flow.md). Visual similarity to lazer is
explicitly not compatibility evidence, and menu/song-select/results styling
stays outside the compatibility claims. Local evidence only: `test:gates`,
Vitest, and the Playwright suite including `tests/browser/select.spec.mjs`
(back navigation, set panel + difficulty filter, drag-and-drop import, wedge
stats) pass on Chromium, Firefox and WebKit against the production WASM; the
synthetic file-drop test skips on WebKit, whose automation cannot construct
such events. No engine, ABI, or service behavior changed, and no upstream
acceptance scenario is closed by this chrome.

## MVP settings shared foundation

The [parallel MVP handoff](mvp-player-experience.md) defines ownership and
integration for onboarding and essential settings. An additive shared module
now defines versioned preferences, defaults, atomic validation and control-label
helpers. A plain in-memory service publishes immutable subscribed snapshots;
the Solid adapter provides guarded settings-dialog entry points, requesting the
ordinary lifecycle pause before opening and never resuming on close.

The foundation is not mounted in production. Persistence, configurable live
input, output volume channels, the settings dialog and onboarding/demo delivery
remain the two follow-up tasks. Zero-offset gameplay is unchanged. Six new local
regressions cover invalid updates, snapshot ownership, key labels, subscription
cleanup and dialog lifecycle guards. Browser typecheck/build and all 126 browser
service tests pass; all product `test:gates` checks pass, including typecheck,
19 unit/component tests, HMR/B1/B2 and the 60-second B3 probe (60.05 fps,
no reported long tasks or heap growth). Documentation link/diff checks pass.
No engine or upstream acceptance gate changes from these additive contracts.

## MVP essential persistent settings (Plan 2)

Plan 2 now mounts the shared settings foundation described above. The page-owned
service reads validated version-1 localStorage once before audio/input setup,
retains unknown versions until explicit edit/reset, and keeps edits usable with
an unsaved warning when storage fails. The shared Audio/Controls dialog supports
physical key capture, duplicate/chord rejection, mouse hits without disabling
aiming, volume/mute, reset, modal focus containment and opener restoration.
Opening from play uses ordinary pause; closing never resumes. Debug and settings
cannot stack, and binding capture blocks background shortcuts.

A persistent mixer applies independent 70% music / 80% effects defaults and
20 ms output ramps. Settings do not modify per-voice engine intent, clock anchors,
judgement timestamps or replay identity. Each start/resume freezes its input
configuration and refreshes shared canvas/controller labels. Ordinary resume
reconciles held physical sources; settings-capture sources alone remain
quarantined until release. The cursor resume press is consumed without dropping
its held action, as described in [pause/resume](compatibility/pause-resume.md). Retry/map changes retain the mixer; disposal
releases subscriptions, gains and held-input observers. A frame-observed audio
suspension now requests ordinary pause before advance, covering a Chromium race
where `statechange` arrives later, without timestamp adjustment.

Pre-mirror Plan 2 evidence: 134 browser service tests, browser typecheck/build, 23 product
unit tests and the full engine suite pass. Custom/muted and default inputs retain
identical final-result/audio-intent digests across the existing cadence/stall
matrix. Real offline audio independently scales/mutes both outputs in Chromium,
Firefox and WebKit. Settings journeys exercise persistence, focus/capture,
remap/resume, muted simulation, retry and injected boot cleanup in all three.
The [evidence and calibration protocol](compatibility/settings-evaluation.md)
records fixture identities, pinned-source search, actual exposed latency samples
and limitations. No human testers or perceived timing results were available;
offsets remain zero and human calibration evaluation is pending.

The inherited diagnostics/evidence changes and Plan 1 screen work are not claimed
as this increment. Combined onboarding/custom-settings/demo acceptance remains
an integration task. Full M2/M3, H11 and release-browser certification remain
open; Firefox's existing per-voice `cancelAndHoldAtTime` dependency still fails
the broader voice-loop audio test, independently of the new mixer.

Pre-mirror Plan 2 product verification: all `test:gates` assertions passed on isolated ports
(including the 60-second B3 probe at 60.05 fps with no reported long tasks or heap
growth); the full sequential browser matrix passes 68 tests with one existing
WebKit reserved Ctrl+F10 shortcut skip. Temporary port overrides did not change
checked-in gate assertions or dependency pins. Those checks cover the earlier settings baseline. Validation of the subsequent
resume behavior change is tracked separately in [pause/resume](compatibility/pause-resume.md).

## Mirrored pause/resume input

The [resume contract and evidence](compatibility/pause-resume.md) supersedes the
initial Plan 2 release-all/suppress-until-release policy. Pause retains engine
actions. Resume synchronizes released physical sources and cursor position,
then forwards the actual resume event before the first advance. Retained sources
can remain held; unrelated keys pressed during pause stay inactive until a fresh
press. Settings-capture sources remain quarantined until release.

Odin supplies the cursor-gate decision, target and per-action blocker flags through
kind 53. The browser keeps time frozen until gate acceptance, supports Escape
cancellation, and handles intro/break/hidden-cursor bypasses. Rules version 2
records the blocker marker, and replay import/seek reproduce the result. Older
rules-version-1 local recordings reject as unsupported.

Validation: the six retained pinned osu!standard pause-input test bodies and two
source-derived real-Player probes pass. The full engine suite, 138 browser service
tests, browser typecheck/build, 23 product unit tests and product gates pass. The
final Chromium/Firefox/WebKit product matrix passes 77 tests with one existing
WebKit shortcut skip. The 60-second B3 probe reports 60.05 fps with no long tasks
or heap growth. Documentation links and diff checks pass.

A21/A23/A24 remain open as complete rows: cooldown, pause-menu sound loops, the
full inactive-player/resource matrix, H11 and physical-device certification are
not implied by these bounded input tests. The finding index retains pinned
revisions, source/test hashes, classifications and the upstream observation digest.

## Song-select decoder metadata (Plan 1 parity round, phase C)

Song select now shows decoder-owned `[Metadata]` values instead of
filename-derived strings, completing the metadata item of the
[Plan 1 handoff](mvp-player-experience.md) as scoped by the
[shell lazer-parity plan](shell-lazer-parity-plan.md). Preparation retains the
decoder's title/artist/creator/version strings on the prepared map and
publishes them through an append-only ABI extension: kind 8 grows 248 → 264
bytes with a `metadata` span (plus a named zero tail to keep eight-byte
alignment), addressing exactly one new kind-54 `prepared_metadata` record
whose four offset/count/stride string triples mirror the kind-17
`audio_filename` pattern. See
[interface-v2](architecture/interface-v2.md) for the versioning stance:
readers of the extended descriptor must accept the grown `byte_size`, and the
append is display data only — prepared identity still hashes raw text, so
`raw_digest`/`prepared_digest` semantics are unchanged while
`description_digest` values legitimately moved with the descriptor bytes.

The browser bridge copies the four validated UTF-8 strings onto its owned
`Prepared_Description`, so `Active_Selection` needed no plumbing. The select
wedge shows title, artist, "mapped by" creator and the difficulty version
(only the prepared active difficulty's row uses version metadata; other rows
keep filename labels, and the difficulty filter searches those same displayed
labels). Explicitly empty metadata fields count as absent and fall back to
the previous filename-derived strings; the decoder's pinned lazer defaults
("Unknown", "Unknown", "Unknown Creator", "Normal" — lazer `Beatmap.cs`
constructor) are ordinary values and display as-is, as in lazer's own song
select, so deliberate values like a `Version:Normal` difficulty name are
never mistaken for missing metadata. ADR-007 records this as a
resolved-with-fallback divergence.

Local evidence: the full engine suite passes with regenerated native/WASM
preparation traces (schema v2 traces now carry a required `metadata` object)
and the ABI-level fixture check compares every kind-54 string against the
reference trace; the `abi-record-fields` fixture gained a `[Metadata]`
section. `engine/reference/findings/m1.json` is preserved untouched as the
historical record of the last pinned upstream execution; rerunning H03/H04
against the metadata-extended traces is pending a dotnet-capable
environment.
Browser service tests, typecheck/build, product unit tests and the Playwright
select specs (real metadata, empty-field fallback and label-based filtering)
pass. Playwright ran on Chromium and Firefox with both full matrices green;
the diagnostics input fixture has a pre-existing, order-dependent Firefox
0.5 px coordinate flake that reproduces without this change. WebKit could
not run because the pinned WebKit build was unavailable from the Playwright
CDN during validation — re-run the browser matrix once the CDN serves it
again. Upstream intent is
covered by the pinned lazer decoder's metadata defaults and field extraction;
display-side has no upstream executable equivalent (search recorded in the
findings), so no upstream acceptance scenario is closed by this increment.

## Song-select info overhaul (summaries, timing chips, preview)

Song select now shows map information for every difficulty, not only the
active one, plus derived timing data and a looping preview. The engine side
extends the foundation describe append-only: kind 5 grows 32 → 128 bytes
keeping its original fields and adding the decoded difficulty inputs
(HP/CS/OD/AR/slider multiplier/tick rate), display-only BPM min/max bounds
(`60000 / beat_length` over uninherited timing points, `0` without them),
first-object-start/last-object-end playable-duration bounds, and a
`metadata` span addressing exactly one kind-54 record — the same
decoder-owned strings the prepared descriptor carries. The bounds are
presentation derivations computed by the engine, not upstream-matched math,
and the record plays no role in preparation identity; the summary is encoded
during foundation preparation from the same map quota and is immutable
afterwards. See the [foundation summary contract](architecture/interface-v2.md#foundation-map-summary)
and [ADR-005](architecture/adr-005-interface-extensions.md#song-select-foundation-summary);
the "do not fully prepare every difficulty for list display" rule is
unchanged — foundation decode plus describe is the whole cost per row.

The browser layer adds `prepare_map_foundation` (flag 1) with a validating
`Foundation_Description` reader, a `Map_Summary` extraction, and a
`Selection_Controller` describe pass that runs one file at a time on a
dedicated second `Engine_Bridge` instance so the gameplay engine's input
inbox is never replaced outside the selection flow. Summaries cache per
asset scope (cleared on `load_files`, surviving difficulty switches),
release their map handles immediately, and record one failure per
unsupported difficulty without touching selection state — those rows keep
filename labels. The wedge derives drain time once per prepare from the
active descriptor's breaks and object span.

The shell renders the new data: set panel shows the cached set artist under
the title; difficulty rows show each summary's version name with
right-aligned `m:ss · BPM` meta; the wedge promotes the artist, adds
duration/BPM/object chips (drain time in the duration chip tooltip), and
replaces the stat table with lazer-style stat bars (HP/CS/OD/AR filled to
value/10) carrying brief native-tooltip explanations. `#objects` moved onto
the object-count chip; every other anchor is unchanged. A debounced
menu-scoped music preview loops from the selected map's preview point on
the shared page context through the mixer's music destination, stops before
attempts/navigation/disposal, and silently skips when the context cannot
run ([ADR-004](architecture/adr-004-audio.md#song-select-preview-loop)). Star
rating/pp and difficulty colour ranking remain deferred (M5); rows stay
neutral-accent.

Local evidence: the full engine suite passes with new native ABI-path tests
(exported foundation describe, quota rejection, bounds/defaults) and a WASM
`abi-test` block asserting the kind-5 append and metadata strings; browser
service tests cover the summary lifecycle, failure isolation and the
preview fade/loop behaviour; product unit tests and the extended Playwright
suite (row meta, timing chips, stat-bar fills, migrated `#objects` chip
assertions) pass on Chromium and Firefox with `test:gates` css-lint green.
WebKit could not run locally (the same documented Playwright CDN download
failure); re-run the browser matrix when the CDN serves it. Upstream
acceptance is unchanged: this is product-layer presentation with no
upstream executable equivalent.

## Hitsound decode fallback and warning semantics

Browser `decodeAudioData` refuses some PCM WAVE encodings shipped by real
beatmaps (24-bit integer and WAVE_FORMAT_EXTENSIBLE headers are common), which
surfaced as a per-file "Could not decode hitsound" warning on every probed
candidate even when a later extension or the synthesized fallback covered the
sound. Two changes in the browser asset layer, no engine or ABI changes:

- `Audio_Decoder` gained an optional in-house RIFF/WAVE fallback decoder
  (`wav-fallback.ts`, no dependencies) used only when the browser decoder
  rejects a file: PCM 8/16/24/32-bit integer and 32-bit float, including
  WAVE_FORMAT_EXTENSIBLE with the PCM/float sub-format GUID, chunk walking
  with count-validated reads. Unsupported encodings (IMA-ADPCM and friends)
  and truncated input fail with a plain error and the browser's original
  refusal propagates. The production session supplies the AudioBuffer
  factory; decoded output flows through the existing decoded-audio quota and
  cache, and music WAVs benefit identically.
- `load_sample_assets` warnings became per-sample and honest: a refusal
  covered by a later extension of the same name is unreported; a refusal
  whose sample still plays through another candidate or the synthesized
  fallback emits one note per unique path ("…a substitute sound plays
  instead"); a sample with no playable source keeps the per-path detail
  lines followed by the existing "Missing hitsound" warning.

Classification is unchanged: browser resource handling with no upstream
executable equivalent (lazer decodes through its own native audio stack).
Local evidence: new generated-fixture tests for every supported encoding and
rejection path, decoder fallback wiring tests (original error preserved on
double failure, quota short-circuits before any decode), and loader warning
matrix tests; the full browser-js suite passes (191 tests) with typecheck and
build, and product gates plus the Chromium/Firefox Playwright suite pass
(WebKit availability unchanged — see the CDN note above).

## Known gameplay MVP defects

The audio executor no longer requires `cancelAndHoldAtTime`. It retains bounded
per-voice gain/pan/rate automation, evaluates replacements at their scheduled
audio time and restores the incoming ramp prefix, including exact-endpoint
replacement. Zero-duration changes, parameter masks, future replacements,
quota failure and voice cleanup have focused regressions. Real offline audio
checks ramp continuity and masked playback-rate changes in Chromium, Firefox
and WebKit. The earlier Firefox voice-loop test now passes; its cleanup assertion
waits for actual queued `ended` callbacks after offline rendering completes.

The [scene correction investigation](compatibility/scene-corrections.md) found
an adapter layout bug and two frame-update effects. Correction fixtures explicitly
use an absolute 512×384 playfield, removing precision loss from the historical
relative-size setup. The pinned spinner consumes one cursor position per update;
the slider's displayed tracking flag copies its previous child-manager state.
Tapweave retains deterministic input segments and current committed feedback.
The original finding index is unchanged; the new index preserves every raw
difference with a narrowly scoped ADR-002 disposition and an eliminating
diagnostic. It compares unclamped rotation as well as progress.

The corrected matrix passes **128 runs / 81,528 comparisons with zero unexplained
differences**. It retains 1,150 progress/rotation sampling differences and 12
first-post-stall tracking-feedback differences. The 120 Hz extension and new
rotation fields mean these counts are not comparable to the earlier 180
progress/indicator discrepancies.

The [validation index](../engine/reference/findings/m3-known-defects.json) retains
source/report/log hashes. The full engine suite passes, including seven new
source-derived native/WASM projection cases. An existing resume test now releases
its engine before destroying its handle tables; the final allocation-tracked run
has no leak warnings. All 116 existing pinned gameplay scenarios and 108 pinned
component comparisons pass again. Browser typecheck/build and all
**145 service tests** pass. The browser integration run passes **37 tests**, with
two expected non-Chromium heap-profile skips; renderer workloads were excluded
from that run. A broader attempt passed 13 tests, including Chromium's workload
smoke cases, before being interrupted; it is not a full matrix pass. Product gates
pass all 23 unit/component tests and the 60-second B3 probe (60.05 fps, no long
tasks, no measured heap growth). Temporary isolated-port overrides were restored
without changing gate assertions.

The final separately hosted Chromium/Firefox/WebKit product run passes **77
tests** with one expected WebKit shortcut skip. Earlier attempts encountered a
Firefox held-key assertion during overlapping browser runs and a stopped preview
server; the final run uses unchanged assertions and a separately managed server.

These results close the known defect investigation only. Full upstream/audio
acceptance, additional presentation coverage, human audible playtesting and
release performance/resource certification remain open.

## Replay watch and save (shell lazer-parity phase A)

The results route now exposes the finished run's replay: **Save replay**
downloads the engine-exported TWREPLAY v2 container as
`{selection filename base}-{score}.twreplay`, and **Watch replay** re-enters
the play route in a non-interactive watch mode (plan
[shell-lazer-parity](shell-lazer-parity-plan.md) phase A; no engine, ABI or
trace changes). The controller models the finished run as a retained
`Completed_Run` — the owned result record plus the exported replay container
captured while the producing session was still terminal — independent of the
active session. Save and watch always serve that retained recording, so they
keep working after the session behind a watch is reset, re-prepared or
released. `watch_replay` resets the current session, rebinds samples on the
READY session before `load_replay` switches it to replay mode, and restarts
playback without attaching `Gameplay_Input`, so live canvas/keyboard input
cannot reach the engine and judgement comes only from the replay frames.
Live and watch starts share one playback-start lifecycle (generation,
starting publication, graphics precondition) with the live-input attachment
explicit in the live path only. `pause`/`play`/`resume` are refused while
watching (automatic pause paths no-op so DOM listeners never throw; an audio
interruption during watch fails loudly into recovery instead). `Retry`
re-runs the watch from the retained recording; `stop_watch` — play-route
Escape, or leaving the route whether the watch is still running, interrupted
or already finished — releases the replay session, re-prepares a fresh live
session for the same selection and restores the retained completed run, so
natural completion normalizes back to the original results context with
working actions and a live Retry. Back/new selections clear the retained
run. The footer/settings entry refuses during watch, the watch banner
(`#watch-banner`) replaces the pause affordance, and the results route
reports replay-action failures through the visible `#replay-status` region
instead of swallowing them. The future phase-B skip button must also remain
functional in watch mode.

Classification: local shell behavior with intent-level upstream mapping, not
an upstream acceptance gate. The pinned search found no executable
equivalent for a DOM replay player; the ported intent is
`TestSceneAutoplay.AddCheckSteps` (a replay completes without user input and
displays results with no misses) and `TestSceneReplayPlayer.TestDoesNotFailOnExit`
(exiting never fails the run) at pinned commit `3c1c96f7`, recorded with file
hashes in the [lifecycle finding index](../engine/reference/findings/m3-lifecycle.json).
Legacy `.osr` export stays M5 and is not exposed.

Validation: the full engine suite passes unchanged; browser typecheck, build
and all 147 service tests pass, including controller-level regressions for
run → export → watch (input refused, stray keys ignored) → byte-identical
terminal result → watch retry → exit to a fresh playable live session whose
save/watch keep serving the retained recording, and for an interrupted watch
startup that recovers without losing the re-watchable completed run.
Product gates pass. The Playwright replay spec (download filename, watch to
terminal with zero injected input and an identical non-zero hit score,
Escape back to retained results, both actions re-verified after Escape and
after natural completion, and Retry-after-normalization verified as a live
retry) and the existing lifecycle/player suites pass on Chromium; Firefox
and WebKit runs were blocked by a Playwright CDN gateway failure
(`GatewayExceptionResponse`/timeouts on cdn.playwright.dev), with Chromium
provisioned from the public Chrome-for-Testing 153.0.8010.12 bucket into the
Playwright cache as a workaround. The cross-browser matrix remains to be
re-run when the CDN is reachable, as previously recorded for the WebKit
gate interruption.

## Live-input capacity

The browser's default session now reserves 40 MiB and admits 65,536 lifetime
input records. The default/ceiling arena quota is 128 MiB; the WASM ceiling is
unchanged at 256 MiB. Map resources and combined per-session reserves have
separate quota checks, not one global engine-wide arena.

Voice storage is now an acknowledged ring with absolute u64 identities. Its
pending-input headroom is independent of lifetime input capacity. Advance,
pause/resume and replay seek reject insufficient headroom before mutating state;
large undrained advances or seeks can still return `QUOTA_EXCEEDED`. Ordinary
frame-by-frame playback reclaims acknowledged commands. This replaces the
complete-lifetime voice-storage guarantee, with unchanged ABI record layouts.

The [capacity investigation](compatibility/live-input-capacity.md) records the
user-reported 8,193rd-input incident, corrected capacity model, pinned upstream
search and local regressions. A 65,000-move controller run reaches terminal and
watches its retained replay; native and WASM long-slider runs exercise 50,000
held-action tracking changes and ring wraparound. No upstream acceptance row or
release-browser certification is closed by these local resource checks.
## Skip during lead-in and breaks (shell lazer-parity phase B)

A lazer-style
Skip affordance (`#skip`, floating bottom-right, outside the canvas input
surface) is available while a live session sits in the map lead-in or a beatmap
break (plan [shell-lazer-parity](shell-lazer-parity-plan.md) phase B; no
engine, ABI or trace changes). The affordance also renders during phase-A
replay watch mode: `can_skip` keys on lifecycle/audio state and descriptor
windows only, and a watch has no live input to drain or drop. The skip windows
come from the prepared
descriptor: `Prepared_Description.breaks()` walks the kind-15 records behind
`summary.breaks_offset/count/stride` and `first_object_ms()` reads the first
time-ordered object; the controller caches the windows per prepared map so the
per-frame probe stays read-only. The window is open while
`0 ≤ t < first_object_ms − 1000` (pinned-lazer
`MasterGameplayClockContainer.MINIMUM_SKIP_TIME`) or inside a break with more
than one skip lead remaining; the target is the next boundary minus the lead,
clamped to at least `committed + 1 ms`.

Space actuates the same affordance: the play screen's window keydown handler
mirrors lazer's `InputKey.Space → GlobalAction.SkipCutscene` binding, whose
overlay handler clicks the very button (repeats ignored). The key runs under
the button's exact visibility gate in live play and watch mode alike, ignores
repeats and modifiers, yields while a shell dialog is open, and yields to a
Space configured as a gameplay hit key (the configured binding wins; lazer
never binds Space as a hit key). No engine, ABI or transport change is
involved — the key calls the same `Player_Session_Service.skip()` command as
the click.

`skip()` is a user-command path, not a frame-path feature: it stops the frame
driver, drains buffered input at the pre-skip receipt times, drops residual
records (closed-epoch stamps fail loudly in drain rather than replaying — an
explicit policy recorded in the finding, not a hidden clamp), then
`Audio_Playback.skip_forward` re-anchors the one audio clock at the target
(`clock.pause` + `clock.start` at the same audio instant), rebinds the session
mapping and restarts the music transport at the target media offset. The next
pump issues a single forward `advance_output` across the gap; health cannot
drain across it because engine no-drain intervals already bracket breaks and
the lead-in. `Gameplay_View.can_skip` is computed live and the frame render
callback publishes only on window transitions, so the steady frame path is
untouched. Outside windows `skip()` is a refusal (view gate), mirroring
lazer's `Skip()` guard.

Classification: local browser/shell behavior with intent-level upstream
mapping, not an upstream acceptance gate. The pinned sources at `3c1c96f7`
(`SkipOverlay.cs`, `MasterGameplayClockContainer.cs`,
`GlobalActionContainer.cs`,
`osu.Game.Tests/Visual/Gameplay/TestSceneSkipOverlay.cs`) were fetched and
hashed into the [skip finding index](../engine/reference/findings/skip-window.json);
the ported assertions are the no-window cases (`TestSkipTimeZero`/
`TestSkipTimeEqualToSkip`), single actuation (`TestClickOnlyActuatesOnce`) and
the `MINIMUM_SKIP_TIME` skip target. The scene's actuation tests are
click-only, so the Space path reuses the single-actuation intent through the
binding plus the overlay's `IKeyBindingHandler` (repeat-guarded, clicks the
same button). Recorded divergences: ours is a DOM
button (lazer overlays the playfield) and ours also skips during breaks
(lazer's intro overlay does not), targeting one lead before the break end; a
Space configured as a hit key keeps its gameplay binding.

Validation: browser typecheck, build and the full service-test suite pass,
including new controller regressions (lead-in skip and break skip each
reproduce the straight-run result bytes byte-for-byte across the jump with a
stray input inside the gap, skip actuates exactly once, refusal outside
windows never disturbs the clock, and a closed-epoch input record after a skip
fails loudly into recovery) and an `Audio_Playback` regression (re-anchor
keeps the engine epoch, restarts music at the target offset and refuses
non-advancing or paused skips). The new product Playwright skip spec (lead-in
appears/jumps/retires, break appears mid-map, no-window map never shows it)
and the existing suites pass on system Chrome via the `chrome` channel; the
Playwright CDN remained unreachable for pinned browser binaries (recorded
above for phase A), and one pre-existing load-dependent HUD flake
(`debug.spec.mjs` "HUD is non-interactive") reproduces identically on the
unmodified main tree and is unrelated. Skip during phase-A watch mode was
additionally verified against a merged tree: the watch reaches terminal with
a byte-identical result after skipping the replay lead-in, and `stop_watch`
restores the retained result. Space-key validation: shell typecheck, build,
vitest suite and the full browser suite pass (chromium and firefox projects;
the webkit project still lacks pinned browser binaries, as recorded above),
with the skip spec extended so the key actuates the lead-in and break windows
like the button, does nothing when no window is open, and yields to a Space
bound as a hit key. Upstream skip acceptance remains open pending a
reference-host adapter.

## Complete-map visual fit and fullscreen gameplay

> **Superseded (fitting only):** the complete-map bounds fit below was
> replaced by pinned lazer playfield framing — see the final section. The
> window-sized shell layout, fullscreen controls, HUD anchoring, framebuffer
> ceilings and resize behaviour introduced here all remain in force.

Gameplay now fills the browser content area and fits every map's complete
visual extent at one stable, uniform scale, instead of clipping to a bordered
4:3 panel over the logical 512×384 rectangle (ADR-003
[playfield framing](architecture/adr-003-rendering.md#pinned-lazer-playfield-framing),
ADR-006 [play route layout](architecture/adr-006-product-shell.md#play-route-layout)).

Engine side: `presentation.visual_bounds` derives one `Visual_Bounds` per map
from final prepared geometry (stacked positions, 4× approach rings, 1.5× hit
growth, slider polylines expanded by the 2.4× tracking-ring half-thickness,
tick/repeat/tail feedback glyphs, follow points, conservatively rotated spinner
glyphs; shared named constants keep bounds and drawing from drifting). It
always starts from the normal rectangle, validates finiteness/magnitude,
allocates nothing, and is computed transactionally before any attachment
allocation — invalid map geometry fails scene-resource creation with
`INVALID_ARGUMENT` and preserves the previous attachment. The bounds are
stored with the immutable `Scene_Attachment` and shared by every session of
the map across retry, replay and restore. `make_bounds_transform` fits them
centred into any viewport with an 8 CSS-px margin (proportionally reduced on
tiny surfaces); forward and inverse coefficients come from one calculation.
The new `oe_session_playfield_transform` (kind 29 in, kind 30 out, same output
slot) serves that fit with the full owner/handle/mailbox validation chain,
`INVALID_STATE` without a scene attachment, no allocation and
publish-after-validate; the sessionless `oe_playfield_transform` is unchanged
for diagnostics. Scene drawing covers the complete canvas with the background
(inverse-fitted viewport rectangle with a small overshoot) and anchors the HUD
to viewport edges through the fitted transform with a viewport-based scale;
glyphs, values, colours and ordering are unchanged.

Browser side: pointer receipt conversion, resume targeting and physical
position all use the session transform — never the last rendered frame's — and
the gameplay protocol check requires the new export so a stale WASM fails
visibly. `framebuffer_size` is the single backing-buffer calculation shared by
admission and allocation; oversized physical surfaces reduce resolution
uniformly over the 16,384-axis/16,777,216-pixel ceilings while the CSS
rectangle and input mapping stay unchanged. Resize and `fullscreenchange`
repaint paused/resuming/ready/terminal states at their frozen beatmap time
without advancing; a temporarily zero-sized surface renders nothing while the
session is preserved; the browser's fullscreen-exit Escape is left to the
browser in both input paths and the resume gate. The shell `/play` route drops
the frame's width constraint and footer, hosts the canvas at content-area
size, moves the footer's Settings entry into the floating controls (idle and
paused attempts only) and adds a Fullscreen button that toggles the player
wrapper in the top layer.

Classification: presentation and shell behavior only — judgement, timing,
scores and replay coordinates are byte-identical, and the fit is an explicit
documented divergence from lazer (which crops oversized content to the
playfield); no upstream acceptance is implied. Local regression evidence:
6 new presentation tests (edge/corner/stack/path-extreme bounds, small-circle
feedback extents, invalid-geometry rejection, fit centring/round-trips/DPR
independence/f32 NDC containment across 640×480…ultrawide/portrait/tiny
viewports) and 2 new scene tests (attachment bounds sharing and session
transform validation incl. stale handles and prior-bytes preservation;
draw-frame transform equality with in-viewport geometry), plus browser
regressions (session transform attachment/handle/viewport failures,
`framebuffer_size` uniform reduction, 65k allocation-free transform queries on
the no-growth session path) and a product Playwright spec (window-sized canvas,
footer hidden on `/play`, fullscreen toggle lifecycle, unpauseed fullscreen
Escape). Full `npm --prefix engine test` passes (byte-identical native/WASM
traces, all gameplay fixtures); browser typecheck/tests/build pass; the
product gates (HMR/B1/B2/B3) pass. WebKit Playwright binaries were again
uninstallable locally (CDN gateway failure) — WebKit browser-suite coverage
for this change is CI-side, consistent with the recorded ADR-006 caveat.

## Pinned lazer playfield framing

Gameplay framing now reproduces the pinned lazer playfield composition
([finding](../engine/reference/findings/playfield-framing.json)) instead of
fitting each map's maximum visual extent: `make_adjusted_playfield_transform`
applies one uniform scale `0.8 × min(viewport_width/512,
viewport_height/384)` — `OsuPlayfieldAdjustmentContainer`'s composed size
adjustment at osu `3c1c96f7` (centred 0.8 relative size → 4:3 FillMode.Fit
child → content scale ChildSize.X/512; the 1024×768 upstream game size
reproduces the source comment's osu-stable ratio 1.6 exactly) — and centres
the logical 512×384 playfield: at 1920×1080 it measures exactly 1152×864 CSS
pixels. Object positions, sizes and distances share that scale; different
maps at the same viewport produce identical transforms because circle size,
slider extremes and animation extents cannot enter the calculation. Content
beyond the logical playfield renders into the surrounding canvas unclipped —
`OsuPlayfield` overrides `UpdateSubTreeMasking()` to false, so upstream does
not crop either; the earlier complete-map section's claim that lazer crops
oversized content was wrong and is corrected in the rendering ADR. The
`AlignWithStoryboard` downward shift is an upstream positional adjustment
intentionally not implemented.

`oe_session_playfield_transform` keeps its record contract (kind 29 in,
kind 30 out, same output slot) and its validation chain (owner, stale
handles, exact mailbox addresses, positive dimensions, finite coefficients,
allocation-free, publish-after-validate, prior bytes preserved on rejection)
but no longer requires a scene attachment — the framing is viewport-only and
succeeds before any renderer publishes scene resources. Drawing, pointer
receipt conversion and pause/resume targeting all consume it unchanged.
`engine/presentation/visual_bounds.odin` and the attachment's cached bounds
were removed together with the fit-only restrictions; scene-resource creation
keeps its transactional finiteness validation of prepared geometry and every
quota. The viewport-anchored HUD, full-canvas background, window-sized shell
layout, fullscreen button/lifecycle, framebuffer ceilings and resize repaint
behaviour from the previous section are unchanged, as are gameplay
coordinates, judgement, timing, scores and replay data. The fullscreen-exit
Escape is owned by the browser across engine delivery orders: a shared guard
(`platform/browser-js/src/fullscreen.ts`) treats an Escape as browser-owned
while the document is fullscreen or within a 400 ms grace window after a
fullscreen exit (some engines exit and fire `fullscreenchange` before
delivering the keydown); the pause, resume-gate, watch-exit and modal-close
Escape consumers all consult it, and browser/product regressions cover both
delivery orders.

Classification: presentation-only framing parity with pinned-source evidence
and a blocked executable probe — the local machine has no dotnet SDK, so the
.NET reference host cannot measure the container composition here; upstream
acceptance stays open until an H-series adapter does (recorded in the
finding). Local regression evidence: presentation tests pin the four
reference viewports (4:3/16:9/ultrawide/portrait, centring, proportional
sides, 1152×864 at 1920×1080, round trips, DPR independence, f32 NDC
containment of the playfield rectangle); scene tests pin map independence
(extreme vs plain maps, before and after attachment publication),
allocation-free queries, rejection semantics and the preserved geometry
validation; the browser engine regression pins the same contract over real
WASM including the 1152×864 measurement and off-rectangle addressability.
`npm --prefix engine test` passes (byte-identical native/WASM traces, all
gameplay fixtures), browser typecheck/tests/build pass (159/159), and the
product shell suites and gates were re-run after the engine rebuild.
WebKit Playwright coverage remains CI-side (blocked CDN install).

## Original demo beatmap (MVP Plan 1)

The shell now offers the original demo required by
[mvp-player-experience.md](mvp-player-experience.md): "Try the demo" lives in
the song-select top bar and the empty-carousel state, fetches the same-origin
`tapweave-demo.osz` with `cache: 'reload'`, and loads it through the
transactional `load_files` archive pipeline exactly like a user import — a
failed fetch never reaches the engine and keeps the standing selection, the
status strip carries the retry affordance, and Play stays an explicit press
so the audio-start gesture belongs to the user. Demo loads are replaceable by
later imports.

The archive is generated, never committed:
`platform/product-ui/scripts/generate_demo.mjs` renders the beatmap (75 s
music, 100 BPM, 4.8 s lead before the first object, CS4/AR4/OD3/HP2, 16
spacious circles, 12 linear sliders, one 10.8 s spinner, 32 objects) and
synthesizes the music from sine oscillators plus a seeded noise generator —
no downloaded songs, samples or art. `prepare-assets` regenerates the archive
into the ignored `public/demo/` and verifies it against the tracked
`scripts/demo/manifest.json` (sha256 + byte length), so nondeterminism or an
unrecorded intentional change fails asset preparation; provenance and
redistribution terms live in `scripts/demo/README.md`. The ZIP carries a
pinned mtime and the generator is deterministic, verified twice over by the
manifest check and the unit suite.

Local evidence: the native decoder accepts the generated map (decode-native
status OK with the expected objects/timing/metadata);
`tests/demo_generator.test.ts` pins the map structure, spacing, WAV envelope,
archive contents and byte-for-byte determinism against the manifest; the
Playwright demo spec covers the first-visit journey (load, play, pause, back),
the failed-fetch retry with a standing selection, and loose-import
replacement. Shell typecheck, build, vitest and the demo spec pass on
chromium and firefox.

Classification: local product feature with no upstream counterpart — lazer
ships no demo flow, so there is no pinned upstream test to port or acceptance
ID to claim. Human beginner readability and audible playtesting of the demo
remain open, as the MVP plan's validation section records.


## Original gameplay typography and pastel effects

The scene uses original rounded stroke glyphs in a 512×256 atlas, bilinear/mipmap
sampling, tightened antialiasing and a narrow dark outline. Digit ink is centred
within each cell; circle combo labels centre the complete number at the stacked
object position in normal, hit-flash and miss states. HUD number runs retain their
edge anchoring. Pastel combo cycling, disc gloss, deep neutral-ink background,
a deterministic starfield and star hit bursts are presentation policy in Odin;
this styling adds no ABI records and changes no judgement rules.

The atlas mismatch was a nested global stroke-slice initialization problem:
WASM produced blank ink cells. Constructing borrowed slices at lookup time fixes
it without reducing alpha precision. Native/WASM scene-resource byte comparison
covers the full atlas; allocation-tracked glyph tests check defined/blank cells,
clear borders and partial coverage. Circle-label tests cover one, two and three
digits through normal/hit/miss states.

Classification: original cosmetic policy, local regression evidence, not A22
upstream acceptance. Search of the pinned osu test tree at
`3c1c96f742e7aae2ff67a7361e058fe91ca3b955` identified and inspected
`TestSceneHitCircle.TestHits/TestMisses`, `TestSceneHitCircleLongCombo.CreateBeatmap`
and `TestSceneHitCircleComboChange` in `osu.Game.Rulesets.Osu.Tests`. They provide
visual circle/long-combo scenarios, with no assertion for this original font's
rasterization or label bounds. The retained `DrawableHitCircle.load` centres its
circle piece. The framework test-tree search at
`f02756c5aa5032e6d04729922702b8d56c4bc2eb` identified SpriteText layout/sizing tests;
those exercise the framework text/font system, which this original stroke atlas
does not use. No upstream executable font comparison is claimed or acceptance
row closed.

Validation for this typography fix: full `npm --prefix engine test` passes
(66 allocation-tracked foundation tests and native/WASM resource, presentation
and gameplay parity); browser typecheck, all 173 service tests and build pass.
Product typecheck, all 40 unit tests, build and all three Chromium demo tests
pass. A 1440×1000 CSS-pixel demo capture at DPR 2 was inspected for digit
sharpness and centring. Firefox/WebKit visual certification and upstream A22
acceptance are not established by this check.

## Private rooms with local maps (ADR-008)

Private 2–8-player rooms support host-selected local difficulties, session-only
imports, exact map/music/WASM SHA-256 matching, revisioned availability/readiness,
a five-second scheduled audio start, transient scoreboard, client-reported shared
results and return to lobby with the selection retained. A SQLite-backed Durable
Object coordinates each room with hibernating WebSockets and deadline/expiry alarms. Odin judgement and scoring
remain local; rounds run the pinned upstream multiplayer fail policy
(`fail_policy=1` in the kind-18 gameplay-create record, ABI 2.1): zero health
marks the F rank and freezes health while play and scoring continue to the
map's end, with terminal status `failed` carrying the full score. Solo play
keeps terminal failure. Networking is limited to this
explicit scope; no competitive verification, accounts, uploads or public directory.
The room screen follows the shared product grammar of ADR-007 (sheared top bar
and footer actions, wedge panels, chips, gradient CTAs over the common backdrop)
without adding primitives or changing room contracts.

See [ADR-008](architecture/adr-008-private-demo-rooms.md) and the
[MP-01–MP-12 validation matrix](compatibility/multiplayer.md). Workers-runtime
tests exercise real SQLite, alarms and socket hibernation/eviction. Independent
context browser tests exercise independently imported local fixtures and
interruptions. The MP-12 fail-policy fixtures port the pinned
`TestSceneMultiplayerPlayer.TestFail` scenario as local native/WASM parity
evidence; the upstream visual scene test is not executable through the reference
hosts, so no lazer gameplay acceptance row is closed. These are product regressions, not new upstream gameplay acceptance. Separate physical devices and
audible-output start skew remain an open release check.

Protocol v2 uses the prepared final object end time from playback zero for
progress and deadlines, plus a 30-second completion grace period. Active rounds
are exempt from inactivity expiry; the absolute four-hour limit still applies.
Legacy demo-only rooms retire with a recreate-room explanation. Local validation
passes the full engine suite, 194 browser-runtime tests, 47 product unit tests,
product gates, 16 Worker tests and 30 Chromium/Firefox/WebKit multiplayer cases.
These changes have not been deployed; see the linked validation record for scope
and the remaining physical-device gate.

## Multi-set song selection and lobby picker

Song selection became a session library. `Selection_Controller` holds any
number of loaded beatmap sets instead of one: imports append a set (within a
12-set / 256-MiB retained-archive quota) and select its first difficulty,
`select_map` addresses `(set_id, filename)` so identical difficulty filenames
in different sets stay distinct, `remove_set` transactionally retires a set —
removing the active set first prepares a neighbouring successor and re-inserts
the set if that successor selection fails — and per-set background summaries
replace the single flat cache, with the library generation fencing superseded
passes. Candidate handling no longer disposes a scope merely because it is not
the active one; only set removal disposes scopes, and a failed import still
admits no set and keeps the standing selection. The music preview keys on
`set_id + filename` so same-named difficulties in different sets restart it
correctly. No engine, ABI, or protocol changes: this is entirely browser-layer
state and product UI.

The select screen renders the library as a grouped carousel — one collapsible
header per set (chevron, title, difficulty count, per-set remove button) with
indented difficulty rows and their duration/BPM meta — while the big set panel
and the details wedge keep mirroring the active difficulty. The filter now
searches set titles and displayed labels across all sets, auto-expanding
matching sets; empty-state copy and a short controls hint in the wedge cover
first-run guidance. Shared display helpers (`selection_display.ts`) serve both
this screen and the multiplayer lobby.

The ADR-008 lobby picker replaces the raw-filename dropdown with the same
grouped difficulty list over the host's whole library (the published row is
marked; choices may queue while an earlier publication is still being
acknowledged, as before), and guests match the host's choice against every
set they imported this session via a content-hash `find_map_by_hash` pass
instead of only the active scope — importing sets once covers later host
choices. The room map panel adds the descriptor length and clearer matching
copy. Wire protocol, worker, and ADR-008 decisions are untouched.

ADR-007 records the grouped multi-set carousel and the lobby list picker as
browser-idiom divergences; upstream song-select acceptance remains open and
unclaimed. Local evidence: the browser runtime suite (205 tests) including 22
selection-controller cases for multi-set add/remove transactions, quotas,
cross-set navigation and hash matching; product unit tests including a guest
cross-set matching regression; product gates (typecheck, expected-errors,
css-lint, build, Vitest, probes) green; the Playwright browser and
multiplayer suites exercise the grouped carousel and the list-based lobby
picker. The full browser suite shows one load-dependent timing flake per run
in unrelated boot/replay specs that reproduces on a tree without these
changes. Star rating, difficulty colours, sort/group modes and persistence
remain deferred (M5).


## Private room chat

Private rooms now include bounded plain-text chat with 100-message durable history,
server author attribution, reconnect recovery and rate limiting. Protocol v2
capability negotiation preserves existing rooms and older clients. Gameplay chat
uses Enter/Escape and engine-owned effective-break state through ABI 2.2; typing
suppresses gameplay actions without pausing playback. Incoming messages stay quiet
while playing. See [chat validation](compatibility/multiplayer.md#room-chat).
Executable pinned-upstream comparison and physical-device certification remain
open. This is not osu! chat protocol compatibility; no deployment is implied.

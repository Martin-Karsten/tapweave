# Pinned reference harness

## Purpose and trust boundary

The harness executes pinned upstream components/tests and compares structured outputs with the Odin engine. It is a developer/test dependency only. The local C# spike is not authoritative and is not linked into oracle generation.

## Components

1. `reference-host`: a .NET test project referencing the checked-out osu! revision and framework `2026.731.0`, with a lock file and commit verification.
2. `fixture-builder`: deterministic `.osu`, replay, archive, sample and skin fixture generation plus imported upstream test resources where licences permit.
3. `trace-schema`: versioned JSON/CBOR records shared with native Odin and WASM.
4. `runner`: executes upstream at controlled frame schedules and Odin native/WASM, normalizes only explicitly non-semantic IDs, and diffs by traceability policy.
5. `corpus-manifest`: SHA-256, origin/licence, format version, feature tags and expected capability.

## Comparison outputs

- `prepared-map`: metadata/defaults, difficulty, ordered typed control points, object order, stacking, path control points/calculated vertices/cumulative lengths, duration/velocity, children, sample descriptors.
- `judgements`: sequence, raw/effective time, top-level/component IDs, result, offset, forced/automatic/user cause.
- `transitions`: score, score without mods, accuracy numerator/denominator, combo/max combo, health, fail/pass after each result.
- `audio`: ordered sample candidates, chosen asset identity, discrete requested time/volume/pan/rate, loop transitions/ramps.
- `presentation`: state enum and numeric parameters at requested sample times; diagnostic only for cosmetic identity.

## Experiments

| ID | Investigation | Method | Resolution criterion |
|---|---|---|---|
| H01 | historical version branches | decode versions 1–14, 128, undefined gap/future, and malformed/missing headers | exact defaults/branches; required versions accepted, undefined/future rejected |
| H02 | coincident timing precedence | permutations of red/inherited lines at same time and before-first query | exact control-point dump |
| H03 | path approximation drift | pathological/repeated/collinear/long curves for all path types | tolerance valid across corpus; otherwise port correction |
| H04 | slider length/ticks/tail | degenerate ends, repeats, min-distance ticks, NaN tick disable | exact children/times except the documented zero-duration legacy-marker canonicalisation (normalised to 0, excluded from scoring-child comparisons) |
| H05 | slider tracking cadence | same timestamped input at 30/60/144 Hz and 100 ms stalls (minimum upstream sampling; the full schedule/stall matrix below governs acceptance) | separate invariant results from frame transitions |
| H06 | hit-window/equal-time order | every exact boundary, adjacent IEEE values, coincident circles/inputs | exact result/order |
| H07 | drawable same-time order | nested and top-level results at one time under all schedules | establish or classify order |
| H08 | spinner sampling | circles with 30–240 Hz frames, direction reversal, >90° segments | define verified recorder density/tolerance |
| H09 | health calibration | maps with breaks/HP0/5/10; dump drain and every result | exact failure, health tolerance |
| H10 | scoring | synthetic result sequences and upstream score tests | exact score/count/combo/rank |
| H11 | sample/loop behavior | control-point boundary, missing assets, rapid track toggles | exact intent trace |
| H12 | replay conversion | upstream `.osr` resources, sentinels, seed, Classic insertion | exact converted frames/settings |

Architecture-critical outcomes are already resolved conservatively: H05/H08 may quantify upstream frame variance but cannot make Odin rendering cadence authoritative; H03 can change a math port but not data ownership; H11 can extend audio event variants without moving audio-node ownership into WASM.

## Schedule and stall matrix

Run each simulation fixture with direct event-boundary stepping and presentation requests at 30, 60, 120, 144 Hz; inject 50, 100, and 250 ms stalls before/between/after critical events. Replay outcomes must be identical across Odin runs. Upstream is run at the same schedules and its range recorded. Native and WASM traces must be byte-identical after canonical float serialization.

## Failure reporting

Every diff reports fixture hash, behavior ID, source commit, first differing event, ten events of context, raw numeric values/ULPs, schedule, and a reproduction command. Updating a golden requires a source revision/profile change or a written finding; never an unconditional snapshot refresh.

## Executed M0 adapters

H01/H02 are implemented and executed by [`engine/reference-host`](../../engine/reference-host/README.md). The [M0 finding index](../../engine/reference/findings/m0.json) records the 83-observation run, fixture/observation digests, locked dependency digest and policy classifications. The runner rebuilds and tests native/WASM before comparison. Its projection excludes M1 geometry, slider duration/children and final sample candidates; matching this projection is not full prepared-map equivalence.

Malformed-line observations preserve upstream's actual catch-and-continue behavior. The adapter records an exception and rethrows it into the original decoder recovery loop. The comparison separately verifies Tapweave's stricter typed, transactional rejection policy. H03/H04 are implemented below. M2 has component subsets of H06/H08/H09/H10; see [M2 status](../status.md#m2-headless-sessions). Full gameplay observations and H05/H07/H11/H12 remain open.

## Implemented preparation observations

`test:prepared:upstream` runs the real `OsuBeatmapConverter`, preprocessor,
`ApplyDefaults`, and postprocessor in the pinned checkout. It observes final
objects, paths, samples, stacking and nested children, and separately calls the
upstream `SliderEventGenerator` for H04 descriptors. Reflection reads the private
cumulative-length list; it does not reproduce the algorithm. Zero-duration legacy
marker progress is normalised to 0 in both trace projections and explicitly marked
as a canonical policy. It is excluded from scoring-child comparisons.

The 101-fixture corpus includes 11 retained synthetic upstream `.osu` test resources
with source/licence/SHA-256 entries in the source manifest. Numbered community
beatmaps, music and art are not bundled. Full-map native/WASM traces include a
binary-description digest. The independent 74-case geometry host remains useful
for testing caller-supplied workspace limits and path kinds without decoding.
See [current evidence](../status.md).

## Remaining gameplay adapters

Whole-scenario A13–A20/A23 and A12/A21/A22 acceptance remains open. Existing
component, local session and bounded [gameplay ports](gameplay-tests.md) do not
substitute for the complete acceptance scenarios below.

| Harness | Required scenarios | Existing evidence / remaining entry point |
|---|---|---|
| H05 / A15 | Slider tracking loss/recovery, key restriction, sparse samples and deadlines across schedules/stalls | 34 slider ports now execute a real drawable adapter; broader curved/short-slider timing remains open |
| H06 / A13–A14 | Strict/adjacent window boundaries, circle selection, note lock, equal-time input | 61 circle/window and four note-lock cases execute real input selection; full scheduling acceptance remains open |
| H07 / A14–A16/A20 | Nested/top-level equal-time result order, early nominal tail | Early/nominal-tail and result-order ports exist; broader equal-time combinations remain open |
| H08 / A16/A23 | Spinner reversals, >90-degree segments, input/recorder angular subdivision | Spin-history component, five cursor ports and the TestHitNothing empty-replay Player port exist; reversal/angular recorder coverage remains open |
| H09 / A19 | HP0/5/10, breaks, drain, failure time/freeze | 36 health cases and ten real Player health/failure cases added (nine mixed/failure sessions plus the TestHitNothing empty-replay Player port, which is also listed under H08/A16/A23); arbitrary frame-cadence health remains open |
| H10 / A17–A18 | Complete score/count/health sequences and terminal rank | Integrated ordered/final score projection added for 116 scenarios; bounded corpus only |
| Replay / A23 | Same replay under direct, 30/60/120/144 Hz and 50/100/250 ms stalls | 17 local schedules per gameplay case and two real recorder ports; full upstream recorder cadence remains open |
| H11 / A20–A21 | Missing candidates, nominal tails, loops, rapid toggles, ramps, pause/resume | Discrete request ports added; loops, fallback and device output remain separate |
| Presentation / A22 | Circle preempt/fade/approach/feedback, slider body/ball/follow/repeats, spinner states | Source chapters, local coordinates and active projections; drawable adapter absent |

Extend the retained score/count/health and Player failure observations to the
remaining cadence, recorder angular subdivision and sample eligibility scenarios. Keep the
schedule/stall matrix above and traceability tolerances unchanged. Capture real
locked-restore observations with source, fixture, observation and lock hashes.
Dense/long/10,000-object workload measurements must include creation/calibration,
advance/event work, live/peak arenas, recording/output/checkpoint high water and
WASM pages. Resolve unexplained discrete differences before closing M2 gates.

## Test backfill plan

The first implemented batch is described in [gameplay test coverage](gameplay-tests.md),
with 154 added fixture cases (116 gameplay scenarios including 10 Player-adapter
cases, 36 health component cases, and two local workloads) and explicit remaining limits. The broader plan below
is not itself acceptance evidence. Prioritise already
implemented headless gameplay; browser-only gates follow the capabilities they
require. Use the pinned commits in `engine/reference/source-manifest.json` (plus
per-source hashes in the retained findings indexes and the geometry manifest for
framework float behavior) throughout.
Inspect work in progress in the reference host before extending it, so existing
scenario adapters are reused rather than replaced or duplicated.

### 1. Inventory and map equivalent upstream tests

Search `osu.Game.Rulesets.Osu.Tests`, shared `osu.Game.Tests` and relevant pinned
framework tests. For each applicable test method and parameter case, record its
source path/revision, acceptance ID, local fixture/test mapping, and status:
covered, missing, blocked, out of scope, or documented divergence. Audit M0/M1
as well as M2; bounded passing corpora do not establish that all equivalent
upstream cases were ported. Record reasons for exclusions, especially Classic,
other mods, legacy replay containers and editor-only behavior.

Retain the mapping with the existing compatibility findings. Preserve licence
notices and record hashes/provenance for added test sources and synthetic assets.
Do not import community music or artwork to reproduce a test.

Exit: every discovered in-scope case has an explicit disposition and missing
cases are assigned to the batches below. Counts describe cases, not just files.

### 2. Complete the shared scenario adapter

Extend the .NET reference host to drive actual pinned drawable/player behavior
with a controlled clock and timestamped input. First prove one circle scenario
can execute upstream and through a production Odin session, producing comparable
judgement, score, health and terminal-state traces. Keep adapters observational;
do not reproduce gameplay algorithms in C# or JavaScript.

Port upstream scenario setup, actions, parameter cases and assertions into local
fixtures, with thin native/WASM transports over shared Odin logic. Extend schemas
and validators together. Retain source, fixture, observation and dependency-lock
hashes, and report the first differing event with reproduction instructions.
An unavailable drawable host is a blocker, not a reason to substitute component
results. Keep component probes as complementary evidence.

Exit: the smoke scenario passes upstream assertions and local assertions, and
its native/WASM traces agree with independently captured upstream observations.

### 3. Backfill gameplay in dependency order

The source names below are inventory starting points in the pinned checkout,
not claims that every required boundary already has an upstream test. Add
source-derived boundary cases wherever the upstream suite has gaps.

| Order | Coverage and starting tests | Required result |
|---|---|---|
| 1 | H06/H07, A13–A14: `TestSceneMissHitWindowJudgements.cs` and input/note-lock tests found during inventory | Exact and adjacent hit-window boundaries, radius checks, overlapping/equal-time objects, one-edge selection, forced misses and automatic deadlines; compare ordered judgements |
| 2 | H05/H07, A15/A20: `TestSceneSliderInput.cs`, `TestSceneSliderFollowCircleInput.cs`, `TestSceneSliderEarlyHitJudgement.cs`, `TestSceneSliderLateHitJudgement.cs` | Tracking acquisition/loss/recovery, held keys and invalid transfers, short sliders, early/late/missed heads, repeats/ticks, early versus nominal tail and equal-time nested ordering |
| 3 | H08, A16: `TestSceneSpinnerInput.cs`, `TestSceneSpinnerJudgement.cs`, `TestSceneSpinnerRotation.cs` | Complete cursor-to-result behavior, threshold boundaries, bonus spins, reversals, centre crossings, large angular steps and sparse/dense samples |
| 4 | H09/H10, A17–A19: shared `ScoreProcessorTest.cs`, `TestSceneScoreProcessor.cs`, `TestSceneDrainingHealthProcessor.cs`, and ruleset `OsuHealthProcessorTest.cs` | Full mixed-object score/count/combo/accuracy sequences, terminal rank, HP0/5/10, breaks, actual failure time and no post-failure mutation |
| 5 | A23: `TestSceneReplayRecording.cs`, `TestSceneReplayStability.cs`, and shared `FramedReplayInputHandlerTest.cs` | Real upstream recording/sampling and replayed input outcomes; local pause, seek and replay identity checks; do not expand into legacy container support |
| 6 | H11, A20 and implemented audio intent: `TestSceneOsuHitObjectSamples.cs`, shared `TestSceneHitObjectSamples.cs` and `TestSceneGameplaySamplePlayback.cs` | Sample eligibility, missing candidates, early/nominal tails and ordered intent; distinguish observed upstream requests from browser playback evidence |

For each batch, execute the original relevant upstream tests or real-behavior
adapter and the ports. Compare full ordered traces, not just final scores.
Fix implementation mismatches with regression cases; never refresh expectations
merely to make a port pass. Apply the existing matching policy and document
measured frame dependence without making Odin judgement depend on rendering.

Exit per batch: mapped cases pass locally on native/WASM and have independent
pinned upstream evidence; remaining cases and divergences stay explicit.

### 4. Exercise cadence, workloads and browser boundaries

Run every integrated gameplay fixture with direct boundary stepping and
30/60/120/144 Hz schedules, plus 50/100/250 ms stalls around critical events.
Run upstream under matching schedules and retain its observed variation; require
Odin outcomes to remain invariant. Vary recorder/input density separately from
presentation cadence, especially for spinners and slider tracking.

Complete dense simultaneous, long-slider/spinner, 10,000-object and three-minute
mixed-session measurements. Include creation/calibration, event work, arena and
recording/output high water, WASM pages, allocation-free advance/reset and
transactional capacity exhaustion. Extend existing workload checks rather than
treating a transport-only workload as complete gameplay validation.

For implemented browser services, close available cross-browser validation gaps
and report unavailable executables as blockers. Add physical input, sampled
presentation and real audio/loop lifecycle checks as browser gameplay lands,
following the [browser plan](../browser-gameplay.md). A12/A21/A22 and the remaining
H11 gates require that integration; mock services cannot close them.

### 5. Make the coverage reproducible and enforce completion

Keep fast local ports in `npm --prefix engine test`. Extend the dedicated pinned
upstream runners for integrated scenarios and document their commands in the
reference-host README. Provide an aggregate compatibility command/job that runs
H01/H02, geometry, preparation, component and new scenario comparisons with clean
pinned checkouts and locked restore. Its required acceptance run must fail on
missing prerequisites or skipped required cases, rather than report success.
Do not imply that the default local test command executes upstream comparisons.

Run local tests plus all affected upstream suites after each implementation
batch; run the aggregate acceptance suite before closing the backfill. Update
[traceability](traceability.md), [status](../status.md) and hashed findings only
from executed results. Completion requires mapped in-scope ports to pass, all
required scenario/schedule observations to exist, and no unexplained discrete
differences. Preserve separate labels for local regression, native/WASM parity,
pinned component evidence and whole-scenario upstream acceptance.


### Complete-scene drawable comparisons

Run `npm --prefix engine run compare:scene:upstream` with the pinned checkout and
.NET environment described in the reference-host README. It verifies source pins,
uses locked restore and rebuilds the real drawable host. The optional
`--reuse-build` argument is only for a previously built development host.
`observe_presentation` enables the default ruleset config for slider snaking;
legacy scenario fixtures retain their prior adapter setup.

The runner writes fixture, observation and comparison hashes to
`engine/reference/findings/m3-scene-presentation.json`. Its current comparison
scope is visible slider body clipping, slider ball position/presence, tracking
indicator presence and spinner progress (including zero). Recorded nested states
are not yet fully compared. It exits unsuccessfully on the retained
spinner and tracking differences. Do not relax those assertions or close A22 from local
scene parity. Extend field coverage and pinned equivalent test ports before
claiming complete presentation acceptance.


## W07 pause/UI backfill

The [W07 finding index](../../engine/reference/findings/m3-lifecycle.json) records
source hashes and local mappings for `TestScenePause`, `TestScenePauseInputHandling`,
`TestScenePauseWhenInactive`, and `TestScenePlayerLoader`. The existing real Player
adapter executed the three source-derived `player-failure-hp*` scenarios. It does
not drive PauseOverlay/OsuResumeOverlay, application focus or PlayerLoader retry;
those exact visual test setups/sequences/assertions are not ported/executed by W07.
Extend the pinned visual host before claiming their upstream acceptance. The
browser's explicit Resume, immediate retry and lack of pause-menu loop are
intentional validation UI policy, not an exact port of lazer cooldown/cursor flows.
Mods, mania, account/score import/submission and menu styling remain outside scope.

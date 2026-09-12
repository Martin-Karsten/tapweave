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
| H04 | slider length/ticks/tail | degenerate ends, repeats, min-distance ticks, NaN tick disable | exact children/times |
| H05 | slider tracking cadence | same timestamped input at 30/60/144 Hz and 100 ms stalls | separate invariant results from frame transitions |
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

Malformed-line observations preserve upstream's actual catch-and-continue behavior. The adapter records an exception and rethrows it into the original decoder recovery loop. The comparison separately verifies Tapweave's stricter typed, transactional rejection policy. H03/H04 are implemented below; H05–H12 remain future experiments.

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

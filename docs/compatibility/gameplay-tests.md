# Gameplay test backfill

This batch covers already implemented unmodded osu!standard behavior against
the revisions in [the source manifest](../../engine/reference/source-manifest.json).
It adds **154 fixture cases**: 116 gameplay scenarios, 36 health component cases,
and two local workloads. Schedule repetitions are not counted as new cases.
The [retained findings](../../engine/reference/findings/m2-gameplay-backfill.json)
contain source-file hashes, upstream method mappings, adaptations, fixture and
observation hashes, compared fields and remaining limitations.

## Running and extending the suite

From the repository root, using the pinned compiler and Node 24:

```sh
npm --prefix engine test
npm --prefix engine run test:simulation:upstream
npm --prefix engine run test:gameplay:upstream
node engine/scripts/retain-gameplay-findings.mjs
```

Set up the clean pinned checkouts and locked .NET dependencies as described in
the [reference-host instructions](../../engine/reference-host/README.md).
`test:compatibility` runs the existing M0/M1 comparisons and both M2 comparison
suites. Upstream execution is explicit; the normal test command needs no .NET
restore or downloaded lazer checkout beyond its retained source requirements.
`--filter=<id substring>` supports investigation, but filtered results cannot be
retained as full-suite findings. Comparison failures make the command fail.

Add gameplay fixtures in
[gameplay-fixtures.mjs](../../engine/scripts/gameplay-fixtures.mjs), recording
source methods and original assertions. Source-derived cases identify the
production classes searched/read when no equivalent test was selected. Keep the
native/WASM transports thin: they prepare a real map, create a production runtime
session, submit live input or replay, and serialize its journal and final state.
They contain no replacement judgement, scoring, health or interpolation logic.
The closed [observation schema](../../engine/gameplay_trace/gameplay.schema.json)
is checked on every local observation. Malformed-batch tests cover cleanup after
partial decoding and failure after an earlier fixture has produced output.

## Coverage and independent evidence

| Family | Added cases | Evidence |
| --- | ---: | --- |
| Circle area, early/no-hit and hit-window boundaries | 61 | TestSceneHitCircleArea, TestSceneMissHitWindowJudgements; source-derived adjacent f64 boundaries at OD0/5/10 |
| Note lock and equal-time input consumption | 4 | TestSceneStartTimeOrderedHitPolicy adaptations and a source-derived same-time regression |
| Slider key history, follow area, early/late judgements | 34 | TestSceneSliderInput, TestSceneSliderFollowCircleInput, TestSceneSliderEarlyHitJudgement, TestSceneSliderLateHitJudgement |
| Spinner cursor input | 5 | TestSceneSpinnerJudgement and SpinFramesGenerator |
| Real Player health, breaks and failure | 10 | Player, OsuHealthProcessor and DrainingHealthProcessor source-derived sessions at HP0/5/10, plus the TestHitNothing empty-replay Player port |
| Real Player recording | 2 | Both TestSceneReplayRecording methods |
| Health components | 36 | 18 OsuHealthProcessorTest minimum/maximum ports; 18 combo-quality regressions |
| Dense and long local workloads | 2 | 10,000 successful circle judgements and a ten-minute replay |

The 116 gameplay cases run at direct advancement and 30/60/120/144 Hz, each with
0/50/100/250 ms stalls. Complete local observations must match across schedules
and serialize identically in native and WASM. Workloads compare direct advancement
with a stalled 60 Hz schedule and assert the complete expected judgement count,
preventing an early failure from masquerading as a successful stress run.

The controlled drawable adapter executes real playfield input selection,
drawable judgement and score processing. Replay cases use the real
OsuFramedReplayInputHandler. It compares ordered object/result/maximum/score/combo
and final score, counts, accuracy, rank and combo. Marked cases additionally
compare non-looping sample request delivery frame, object and volume. Semantic
request time is projected to the first declared upstream update at/after that
time; original local times and raw upstream observations remain unchanged. This
is an exact clock projection, not a timing tolerance. Missing local assets
remain explicit silence. No music or community artwork is required.

The Player adapter uses the pinned test runner and **Player**, preserving normal
failure behavior. It compares per-result and final health within 1e-9 and failure
state. Player emits visual judgements after failure but rejects them from scoring;
raw observations retain these `FailedAtJudgement` records, and the accepted
stream is compared with Odin's committed journal. Recording tests assert retained
left/right/smoke actions, including press and release at one frozen timestamp.

## Adaptations and remaining acceptance

The source tests are ported as fixtures and assertions; the original NUnit
assemblies are not claimed to have run. Each port also executes an adapter using
the actual pinned classes. The suite is a bounded regression corpus, not a count
of every missing test in lazer.

- Circle exact-edge input is translated to the origin so the f32 radius is
  representable without a screen-transform round trip. Browser coordinate
  acceptance remains A12 work.
- Note-lock source tests install custom windows. The ports preserve input/order
  setup and use the actual OD5 result bands supported by the production profile.
- Programmatic slider multiplier/tick settings can exceed legacy decoder limits.
  Equivalent beat length, velocity and tick rate preserve duration and tick
  distance within the supported decoder range; no decoder clamp is bypassed.
- Upstream automatic judgements are frame-quantized. The adapter includes exact
  input boundaries. Player additionally includes boundaries obtained from its
  actual prepared objects, including just before object ends for sampled health
  drain. Its applied schedule is retained in the observation. The pinned audio
  clock interpolator's allowable error is set to zero through an explicitly
  checked reflected field, disabling wall-clock smoothing of the prescribed
  test clock. Local cadence invariance does not prove arbitrary upstream
  render-cadence or automatic-judgement-time equivalence. Existing delivery
  experiments remain separate evidence.
- Both recorder source assertions are ported, but equality of every adaptively
  sampled recorder frame, angular subdivision and full seek/pause behavior still
  needs broader upstream observations. Existing local replay/seek/pause tests
  remain active.
- The three upstream ignored SliderInput methods (`TestVeryShortSliderMissHead`,
  `TestVeryShortSlider`, `TestTailLeniency`) explicitly cite insufficient headless
  timing precision. They are not treated as passing upstream evidence. The late
  slider corpus is bounded and does not yet include all curved catch-up and
  stream methods. Full spinner reversal/threshold permutations remain broader
  acceptance work beyond the existing component tests and five cursor ports.
- Classic/mod variants, other rulesets, editing and legacy replay containers are
  outside the current profile. Browser coordinate/presentation/device-audio gates
  A12/A21/A22 follow the browser implementation. Asset fallback, loops and audible
  playback are not certified by discrete sample requests.

Full A13–A20/A23 remains open until those broader acceptance scenarios are
resolved. This batch found and corrected missed-tail combo health, slider key
history, note-lock result publication order, and missing slider-tail sample
bindings. The fixes use the existing shared engine ownership and reservation
model; none adds allocation to gameplay hot paths.

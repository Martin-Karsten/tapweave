# Beatmap preparation

## Decode and defaults

**SC.** Stable `.osu` format versions end at 14 ([`LegacyDecoder.LATEST_VERSION`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyDecoder.cs#L18-L31)); lazer-native encoding starts at 128 ([`LegacyBeatmapEncoder.FIRST_LAZER_VERSION`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapEncoder.cs#L20-L29)). The pinned decoder accepts the parsed integer and branches at `<5`, `<6`, and `<128`; its tests cover v4/v6 and v128 fractional coordinates. Engine profile `lazer-2026.804.2` accepts versions 1–14 and exactly 128, and rejects the undefined gap 15–127 and future versions >128 rather than guessing. It also rejects missing/invalid headers, other modes, unsupported object types, non-finite ordinary numbers, and out-of-budget resources. **UR-FMT-1:** versions 1–3 lack a broad upstream fixture corpus; H01 now verifies the bounded default/coordinate/time corpus for those versions; see the [M0 findings](../status.md).

For format `<5`, lazer applies a 24 ms early-format timing offset ([`EARLY_VERSION_TIMING_OFFSET`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapDecoder.cs#L25-L76)). Difficulty is clamped: CS/HP/OD/AR to `[0,10]` (AR defaults to OD if absent), slider multiplier to lazer’s allowed range, tick rate to `[0.5,8]` ([decode restrictions](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapDecoder.cs#L115-L137)). Legacy defaults are applied before sections are parsed, so absent keys are not equivalent to zero ([`ApplyLegacyDefaults`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapDecoder.cs#L193-L206)).

Top-level objects are stable-sorted by `StartTime`, then defaults and samples are applied ([decode completion](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapDecoder.cs#L85-L113)). Preserve source ordinal as the tie-break.

## Difficulty-derived values

Let `range(d, low, mid, high)` be linear from low→mid for `d∈[0,5]` and mid→high for `d∈[5,10]`.

- circle scale: `(1 - 0.7 × (CS - 5) / 5) / 2 × 1.00041`; radius is `64 × scale`. The final factor is the replay-compatibility gamefield-rounding allowance ([`CalculateScaleFromCircleSize`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Objects/Legacy/LegacyRulesetExtensions.cs#L43-L59)).
- preempt: `range(AR, 1800, 1200, 450)` ms, calculated with the integer difficulty-range path; fade-in is `400 × min(1, preempt/450)` ([same source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/OsuHitObject.cs#L170-L181)).
- hit windows are specified in [input and judgement](input-and-judgement.md).

Worked example: AR5 gives 1200 ms preempt and 400 ms fade-in. OD5 gives 49.5/99.5/149.5 ms Great/Ok/Meh windows. A circle at 10 s becomes presentation-alive at 8.8 s.

## Timing and control points

Each timing line may produce timing, difficulty, effect, and sample control points. `NaN` is allowed only for inherited beat length, where it disables tick generation ([decoder](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapDecoder.cs#L484-L568)). Red points establish beat length/time signature; inherited points establish slider velocity and tick generation while inheriting timing.

**SC.** Coincident entries are accumulated. Timing-change-derived values are inserted first; non-timing changes are appended and therefore win for duplicate control-point types when pending points are flushed ([precedence implementation](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapDecoder.cs#L571-L602)). Queries use binary search with type-specific fallback; sample lookup before the first point uses the first sample point, while difficulty uses `DifficultyControlPoint.DEFAULT` ([`LegacyControlPointInfo`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Legacy/LegacyControlPointInfo.cs)). Sample selection intentionally uses `StartTime + 6 ms` for heads and `EndTime + 5 ms` for tails around stable’s 5 ms leniency ([sample application](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapDecoder.cs#L155-L190)).

## Sliders: path, duration, and children

Path control points may begin linear, perfect-curve, Catmull, or Bézier/B-spline segments. Repeated points split segments. [`SliderPath.calculatePath`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Objects/SliderPath.cs#L287-L424) delegates approximation to the matching framework [`PathApproximator`](https://github.com/ppy/osu-framework/blob/f02756c5aa5032e6d04729922702b8d56c4bc2eb/osu.Framework/Utils/PathApproximator.cs). A perfect curve with other than three points falls back; invalid circular arcs fall back to the B-spline path. Catmull output is later simplified with compatibility-specific spacing.

The polyline is shortened or extended to declared pixel length. The pinned implementation deliberately skips extension when the final two calculated vertices coincide and retains an extra cumulative-length entry. Otherwise it adjusts the final remaining segment after trimming excess lengths for shortening ([length adjustment](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Objects/SliderPath.cs#L426-L484)). This behavior was reproduced by the independent M1 geometry host. No independently chosen geometric tolerance is compatible: Odin must port the pinned algorithms and float behavior, then compare vertices/cumulative lengths.

For a slider:

```text
adjustedBeatLength = precisionAdjusted(beatLength, SliderVelocityMultiplier)
velocity        = 100 × SliderMultiplier / adjustedBeatLength   (osu! px/ms)
scoringDistance = velocity × beatLength
spanDuration    = pathDistance / velocity
duration        = spanCount × spanDuration
endTime         = startTime + duration
tickDistance    = scoringDistance / SliderTickRate
```

[`Slider.ApplyDefaultsToSelf`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Slider.cs#L158-L170) supplies the concrete values. `precisionAdjusted` intentionally reproduces stable floating behavior and clamps the inherited beat-length surrogate ([`GetPrecisionAdjustedBeatLength`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Objects/Legacy/LegacyRulesetExtensions.cs#L13-L40)); an algebraically simplified formula is not an exact substitute. [`SliderEventGenerator`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Objects/SliderEventGenerator.cs) emits head, ticks, repeats, legacy-last-tick, and tail. Ticks too near a span end are suppressed. The legacy-last-tick is `max(start + duration/2, finalSpanEnd - 36 ms)` and is not a default lazer scoring child; the real tail is at nominal end.

Worked example: beat length 500 ms, slider multiplier 1.4, SV multiplier 1, declared distance 280 px, two spans, tick rate 1. Velocity is `140/500 = 0.28 px/ms`; span duration is 1000 ms, total duration 2000 ms, and tick distance is 140 px. Each span contains one interior tick; a repeat occurs at 1000 ms and the tail at 2000 ms after start.

## Stacking

`OsuBeatmapProcessor` updates combo information then applies stacking. Version `>=6` uses modern reverse traversal; older maps use the old algorithm ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Beatmaps/OsuBeatmapProcessor.cs)). Stack distance is `<3` osu! px. Time threshold is integer-truncated preempt multiplied by `StackLeniency`. Modern stacking handles slider-end overlaps by shifting intervening objects negatively. Modern stacking skips spinners in its main traversal. The old algorithm can assign a spinner a stack height, but its stack offset remains zero.

## Prepared-data invariants

- UTF-8 strings are validated and owned by the prepared map.
- All times are finite f64 milliseconds. Prepared geometry records expose f64 coordinates, while source algorithms preserve upstream f32 Vector2 intermediate rounding where required; render buffers store f32 coordinates.
- Objects have stable `object_id = source ordinal`; components have stable per-object ordinals.
- Top-level and nested schedules are pre-sorted; no session mutates them.
- Path cumulative lengths are monotonic; zero-length segments are retained only where upstream behavior requires them.
- Sample descriptors are resolved to ordered candidate names, not to loaded audio buffers.

## Tests and evidence

Use pinned tests for [`SliderPath`](https://github.com/ppy/osu/tree/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Tests/Rulesets/Objects), [`OsuBeatmapProcessor`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneNoSpinnerStacking.cs), and slider application ([`TestSceneSliderApplication`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneSliderApplication.cs)).

- **UR-FMT-1:** versions 1–3 default/branch corpus; H01 resolves the M0 default/coordinate/time projection; M1 now covers integrated prepared output in the recorded corpus.
- **UR-GEO-1:** cross-runtime float path drift on pathological Béziers; H03 compares raw vertices and cumulative lengths from pinned framework and Odin; the M1 finding index records the executed corpus.
- **UR-CP-1:** every coincident red/green ordering permutation; H02 now passes the 24 two-red/two-inherited permutations and additional replacement/fallback fixtures; see the [hashed observations](../../engine/reference/findings/m0.json).

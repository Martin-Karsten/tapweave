# Input and judgement

## Coordinate mapping and actions

The logical playfield is 512×384 osu! pixels ([`OsuPlayfield.BASE_SIZE`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/UI/OsuPlayfield.cs)). Lazer fits a 4:3 container, scales its width from 512, and optionally shifts gameplay down by eight logical pixels for storyboard alignment ([`OsuPlayfieldAdjustmentContainer`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/UI/OsuPlayfieldAdjustmentContainer.cs)). Odin stores input in gamefield coordinates; the JavaScript host snapshots the inverse canvas transform at event receipt. Resize after receipt cannot move an input.

Production actions are `LEFT`, `RIGHT`, and `SMOKE`; only the first two trigger hits/tracking. Keyboard and mouse bindings map to the same action state ([default bindings](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/OsuRuleset.cs#L65-L74)). Input records are complete snapshots with a strictly increasing sequence, raw/effective time, position, action bits, pointer source, and focus epoch. Equal-time records retain sequence order.

## Hit windows

For OD `d`, half-windows are:

```text
Great = floor(range(d, 80, 50, 20)) - 0.5 ms
Ok    = floor(range(d,140,100, 60)) - 0.5 ms
Meh   = floor(range(d,200,150,100)) - 0.5 ms
Miss  = 400 ms
```

These values and the fixed miss window are source-confirmed in [`OsuHitWindows`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Scoring/OsuHitWindows.cs). Boundaries are inclusive because `HitWindows.ResultFor()` selects a result when absolute offset is no greater than its window ([base implementation](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/HitWindows.cs)). OD5 therefore produces Great through ±49.5 ms, Ok through ±99.5, Meh through ±149.5, then `ResultFor()` returns Miss through ±400 ms and None outside that range. The non-user circle path instead checks `!CanBeHit(timeOffset)`: automatic miss becomes eligible strictly after the Meh window (OD5: after +149.5 ms), not after +400 ms. Pinned component observations are recorded in [M2 status](../status.md#m2-headless-sessions); drawable dispatch and note-lock acceptance remain open.

## Default note lock

Default lazer uses `StartTimeOrderedHitPolicy` ([playfield setup](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/UI/OsuPlayfield.cs#L68-L91)). A prior unjudged hit circle blocks a future circle only while current time is before that prior circle’s start. Once the prior start is reached, successfully hitting a later circle force-misses prior blocking circles. Objects at exactly the same start time are allowed. Nested non-circle components and spinners do not block ([policy](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/UI/StartTimeOrderedHitPolicy.cs)).

Classic mod instead installs `LegacyHitPolicy`, blocks on earlier valid objects across the full configured range, includes a 3 ms separation leniency, and may make hit slider heads block underlying input until fully judged ([classic mod](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Mods/OsuModClassic.cs), [policy](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/UI/LegacyHitPolicy.cs)). This is not default behavior.

## Circle transition

```text
pending --press edge + in radius + hittable--> ResultFor(offset)
pending --time > start+MehWindow------------> Miss
```

`DrawableHitCircle.CheckForResult` first checks the miss deadline for non-user updates, then maps user offset to a result, asks the hit policy, and applies the result with hit position ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableHitCircle.cs#L137-L188)). A held action does not generate another press edge. If two inputs share a time, sequence determines which circle sees the edge first; one physical edge may hit at most one head.

## Slider transition and children

A slider consists of a timed head circle, zero or more ticks/repeats, a tail circle, and an aggregate parent result. Default lazer requires head accuracy. The head uses circle timing/radius. Tracking thereafter requires:

- a valid held osu! action;
- the cursor in the follow area around the ball/current child;
- the pinned head-action restriction for overlapping held keys. The other key
  becomes valid after it was released in a prior tracking sample; this is not a
  blanket requirement to release both keys.

Tracking may be acquired after a successful head, lost, and recovered. The expanded follow radius while already tracking and the special head/tick-range checks are implemented by [`SliderInputManager`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/SliderInputManager.cs). Each nested drawable judges at its scheduled time from current tracking; [`DrawableSliderTick`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSliderTick.cs), [`DrawableSliderRepeat`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSliderRepeat.cs), and [`DrawableSliderTail`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSliderTail.cs) define result types.

After the tail is judged and nominal end time reached, the parent aggregate result is calculated. In default lazer, the parent is ignored for scoring and receives a visual max result if any nested component hit, otherwise its minimum. With Classic slider behavior, all nested hit objects form the stable-like fraction: all is Great, none is Miss, `>=0.5` is Ok, otherwise Meh ([`DrawableSlider.CheckForResult`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSlider.cs#L293-L326)).

**OD deterministic rule.** The simulator does not run the spike’s fixed 1 ms loop. It advances between input and scheduled judgement events. For live input, cursor position is sample-and-hold between records; for replay it is linearly interpolated. At each child timestamp it evaluates action-lock and follow-area predicates exactly. Presentation may calculate continuous area-entry roots, but those roots cannot change past discrete judgements. This removes cost proportional to elapsed milliseconds and makes results independent of RAF. H05 measures the intentional difference against lazer schedules.

## Spinner transition

Spinner requirements derive from duration and OD:

```text
clearRPM    = range(OD, 90,150,225)
completeRPM = range(OD,250,380,430)
required    = trunc(clearRPM/60 × durationSeconds + 0.0001)
maxBonus    = max(0, trunc(completeRPM/60 × durationSeconds + 0.0001)
                     - required - 2)
```

See [`Spinner.ApplyDefaultsToSelf`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Spinner.cs#L61-L97). Cursor angular deltas are normalized to `[-180,180]`, multiplied by absolute gameplay rate, and accumulated only during spinnable time while an action is held ([`SpinnerRotationTracker`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Skinning/Default/SpinnerRotationTracker.cs)). Direction reversal does not grant cheese rotations: `SpinnerSpinHistory` tracks completed signed spins and maximum progress in the current spin ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/SpinnerSpinHistory.cs)).

At end: progress `>=1` gives Great, strictly `>0.9` gives Ok, strictly `>0.75` gives Meh, otherwise Miss ([`DrawableSpinner.CheckForResult`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSpinner.cs#L247-L273)). Spinner tick and bonus results occur as whole spins complete.

**OD deterministic rule.** Each position record contributes the shortest signed angular delta, capped by the upstream normalization. Replay interpolation inserts deterministic subdivision whenever a segment would be ambiguous or exceed 180°; the recorder must emit important spinner frames at least every 90°—an upstream TODO acknowledges this dependency. Native/WASM use identical f64 `atan2` inputs and compare total rotation with a documented tolerance.

## Completion, focus, and late input

All top-level and scoring nested components must reach terminal results; then score processing completes. Focus loss creates an all-actions-released snapshot before requesting pause. Inputs received with effective time earlier than committed simulation time return `LATE_INPUT` and do not mutate state; the browser must enqueue DOM events before advancing to the latest audio time. Replays are loaded ahead of simulation and cannot be late.

## Worked edge cases and tests

- Two circles at 1000 ms can both be hit by two equal-time press edges in sequence order.
- A 1000 ms circle still pending when a hittable 1100 ms circle is hit at 1100 ms is force-missed first under default note lock.
- Moving outside a slider follow circle after one tick, then returning with the original action still held, allows later recovery; an already-held other key cannot take over until the pinned action restriction
  has been lifted by an earlier released-other-key tracking sample.
- A 2000 ms spinner at OD5 requires `trunc(150/60×2+0.0001)=5` spins.

Pinned tests: [`TestSceneStartTimeOrderedHitPolicy`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneStartTimeOrderedHitPolicy.cs), [`TestSceneSliderInput`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneSliderInput.cs), [`TestSceneSliderFollowCircleInput`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneSliderFollowCircleInput.cs), [`TestSceneSpinnerJudgement`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneSpinnerJudgement.cs), and [`SpinnerSpinHistoryTest`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/SpinnerSpinHistoryTest.cs).

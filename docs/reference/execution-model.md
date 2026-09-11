# Execution model

## Source-confirmed dependency graph

`Player.load()` obtains a playable beatmap, creates a `DrawableRuleset`, applies the beatmap to score and health processors, builds the gameplay clock/container hierarchy, and wires each new judgement to health first and score second. See [`Player.load`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Screens/Play/Player.cs#L227-L429). The ordering is observable: a result snapshots health/failure state, then the score processor may suppress post-failure judgements.

```text
WorkingBeatmap
  -> GetPlayableBeatmap(ruleset, mods)
  -> decoder + converter + OsuBeatmapProcessor
  -> immutable-in-practice IBeatmap
  -> DrawableOsuRuleset / OsuPlayfield / Drawable* objects
  -> NewResult
       -> HealthProcessor.ApplyResult
       -> ScoreProcessor.ApplyResult
  -> score complete + storyboard complete
  -> results preparation
```

`DrawableRuleset<T>` creates the frame-stability container, audio container, input manager, playfield adjustment, playfield and drawable hit objects, then applies drawable mods after objects are loaded ([constructor/load](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/UI/DrawableRuleset.cs#L119-L223)). `Playfield` manages lifetime, pooling, nested objects, sample preloading, and result forwarding ([`Playfield`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/UI/Playfield.cs)).

## Clocks and update ordering

**SC.** `GameplayClockContainer` wraps a `FramedBeatmapClock`; its `CurrentTime` is the time visible to gameplay drawables ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Screens/Play/GameplayClockContainer.cs)). `DrawableRuleset.FrameStableClock` is injected as `IGameplayClock`, and frame-stable components contain score and health processors before the drawable ruleset in the visual hierarchy ([wiring](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Screens/Play/Player.cs#L357-L470)).

**SC.** Drawable gameplay is update-driven. `DrawableHitObject` checks automatic result transitions as its clock crosses deadlines; slider tracking is recomputed in `SliderInputManager.Update`; slider ball/body progress is updated in `DrawableSlider.UpdateAfterChildren`; spinner rotation is accumulated in `SpinnerRotationTracker.Update`. Relevant sources: [`DrawableHitObject`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Objects/Drawables/DrawableHitObject.cs), [`SliderInputManager`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/SliderInputManager.cs), and [`SpinnerRotationTracker`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Skinning/Default/SpinnerRotationTracker.cs).

This means “same timestamped input” does not guarantee identical internal tracking history under arbitrary update schedules. The harness must classify results as discrete-stable, numeric-tolerant, or frame-dependent.

## Walkthrough: load to completion

1. Decode `.osu`, normalize legacy defaults and control points, sort top-level objects by start time, apply defaults/samples, convert to osu!standard if required, then apply combo information and stacking.
2. Score processing simulates an autoplay perfect play while applying the beatmap to establish maximum base score, maximum combo portion and judgement count. The order is explicitly guarded in [`ScoreProcessor.ApplyBeatmap`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/ScoreProcessor.cs#L220-L237).
3. Drawable objects become alive at `StartTime - TimePreempt`; input flows through the ruleset input manager and playfield hit policy.
4. A drawable applies a result. The playfield forwards it; the player updates health then score. Nested slider/spinner results participate individually.
5. Health reaching the fail condition triggers failure unless a mod overrides it. `Player.PerformFail()` starts the fail sequence and concludes the score after ensuring the triggering judgement is processed ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Screens/Play/Player.cs#L951-L1025)).
6. A successful play completes when `ScoreProcessor.HasCompleted` and the storyboard has ended; results preparation is asynchronous and may delay display ([completion flow](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Screens/Play/Player.cs#L805-L947)).

## State model required in Odin

```text
empty -> loading -> prepared -> ready -> running <-> paused
                                  |        |  |
                                  |        |  +-> failed -> finished
                                  |        +----> passed -> finished
                                  +-------------> disposed
```

Loading is transactional: failure leaves the previous prepared map usable unless the caller requested replacement with `DROP_OLD`. Session reset never reparses or mutates prepared data. Disposed handles reject all calls.

## Edge cases and worked example

- A map with no hit objects is rejected by `Player.loadPlayableBeatmap`, not treated as an instant pass.
- Rewinding requires result reversion in lazer. Odin v2 does not expose arbitrary live rewind; replay seeking restores a checkpoint then deterministically resimulates.
- If an OD5 circle at 10,000 ms is hit at 10,049.5 ms, it is exactly within the 49.5 ms Great boundary. If the drawable update jumps from 10,040 to 10,060, a timestamped input still carries its own effective time; automatic miss processing must happen after equal-time inputs in Odin.

## Relevant upstream tests

- [`TestSceneOsuPlayer`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneOsuPlayer.cs)
- [`TestSceneReplayStability`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneReplayStability.cs)
- generic scoring and health tests under [`osu.Game.Tests/Rulesets/Scoring`](https://github.com/ppy/osu/tree/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Tests/Rulesets/Scoring)

## Unresolved evidence

**UR-EXEC-1.** Exact same-frame ordering between multiple drawable children can depend on the framework tree. Experiment H07 records result order for coincident slider children, top-level circles, and an input at the same timestamp across 30/60/144 Hz and injected stalls. Odin’s normative tie-break remains `(time, phase, topLevelIndex, componentIndex, inputSequence)` regardless of the outcome; any upstream variation is recorded as an intentional deterministic divergence.

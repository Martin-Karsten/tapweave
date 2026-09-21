# Scoring, health, failure, and results

## Result aggregation and combo

The score processor receives every judgement in emitted order. It snapshots combo, ignores new score changes after failure unless configured otherwise, increments result counts, changes combo, updates accuracy portions, applies bonus/combo portions, and finally refreshes total score ([`ScoreProcessor.ApplyResultInternal`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/ScoreProcessor.cs#L238-L285)). Result properties—not object type guesses—define whether a result increases/breaks combo, affects accuracy, is scorable, or is bonus ([`HitResultExtensions`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/HitResult.cs)). Odin must port that table explicitly.

Base values are 10 small tick, 30 large tick, 150 slider tail, 50 Meh, 100 Ok, 200 Good, 300 Great/Perfect, 10 small bonus, and 50 large bonus ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/ScoreProcessor.cs#L341-L386)). This is the shared cross-ruleset table; unmodded osu!standard emits Great/Ok/Meh/Miss plus tick/bonus results (`Good` belongs to other rulesets/mods).

## Accuracy and lazer score

For applied accuracy-affecting judgements:

```text
accuracy = sum(base(actual)) / sum(base(max result for each judgement))
```

This general form correctly includes only result types whose table says they affect accuracy. It must not be simplified to top-level circle counts.

For each non-bonus scorable result, combo portion increases by:

```text
base(maxResult) × comboAfter ^ 0.5
```

where `0.5` is `COMBO_EXPONENT` ([definition](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/ScoreProcessor.cs#L22-L31)). A perfect autoplay simulation establishes maximum combo portion and maximum accuracy judgement count. At progress:

```text
comboProgress    = currentComboPortion / maximumComboPortion
accuracyProgress = currentAccuracyJudgementCount / maximumAccuracyJudgementCount
rawScore = 500000 × accuracy × comboProgress
         + 500000 × accuracy^5 × accuracyProgress
         + bonusPortion
scoreWithoutMods = round(rawScore)
totalScore       = round(scoreWithoutMods × modMultiplier)
```

See [`ComputeTotalScore`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/ScoreProcessor.cs#L416-L434). Unmodded multiplier is 1. Spinner bonus may push a score over one million.

Worked example: suppose a synthetic two-judgement map has both max results Great. Results Great then Ok yield accuracy `400/600 = 2/3`. Combo-after values are 1 and 2, so current and maximum combo portions are equal if neither result breaks combo. At completion, score is `round(500000×2/3 + 500000×(2/3)^5) = 399,177` before bonus.

## Slider aggregate nuance

Default slider head accuracy produces an accuracy judgement at the head; ticks/repeats/tail use their own result semantics. The parent slider result is an aggregate that flows through score processing, but in default lazer only the head-accuracy and per-child results contribute: the parent value itself is visual (max if any nested component hit, otherwise minimum, per [input and judgement](input-and-judgement.md)). Classic’s `NoSliderHeadAccuracy` changes the parent and child contract ([`OsuModClassic`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Mods/OsuModClassic.cs)). The spike’s “head accuracy plus one combo per child” is therefore explicitly non-production.

## Health and failure

Health begins at 1 and is clamped to `[0,1]`. Each result first records health/failure-at-judgement, then applies result health, then checks default and mod fail conditions ([`HealthProcessor`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/HealthProcessor.cs)). `DrainingHealthProcessor` continuously subtracts `DrainRate × elapsedGameplayMs`; it computes a map-specific drain rate by simulating maximum results and searching for the target minimum health determined from HP difficulty ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/DrainingHealthProcessor.cs)). Drain begins at the first object and excludes configured break periods through gameplay integration.

osu!standard result deltas include:

| Result | Health change |
|---|---:|
| miss | `range(HP,-0.03,-0.125,-0.20)` |
| small/large tick miss | `range(HP,-0.02,-0.075,-0.14)` |
| small tick hit | `+0.02` |
| slider tick | `+0.015` |
| slider head/tail/repeat | `+0.02` |
| Meh / Ok / Great | `+0.002 / +0.011 / +0.03` |
| small / large bonus | `+0.0085 / +0.01` |

At the last hit of a combo, an additional `+0.07`, `+0.05`, or `+0.03` is awarded for perfect, good, or otherwise-hit combo quality. See [`OsuHealthProcessor`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Scoring/OsuHealthProcessor.cs).

Default failure occurs when clamped health reaches zero within framework precision (`AlmostBigger(0, health)`). NoFail/SuddenDeath/Perfect and Classic health alter this; they are outside the unmodded normative path.

The Player layer owns what failure does. Solo `Player.PerformFail()` starts the fail sequence and freezes scoring (`ApplyNewJudgementsWhenFailed` defaults to false). Multiplayer overrides it: `MultiplayerPlayer.PerformFail()` only marks the F rank via `ScoreProcessor.FailScore`, sets `ApplyNewJudgementsWhenFailed = true`, and once `HealthProcessor.HasFailed` health never changes again — play, scoring and drain-clamped zero health continue to the map's end ([`MultiplayerPlayer`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Screens/OnlinePlay/Multiplayer/MultiplayerPlayer.cs)). Odin exposes this as the session create record's `fail_policy=1` (mark-and-continue); the default `fail_policy=0` keeps solo terminal failure.

## Result contract

Final results must contain rules identity, map identity, replay identity, score/score-without-mods, accuracy, rank, current/max combo, result counts including nested and bonus types, maximum counts, health/fail/pass state, timestamps, and ordered hit events. Hit events contain time offset, gameplay rate, result, current and previous object identity, and optional positional offset ([`HitEvent`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Scoring/HitEvent.cs)).

Rank uses the base thresholds, with osu!standard preventing S/X when misses exist ([`OsuScoreProcessor`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Scoring/OsuScoreProcessor.cs)). Results become immutable once session state is `PASSED`, `FAILED`, or `ABORTED`.

## Ordering and edge cases

- Health receives a new result before score.
- Equal-time results use the simulator’s stable component order; reversion logic in lazer deliberately neutralizes concurrent order for combo restoration.
- A result that triggers failure still reaches score; in Odin, subsequent judgements are suppressed by default (the Player layer may still emit visual post-failure judgements, which score processing rejects — see [gameplay tests](../compatibility/gameplay-tests.md)). Under the multiplayer `fail_policy=1` the run instead continues: post-failure judgements keep scoring, health stays frozen at zero, and the rank stays F.
- Score maxima are computed from the exact prepared map after mods, never from object-count shortcuts.
- `round` parity must match .NET midpoint-to-even behavior; acceptance fixtures cover `.5` totals.

Pinned tests: [`TestSceneScoring`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneScoring.cs), [`OsuHealthProcessorTest`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/OsuHealthProcessorTest.cs), and [`TestSceneOsuLegacyHealthProcessor`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneOsuLegacyHealthProcessor.cs).

**UR-HP-1.** Floating search convergence and break drain boundaries require H09, which dumps computed drain rate plus health at every result from pinned lazer. Exact result health is tolerance-compared; fail/pass and fail-triggering result are exact. Acceptance stays with A19; no A19 row closes until H09 is executed.

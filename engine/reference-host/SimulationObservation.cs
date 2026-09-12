using System.Text.Json;
using System.Reflection;
using osu.Game.Beatmaps;
using osu.Game.Beatmaps.Timing;
using osu.Game.Rulesets.Objects;
using osu.Game.Rulesets.Judgements;
using osu.Game.Rulesets.Scoring;
using osu.Game.Rulesets.Osu.Scoring;
using osu.Game.Rulesets.Osu.Objects.Drawables;

// Explicit synthetic inputs exercise the real processors. No recreated score,
// window, or spin arithmetic is used by this adapter; no M1 projection involved.
static class SimulationObservation
{
    static HitResult Result(int resultId) => (HitResult)resultId;
    public static void Run(string path)
    {
        using var document = JsonDocument.Parse(File.ReadAllBytes(path));
        var observations = new List<object>();
        foreach (var fixture in document.RootElement.EnumerateArray())
        {
            var kind = fixture.GetProperty("kind").GetString();
            var values = new List<object>();
            switch (kind)
            {
                case "properties":
                    using (var processor = new OsuScoreProcessor())
                    {
                        foreach (var result in HitResultExtensions.ALL_TYPES)
                        {
                            values.Add(new
                            {
                                result = (int)result,
                                base_score = processor.GetBaseScoreForResult(result),
                                hit = result.IsHit(),
                                miss = result.IsMiss(),
                                scorable = result.IsScorable(),
                                accuracy = result.AffectsAccuracy(),
                                increases_combo = result.IncreasesCombo(),
                                breaks_combo = result.BreaksCombo(),
                                tick = result.IsTick(),
                                bonus = result.IsBonus()
                            });
                        }
                    }
                    break;
                case "score":
                    using (var processor = new OsuScoreProcessor())
                    {
                        var maximumResults = fixture.GetProperty("maximum").EnumerateArray().Select(resultElement => Result(resultElement.GetInt32())).ToArray();
                        var objects = maximumResults.Select((maximumResult, objectIndex) => new ExplicitObject(maximumResult) { StartTime = objectIndex * 1000 }).ToArray();
                        var beatmap = new Beatmap { HitObjects = objects.Cast<HitObject>().ToList() };
                        processor.ApplyBeatmap(beatmap);
                        int judgementIndex = 0;
                        foreach (var resultElement in fixture.GetProperty("actual").EnumerateArray())
                        {
                            var result = new JudgementResult(objects[judgementIndex], objects[judgementIndex].Judgement) { Type = Result(resultElement.GetInt32()) };
                            if (fixture.TryGetProperty("failed_before", out var failureFlags) && failureFlags[judgementIndex].GetBoolean())
                            {
                                typeof(JudgementResult).GetProperty(nameof(JudgementResult.FailedAtJudgement))!.SetValue(result, true);
                            }
                            processor.ApplyResult(result);
                            var statistics = processor.GetScoreProcessorStatistics();
                            values.Add(new
                            {
                                total = processor.TotalScore.Value,
                                accuracy = processor.Accuracy.Value,
                                combo = processor.Combo.Value,
                                highest_combo = processor.HighestCombo.Value,
                                numerator = statistics.BaseScore,
                                denominator = statistics.MaximumBaseScore,
                                accuracy_count = statistics.AccuracyJudgementCount,
                                combo_portion = statistics.ComboPortion,
                                bonus = statistics.BonusPortion,
                                rank = processor.Rank.Value.ToString(),
                                counts = Enumerable.Range(0, 17).Select(resultId => processor.Statistics.GetValueOrDefault(Result(resultId))).ToArray()
                            });
                            judgementIndex++;
                        }
                    }
                    break;
                case "windows":
                    var windows = new OsuHitWindows();
                    windows.SetDifficulty(fixture.GetProperty("difficulty").GetDouble());
                    foreach (var offsetElement in fixture.GetProperty("offsets").EnumerateArray())
                    {
                        var offset = offsetElement.GetDouble();
                        values.Add(new { result = (int)windows.ResultFor(offset), can_be_hit = windows.CanBeHit(offset) });
                    }
                    break;
                case "spin":
                    var history = new SpinnerSpinHistory();
                    int sampleIndex = 0;
                    foreach (var deltaElement in fixture.GetProperty("deltas").EnumerateArray())
                    {
                        history.ReportDelta(sampleIndex++, deltaElement.GetSingle());
                        values.Add(new { rotation = (double)history.TotalRotation });
                    }
                    break;
                case "drain":
                    using (var processor = new DrainingHealthProcessor(fixture.GetProperty("drain_start_ms").GetDouble()))
                    {
                        var increases = fixture.GetProperty("increases").EnumerateArray().ToArray();
                        var objects = increases.Select(increaseElement => new HealthObject(increaseElement.GetProperty("amount").GetDouble()) { StartTime = increaseElement.GetProperty("time_ms").GetDouble() }).ToList();
                        var beatmap = new Beatmap { HitObjects = objects.Cast<HitObject>().ToList() };
                        beatmap.Difficulty.DrainRate = (float)fixture.GetProperty("difficulty").GetDouble();
                        foreach (var breakEndElement in fixture.GetProperty("break_end_times").EnumerateArray())
                        {
                            double breakEndTime = breakEndElement.GetDouble();
                            beatmap.Breaks.Add(new BreakPeriod(breakEndTime - 10, breakEndTime));
                        }
                        processor.ApplyBeatmap(beatmap);
                        values.Add(new { drain_rate = processor.DrainRate });
                    }
                    break;
                case "round":
                    foreach (var scoreElement in fixture.GetProperty("values").EnumerateArray())
                    {
                        values.Add(new { rounded = (long)Math.Round(scoreElement.GetDouble()) });
                    }
                    break;
                default: throw new ArgumentException($"Unknown fixture kind: {kind}");
            }
            observations.Add(new { schema_version = 1, id = fixture.GetProperty("id").GetString(), kind, values });
        }
        Console.WriteLine(JsonSerializer.Serialize(observations));
    }
    sealed class HealthJudgement(double amount) : Judgement
    {
        public override HitResult MaxResult => HitResult.Great;
        protected override double HealthIncreaseFor(HitResult result) => amount;
    }
    sealed class HealthObject(double healthIncrease) : HitObject
    {
        public override Judgement CreateJudgement() => new HealthJudgement(healthIncrease);
    }
    sealed class ExplicitJudgement(HitResult maximumResult) : Judgement
    {
        public override HitResult MaxResult => maximumResult;
    }
    sealed class ExplicitObject(HitResult maximumResult) : HitObject
    {
        public override Judgement CreateJudgement() => new ExplicitJudgement(maximumResult);
    }
}

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
    static HitResult Result(int value) => (HitResult)value;
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
                    foreach (var result in HitResultExtensions.ALL_TYPES)
                        values.Add(new { result=(int)result, base_score=processor.GetBaseScoreForResult(result), hit=result.IsHit(), miss=result.IsMiss(), scorable=result.IsScorable(), accuracy=result.AffectsAccuracy(), increases_combo=result.IncreasesCombo(), breaks_combo=result.BreaksCombo(), tick=result.IsTick(), bonus=result.IsBonus() });
                    break;
                case "score":
                    using (var processor = new OsuScoreProcessor())
                    {
                        var maximum = fixture.GetProperty("maximum").EnumerateArray().Select(v => Result(v.GetInt32())).ToArray();
                        var objects = maximum.Select((v,i) => new ExplicitObject(v) { StartTime=i*1000 }).ToArray();
                        var beatmap = new Beatmap { HitObjects=objects.Cast<HitObject>().ToList() };
                        processor.ApplyBeatmap(beatmap);
                        int index=0;
                        foreach (var value in fixture.GetProperty("actual").EnumerateArray())
                        {
                            var result = new JudgementResult(objects[index], objects[index].Judgement) { Type=Result(value.GetInt32()) };
                            if (fixture.TryGetProperty("failed_before", out var failed) && failed[index].GetBoolean())
                                typeof(JudgementResult).GetProperty(nameof(JudgementResult.FailedAtJudgement))!.SetValue(result,true);
                            processor.ApplyResult(result);
                            var statistics = processor.GetScoreProcessorStatistics();
                            values.Add(new { total=processor.TotalScore.Value, accuracy=processor.Accuracy.Value, combo=processor.Combo.Value, highest_combo=processor.HighestCombo.Value, numerator=statistics.BaseScore, denominator=statistics.MaximumBaseScore, accuracy_count=statistics.AccuracyJudgementCount, combo_portion=statistics.ComboPortion, bonus=statistics.BonusPortion, rank=processor.Rank.Value.ToString(), counts=Enumerable.Range(0,17).Select(v => processor.Statistics.GetValueOrDefault(Result(v))).ToArray() });
                            index++;
                        }
                    }
                    break;
                case "windows":
                    var windows = new OsuHitWindows();
                    windows.SetDifficulty(fixture.GetProperty("difficulty").GetDouble());
                    foreach (var value in fixture.GetProperty("offsets").EnumerateArray())
                    {
                        var offset=value.GetDouble();
                        values.Add(new { result=(int)windows.ResultFor(offset), can_be_hit=windows.CanBeHit(offset) });
                    }
                    break;
                case "spin":
                    var history = new SpinnerSpinHistory();
                    int time=0;
                    foreach (var value in fixture.GetProperty("deltas").EnumerateArray())
                    {
                        history.ReportDelta(time++,value.GetSingle());
                        values.Add(new { rotation=(double)history.TotalRotation });
                    }
                    break;
                case "drain":
                    using (var processor = new DrainingHealthProcessor(fixture.GetProperty("drain_start_ms").GetDouble()))
                    {
                        var increases=fixture.GetProperty("increases").EnumerateArray().ToArray();
                        var objects=increases.Select(value => new HealthObject(value.GetProperty("amount").GetDouble()) { StartTime=value.GetProperty("time_ms").GetDouble() }).ToList();
                        var beatmap=new Beatmap { HitObjects=objects.Cast<HitObject>().ToList() };
                        beatmap.Difficulty.DrainRate=(float)fixture.GetProperty("difficulty").GetDouble();
                        foreach (var end in fixture.GetProperty("break_end_times").EnumerateArray()) beatmap.Breaks.Add(new BreakPeriod(end.GetDouble()-10,end.GetDouble()));
                        processor.ApplyBeatmap(beatmap);
                        values.Add(new { drain_rate=processor.DrainRate });
                    }
                    break;
                case "round":
                    foreach (var value in fixture.GetProperty("values").EnumerateArray()) values.Add(new { rounded=(long)Math.Round(value.GetDouble()) });
                    break;
                default: throw new ArgumentException($"Unknown fixture kind: {kind}");
            }
            observations.Add(new { schema_version=1, id=fixture.GetProperty("id").GetString(), kind, values });
        }
        Console.WriteLine(JsonSerializer.Serialize(observations));
    }
    sealed class HealthJudgement(double amount) : Judgement
    {
        public override HitResult MaxResult => HitResult.Great;
        protected override double HealthIncreaseFor(HitResult result) => amount;
    }
    sealed class HealthObject(double amount) : HitObject { public override Judgement CreateJudgement() => new HealthJudgement(amount); }
    sealed class ExplicitJudgement(HitResult maximum) : Judgement { public override HitResult MaxResult => maximum; }
    sealed class ExplicitObject(HitResult maximum) : HitObject { public override Judgement CreateJudgement() => new ExplicitJudgement(maximum); }
}

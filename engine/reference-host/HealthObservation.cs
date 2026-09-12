using System.Text.Json;
using osu.Game.Rulesets.Osu.Beatmaps;
using osu.Game.Rulesets.Osu.Judgements;
using osu.Game.Rulesets.Osu.Objects;
using osu.Game.Rulesets.Osu.Scoring;
using osu.Game.Rulesets.Scoring;

static partial class SimulationObservation
{
    private static OsuHitObject HealthObjectFor(string object_kind) => object_kind switch
    {
        "HitCircle" => new HitCircle(),
        "SliderHeadCircle" => new SliderHeadCircle(),
        "SliderTick" => new SliderTick(),
        "SliderRepeat" => new SliderRepeat(new Slider()),
        "SliderTailCircle" => new SliderTailCircle(new Slider()),
        "Slider" => new Slider(),
        "SpinnerTick" => new SpinnerTick(),
        "SpinnerBonusTick" => new SpinnerBonusTick(),
        "Spinner" => new Spinner(),
        _ => throw new InvalidDataException($"Unsupported health object {object_kind}")
    };

    private static void ObserveHealth(JsonElement fixture, List<object> values)
    {
        var objects = fixture.GetProperty("health_kinds").EnumerateArray()
            .Select(object_kind => HealthObjectFor(object_kind.GetString()!)).ToList();
        var flags = fixture.GetProperty("combo_flags").EnumerateArray().Select(flag => flag.GetUInt32()).ToArray();
        for (int object_index = 0; object_index < objects.Count; object_index++)
        {
            objects[object_index].NewCombo = (flags[object_index] & 1) != 0;
            objects[object_index].LastInCombo = (flags[object_index] & 2) != 0;
        }
        var beatmap = new OsuBeatmap { HitObjects = objects };
        beatmap.Difficulty.DrainRate = fixture.GetProperty("difficulty").GetSingle();
        using var processor = new OsuHealthProcessor(0);
        processor.ApplyBeatmap(beatmap);
        processor.Health.Value = fixture.GetProperty("starting_health").GetDouble();
        int judgement_index = 0;
        foreach (var result_element in fixture.GetProperty("actual").EnumerateArray())
        {
            var hit_object = objects[judgement_index++];
            var result = new OsuJudgementResult(hit_object, hit_object.CreateJudgement())
            {
                Type = (HitResult)result_element.GetInt32()
            };
            processor.ApplyResult(result);
            values.Add(new { health = processor.Health.Value, failed = processor.HasFailed });
        }
    }
}

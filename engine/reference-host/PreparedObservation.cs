using System.Text.Json;
using System.Reflection;
using osu.Game.Beatmaps;
using osu.Game.Beatmaps.Formats;
using osu.Game.IO;
using osu.Game.Audio;
using osu.Game.Rulesets.Osu;
using osu.Game.Rulesets.Osu.Beatmaps;
using osu.Game.Rulesets.Osu.Objects;
using osu.Game.Rulesets.Objects;
using osu.Game.Rulesets.Objects.Types;
using osuTK;

static class PreparedObservation
{
    static double[] Position(Vector2 position) => [(double)position.X, (double)position.Y];
    static object Samples(HitSampleInfo sample) => new { name=sample.Name,bank=sample.Bank,suffix=sample.Suffix ?? "",volume=sample.Volume,use_beatmap=sample.UseBeatmapSamples,layered=(bool?)sample.GetType().GetProperty("IsLayered")?.GetValue(sample) ?? (bool?)sample.GetType().GetField("IsLayered")?.GetValue(sample) ?? false,candidates=sample.LookupNames.ToArray() };
    public static void Run(string[] paths)
    {
        foreach (var path in paths)
        {
            using var reader=new LineBufferedReader(File.OpenRead(path));
            var raw=Decoder.GetDecoder<Beatmap>(reader).Decode(reader);
            var map=new OsuBeatmapConverter(raw,new OsuRuleset()).Convert();
            var processor=new OsuBeatmapProcessor(map);
            processor.PreProcess();
            foreach(var hitObject in map.HitObjects) hitObject.ApplyDefaults(map.ControlPointInfo,map.Difficulty);
            processor.PostProcess();
            Console.WriteLine(JsonSerializer.Serialize(new {objects=map.HitObjects.Cast<OsuHitObject>().Select(hitObject => new {
                kind=hitObject is Slider?"SLIDER":hitObject is Spinner?"SPINNER":"CIRCLE",
                time_ms=hitObject.StartTime,end_time_ms=hitObject.GetEndTime(),position=Position(hitObject.Position),end_position=Position(hitObject.EndPosition),stack_offset=Position(hitObject.StackOffset),
                scale=(double)hitObject.Scale,radius=hitObject.Radius,preempt_ms=hitObject.TimePreempt,fade_in_ms=hitObject.TimeFadeIn,
                stack_height=hitObject.StackHeight,combo_index=hitObject.ComboIndex,combo_index_with_offsets=hitObject.ComboIndexWithOffsets,index_in_combo=hitObject.IndexInCurrentCombo,
                new_combo=hitObject.NewCombo,last_in_combo=hitObject.LastInCombo,combo_offset=hitObject.ComboOffset,
                spans=hitObject is Slider slider?slider.SpanCount():0,velocity=hitObject is Slider slider2?slider2.Velocity:0,
                span_duration=hitObject is Slider slider3?slider3.SpanDuration:0,path_distance=hitObject is Slider slider4?slider4.Path.Distance:0,
                vertices=hitObject is Slider geometrySlider?geometrySlider.Path.CalculatedPath.Select(Position):[],
                cumulative=hitObject is Slider cumulativeSlider?(List<double>)typeof(SliderPath).GetField("cumulativeLength",BindingFlags.NonPublic|BindingFlags.Instance)!.GetValue(cumulativeSlider.Path)!:[],
                calculated_distance=hitObject is Slider calculatedSlider?calculatedSlider.Path.CalculatedDistance:0,
                tick_distance=hitObject is Slider tickSlider&&tickSlider.GenerateTicks?tickSlider.TickDistance:0,
                generate_ticks=hitObject is Slider generateSlider&&generateSlider.GenerateTicks,
                events=hitObject is Slider eventSlider?SliderEventGenerator.Generate(eventSlider.StartTime,eventSlider.SpanDuration,eventSlider.Velocity,eventSlider.TickDistance,eventSlider.Path.Distance,eventSlider.SpanCount()).Select(item=>new{kind=item.Type.ToString(),time_ms=item.Time,span_start_ms=item.SpanStartTime,span_index=item.SpanIndex,progress=double.IsFinite(item.PathProgress)?item.PathProgress:0}):[],
                samples=hitObject.Samples.Select(Samples),tail_samples=hitObject is Slider slider5?slider5.TailSamples.Select(Samples):[],auxiliary_samples=hitObject.AuxiliarySamples.Select(Samples),
                spins_required=hitObject is Spinner spinner?spinner.SpinsRequired:0,maximum_bonus_spins=hitObject is Spinner spinner2?spinner2.MaximumBonusSpins:0,
                children=hitObject.NestedHitObjects.Cast<OsuHitObject>().Select(child=>new{kind=child.GetType().Name,time_ms=child.StartTime,position=Position(child.Position),samples=child.Samples.Select(Samples)})
            })}));
        }
    }
}

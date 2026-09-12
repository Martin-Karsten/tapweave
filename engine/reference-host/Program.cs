using System.Security.Cryptography;
using System.Text.Json;
using osu.Game.Beatmaps;
using osu.Game.Beatmaps.ControlPoints;
using osu.Game.Beatmaps.Legacy;
using osu.Game.Beatmaps.Formats;
using osu.Game.IO;
using osu.Game.Rulesets.Objects.Types;
using osu.Game.Rulesets.Objects.Legacy;

if (args.Length > 0 && args[0] == "--prepared") { PreparedObservation.Run(args[1..]); return; }

// H01/H02 observations come exclusively from the real pinned decoder. Exceptions
// remain upstream exception types: Tapweave policy/error codes are not an oracle.
foreach (string path in args)
{
    var bytes = File.ReadAllBytes(path);
    object observation;
    try
    {
        using var stream = new LineBufferedReader(new MemoryStream(bytes));
        var selected = Decoder.GetDecoder<Beatmap>(stream);
        int version = (int)typeof(LegacyDecoder<Beatmap>).GetField("FormatVersion", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.GetValue(selected)!;
        var decoder = new ObservedDecoder(version);
        var map = decoder.Decode(stream);
        var cp = (LegacyControlPointInfo)map.ControlPointInfo;
        var times = cp.AllControlPoints.SelectMany(p => new[] { p.Time-6, p.Time-5, p.Time, p.Time+5, p.Time+6 }).Append(-1000).Append(0).Distinct().Order().ToArray();
        observation = new {
            accepted = true,
            line_errors = decoder.Errors,
            format_version = map.BeatmapVersion,
            difficulty = new { hp=(double)map.Difficulty.DrainRate, cs=(double)map.Difficulty.CircleSize, od=(double)map.Difficulty.OverallDifficulty, ar=(double)map.Difficulty.ApproachRate, slider_multiplier=map.Difficulty.SliderMultiplier, tick_rate=map.Difficulty.SliderTickRate },
            stack_leniency = (double)map.StackLeniency,
            metadata = new { title=map.Metadata.Title, artist=map.Metadata.Artist, creator=map.Metadata.Author.Username, version=map.BeatmapInfo.DifficultyName, audio=map.Metadata.AudioFile },
            general = new { audio_lead_in=map.AudioLeadIn, preview_time=(double)map.Metadata.PreviewTime, countdown=(int)map.Countdown, countdown_offset=map.CountdownOffset, samples_match_playback_rate=map.SamplesMatchPlaybackRate, letterbox_in_breaks=map.LetterboxInBreaks, epilepsy_warning=map.EpilepsyWarning, widescreen_storyboard=map.WidescreenStoryboard, special_style=map.SpecialStyle },
            breaks = map.Breaks.Select(b => new { start_ms=b.StartTime, end_ms=b.EndTime }),
            objects = map.HitObjects.Select(o => new { new_combo=((IHasCombo)o).NewCombo, combo_offset=((IHasCombo)o).ComboOffset, time_ms=o.StartTime, x=o is IHasPosition pos ? (double)pos.Position.X : 256, y=o is IHasPosition pos2 ? (double)pos2.Position.Y : 192 }),
            control_points = new { timing=cp.TimingPoints.Select(Point), difficulty=cp.DifficultyPoints.Select(Point), sample=cp.SamplePoints.Select(Point), effect=cp.EffectPoints.Select(Point) },
            queries = times.Select(t => new { time_ms=t, timing=Point(cp.TimingPointAt(t)), difficulty=Point(cp.DifficultyPointAt(t)), sample=Point(cp.SamplePointAt(t)), effect=Point(cp.EffectPointAt(t)) })
        };
    }
    catch (Exception ex) { observation = new { accepted=false, exception=ex.GetType().FullName, message=ex.Message }; }
    Console.WriteLine(JsonSerializer.Serialize(new { schema_version=1, kind="upstream-m0-observation", sha256=Convert.ToHexStringLower(SHA256.HashData(bytes)), source_commit="3c1c96f742e7aae2ff67a7361e058fe91ca3b955", framework_commit="f02756c5aa5032e6d04729922702b8d56c4bc2eb", observation }));
}

static object Point(ControlPoint p) => new {
    time_ms=p.Time,
    beat_length=p is TimingControlPoint t ? t.BeatLength : 1000,
    slider_velocity=p is DifficultyControlPoint d ? d.SliderVelocity : 1,
    meter=p is TimingControlPoint tm ? tm.TimeSignature.Numerator : 4,
    sample_set=p is SampleControlPoint s ? s.SampleBank : "normal",
    sample_index=(int?)p.GetType().GetField("CustomSampleBank")?.GetValue(p) ?? 0,
    volume=p is SampleControlPoint sv ? sv.SampleVolume : 100,
    generate_ticks=p is not DifficultyControlPoint dt || dt.GenerateTicks,
    kiai=p is EffectControlPoint e && e.KiaiMode,
    omit_first_bar=p is TimingControlPoint tb && tb.OmitFirstBarLine
};

sealed class ObservedDecoder(int version) : LegacyBeatmapDecoder(version)
{
    public List<object> Errors { get; } = new();
    protected override void ParseLine(Beatmap map, Section section, string line, bool primary)
    {
        try { base.ParseLine(map, section, line, primary); }
        catch (Exception ex)
        {
            Errors.Add(new { section=section.ToString(), line, exception=ex.GetType().FullName });
            throw; // preserve upstream's catch-and-continue behavior
        }
    }
}

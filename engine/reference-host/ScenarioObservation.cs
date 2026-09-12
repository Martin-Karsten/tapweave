using System.Security.Cryptography;
using System.Text.Json;
using osu.Framework;
using osu.Framework.Allocation;
using osu.Framework.Audio;
using osu.Framework.Audio.Track;
using osu.Framework.Graphics;
using osu.Framework.IO.Stores;
using osu.Framework.Testing;
using osu.Framework.Testing.Input;
using osu.Framework.Timing;
using osu.Game.Beatmaps;
using osu.Game.Beatmaps.ControlPoints;
using osu.Game.Beatmaps.Formats;
using osu.Game.Configuration;
using osu.Game.Database;
using osu.Game.Graphics;
using osu.Game.IO;
using osu.Game.Resources;
using osu.Game.Rulesets.Osu;
using osu.Game.Rulesets.Osu.Beatmaps;
using osu.Game.Rulesets.Osu.Objects;
using osu.Game.Rulesets.Osu.Objects.Drawables;
using osu.Game.Rulesets.Osu.Scoring;
using osu.Game.Rulesets.Osu.UI;
using osu.Game.Skinning;
using osuTK;
using osuTK.Input;

// Real input -> playfield policy -> drawable result -> score. This controlled
// drawable host is not Player, device audio, or rendered-pixel certification.
static class ScenarioObservation
{
    public static void Run(string fixture_path, string output_path)
    {
        byte[] fixture_bytes = File.ReadAllBytes(fixture_path);
        var fixture = JsonSerializer.Deserialize<ScenarioFixture>(fixture_bytes)!;
        if (fixture.schema_version != 1 || fixture.profile != "unmodded-lazer-zero-offset-rate-1" ||
            fixture.schedule_ms.Length == 0 || fixture.schedule_ms.Length > 100000 ||
            fixture.schedule_ms.Any(time_ms => !double.IsFinite(time_ms)) ||
            fixture.schedule_ms.Zip(fixture.schedule_ms.Skip(1)).Any(pair => pair.First >= pair.Second) ||
            fixture.inputs.Any(input => !double.IsFinite(input.time_ms) || !float.IsFinite(input.x) || !float.IsFinite(input.y) || input.actions > 3) ||
            fixture.inputs.Zip(fixture.inputs.Skip(1)).Any(pair => pair.First.time_ms > pair.Second.time_ms))
            throw new InvalidDataException("Invalid controlled scenario envelope.");
        using var host = new TestRunHeadlessGameHost("tapweave-scenario-" + Guid.NewGuid());
        using var game = new ScenarioGame(fixture);
        host.Run(game);
        File.WriteAllText(output_path, JsonSerializer.Serialize(new
        {
            schema_version = 1,
            fixture_sha256 = Convert.ToHexStringLower(SHA256.HashData(fixture_bytes)),
            source_commit = "3c1c96f742e7aae2ff67a7361e058fe91ca3b955",
            framework_commit = "f02756c5aa5032e6d04729922702b8d56c4bc2eb",
            fixture.profile,
            fixture.id,
            fixture.schedule_ms,
            adapter = "controlled-drawable-input",
            judgements = game.Judgements,
            frames = game.Frames
        }));
    }
}

sealed record ScenarioInput(double time_ms, float x, float y, uint actions);
sealed record ScenarioFixture(int schema_version, string id, string profile, string map,
    double[] schedule_ms, ScenarioInput[] inputs);

partial class ScenarioGame(ScenarioFixture fixture) : Game, IBeatSyncProvider
{
    ChannelAmplitudes IHasAmplitudes.CurrentAmplitudes => new();
    ControlPointInfo IBeatSyncProvider.ControlPoints => prepared_map.ControlPointInfo;
    IClock IBeatSyncProvider.Clock => scenario_clock;
    public List<object> Judgements { get; } = new();
    public List<object> Frames { get; } = new();
    private readonly ManualClock scenario_clock = new();
    private readonly OsuScoreProcessor score_processor = new();
    private readonly List<DrawableOsuHitObject> drawables = new();
    private IBeatmap prepared_map = null!;
    private ManualInputManager manual_input = null!;
    private OsuPlayfield playfield = null!;
    private RealmAccess? realm;
    private OsuConfigManager? configuration;
    private int update_index, input_index;
    private uint previous_actions;
    private bool frame_pending;
    private DependencyContainer scenario_dependencies = null!;

    protected override IReadOnlyDependencyContainer CreateChildDependencies(IReadOnlyDependencyContainer parent)
    {
        return scenario_dependencies = new DependencyContainer(base.CreateChildDependencies(parent));
    }

    [BackgroundDependencyLoader]
    private void load()
    {
        using var reader = new LineBufferedReader(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(fixture.map)));
        var decoded_map = Decoder.GetDecoder<Beatmap>(reader).Decode(reader);
        prepared_map = new OsuBeatmapConverter(decoded_map, new OsuRuleset()).Convert();
        var processor = new OsuBeatmapProcessor(prepared_map);
        processor.PreProcess();
        foreach (var hit_object in prepared_map.HitObjects)
            hit_object.ApplyDefaults(prepared_map.ControlPointInfo, prepared_map.Difficulty);
        processor.PostProcess();
        Resources.AddStore(new DllResourceStore(OsuResources.ResourceAssembly));
        scenario_dependencies.CacheAs<IBeatSyncProvider>(this);
        scenario_dependencies.CacheAs(new OsuColour());
        scenario_dependencies.CacheAs(realm = new RealmAccess(Host.Storage, "scenario.realm", Host.UpdateThread));
        scenario_dependencies.CacheAs(configuration = new OsuConfigManager(Host.Storage));
        scenario_dependencies.CacheAs<IGameplaySettings>(configuration);
        score_processor.ApplyBeatmap(prepared_map);
        playfield = new OsuPlayfield { Size = new Vector2(512, 384) };
        foreach (var hit_object in prepared_map.HitObjects.Cast<OsuHitObject>())
        {
            DrawableOsuHitObject drawable = hit_object switch
            {
                HitCircle circle => new DrawableHitCircle(circle),
                Slider slider => new DrawableSlider(slider),
                Spinner spinner => new DrawableSpinner(spinner),
                _ => throw new InvalidDataException("Unsupported scenario object.")
            };
            int object_index = drawables.Count;
            drawable.OnNewResult += (_, result) =>
            {
                score_processor.ApplyResult(result);
                Judgements.Add(new
                {
                    time_ms = scenario_clock.CurrentTime,
                    object_index,
                    object_type = result.HitObject.GetType().Name,
                    result = (int)result.Type,
                    offset_ms = result.TimeOffset,
                    score = score_processor.TotalScore.Value,
                    combo = score_processor.Combo.Value,
                    accuracy = score_processor.Accuracy.Value
                });
            };
            drawables.Add(drawable);
            playfield.Add(drawable);
        }
        scenario_clock.CurrentTime = fixture.schedule_ms[0];
        Add(manual_input = new ManualInputManager
        {
            RelativeSizeAxes = Axes.Both,
            Clock = new FramedClock(scenario_clock),
            UseParentInput = false,
            ShowVisualCursorGuide = false,
            Child = new SkinProvidingContainer(null)
            {
                Child = new OsuInputManager(new OsuRuleset().RulesetInfo)
                {
                    RelativeSizeAxes = Axes.Both,
                    Child = playfield
                }
            }
        });
    }

    protected override void Update()
    {
        base.Update();
        // The previous update traversed children. Record their actual properties
        // before installing the next time/input; never calculate oracle visuals.
        if (frame_pending)
        {
            frame_pending = false;
            Frames.Add(new
            {
                time_ms = scenario_clock.CurrentTime,
                objects = drawables.Select(drawable => new
                {
                    alpha = drawable.Alpha,
                    scale_x = drawable.Scale.X,
                    scale_y = drawable.Scale.Y,
                    judged = drawable.AllJudged,
                    lifetime_start = drawable.LifetimeStart,
                    lifetime_end = double.IsFinite(drawable.LifetimeEnd) ? (double?)drawable.LifetimeEnd : null,
                    approach_alpha = drawable is DrawableHitCircle circle ? (float?)circle.ApproachCircle.Alpha : null,
                    approach_scale = drawable is DrawableHitCircle approach_circle ? (float?)approach_circle.ApproachCircle.Scale.X : null
                }).ToArray()
            });
        }
        if (update_index == fixture.schedule_ms.Length)
        {
            Exit();
            return;
        }
        scenario_clock.CurrentTime = fixture.schedule_ms[update_index++];
        // Live input is delivered at the first declared update at/after receipt.
        // This quantisation is retained in observations, not hidden by retiming.
        while (input_index < fixture.inputs.Length && fixture.inputs[input_index].time_ms <= scenario_clock.CurrentTime)
        {
            var input = fixture.inputs[input_index++];
            manual_input.MoveMouseTo(playfield.ToScreenSpace(new Vector2(input.x, input.y)));
            for (int action_index = 0; action_index < 2; action_index++)
            {
                uint action_mask = 1u << action_index;
                var key = action_index == 0 ? Key.Z : Key.X;
                if ((input.actions & action_mask) != (previous_actions & action_mask))
                {
                    if ((input.actions & action_mask) != 0)
                        manual_input.PressKey(key);
                    else
                        manual_input.ReleaseKey(key);
                }
            }
            previous_actions = input.actions;
        }
        frame_pending = true;
    }

    protected override void Dispose(bool is_disposing)
    {
        score_processor.Dispose();
        base.Dispose(is_disposing);
        configuration?.Dispose();
        realm?.Dispose();
    }
}

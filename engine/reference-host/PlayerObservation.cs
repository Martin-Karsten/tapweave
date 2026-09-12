using System.Security.Cryptography;
using System.Text.Json;
using osu.Framework.Testing;
using osu.Framework.Allocation;
using osu.Game.Screens.Play.Leaderboards;
using osu.Framework.Timing;
using System.Reflection;
using osu.Game.Beatmaps;
using osu.Game.Rulesets.Objects;
using osu.Game.Rulesets.Objects.Types;
using osu.Game.Rulesets.Osu.Objects;
using osu.Game.Beatmaps.Formats;
using osu.Game.IO;
using osu.Game.Replays;
using osu.Game.Rulesets.Osu;
using osu.Game.Rulesets.Osu.Replays;
using osu.Game.Rulesets.Scoring;
using osu.Game.Scoring;
using osu.Game.Screens.Play;
using osu.Game.Screens.Ranking;
using osu.Game.Tests.Visual;
using osuTK;
using osuTK.Input;

// Actual Player integration with synthetic replay input. Unlike ReplayPlayer,
// Player retains normal failure handling and score-freeze behavior. No scoring,
// drain, note-lock or replay interpolation algorithms are implemented here.
static class PlayerObservation
{
    public static void Run(string fixture_path, string output_path)
    {
        var bytes = File.ReadAllBytes(fixture_path);
        var fixture = ScenarioFixture.Parse(bytes);
        using var host = new TestRunHeadlessGameHost("tapweave-player-" + Guid.NewGuid());
        using var runner = new OsuTestScene.OsuTestSceneTestRunner();
        using var scene = new PlayerScenario(fixture);
        var host_task = Task.Factory.StartNew(() => host.Run(runner), TaskCreationOptions.LongRunning);
        try
        {
            if (!SpinWait.SpinUntil(() => runner.IsLoaded || host_task.IsCompleted, TimeSpan.FromSeconds(30)))
                throw new TimeoutException("Player test runner did not load.");
            if (host_task.IsCompleted)
                host_task.GetAwaiter().GetResult();
            runner.RunTestBlocking(scene);
            if (scene.Observation == null)
                throw new InvalidOperationException("Player scenario did not produce an observation.");
            File.WriteAllText(output_path, JsonSerializer.Serialize(new
            {
                schema_version = 1, fixture.id,
                fixture_sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)),
                adapter = fixture.record ? "pinned-player-with-live-recording" : "pinned-player-with-replay-input",
                source_commit = "3c1c96f742e7aae2ff67a7361e058fe91ca3b955",
                framework_commit = "f02756c5aa5032e6d04729922702b8d56c4bc2eb",
                schedule_ms = scene.AppliedSchedule,
                observation = scene.Observation
            }));
        }
        finally
        {
            host.Exit();
            if (!host_task.Wait(TimeSpan.FromSeconds(15)))
                throw new TimeoutException("Player test runner did not exit.");
        }
    }
}

partial class PlayerScenario : RateAdjustedBeatmapTestScene
{
    private ObservedPlayer? player;
    private readonly ScenarioFixture fixture;
    private int schedule_index;
    private int input_index;
    private uint previous_actions;
    private bool input_pending;
    private double[] schedule_ms = Array.Empty<double>();
    private bool advancing;
    public object? Observation { get; private set; }
    public double[] AppliedSchedule => schedule_ms;

    public PlayerScenario(ScenarioFixture fixture)
    {
        this.fixture = fixture;
        AddStep("load synthetic beatmap and real player", () =>
        {
            using var reader = new LineBufferedReader(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(fixture.map)));
            var beatmap = Decoder.GetDecoder<Beatmap>(reader).Decode(reader);
            beatmap.BeatmapInfo.Ruleset = new OsuRuleset().RulesetInfo;
            Beatmap.Value = CreateWorkingBeatmap(beatmap);
            LoadScreen(player = new ObservedPlayer(fixture));
        });
        AddUntilStep("wait for player", () => player?.Ready == true);
        AddStep("start deterministic clock schedule", () =>
        {
            schedule_ms = fixture.schedule_ms.Concat(player!.SemanticBoundaries()).Distinct().Order().ToArray();
            advancing = true;
        });
        AddUntilStep("run complete player schedule", () => schedule_index >= schedule_ms.Length);
        AddStep("capture player results", () => Observation = player!.Snapshot());
    }

    protected override void Update()
    {
        base.Update();
        if (!advancing || schedule_index >= schedule_ms.Length)
            return;
        if (fixture.record && input_pending)
        {
            if (input_index < fixture.inputs.Length && fixture.inputs[input_index].time_ms <= player!.SourceClock.CurrentTime)
            {
                var input = fixture.inputs[input_index++];
                InputManager.MoveMouseTo(player.InputPosition(input));
                Key[] keys = [Key.Z, Key.X, Key.C];
                for (int action_index = 0; action_index < keys.Length; action_index++)
                {
                    uint action_mask = 1u << action_index;
                    if ((input.actions & action_mask) == (previous_actions & action_mask))
                        continue;
                    if ((input.actions & action_mask) != 0) InputManager.PressKey(keys[action_index]);
                    else InputManager.ReleaseKey(keys[action_index]);
                }
                previous_actions = input.actions;
                return;
            }
            input_pending = false;
        }
        player!.SourceClock.CurrentTime = schedule_ms[schedule_index++];
        input_pending = fixture.record;
    }
}

partial class ObservedPlayer(ScenarioFixture fixture) : Player(new PlayerConfiguration
{
    AllowPause = false, ShowResults = false, ShowFailingOverlay = false
})
{
    [Cached(typeof(IGameplayLeaderboardProvider))]
    private readonly SoloGameplayLeaderboardProvider leaderboard_provider = new();
    [BackgroundDependencyLoader]
    private void load() => AddInternal(leaderboard_provider);

    public ScenarioClock SourceClock { get; } = new() { Rate = 1, IsRunning = true };
    public bool Ready => IsLoaded && LoadedBeatmapSuccessfully && GameplayClockContainer.IsRunning;
    private readonly List<object> judgements = new();
    private double? failed_time;
    protected override bool PauseOnFocusLost => false;
    protected override GameplayClockContainer CreateGameplayClockContainer(WorkingBeatmap beatmap, double gameplayStart)
        => new ControlledGameplayClock(SourceClock);
    protected override Score CreateScore(IBeatmap beatmap)
    {
        if (fixture.record)
            return base.CreateScore(beatmap);
        var replay = new Replay();
        foreach (var input in fixture.inputs)
        {
            var actions = new List<OsuAction>();
            if ((input.actions & 1) != 0) actions.Add(OsuAction.LeftButton);
            if ((input.actions & 2) != 0) actions.Add(OsuAction.RightButton);
            replay.Frames.Add(new OsuReplayFrame(input.time_ms, new Vector2(input.x, input.y), actions.ToArray()));
        }
        return new Score { Replay = replay };
    }
    public Vector2 InputPosition(ScenarioInput input) => DrawableRuleset.Playfield.ToScreenSpace(new Vector2(input.x, input.y));
    protected override void PrepareReplay()
    {
        if (fixture.record) base.PrepareReplay();
        else DrawableRuleset.SetReplayScore(Score);
    }
    protected override ResultsScreen CreateResults(ScoreInfo score) => new SoloResultsScreen(score);
    protected override Task ImportScore(Score score) => Task.CompletedTask;
    protected override void LoadComplete()
    {
        base.LoadComplete();
        ScoreProcessor.NewJudgement += result => judgements.Add(new
        {
            time_ms = GameplayClockContainer.CurrentTime, offset_ms = result.TimeOffset,
            object_index = GameplayState.Beatmap.HitObjects.ToList().FindIndex(hit_object => ReferenceEquals(hit_object, result.HitObject) || hit_object.NestedHitObjects.Contains(result.HitObject)),
            object_type = result.HitObject.GetType().Name, result = (int)result.Type,
            maximum = (int)result.Judgement.MaxResult, failed_at_judgement = result.FailedAtJudgement, health = HealthProcessor.Health.Value,
            score = ScoreProcessor.TotalScore.Value, combo = ScoreProcessor.Combo.Value
        });
        HealthProcessor.Failed += () =>
        {
            failed_time ??= GameplayClockContainer.CurrentTime;
            return true;
        };
    }
    public IEnumerable<double> SemanticBoundaries()
    {
        foreach (var hit_object in GameplayState.Beatmap.HitObjects)
        {
            yield return hit_object.StartTime;
            if (hit_object.GetEndTime() > 0)
                yield return Math.BitDecrement(hit_object.GetEndTime());
            yield return hit_object.GetEndTime();
            if (hit_object is OsuHitObject osu_object)
                yield return Math.BitIncrement(hit_object.StartTime + osu_object.HitWindows.WindowFor(HitResult.Meh));
            foreach (var nested in hit_object.NestedHitObjects)
            {
                yield return nested.StartTime;
                if (nested is SliderTailCircle)
                    yield return nested.StartTime - 36;
            }
        }
    }
    public object Snapshot() => new
    {
        recording = Score.Replay.Frames.OfType<OsuReplayFrame>().Select(frame => new
        {
            time_ms = frame.Time, x = frame.Position.X, y = frame.Position.Y,
            action_bits = (frame.Actions.Contains(OsuAction.LeftButton) ? 1 : 0) |
                          (frame.Actions.Contains(OsuAction.RightButton) ? 2 : 0) |
                          (frame.Actions.Contains(OsuAction.Smoke) ? 4 : 0)
        }).ToArray(),
        judgements, score = ScoreProcessor.TotalScore.Value, accuracy = ScoreProcessor.Accuracy.Value,
        combo = ScoreProcessor.Combo.Value, highest_combo = ScoreProcessor.HighestCombo.Value,
        counts = Enumerable.Range(0, 17).Select(result_id => ScoreProcessor.Statistics.GetValueOrDefault((HitResult)result_id)).ToArray(),
        health = HealthProcessor.Health.Value, failed = HealthProcessor.HasFailed, failed_time,
        rank = ScoreProcessor.Rank.Value.ToString(), completed = ScoreProcessor.HasCompleted.Value
    };
}

sealed class ScenarioClock : ManualClock, IAdjustableClock
{
    public void Reset() { CurrentTime = 0; IsRunning = false; }
    public void Start() => IsRunning = true;
    public void Stop() => IsRunning = false;
    public bool Seek(double position) { CurrentTime = position; return true; }
    public void ResetSpeedAdjustments() => Rate = 1;
}

// Disable only the audio-source wall-clock smoothing for a prescribed test
// clock. Gameplay rules and Player scheduling remain upstream implementations.
// The reflected field is pinned and a missing/changed field fails the host.
partial class ControlledGameplayClock : GameplayClockContainer
{
    public ControlledGameplayClock(IClock source) : base(source, false, false)
    {
        var field = typeof(FramedBeatmapClock).GetField("interpolatedTrack", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingFieldException("Pinned FramedBeatmapClock.interpolatedTrack");
        var interpolator = (InterpolatingFramedClock)field.GetValue(GameplayClock)!;
        interpolator.AllowableErrorMilliseconds = 0;
    }
}

using osu.Framework.Input.StateChanges;
using osu.Game.Replays;
using osu.Game.Rulesets.Osu;
using osu.Game.Rulesets.Osu.Replays;
using osu.Game.Rulesets.Replays;
using osuTK;

// Observe the real framed replay handler. Coordinate interpolation and action
// selection belong to upstream; this adapter only translates its input records.
sealed class GameplayReplaySampler : OsuFramedReplayInputHandler
{
    public GameplayReplaySampler(ScenarioInput[] inputs) : base(CreateReplay(inputs))
    {
        GamefieldToScreenSpace = position => position;
    }

    private static Replay CreateReplay(ScenarioInput[] inputs)
    {
        var replay = new Replay();
        foreach (var input in inputs)
        {
            var actions = new List<OsuAction>();
            if ((input.actions & 1) != 0)
                actions.Add(OsuAction.LeftButton);
            if ((input.actions & 2) != 0)
                actions.Add(OsuAction.RightButton);
            replay.Frames.Add(new OsuReplayFrame(input.time_ms, new Vector2(input.x, input.y), actions.ToArray()));
        }
        return replay;
    }

    public ScenarioInput Sample(double time_ms)
    {
        if (Frames.Count == 0)
            return new ScenarioInput(time_ms, 0, 0, 0);
        for (int frame_index = 0; frame_index <= Frames.Count + 1; frame_index++)
        {
            SetFrameFromTime(time_ms);
            if (CurrentTime == time_ms && (NextFrame == null || NextFrame.Time > time_ms))
                break;
        }
        var inputs = new List<IInput>();
        CollectReplayInputs(inputs);
        var position = inputs.OfType<MousePositionAbsoluteInput>().Single().Position;
        var actions = inputs.OfType<ReplayState<OsuAction>>().Single().PressedActions;
        uint action_bits = (actions.Contains(OsuAction.LeftButton) ? 1u : 0u) |
                           (actions.Contains(OsuAction.RightButton) ? 2u : 0u);
        return new ScenarioInput(time_ms, position.X, position.Y, action_bits);
    }
}

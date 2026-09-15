using System.Linq;
using osu.Framework.Testing;
using osu.Game.Rulesets.Osu;
using osu.Game.Rulesets.Osu.UI;
using osu.Game.Screens.Play.HUD;
using osuTK.Input;

namespace osu.Game.Tests.Visual.Gameplay;

// Additional source-derived probes over the same real Player, input manager,
// map and assertions. Original retained test bodies stay unchanged.
public partial class PinnedPauseInputScene
{
    public void TestOsuNewKeyHeldWhilePausedIsNotRestored()
    {
        KeyCounter counterX = null!;
        loadPlayer(() => new OsuRuleset());
        AddStep("get X counter", () => counterX = this.ChildrenOfType<KeyCounter>().Single(counter =>
            counter.Trigger is KeyCounterActionTrigger<OsuAction> trigger && trigger.Action == OsuAction.RightButton));
        AddStep("pause", () => Player.Pause());
        AddStep("press X while paused", () => InputManager.PressKey(Key.X));
        AddStep("request resume", () => Player.Resume());
        AddStep("hover resume", () => InputManager.MoveMouseTo(this.ChildrenOfType<OsuResumeOverlay.OsuClickToResumeCursor>().Single()));
        AddStep("resume with Z", () => InputManager.PressKey(Key.Z));
        checkKey(() => counterX, 0, false);
        AddStep("release X", () => InputManager.ReleaseKey(Key.X));
        AddStep("fresh X press", () => InputManager.PressKey(Key.X));
        checkKey(() => counterX, 1, true);
    }

    public void TestOsuReleasedKeyboardSourceResumesWithMouseSource()
    {
        KeyCounter counterZ = null!;
        loadPlayer(() => new OsuRuleset());
        AddStep("get left counter", () => counterZ = this.ChildrenOfType<KeyCounter>().Single(counter =>
            counter.Trigger is KeyCounterActionTrigger<OsuAction> trigger && trigger.Action == OsuAction.LeftButton));
        AddStep("press Z", () => InputManager.PressKey(Key.Z));
        checkKey(() => counterZ, 1, true);
        AddStep("pause", () => Player.Pause());
        AddStep("release Z while paused", () => InputManager.ReleaseKey(Key.Z));
        AddStep("request resume", () => Player.Resume());
        AddStep("hover resume", () => InputManager.MoveMouseTo(this.ChildrenOfType<OsuResumeOverlay.OsuClickToResumeCursor>().Single()));
        AddStep("resume with mouse", () => InputManager.PressButton(MouseButton.Left));
        checkKey(() => counterZ, 2, true);
        AddStep("release mouse", () => InputManager.ReleaseButton(MouseButton.Left));
        checkKey(() => counterZ, 2, false);
    }
}

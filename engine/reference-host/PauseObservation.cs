using System.Text.Json;
using osu.Framework.Testing;
using osu.Game.Tests.Visual;
using osu.Game.Tests.Visual.Gameplay;

// Executes the pinned osu!standard test bodies, including their assertions.
// Mania cases are outside the Tapweave profile and are omitted from the port.
static class PauseObservation
{
    public static void Run(string output_path)
    {
        var completed = new List<string>();
        foreach (var method in typeof(PinnedPauseInputScene).GetMethods().Where(method => method.Name.StartsWith("TestOsu")))
        {
            using var host = new TestRunHeadlessGameHost("tapweave-pause-" + Guid.NewGuid());
            using var runner = new OsuTestScene.OsuTestSceneTestRunner();
            using var scene = new PinnedPauseInputScene();
            scene.SetUp();
            method.Invoke(scene, null);
            var host_task = Task.Factory.StartNew(() => host.Run(runner), TaskCreationOptions.LongRunning);
            try
            {
                if (!SpinWait.SpinUntil(() => runner.IsLoaded || host_task.IsCompleted, TimeSpan.FromSeconds(30)))
                    throw new TimeoutException("Pause runner did not load.");
                if (host_task.IsCompleted) host_task.GetAwaiter().GetResult();
                runner.RunTestBlocking(scene);
                completed.Add(method.Name);
                Console.WriteLine("PASS " + method.Name);
            }
            finally
            {
                host.Exit();
                if (!host_task.Wait(TimeSpan.FromSeconds(15))) throw new TimeoutException("Pause runner did not exit.");
            }
        }
        File.WriteAllText(output_path, JsonSerializer.Serialize(new { source_commit = "3c1c96f742e7aae2ff67a7361e058fe91ca3b955",
            framework_commit = "f02756c5aa5032e6d04729922702b8d56c4bc2eb", completed }));
    }
}

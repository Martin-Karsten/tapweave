using System.Reflection;
using System.Text.Json;
using osu.Game.Rulesets.Objects;
using osu.Game.Rulesets.Objects.Types;
using osuTK;

// Executes the unmodified pinned SliderPath against the pinned framework package.
// No decoder, beatmap preparation, simulation, M0 host, or experimental C# code.
using var document = JsonDocument.Parse(File.ReadAllText(args.Single()));
var outputs = new List<object>();
foreach (var fixture in document.RootElement.EnumerateArray())
{
    var controls = fixture.GetProperty("points").EnumerateArray().Select(p =>
    {
        var position = p.GetProperty("position").EnumerateArray().Select(x => x.GetSingle()).ToArray();
        var degree = p.GetProperty("degree").GetInt32();
        PathType? kind = p.GetProperty("kind").GetString() switch
        {
            "None" => null,
            "Linear" => PathType.LINEAR,
            "Bezier" => degree == 0 ? PathType.BEZIER : PathType.BSpline(degree),
            "Catmull" => PathType.CATMULL,
            "Perfect" => PathType.PERFECT_CURVE,
            _ => throw new InvalidDataException("Unknown geometry kind")
        };
        return new PathControlPoint(new Vector2(position[0], position[1]), kind);
    }).ToArray();
    var options = fixture.GetProperty("options");
    var path = new SliderPath(controls, options.GetProperty("adjust_length").GetBoolean()
        ? options.GetProperty("expected_length").GetDouble() : null)
    { OptimiseCatmull = options.GetProperty("optimise_catmull").GetBoolean() };
    var vertices = path.CalculatedPath.Select(p => new double[] { p.X, p.Y }).ToArray();
    var cumulative = (List<double>)typeof(SliderPath).GetField("cumulativeLength", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(path)!;
    var segmentEnds = (double[])typeof(SliderPath).GetField("segmentEndDistances", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(path)!;
    var samples = fixture.GetProperty("progress").EnumerateArray().Select(p =>
    {
        var point = path.PositionAt(p.GetDouble());
        return new double[] { point.X, point.Y };
    }).ToArray();
    outputs.Add(new { schema_version = 1, id = fixture.GetProperty("id").GetString(), status = "OK", vertices,
        cumulative, segment_ends = segmentEnds, calculated_length = path.CalculatedDistance,
        distance = path.Distance, samples });
}
Console.WriteLine(JsonSerializer.Serialize(outputs));

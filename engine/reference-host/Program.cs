using System.Text.Json;
using osu.Game.Beatmaps.Formats;

// Skeleton only: fail explicitly rather than generating an invented oracle.
// H01/H02 adapters must use the pinned decoder and emit trace-schema records.
Console.Error.WriteLine(JsonSerializer.Serialize(new
{
    kind = "reference-host-status",
    schema_version = 1,
    decoder_assembly = typeof(LegacyBeatmapDecoder).Assembly.FullName,
    status = "EXPERIMENT_ADAPTERS_REQUIRED",
    experiments = new[] { "H01", "H02" }
}));
return 2;

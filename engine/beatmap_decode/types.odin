package beatmap_decode
import ct "../core_types"

Difficulty :: struct { hp, cs, od, ar, slider_multiplier, tick_rate: f64 }
DEFAULT_DIFFICULTY :: Difficulty{5, 5, 5, 5, 1.4, 1}
Metadata :: struct { title, artist, creator, version, audio: string }
Object_Kind :: enum u32 { CIRCLE = 1, SLIDER = 2, SPINNER = 8 }
Raw_Object :: struct {
 id, line: u32,
 kind: Object_Kind,
 flags, hit_sound: u32,
 x, y, time_ms, end_time_ms: f64,
 spans: u32,
 length: f64,
 // Lossless owned syntax for M1 path/sample preparation.
 path, edge_sounds, edge_sets, hit_sample: string,
}
Raw_Timing :: struct {
 id, line: u32,
 time_ms, beat_length: f64,
 meter, sample_set, sample_index, volume, effects: i32,
 timing_change, generate_ticks: bool,
}
Map :: struct {
 arena: ct.Arena,
 text: string,
 format_version: u32,
 difficulty: Difficulty,
 metadata: Metadata,
 stack_leniency: f64,
 objects: []Raw_Object,
 timing: []Raw_Timing,
}
Counts :: struct { lines, objects, timing: u64 }

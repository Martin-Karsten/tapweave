package beatmap_decode

import core_types "../core_types"

Difficulty :: struct {
	health_drain_rate: f64 `json:"hp"`,
	circle_size: f64 `json:"cs"`,
	overall_difficulty: f64 `json:"od"`,
	approach_rate: f64 `json:"ar"`,
	slider_multiplier, tick_rate: f64,
}

DEFAULT_DIFFICULTY :: Difficulty{5, 5, 5, 5, 1.4, 1}
Metadata :: struct {
	title, artist, creator, version, audio: string,
}

General :: struct {
	audio_lead_in, preview_time: f64,
	sample_set, sample_volume, countdown, countdown_offset: i32,
	samples_match_playback_rate, letterbox_in_breaks, epilepsy_warning, widescreen_storyboard, special_style: bool,
}

Break :: struct {
	start_ms, end_ms: f64,
}

Object_Kind :: enum u32 {
	CIRCLE  = 1,
	SLIDER  = 2,
	SPINNER = 8,
}

Raw_Object :: struct {
	id, line: u32,
	kind: Object_Kind,
	flags, hit_sound, combo_offset: u32,
	new_combo: bool,
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
	arena: core_types.Arena,
	text: string,
	format_version: u32,
	difficulty: Difficulty,
	metadata: Metadata,
	stack_leniency: f64,
	general: General,
	breaks: []Break,
	objects: []Raw_Object,
	timing: []Raw_Timing,
}

Counts :: struct {
	lines, objects, timing, breaks: u64,
}

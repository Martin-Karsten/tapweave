package prepared

import core_types "../core_types"

Position :: [2]f64
Object_Kind :: enum u32 {
	CIRCLE  = 1,
	SLIDER  = 2,
	SPINNER = 8,
}

Component_Kind :: enum {
	Head,
	Tick,
	Repeat,
	Tail,
	LegacyLastTick,
	SpinnerTick,
	SpinnerBonusTick,
}

Sample :: struct {
	name, bank, suffix: string,
	volume: i32,
	use_beatmap, layered: bool,
	candidates: []string,
}

// Upstream sustained-loop hitsound names: slider slide/whistle and spinner
// spin produce continuous loops rather than one-shots. The descriptor exposes
// this classification as bit 0 of the prepared_sample flags field.
is_loop_sample :: proc(name: string) -> bool {
	return name == "sliderslide" || name == "sliderwhistle" || name == "spinnerspin"
}

Component :: struct {
	id: u32,
	kind: Component_Kind,
	time_ms, event_time_ms, span_start_ms, progress: f64,
	span_index: u32,
	position: Position,
	samples: []Sample,
}

Object :: struct {
	id: u32,
	kind: Object_Kind,
	time_ms, end_time_ms: f64,
	position, end_position, stack_offset: Position,
	scale, radius, preempt_ms, fade_in_ms: f64,
	stack_height, combo_index, combo_index_with_offsets, index_in_combo: i32,
	new_combo, last_in_combo: bool,
	combo_offset: u32,
	spans: u32,
	velocity, span_duration, tick_distance, path_distance, calculated_distance: f64,
	generate_ticks: bool,
	vertices: []Position,
	cumulative: []f64,
	samples, tail_samples, auxiliary_samples: []Sample,
	components: []Component,
	spins_required, maximum_bonus_spins: i32,
}

Schedule_Entry :: struct {
	time_ms: f64,
	object_index, component_index: u32,
}

Difficulty :: struct {
	health_drain_rate: f64 `json:"hp"`,
	circle_size: f64 `json:"cs"`,
	overall_difficulty: f64 `json:"od"`,
	approach_rate: f64 `json:"ar"`,
	slider_multiplier, tick_rate: f64,
}

// Downstream packages borrow these immutable records from the map arena.
Break :: struct {
	start_ms, end_ms: f64,
}

Control_Point :: struct {
	time_ms: f64,
	source_id: i32,
	beat_length, slider_velocity: f64,
	meter, sample_set, sample_index, volume: i32,
	generate_ticks, kiai, omit_first_bar: bool,
}

Playback :: struct {
	audio_lead_in, preview_time: f64,
	sample_set, sample_volume, countdown, countdown_offset: i32,
	samples_match_playback_rate, letterbox_in_breaks, epilepsy_warning, widescreen_storyboard, special_style: bool,
	audio_filename: string,
}

Map :: struct {
	format_version: u32,
	playback: Playback,
	breaks: []Break,
	timing_points, difficulty_points, sample_points, effect_points: []Control_Point,
	difficulty: Difficulty,
	stack_leniency: f64,
	arena: core_types.Arena,
	description: core_types.Arena,
	objects: []Object,
	schedule: []Schedule_Entry,
	raw_digest, prepared_digest: [32]byte,
}

destroy_map :: proc(prepared_map: ^Map) {
	core_types.arena_destroy(&prepared_map.description)
	core_types.arena_destroy(&prepared_map.arena)
	prepared_map^ = {}
}

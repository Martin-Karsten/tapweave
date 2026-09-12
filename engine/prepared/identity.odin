// Canonical prepared identity v2. Field order and scalar widths are a protocol.
// Append/change fields only with a new IDENTITY_PROFILE and golden digest.
package prepared

import "core:crypto/sha2"
IDENTITY_PROFILE :: "tapweave:lazer-2026.804.2:prepared-v2"
identity_u64 :: proc(hasher: ^sha2.Context_256, value: u64) {
	bytes: [8]byte
	for byte_index in 0 ..< 8 {
		bytes[byte_index] = byte(value >> u32(byte_index * 8))
	}
	sha2.update(hasher, bytes[:])
}

identity_f64 :: proc(hasher: ^sha2.Context_256, value: f64) {
	identity_u64(hasher, transmute(u64)value)
}

identity_i32 :: proc(hasher: ^sha2.Context_256, value: i32) {
	identity_u64(hasher, u64(transmute(u32)value))
}

identity_string :: proc(hasher: ^sha2.Context_256, value: string) {
	identity_u64(hasher, u64(len(value)))
	sha2.update(hasher, transmute([]byte)value)
}

identity_position :: proc(hasher: ^sha2.Context_256, value: Position) {
	identity_f64(hasher, value[0])
	identity_f64(hasher, value[1])
}

identity_sample :: proc(hasher: ^sha2.Context_256, record: ^Sample) {
	identity_string(hasher, record.name)
	identity_string(hasher, record.bank)
	identity_string(hasher, record.suffix)
	identity_i32(hasher, record.volume)
	identity_u64(hasher, u64(record.use_beatmap))
	identity_u64(hasher, u64(record.layered))
	identity_u64(hasher, u64(len(record.candidates)))
	for candidate in record.candidates {
		identity_string(hasher, candidate)
	}
}

identity_component :: proc(hasher: ^sha2.Context_256, record: ^Component) {
	identity_u64(hasher, u64(record.id))
	identity_u64(hasher, u64(record.kind))
	identity_f64(hasher, record.time_ms)
	identity_f64(hasher, record.event_time_ms)
	identity_f64(hasher, record.span_start_ms)
	identity_f64(hasher, record.progress)
	identity_u64(hasher, u64(record.span_index))
	identity_position(hasher, record.position)
	identity_samples(hasher, record.samples)
}

identity_object :: proc(hasher: ^sha2.Context_256, record: ^Object) {
	identity_u64(hasher, u64(record.id))
	identity_u64(hasher, u64(record.kind))
	identity_f64(hasher, record.time_ms)
	identity_f64(hasher, record.end_time_ms)
	identity_position(hasher, record.position)
	identity_position(hasher, record.end_position)
	identity_position(hasher, record.stack_offset)
	identity_f64(hasher, record.scale)
	identity_f64(hasher, record.radius)
	identity_f64(hasher, record.preempt_ms)
	identity_f64(hasher, record.fade_in_ms)
	identity_i32(hasher, record.stack_height)
	identity_i32(hasher, record.combo_index)
	identity_i32(hasher, record.combo_index_with_offsets)
	identity_i32(hasher, record.index_in_combo)
	identity_u64(hasher, u64(record.new_combo))
	identity_u64(hasher, u64(record.last_in_combo))
	identity_u64(hasher, u64(record.combo_offset))
	identity_u64(hasher, u64(record.spans))
	identity_f64(hasher, record.velocity)
	identity_f64(hasher, record.span_duration)
	identity_f64(hasher, record.tick_distance)
	identity_f64(hasher, record.path_distance)
	identity_f64(hasher, record.calculated_distance)
	identity_u64(hasher, u64(record.generate_ticks))
	identity_u64(hasher, u64(len(record.vertices)))
	for vertex in record.vertices {
		identity_position(hasher, vertex)
	}
	identity_u64(hasher, u64(len(record.cumulative)))
	for distance in record.cumulative {
		identity_f64(hasher, distance)
	}
	identity_samples(hasher, record.samples)
	identity_samples(hasher, record.tail_samples)
	identity_samples(hasher, record.auxiliary_samples)
	identity_u64(hasher, u64(len(record.components)))
	for &component in record.components {
		identity_component(hasher, &component)
	}
	identity_i32(hasher, record.spins_required)
	identity_i32(hasher, record.maximum_bonus_spins)
}

identity_control_point :: proc(hasher: ^sha2.Context_256, record: ^Control_Point) {
	identity_f64(hasher, record.time_ms)
	identity_i32(hasher, record.source_id)
	identity_f64(hasher, record.beat_length)
	identity_f64(hasher, record.slider_velocity)
	identity_i32(hasher, record.meter)
	identity_i32(hasher, record.sample_set)
	identity_i32(hasher, record.sample_index)
	identity_i32(hasher, record.volume)
	identity_u64(hasher, u64(record.generate_ticks))
	identity_u64(hasher, u64(record.kiai))
	identity_u64(hasher, u64(record.omit_first_bar))
}

identity_playback :: proc(hasher: ^sha2.Context_256, record: ^Playback) {
	identity_f64(hasher, record.audio_lead_in)
	identity_f64(hasher, record.preview_time)
	identity_i32(hasher, record.sample_set)
	identity_i32(hasher, record.sample_volume)
	identity_i32(hasher, record.countdown)
	identity_i32(hasher, record.countdown_offset)
	identity_u64(hasher, u64(record.samples_match_playback_rate))
	identity_u64(hasher, u64(record.letterbox_in_breaks))
	identity_u64(hasher, u64(record.epilepsy_warning))
	identity_u64(hasher, u64(record.widescreen_storyboard))
	identity_u64(hasher, u64(record.special_style))
	identity_string(hasher, record.audio_filename)
}

identity_samples :: proc(hasher: ^sha2.Context_256, samples: []Sample) {
	identity_u64(hasher, u64(len(samples)))
	for &sample in samples {
		identity_sample(hasher, &sample)
	}
}

compute_identity :: proc(prepared_map: ^Map, raw_text: string) {
	hasher: sha2.Context_256
	sha2.init_256(&hasher)
	sha2.update(&hasher, transmute([]byte)raw_text)
	sha2.final(&hasher, prepared_map.raw_digest[:])
	sha2.init_256(&hasher)
	profile: string = IDENTITY_PROFILE
	sha2.update(&hasher, transmute([]byte)profile)
	sha2.update(&hasher, prepared_map.raw_digest[:])
	identity_u64(&hasher, u64(prepared_map.format_version))
	identity_f64(&hasher, prepared_map.difficulty.health_drain_rate)
	identity_f64(&hasher, prepared_map.difficulty.circle_size)
	identity_f64(&hasher, prepared_map.difficulty.overall_difficulty)
	identity_f64(&hasher, prepared_map.difficulty.approach_rate)
	identity_f64(&hasher, prepared_map.difficulty.slider_multiplier)
	identity_f64(&hasher, prepared_map.difficulty.tick_rate)
	identity_f64(&hasher, prepared_map.stack_leniency)
	identity_playback(&hasher, &prepared_map.playback)
	identity_u64(&hasher, u64(len(prepared_map.breaks)))
	for map_break in prepared_map.breaks {
		identity_f64(&hasher, map_break.start_ms)
		identity_f64(&hasher, map_break.end_ms)
	}
	identity_u64(&hasher, u64(len(prepared_map.timing_points)))
	for &point in prepared_map.timing_points {
		identity_control_point(&hasher, &point)
	}
	identity_u64(&hasher, u64(len(prepared_map.difficulty_points)))
	for &point in prepared_map.difficulty_points {
		identity_control_point(&hasher, &point)
	}
	identity_u64(&hasher, u64(len(prepared_map.sample_points)))
	for &point in prepared_map.sample_points {
		identity_control_point(&hasher, &point)
	}
	identity_u64(&hasher, u64(len(prepared_map.effect_points)))
	for &point in prepared_map.effect_points {
		identity_control_point(&hasher, &point)
	}
	identity_u64(&hasher, u64(len(prepared_map.objects)))
	for &object in prepared_map.objects {
		identity_object(&hasher, &object)
	}
	identity_u64(&hasher, u64(len(prepared_map.schedule)))
	for entry in prepared_map.schedule {
		identity_f64(&hasher, entry.time_ms)
		identity_u64(&hasher, u64(entry.object_index))
		identity_u64(&hasher, u64(entry.component_index))
	}
	sha2.final(&hasher, prepared_map.prepared_digest[:])
}

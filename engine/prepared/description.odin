// Portable little-endian description; every field offset comes from abi/records.json.
package prepared

import core_types "../core_types"
Binary_Builder :: struct {
	bytes: []byte,
	used, limit: u64,
	error: core_types.Status,
}

reserve :: proc(builder: ^Binary_Builder, count, stride: u64) -> u64 {
	if builder.error != .OK {
		return 0
	}
	start, end, valid := core_types.aligned_end(builder.used, count, stride, 8)
	if !valid || end > builder.limit {
		builder.error = .QUOTA_EXCEEDED
		return 0
	}
	builder.used = end
	return start
}

write_number :: proc(builder: ^Binary_Builder, offset, value, width: u64) {
	if len(builder.bytes) == 0 || builder.error != .OK {
		return
	}
	for byte_index: u64 = 0; byte_index < width; byte_index += 1 {
		builder.bytes[int(offset + byte_index)] = byte(value >> (byte_index * 8))
	}
}

write_header :: proc(builder: ^Binary_Builder, offset, kind, size: u64) {
	write_number(builder, offset + ABI_RECORD_KIND_OFFSET, kind, 2)
	write_number(builder, offset + ABI_RECORD_VERSION_OFFSET, 1, 2)
	write_number(builder, offset + ABI_RECORD_BYTE_SIZE_OFFSET, size, 4)
}

write_span :: proc(builder: ^Binary_Builder, offset, start, count, stride: u64) {
	write_number(builder, offset + ABI_ARRAY_OFFSET_OFFSET, start, 4)
	write_number(builder, offset + ABI_ARRAY_COUNT_OFFSET, count, 4)
	write_number(builder, offset + ABI_ARRAY_STRIDE_OFFSET, stride, 4)
}

write_string :: proc(builder: ^Binary_Builder, offset: u64, value: string) {
	start := reserve(builder, u64(len(value)), 1)
	write_span(builder, offset, start, u64(len(value)), 1)
	if len(builder.bytes) > 0 && builder.error == .OK {
		copy(builder.bytes[int(start):], transmute([]byte)value)
	}
}

write_samples :: proc(builder: ^Binary_Builder, span_offset: u64, samples: []Sample) {
	samples_offset := reserve(builder, u64(len(samples)), ABI_PREPARED_SAMPLE_SIZE)
	write_span(builder, span_offset, samples_offset, u64(len(samples)), ABI_PREPARED_SAMPLE_SIZE)
	for &sample, sample_index in samples {
		record_offset := samples_offset + u64(sample_index) * ABI_PREPARED_SAMPLE_SIZE
		write_header(builder, record_offset, ABI_PREPARED_SAMPLE_KIND, ABI_PREPARED_SAMPLE_SIZE)
		write_number(
			builder,
			record_offset + ABI_PREPARED_SAMPLE_VOLUME_OFFSET,
			u64(transmute(u32)sample.volume),
			4,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_SAMPLE_USE_BEATMAP_OFFSET,
			u64(sample.use_beatmap),
			4,
		)
		write_number(builder, record_offset + ABI_PREPARED_SAMPLE_LAYERED_OFFSET, u64(sample.layered), 4)
		write_number(builder, record_offset + ABI_PREPARED_SAMPLE_FLAGS_OFFSET, u64(is_loop_sample(sample.name) ? 1 : 0), 4)
		write_string(builder, record_offset + ABI_PREPARED_SAMPLE_NAME_OFFSET_OFFSET, sample.name)
		write_string(builder, record_offset + ABI_PREPARED_SAMPLE_BANK_OFFSET_OFFSET, sample.bank)
		write_string(builder, record_offset + ABI_PREPARED_SAMPLE_SUFFIX_OFFSET_OFFSET, sample.suffix)
		candidates_offset := reserve(builder, u64(len(sample.candidates)), ABI_SAMPLE_CANDIDATE_SIZE)
		write_span(
			builder,
			record_offset + ABI_PREPARED_SAMPLE_CANDIDATES_OFFSET_OFFSET,
			candidates_offset,
			u64(len(sample.candidates)),
			ABI_SAMPLE_CANDIDATE_SIZE,
		)
		for candidate, candidate_index in sample.candidates {
			candidate_offset := candidates_offset + u64(candidate_index) * ABI_SAMPLE_CANDIDATE_SIZE
			write_header(builder, candidate_offset, ABI_SAMPLE_CANDIDATE_KIND, ABI_SAMPLE_CANDIDATE_SIZE)
			write_string(builder, candidate_offset + ABI_SAMPLE_CANDIDATE_NAME_OFFSET_OFFSET, candidate)
		}
	}
}

write_components :: proc(builder: ^Binary_Builder, span_offset: u64, components: []Component) {
	components_offset := reserve(builder, u64(len(components)), ABI_PREPARED_COMPONENT_SIZE)
	write_span(builder, span_offset, components_offset, u64(len(components)), ABI_PREPARED_COMPONENT_SIZE)
	for &component, component_index in components {
		record_offset := components_offset + u64(component_index) * ABI_PREPARED_COMPONENT_SIZE
		write_header(builder, record_offset, ABI_PREPARED_COMPONENT_KIND, ABI_PREPARED_COMPONENT_SIZE)
		write_number(builder, record_offset + ABI_PREPARED_COMPONENT_ID_OFFSET, u64(component.id), 4)
		write_number(builder, record_offset + ABI_PREPARED_COMPONENT_KIND_OFFSET, u64(component.kind), 4)
		write_number(
			builder,
			record_offset + ABI_PREPARED_COMPONENT_TIME_MS_OFFSET,
			transmute(u64)component.time_ms,
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_COMPONENT_SPAN_START_MS_OFFSET,
			transmute(u64)component.span_start_ms,
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_COMPONENT_PROGRESS_OFFSET,
			transmute(u64)component.progress,
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_COMPONENT_POSITION_X_OFFSET,
			transmute(u64)component.position[0],
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_COMPONENT_POSITION_Y_OFFSET,
			transmute(u64)component.position[1],
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_COMPONENT_SPAN_INDEX_OFFSET,
			u64(component.span_index),
			4,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_COMPONENT_EVENT_TIME_MS_OFFSET,
			transmute(u64)component.event_time_ms,
			8,
		)
		write_samples(
			builder,
			record_offset + ABI_PREPARED_COMPONENT_SAMPLES_OFFSET_OFFSET,
			component.samples,
		)
	}
}

write_object :: proc(builder: ^Binary_Builder, record_offset: u64, object: ^Object) {
	write_header(builder, record_offset, ABI_PREPARED_OBJECT_KIND, ABI_PREPARED_OBJECT_SIZE)
	write_number(builder, record_offset + ABI_PREPARED_OBJECT_ID_OFFSET, u64(object.id), 4)
	write_number(builder, record_offset + ABI_PREPARED_OBJECT_KIND_OFFSET, u64(object.kind), 4)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_TIME_MS_OFFSET,
		transmute(u64)object.time_ms,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_END_TIME_MS_OFFSET,
		transmute(u64)object.end_time_ms,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_POSITION_X_OFFSET,
		transmute(u64)object.position[0],
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_POSITION_Y_OFFSET,
		transmute(u64)object.position[1],
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_END_POSITION_X_OFFSET,
		transmute(u64)object.end_position[0],
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_END_POSITION_Y_OFFSET,
		transmute(u64)object.end_position[1],
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_STACK_OFFSET_X_OFFSET,
		transmute(u64)object.stack_offset[0],
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_STACK_OFFSET_Y_OFFSET,
		transmute(u64)object.stack_offset[1],
		8,
	)
	write_number(builder, record_offset + ABI_PREPARED_OBJECT_SCALE_OFFSET, transmute(u64)object.scale, 8)
	write_number(builder, record_offset + ABI_PREPARED_OBJECT_RADIUS_OFFSET, transmute(u64)object.radius, 8)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_PREEMPT_MS_OFFSET,
		transmute(u64)object.preempt_ms,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_FADE_IN_MS_OFFSET,
		transmute(u64)object.fade_in_ms,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_STACK_HEIGHT_OFFSET,
		u64(transmute(u32)object.stack_height),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_COMBO_INDEX_OFFSET,
		u64(transmute(u32)object.combo_index),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_COMBO_INDEX_WITH_OFFSETS_OFFSET,
		u64(transmute(u32)object.combo_index_with_offsets),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_INDEX_IN_COMBO_OFFSET,
		u64(transmute(u32)object.index_in_combo),
		4,
	)
	write_number(builder, record_offset + ABI_PREPARED_OBJECT_NEW_COMBO_OFFSET, u64(object.new_combo), 4)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_LAST_IN_COMBO_OFFSET,
		u64(object.last_in_combo),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_COMBO_OFFSET_OFFSET,
		u64(object.combo_offset),
		4,
	)
	write_number(builder, record_offset + ABI_PREPARED_OBJECT_SPANS_OFFSET, u64(object.spans), 4)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_VELOCITY_OFFSET,
		transmute(u64)object.velocity,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_SPAN_DURATION_OFFSET,
		transmute(u64)object.span_duration,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_TICK_DISTANCE_OFFSET,
		transmute(u64)object.tick_distance,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_PATH_DISTANCE_OFFSET,
		transmute(u64)object.path_distance,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_CALCULATED_DISTANCE_OFFSET,
		transmute(u64)object.calculated_distance,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_GENERATE_TICKS_OFFSET,
		u64(object.generate_ticks),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_SPINS_REQUIRED_OFFSET,
		u64(transmute(u32)object.spins_required),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_OBJECT_MAXIMUM_BONUS_SPINS_OFFSET,
		u64(transmute(u32)object.maximum_bonus_spins),
		4,
	)
	vertices_offset := reserve(builder, u64(len(object.vertices)), 2 * size_of(f64))
	write_span(
		builder,
		record_offset + ABI_PREPARED_OBJECT_VERTICES_OFFSET_OFFSET,
		vertices_offset,
		u64(len(object.vertices)),
		2 * size_of(f64),
	)
	for vertex, vertex_index in object.vertices {
		for coordinate, axis_index in vertex {
			write_number(
				builder,
				vertices_offset + u64(vertex_index) * 2 * size_of(f64) + u64(axis_index) * size_of(f64),
				transmute(u64)coordinate,
				size_of(f64),
			)
		}
	}
	cumulative_offset := reserve(builder, u64(len(object.cumulative)), size_of(f64))
	write_span(
		builder,
		record_offset + ABI_PREPARED_OBJECT_CUMULATIVE_OFFSET_OFFSET,
		cumulative_offset,
		u64(len(object.cumulative)),
		size_of(f64),
	)
	for distance, distance_index in object.cumulative {
		write_number(
			builder,
			cumulative_offset + u64(distance_index) * size_of(f64),
			transmute(u64)distance,
			size_of(f64),
		)
	}
	write_samples(builder, record_offset + ABI_PREPARED_OBJECT_SAMPLES_OFFSET_OFFSET, object.samples)
	write_samples(
		builder,
		record_offset + ABI_PREPARED_OBJECT_TAIL_SAMPLES_OFFSET_OFFSET,
		object.tail_samples,
	)
	write_samples(
		builder,
		record_offset + ABI_PREPARED_OBJECT_AUXILIARY_SAMPLES_OFFSET_OFFSET,
		object.auxiliary_samples,
	)
	write_components(
		builder,
		record_offset + ABI_PREPARED_OBJECT_COMPONENTS_OFFSET_OFFSET,
		object.components,
	)
}

write_control_points :: proc(builder: ^Binary_Builder, span_offset: u64, points: []Control_Point) {
	points_offset := reserve(builder, u64(len(points)), ABI_PREPARED_CONTROL_POINT_SIZE)
	write_span(builder, span_offset, points_offset, u64(len(points)), ABI_PREPARED_CONTROL_POINT_SIZE)
	for point, point_index in points {
		record_offset := points_offset + u64(point_index) * ABI_PREPARED_CONTROL_POINT_SIZE
		write_header(
			builder,
			record_offset,
			ABI_PREPARED_CONTROL_POINT_KIND,
			ABI_PREPARED_CONTROL_POINT_SIZE,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_TIME_MS_OFFSET,
			transmute(u64)point.time_ms,
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_BEAT_LENGTH_OFFSET,
			transmute(u64)point.beat_length,
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_SLIDER_VELOCITY_OFFSET,
			transmute(u64)point.slider_velocity,
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_SOURCE_ID_OFFSET,
			u64(transmute(u32)point.source_id),
			4,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_METER_OFFSET,
			u64(transmute(u32)point.meter),
			4,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_SAMPLE_SET_OFFSET,
			u64(transmute(u32)point.sample_set),
			4,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_SAMPLE_INDEX_OFFSET,
			u64(transmute(u32)point.sample_index),
			4,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_VOLUME_OFFSET,
			u64(transmute(u32)point.volume),
			4,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_GENERATE_TICKS_OFFSET,
			u64(point.generate_ticks),
			4,
		)
		write_number(builder, record_offset + ABI_PREPARED_CONTROL_POINT_KIAI_OFFSET, u64(point.kiai), 4)
		write_number(
			builder,
			record_offset + ABI_PREPARED_CONTROL_POINT_OMIT_FIRST_BAR_OFFSET,
			u64(point.omit_first_bar),
			4,
		)
	}
}

write_playback :: proc(builder: ^Binary_Builder, playback: ^Playback) {
	record_offset := reserve(builder, 1, ABI_PREPARED_PLAYBACK_SIZE)
	write_span(
		builder,
		ABI_PREPARED_DESCRIPTOR_PLAYBACK_OFFSET_OFFSET,
		record_offset,
		1,
		ABI_PREPARED_PLAYBACK_SIZE,
	)
	write_header(builder, record_offset, ABI_PREPARED_PLAYBACK_KIND, ABI_PREPARED_PLAYBACK_SIZE)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_AUDIO_LEAD_IN_OFFSET,
		transmute(u64)playback.audio_lead_in,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_PREVIEW_TIME_OFFSET,
		transmute(u64)playback.preview_time,
		8,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_SAMPLE_SET_OFFSET,
		u64(transmute(u32)playback.sample_set),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_SAMPLE_VOLUME_OFFSET,
		u64(transmute(u32)playback.sample_volume),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_COUNTDOWN_OFFSET,
		u64(transmute(u32)playback.countdown),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_COUNTDOWN_OFFSET_OFFSET,
		u64(transmute(u32)playback.countdown_offset),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_SAMPLES_MATCH_PLAYBACK_RATE_OFFSET,
		u64(playback.samples_match_playback_rate),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_LETTERBOX_IN_BREAKS_OFFSET,
		u64(playback.letterbox_in_breaks),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_EPILEPSY_WARNING_OFFSET,
		u64(playback.epilepsy_warning),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_WIDESCREEN_STORYBOARD_OFFSET,
		u64(playback.widescreen_storyboard),
		4,
	)
	write_number(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_SPECIAL_STYLE_OFFSET,
		u64(playback.special_style),
		4,
	)
	write_string(
		builder,
		record_offset + ABI_PREPARED_PLAYBACK_AUDIO_FILENAME_OFFSET_OFFSET,
		playback.audio_filename,
	)
}

write_metadata :: proc(builder: ^Binary_Builder, metadata: ^Metadata) {
	record_offset := reserve(builder, 1, ABI_PREPARED_METADATA_SIZE)
	write_span(
		builder,
		ABI_PREPARED_DESCRIPTOR_METADATA_OFFSET_OFFSET,
		record_offset,
		1,
		ABI_PREPARED_METADATA_SIZE,
	)
	write_header(builder, record_offset, ABI_PREPARED_METADATA_KIND, ABI_PREPARED_METADATA_SIZE)
	write_string(builder, record_offset + ABI_PREPARED_METADATA_TITLE_OFFSET_OFFSET, metadata.title)
	write_string(builder, record_offset + ABI_PREPARED_METADATA_ARTIST_OFFSET_OFFSET, metadata.artist)
	write_string(builder, record_offset + ABI_PREPARED_METADATA_CREATOR_OFFSET_OFFSET, metadata.creator)
	write_string(builder, record_offset + ABI_PREPARED_METADATA_VERSION_OFFSET_OFFSET, metadata.version)
}

write_description :: proc(builder: ^Binary_Builder, prepared_map: ^Map) {
	reserve(builder, 1, ABI_PREPARED_DESCRIPTOR_SIZE)
	write_header(builder, 0, ABI_PREPARED_DESCRIPTOR_KIND, ABI_PREPARED_DESCRIPTOR_SIZE)
	write_number(builder, ABI_PREPARED_DESCRIPTOR_BEHAVIOR_ID_OFFSET, 202608042, 4)
	write_number(builder, ABI_PREPARED_DESCRIPTOR_NUMERIC_MODE_OFFSET, 3, 4)
	objects_offset := reserve(builder, u64(len(prepared_map.objects)), ABI_PREPARED_OBJECT_SIZE)
	write_span(
		builder,
		ABI_PREPARED_DESCRIPTOR_OBJECTS_OFFSET_OFFSET,
		objects_offset,
		u64(len(prepared_map.objects)),
		ABI_PREPARED_OBJECT_SIZE,
	)
	schedule_offset := reserve(builder, u64(len(prepared_map.schedule)), ABI_PREPARED_SCHEDULE_SIZE)
	write_span(
		builder,
		ABI_PREPARED_DESCRIPTOR_SCHEDULE_OFFSET_OFFSET,
		schedule_offset,
		u64(len(prepared_map.schedule)),
		ABI_PREPARED_SCHEDULE_SIZE,
	)
	for entry, entry_index in prepared_map.schedule {
		record_offset := schedule_offset + u64(entry_index) * ABI_PREPARED_SCHEDULE_SIZE
		write_header(builder, record_offset, ABI_PREPARED_SCHEDULE_KIND, ABI_PREPARED_SCHEDULE_SIZE)
		write_number(
			builder,
			record_offset + ABI_PREPARED_SCHEDULE_TIME_MS_OFFSET,
			transmute(u64)entry.time_ms,
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_SCHEDULE_OBJECT_INDEX_OFFSET,
			u64(entry.object_index),
			4,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_SCHEDULE_COMPONENT_INDEX_OFFSET,
			u64(entry.component_index),
			4,
		)
	}
	for &object, object_index in prepared_map.objects {
		write_object(builder, objects_offset + u64(object_index) * ABI_PREPARED_OBJECT_SIZE, &object)
	}
	breaks_offset := reserve(builder, u64(len(prepared_map.breaks)), ABI_PREPARED_BREAK_SIZE)
	write_span(
		builder,
		ABI_PREPARED_DESCRIPTOR_BREAKS_OFFSET_OFFSET,
		breaks_offset,
		u64(len(prepared_map.breaks)),
		ABI_PREPARED_BREAK_SIZE,
	)
	for map_break, break_index in prepared_map.breaks {
		record_offset := breaks_offset + u64(break_index) * ABI_PREPARED_BREAK_SIZE
		write_header(builder, record_offset, ABI_PREPARED_BREAK_KIND, ABI_PREPARED_BREAK_SIZE)
		write_number(
			builder,
			record_offset + ABI_PREPARED_BREAK_START_MS_OFFSET,
			transmute(u64)map_break.start_ms,
			8,
		)
		write_number(
			builder,
			record_offset + ABI_PREPARED_BREAK_END_MS_OFFSET,
			transmute(u64)map_break.end_ms,
			8,
		)
	}
	write_control_points(
		builder,
		ABI_PREPARED_DESCRIPTOR_TIMING_POINTS_OFFSET_OFFSET,
		prepared_map.timing_points,
	)
	write_control_points(
		builder,
		ABI_PREPARED_DESCRIPTOR_DIFFICULTY_POINTS_OFFSET_OFFSET,
		prepared_map.difficulty_points,
	)
	write_control_points(
		builder,
		ABI_PREPARED_DESCRIPTOR_SAMPLE_POINTS_OFFSET_OFFSET,
		prepared_map.sample_points,
	)
	write_control_points(
		builder,
		ABI_PREPARED_DESCRIPTOR_EFFECT_POINTS_OFFSET_OFFSET,
		prepared_map.effect_points,
	)
	write_playback(builder, &prepared_map.playback)
	write_metadata(builder, &prepared_map.metadata)
	write_number(builder, ABI_PREPARED_DESCRIPTOR_FORMAT_VERSION_OFFSET, u64(prepared_map.format_version), 4)
	write_number(
		builder,
		ABI_PREPARED_DESCRIPTOR_HP_OFFSET,
		transmute(u64)prepared_map.difficulty.health_drain_rate,
		8,
	)
	write_number(
		builder,
		ABI_PREPARED_DESCRIPTOR_CS_OFFSET,
		transmute(u64)prepared_map.difficulty.circle_size,
		8,
	)
	write_number(
		builder,
		ABI_PREPARED_DESCRIPTOR_OD_OFFSET,
		transmute(u64)prepared_map.difficulty.overall_difficulty,
		8,
	)
	write_number(
		builder,
		ABI_PREPARED_DESCRIPTOR_AR_OFFSET,
		transmute(u64)prepared_map.difficulty.approach_rate,
		8,
	)
	write_number(
		builder,
		ABI_PREPARED_DESCRIPTOR_SLIDER_MULTIPLIER_OFFSET,
		transmute(u64)prepared_map.difficulty.slider_multiplier,
		8,
	)
	write_number(
		builder,
		ABI_PREPARED_DESCRIPTOR_TICK_RATE_OFFSET,
		transmute(u64)prepared_map.difficulty.tick_rate,
		8,
	)
	write_number(
		builder,
		ABI_PREPARED_DESCRIPTOR_STACK_LENIENCY_OFFSET,
		transmute(u64)prepared_map.stack_leniency,
		8,
	)
	write_number(builder, ABI_PREPARED_DESCRIPTOR_TOTAL_BYTES_OFFSET, builder.used, 8)
	if len(builder.bytes) > 0 && builder.error == .OK {
		copy(builder.bytes[ABI_PREPARED_DESCRIPTOR_RAW_DIGEST_0_OFFSET:], prepared_map.raw_digest[:])
		copy(
			builder.bytes[ABI_PREPARED_DESCRIPTOR_PREPARED_DIGEST_0_OFFSET:],
			prepared_map.prepared_digest[:],
		)
	}
}

describe :: proc(prepared_map: ^Map, quota: u64, allocator := context.allocator) -> core_types.Status {
	if len(prepared_map.description.bytes) > 0 {
		return .INVALID_STATE
	}
	builder := Binary_Builder {
		limit = quota,
	}
	write_description(&builder, prepared_map)
	if builder.error != .OK {
		return builder.error
	}
	candidate, status := core_types.arena_create(builder.used, allocator)
	if status != .OK {
		return status
	}
	committed := false
	defer {
		if !committed {
			core_types.arena_destroy(&candidate)
		}
	}
	builder.bytes = candidate.bytes
	builder.used = 0
	write_description(&builder, prepared_map)
	if builder.error != .OK {
		return builder.error
	}
	prepared_map.description = candidate
	candidate = {} // Transfer sole ownership after encoding succeeds.
	committed = true
	return .OK
}

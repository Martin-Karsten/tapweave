package engine_runtime

import beatmap_decode "../beatmap_decode"
import core_types "../core_types"

// Foundation map summary: one kind-5 map_descriptor record carrying the
// decoded difficulty inputs, display-only BPM and playable-duration bounds,
// and one kind-54 metadata record with owned UTF-8 strings. Built once during
// foundation map_prepare and immutable afterwards, mirroring the prepared
// description lifecycle. The BPM bounds are presentation derivations from the
// decoded uninherited timing points; they are not upstream-matched math.

Summary_Builder :: struct {
	bytes: []byte,
	used: u64,
	limit: u64,
	failed: bool,
}

summary_reserve :: proc(builder: ^Summary_Builder, count, stride: u64) -> u64 {
	if builder.failed {
		return 0
	}
	start, end, valid := core_types.aligned_end(builder.used, count, stride, 8)
	if !valid || end > builder.limit {
		builder.failed = true
		return 0
	}
	builder.used = end
	return start
}

summary_put_u32 :: proc(builder: ^Summary_Builder, offset: u64, value: u32) {
	if len(builder.bytes) == 0 || builder.failed {
		return
	}
	put_u32(builder.bytes, int(offset), value)
}

summary_put_u64 :: proc(builder: ^Summary_Builder, offset: u64, value: u64) {
	if len(builder.bytes) == 0 || builder.failed {
		return
	}
	put_u64(builder.bytes, int(offset), value)
}

summary_put_f64 :: proc(builder: ^Summary_Builder, offset: u64, number: f64) {
	if len(builder.bytes) == 0 || builder.failed {
		return
	}
	put_f64(builder.bytes, int(offset), number)
}

summary_write_string :: proc(builder: ^Summary_Builder, span_offset: u64, value: string) {
	start := summary_reserve(builder, u64(len(value)), 1)
	summary_put_u32(builder, span_offset, u32(start))
	summary_put_u32(builder, span_offset + 4, u32(len(value)))
	summary_put_u32(builder, span_offset + 8, 1)
	if len(builder.bytes) == 0 || builder.failed {
		return
	}
	copy(builder.bytes[int(start):int(start) + len(value)], value)
}

summary_write_header :: proc(builder: ^Summary_Builder, offset: u64, kind, size: u32) {
	summary_put_u32(builder, offset, kind | 1 << 16)
	summary_put_u32(builder, offset + 4, size)
}

summary_write :: proc(builder: ^Summary_Builder, decoded: ^beatmap_decode.Map, live_arena_bytes: u64) {
	record_offset := summary_reserve(builder, 1, ABI_MAP_DESCRIPTOR_SIZE)
	summary_write_header(builder, record_offset, ABI_MAP_DESCRIPTOR_KIND, ABI_MAP_DESCRIPTOR_SIZE)
	summary_put_u32(builder, record_offset + ABI_MAP_DESCRIPTOR_FORMAT_VERSION_OFFSET, decoded.format_version)
	summary_put_u32(builder, record_offset + ABI_MAP_DESCRIPTOR_FOUNDATION_OFFSET, 1)
	summary_put_u32(builder, record_offset + ABI_MAP_DESCRIPTOR_OBJECTS_OFFSET, u32(len(decoded.objects)))
	summary_put_u32(builder, record_offset + ABI_MAP_DESCRIPTOR_RAW_TIMING_OFFSET, u32(len(decoded.timing)))
	summary_put_u64(builder, record_offset + ABI_MAP_DESCRIPTOR_LIVE_ARENA_BYTES_OFFSET, live_arena_bytes)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_HP_OFFSET, decoded.difficulty.health_drain_rate)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_CS_OFFSET, decoded.difficulty.circle_size)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_OD_OFFSET, decoded.difficulty.overall_difficulty)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_AR_OFFSET, decoded.difficulty.approach_rate)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_SLIDER_MULTIPLIER_OFFSET, decoded.difficulty.slider_multiplier)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_TICK_RATE_OFFSET, decoded.difficulty.tick_rate)

	bpm_min, bpm_max := summary_bpm_bounds(decoded)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_BPM_MIN_OFFSET, bpm_min)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_BPM_MAX_OFFSET, bpm_max)

	first_object_ms, last_object_ms := summary_duration_bounds(decoded)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_FIRST_OBJECT_MS_OFFSET, first_object_ms)
	summary_put_f64(builder, record_offset + ABI_MAP_DESCRIPTOR_LAST_OBJECT_MS_OFFSET, last_object_ms)

	metadata_offset := summary_reserve(builder, 1, ABI_PREPARED_METADATA_SIZE)
	summary_put_u32(builder, record_offset + ABI_MAP_DESCRIPTOR_METADATA_OFFSET_OFFSET, u32(metadata_offset))
	summary_put_u32(builder, record_offset + ABI_MAP_DESCRIPTOR_METADATA_COUNT_OFFSET, 1)
	summary_put_u32(builder, record_offset + ABI_MAP_DESCRIPTOR_METADATA_STRIDE_OFFSET, ABI_PREPARED_METADATA_SIZE)
	summary_write_header(builder, metadata_offset, ABI_PREPARED_METADATA_KIND, ABI_PREPARED_METADATA_SIZE)
	summary_write_string(builder, metadata_offset + ABI_PREPARED_METADATA_TITLE_OFFSET_OFFSET, decoded.metadata.title)
	summary_write_string(builder, metadata_offset + ABI_PREPARED_METADATA_ARTIST_OFFSET_OFFSET, decoded.metadata.artist)
	summary_write_string(builder, metadata_offset + ABI_PREPARED_METADATA_CREATOR_OFFSET_OFFSET, decoded.metadata.creator)
	summary_write_string(builder, metadata_offset + ABI_PREPARED_METADATA_VERSION_OFFSET_OFFSET, decoded.metadata.version)
}

// Display-only BPM bounds over uninherited timing points (positive
// beat_length); 0/0 when the map declares none.
summary_bpm_bounds :: proc(decoded: ^beatmap_decode.Map) -> (bpm_min, bpm_max: f64) {
	for &timing_point in decoded.timing {
		if timing_point.beat_length <= 0 {
			continue
		}
		bpm := 60000 / timing_point.beat_length
		if bpm_min == 0 || bpm < bpm_min {
			bpm_min = bpm
		}
		if bpm > bpm_max {
			bpm_max = bpm
		}
	}
	return
}

// Playable-duration bounds: first object start to last object end. Zero when
// the map has no objects.
summary_duration_bounds :: proc(decoded: ^beatmap_decode.Map) -> (first_object_ms, last_object_ms: f64) {
	for &raw_object in decoded.objects {
		if first_object_ms == 0 || raw_object.time_ms < first_object_ms {
			first_object_ms = raw_object.time_ms
		}
		if raw_object.end_time_ms > last_object_ms {
			last_object_ms = raw_object.end_time_ms
		}
	}
	return
}

foundation_summary :: proc(
	decoded: ^beatmap_decode.Map,
	live_arena_bytes, quota: u64,
	allocator := context.allocator,
) -> (
	summary: core_types.Arena,
	status: core_types.Status,
) {
	builder := Summary_Builder{limit = quota}
	summary_write(&builder, decoded, live_arena_bytes)
	if builder.failed {
		return {}, .QUOTA_EXCEEDED
	}
	candidate, allocation := core_types.arena_create(builder.used, allocator)
	if allocation != .OK {
		return {}, allocation
	}
	committed := false
	defer {
		if !committed {
			core_types.arena_destroy(&candidate)
		}
	}
	builder.bytes = candidate.bytes
	builder.used = 0
	summary_write(&builder, decoded, live_arena_bytes)
	if builder.failed {
		return {}, .QUOTA_EXCEEDED
	}
	summary = candidate
	candidate = {} // Transfer sole ownership after encoding succeeds.
	committed = true
	return summary, .OK
}

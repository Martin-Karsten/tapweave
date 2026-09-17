package osu_prepare

import core_types "../core_types"
import prepared "../prepared"
import beatmap_decode "../beatmap_decode"


Map_Builder :: struct {
	arena: ^core_types.Arena,
	used, limit, component_count: u64,
	fill: bool,
	error: core_types.Error,
	work_budget: ^core_types.Work_Budget,
}

map_take :: proc(builder: ^Map_Builder, $T: typeid, count: u64) -> []T {
	if builder.error.status != .OK {
		return nil
	}
	if builder.work_budget != nil && !core_types.spend_work(builder.work_budget, count) {
		builder.error = {
			status = .QUOTA_EXCEEDED,
			code = .PREPARATION_WORK,
			requested = count,
			limit = builder.work_budget.remaining,
		}
		return nil
	}
	_, end, valid := core_types.aligned_end(builder.used, count, size_of(T), align_of(T))
	if !valid || end > builder.limit {
		builder.error = {
			status = .QUOTA_EXCEEDED,
			code = .ARENA_BYTES,
			requested = end,
			limit = builder.limit,
		}
		return nil
	}
	builder.used = end
	if !builder.fill {
		return nil
	}
	result, ok := core_types.arena_take(builder.arena, T, count)
	if !ok {
		builder.error = {
			status = .INTERNAL,
		}
		return nil
	}
	return result
}

map_string :: proc(builder: ^Map_Builder, text: string) -> string {
	bytes := map_take(builder, byte, u64(len(text)))
	if !builder.fill {
		return text
	}
	if builder.error.status != .OK {
		return ""
	}
	copy(bytes, transmute([]byte)text)
	return string(bytes)
}

copy_vertices :: proc(builder: ^Map_Builder, source: []Position_F64) -> []prepared.Position {
	result := map_take(builder, prepared.Position, u64(len(source)))
	if builder.fill && builder.error.status == .OK {
		copy(result, source)
	}
	return result
}

copy_lengths :: proc(builder: ^Map_Builder, source: []f64) -> []f64 {
	result := map_take(builder, f64, u64(len(source)))
	if builder.fill && builder.error.status == .OK {
		copy(result, source)
	}
	return result
}


prepare_shared_records :: proc(
	builder: ^Map_Builder,
	prepared_map: ^prepared.Map,
	decoded: ^beatmap_decode.Map,
	points: ^Points,
) {
	prepared_map.format_version = decoded.format_version
	prepared_map.playback = {
		audio_lead_in = decoded.general.audio_lead_in,
		preview_time = decoded.general.preview_time,
		sample_set = decoded.general.sample_set,
		sample_volume = decoded.general.sample_volume,
		countdown = decoded.general.countdown,
		countdown_offset = decoded.general.countdown_offset,
		samples_match_playback_rate = decoded.general.samples_match_playback_rate,
		letterbox_in_breaks = decoded.general.letterbox_in_breaks,
		epilepsy_warning = decoded.general.epilepsy_warning,
		widescreen_storyboard = decoded.general.widescreen_storyboard,
		special_style = decoded.general.special_style,
		audio_filename = map_string(builder, decoded.metadata.audio),
	}
	prepared_map.metadata = {
		title = map_string(builder, decoded.metadata.title),
		artist = map_string(builder, decoded.metadata.artist),
		creator = map_string(builder, decoded.metadata.creator),
		version = map_string(builder, decoded.metadata.version),
	}
	prepared_map.breaks = map_take(builder, prepared.Break, u64(len(decoded.breaks)))
	if builder.fill && builder.error.status == .OK {
		for map_break, break_index in decoded.breaks {
			prepared_map.breaks[break_index] = {map_break.start_ms, map_break.end_ms}
		}
	}
	prepared_map.timing_points = copy_control_points(builder, points.timing)
	prepared_map.difficulty_points = copy_control_points(builder, points.difficulty)
	prepared_map.sample_points = copy_control_points(builder, points.sample)
	prepared_map.effect_points = copy_control_points(builder, points.effect)
}

copy_control_points :: proc(
	builder: ^Map_Builder,
	source: []prepared.Control_Point,
) -> []prepared.Control_Point {
	result := map_take(builder, prepared.Control_Point, u64(len(source)))
	if builder.fill && builder.error.status == .OK {
		copy(result, source)
	}
	return result
}

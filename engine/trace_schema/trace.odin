package trace_schema

import beatmap_decode "../beatmap_decode"
import osu_prepare "../osu_prepare"
import core_types "../core_types"
import "core:encoding/json"
import "core:slice"

Control_Points :: struct {
	timing, difficulty, sample, effect: []osu_prepare.Point,
}

Query :: struct {
	time_ms: f64,
	timing, difficulty, sample, effect: osu_prepare.Point,
}

Decode_Trace :: struct {
	schema_version: u32,
	kind: string,
	error: core_types.Error,
	format_version: u32,
	difficulty: beatmap_decode.Difficulty,
	metadata: beatmap_decode.Metadata,
	stack_leniency: f64,
	general: beatmap_decode.General,
	breaks: []beatmap_decode.Break,
	objects: []beatmap_decode.Raw_Object,
	timing: []beatmap_decode.Raw_Timing,
	control_points: Control_Points,
	queries: []Query,
}

// Serialize fields, never native struct bytes/pointers/padding. Arena sizes are
// intentionally diagnostics, not compatibility records (pointer widths differ).
decode_trace :: proc(text: string) -> ([]byte, bool) {
	decoded_map, error := beatmap_decode.decode(text)
	defer beatmap_decode.destroy(&decoded_map)
	points: osu_prepare.Points
	if error.status == .OK {
		status: core_types.Status
		points, status = osu_prepare.resolve(&decoded_map)
		if status != .OK {
			return nil, false
		}
	}
	defer osu_prepare.destroy(&points)
	times := make([dynamic]f64)
	defer delete(times)
	append(&times, -1000, 0)
	for array in ([4][]osu_prepare.Point{points.timing, points.difficulty, points.sample, points.effect}) {
		for point in array {
			for delta in ([5]f64{-6, -5, 0, 5, 6}) {
				append(&times, point.time_ms + delta)
			}
		}
	}
	slice.sort(times[:])
	queries := make([dynamic]Query)
	defer delete(queries)
	for time, index in times {
		if index > 0 && time == times[index - 1] {
			continue
		}
		append(
			&queries,
			Query {
				time,
				osu_prepare.query(points.timing, .TIMING, time),
				osu_prepare.query(points.difficulty, .DIFFICULTY, time),
				osu_prepare.query(points.sample, .SAMPLE, time),
				osu_prepare.query(points.effect, .EFFECT, time),
			},
		)
	}
	trace := Decode_Trace {
		schema_version = 2,
		kind = "decoded-map",
		error = error,
		format_version = decoded_map.format_version,
		difficulty = decoded_map.difficulty,
		metadata = decoded_map.metadata,
		stack_leniency = decoded_map.stack_leniency,
		general = decoded_map.general,
		breaks = decoded_map.breaks,
		objects = decoded_map.objects,
		timing = decoded_map.timing,
		control_points = {points.timing, points.difficulty, points.sample, points.effect},
		queries = queries[:],
	}
	bytes, marshal_error := json.marshal(trace, {use_enum_names = true})
	return bytes, marshal_error == nil
}

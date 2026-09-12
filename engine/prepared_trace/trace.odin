package prepared_trace

import core_types "../core_types"
import beatmap_decode "../beatmap_decode"
import osu_prepare "../osu_prepare"
import prepared "../prepared"
import "core:encoding/json"
import "core:crypto/sha2"
import "core:time"
Trace :: struct {
	schema_version: u32,
	format_version: u32,
	playback: prepared.Playback,
	breaks: []prepared.Break,
	timing_points, difficulty_points, sample_points, effect_points: []prepared.Control_Point,
	difficulty: prepared.Difficulty,
	stack_leniency: f64,
	objects: []prepared.Object,
	schedule: []prepared.Schedule_Entry,
	digest, description_digest: [32]byte,
	description_bytes: u64,
}

Statistics :: struct {
	decode_ns, control_points_ns, preparation_ns, description_ns: i64,
	decode_bytes, control_points_bytes, prepared_bytes, description_bytes, scratch_bytes: u64,
}

run :: proc(input: []byte, statistics: ^Statistics = nil) -> ([]byte, bool) {
	started := time.tick_now()
	decoded, error := beatmap_decode.decode(string(input))
	if error.status != .OK {
		return nil, false
	}
	defer beatmap_decode.destroy(&decoded)
	if statistics != nil {
		statistics.decode_ns = i64(time.tick_since(started))
		statistics.decode_bytes = u64(len(decoded.arena.bytes))
	}
	started = time.tick_now()
	work_budget := core_types.Work_Budget {
		remaining = core_types.DEFAULT_PREPARATION_WORK,
	}
	remaining_bytes := core_types.DEFAULT_QUOTAS.arena_bytes - u64(len(decoded.arena.bytes))
	points, status := osu_prepare.resolve(&decoded, remaining_bytes, work_budget = &work_budget)
	if status != .OK {
		return nil, false
	}
	defer osu_prepare.destroy(&points)
	if statistics != nil {
		statistics.control_points_ns = i64(time.tick_since(started))
		statistics.control_points_bytes = u64(len(points.arena.bytes))
	}
	started = time.tick_now()
	remaining_bytes -= u64(len(points.arena.bytes))
	prepared_map, preparation_error := osu_prepare.prepare_map(
		&decoded,
		&points,
		remaining_bytes,
		work_budget = &work_budget,
	)
	if preparation_error.status != .OK {
		return nil, false
	}
	defer prepared.destroy_map(&prepared_map)
	if statistics != nil {
		statistics.preparation_ns = i64(time.tick_since(started))
		statistics.prepared_bytes = u64(len(prepared_map.arena.bytes))
	}
	started = time.tick_now()
	if prepared.describe(&prepared_map, remaining_bytes - u64(len(prepared_map.arena.bytes))) != .OK {
		return nil, false
	}
	if statistics != nil {
		statistics.description_ns = i64(time.tick_since(started))
		statistics.description_bytes = u64(len(prepared_map.description.bytes))
		scratch, scratch_status := osu_prepare.create_scratch(&decoded, remaining_bytes, context.allocator)
		if scratch_status != .OK {
			return nil, false
		}
		statistics.scratch_bytes = u64(len(scratch.arena.bytes))
		core_types.arena_destroy(&scratch.arena)
	}
	hasher: sha2.Context_256
	sha2.init_256(&hasher)
	sha2.update(&hasher, prepared_map.description.bytes)
	description_digest: [32]byte
	sha2.final(&hasher, description_digest[:])
	output, marshal_error := json.marshal(
		Trace {
			2,
			prepared_map.format_version,
			prepared_map.playback,
			prepared_map.breaks,
			prepared_map.timing_points,
			prepared_map.difficulty_points,
			prepared_map.sample_points,
			prepared_map.effect_points,
			prepared_map.difficulty,
			prepared_map.stack_leniency,
			prepared_map.objects,
			prepared_map.schedule,
			prepared_map.prepared_digest,
			description_digest,
			u64(len(prepared_map.description.bytes)),
		},
		{use_enum_names = true},
	)
	return output, marshal_error == nil
}

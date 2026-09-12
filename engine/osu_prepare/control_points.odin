package osu_prepare

import core_types "../core_types"
import beatmap_decode "../beatmap_decode"
import prepared "../prepared"

// Source-informed port of pinned LegacyBeatmapDecoder pending-group resolution,
// ControlPointInfo.Add and LegacyControlPointInfo fallback rules.
Kind :: enum {
	TIMING,
	DIFFICULTY,
	SAMPLE,
	EFFECT,
}

Point :: prepared.Control_Point
Points :: struct {
	arena: core_types.Arena,
	timing, difficulty, sample, effect: []Point,
}

default_point :: proc(kind: Kind) -> Point {
	return Point {
		source_id = -1,
		beat_length = 1000,
		slider_velocity = 1,
		meter = 4,
		sample_set = 1,
		volume = 100,
		generate_ticks = true,
	}
}

selected_index :: proc(points: []Point, time: f64) -> int {
	lower_index, upper_index := 0, len(points)
	for lower_index < upper_index {
		middle_index := lower_index + (upper_index - lower_index) / 2
		if points[middle_index].time_ms <= time {
			lower_index = middle_index + 1
		} else {
			upper_index = middle_index
		}
	}
	return lower_index - 1
}

query :: proc(points: []Point, kind: Kind, time: f64) -> Point {
	index := selected_index(points, time)
	if index >= 0 {
		return points[index]
	}
	if (kind == .TIMING || kind == .SAMPLE) && len(points) > 0 {
		return points[0]
	}
	return default_point(kind)
}

redundant :: proc(first_point, second_point: Point, kind: Kind) -> bool {
	switch kind {
	case .TIMING:
		return false
	case .DIFFICULTY:
		return(
			first_point.slider_velocity == second_point.slider_velocity &&
			first_point.generate_ticks == second_point.generate_ticks \
		)
	case .SAMPLE:
		return(
			first_point.sample_set == second_point.sample_set &&
			first_point.sample_index == second_point.sample_index &&
			first_point.volume == second_point.volume \
		)
	case .EFFECT:
		return first_point.kiai == second_point.kiai
	}
	return false
}

add :: proc(
	storage: []Point,
	count: ^int,
	point: Point,
	kind: Kind,
	work_budget: ^core_types.Work_Budget,
) -> bool {
	index := selected_index(storage[:count^], point.time_ms)
	previous := default_point(kind)
	if index >= 0 {
		previous = storage[index]
	}
	if (kind != .SAMPLE || index >= 0) && redundant(point, previous, kind) {
		return true
	}
	if index >= 0 && storage[index].time_ms == point.time_ms {
		storage[index] = point
		return true
	}
	if !core_types.spend_work(work_budget, u64(count^ - index)) {
		return false
	}
	insertion_index := index + 1
	for shifted_point_index := count^;
	    shifted_point_index > insertion_index;
	    shifted_point_index -= 1 {
		storage[shifted_point_index] = storage[shifted_point_index - 1]
	}
	storage[insertion_index] = point
	count^ += 1
	return true
}

resolve :: proc(
	decoded_map: ^beatmap_decode.Map,
	quota := core_types.DEFAULT_QUOTAS.arena_bytes,
	allocator := context.allocator,
	work_budget: ^core_types.Work_Budget = nil,
) -> (
	result: Points,
	status: core_types.Status,
) {
	local_budget := core_types.Work_Budget {
		remaining = core_types.DEFAULT_PREPARATION_WORK,
	}
	work_budget := work_budget
	if work_budget == nil {
		work_budget = &local_budget
	}
	bytes, ok := core_types.checked_product(u64(len(decoded_map.timing)), 4 * size_of(Point))
	if !ok || bytes > quota || bytes > core_types.MAX_ADDRESSABLE {
		return {}, .QUOTA_EXCEEDED
	}
	arena, allocation_status := core_types.arena_create(bytes, allocator)
	if allocation_status != .OK {
		return {}, allocation_status
	}
	result.arena = arena
	arena = {} // Ownership transferred to the result.
	all, taken := core_types.arena_take(&result.arena, Point, 4 * u64(len(decoded_map.timing)))
	if !taken {
		destroy(&result)
		return {}, .INTERNAL
	}
	timing_point_count := len(decoded_map.timing)
	arrays := [4][]Point {
		all[:timing_point_count],
		all[timing_point_count:2 * timing_point_count],
		all[2 * timing_point_count:3 * timing_point_count],
		all[3 * timing_point_count:],
	}
	counts: [4]int
	start := 0
	for start < timing_point_count {
		end := start + 1
		for end < timing_point_count &&
		    decoded_map.timing[end].time_ms == decoded_map.timing[start].time_ms {
			end += 1
		}
		timing_index, inherited_index := -1, -1
		for timing_index_in_group in start ..< end {
			if decoded_map.timing[timing_index_in_group].timing_change {
				if timing_index < 0 {
					timing_index = timing_index_in_group
				}
				if inherited_index < 0 {
					inherited_index = timing_index_in_group
				}
			} else {
				inherited_index = timing_index_in_group
			}
		}
		for kind in Kind {
			index := kind == .TIMING ? timing_index : inherited_index
			if index < 0 {
				continue
			}
			raw := decoded_map.timing[index]
			point := default_point(kind)
			point.time_ms = raw.time_ms
			point.source_id = i32(raw.id)
			switch kind {
			case .TIMING:
				point.beat_length = clamp(raw.beat_length, 6, 60000)
				point.meter = raw.meter
				point.omit_first_bar = raw.effects & 8 != 0
			case .DIFFICULTY:
				point.slider_velocity = raw.beat_length < 0 ? clamp(100 / -raw.beat_length, 0.1, 10) : 1
				point.generate_ticks = raw.generate_ticks
			case .SAMPLE:
				point.sample_set = raw.sample_set == 0 ? 1 : raw.sample_set
				point.sample_index = raw.sample_index
				point.volume = clamp(raw.volume, 0, 100)
			case .EFFECT:
				point.kiai = raw.effects & 1 != 0
			}
			if !add(arrays[int(kind)], &counts[int(kind)], point, kind, work_budget) {
				destroy(&result)
				return {}, .QUOTA_EXCEEDED
			}
		}
		start = end
	}
	result.timing = arrays[0][:counts[0]]
	result.difficulty = arrays[1][:counts[1]]
	result.sample = arrays[2][:counts[2]]
	result.effect = arrays[3][:counts[3]]
	return result, .OK
}

destroy :: proc(point: ^Points) {
	core_types.arena_destroy(&point.arena)
	point^ = {}
}

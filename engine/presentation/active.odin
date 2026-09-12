package presentation

import "core:slice"
import core_types "../core_types"
import prepared "../prepared"
import simulation "../simulation"

// Conservative retention from pinned DrawableHitCircle's 800 ms lifetime.
// This bounds traversal; it is not a substitute for A22 animation observations.
FEEDBACK_RETENTION_MS :: 800.0

feedback_duration :: proc(projection: simulation.Projection, object_index: int, result: core_types.Hit_Result) -> f64 {
	if projection.prepared_objects[object_index].kind == .CIRCLE && result == .MISS {
		return 100
	}
	return FEEDBACK_RETENTION_MS
}

feedback_expired :: proc(projection: simulation.Projection, object_index: int, time_ms: f64, circle_policy: bool) -> bool {
	outcome := &projection.outcomes[object_index]
	if outcome.result == .NONE {
		return false
	}
	if circle_policy && projection.prepared_objects[object_index].kind == .CIRCLE {
		// DrawableHitCircle fades a miss over 100 ms and cuts a hit at 800 ms.
		// Actual drawable observations verify these separately from skin styling.
		duration_ms := feedback_duration(projection, object_index, outcome.result)
		return time_ms >= outcome.result_time_ms + duration_ms
	}
	// Non-circle draw producers have not yet replaced conservative membership.
	return time_ms > outcome.result_time_ms + FEEDBACK_RETENTION_MS
}

Reveal :: struct {
	time_ms: f64,
	object_index: int,
}

Active_Set :: struct {
	// All storage borrows the caller's creation-time arena. Never copy this owner.
	reveals: []Reveal,
	indices: []int,
	next_reveal, count: int,
	previous_ms: f64,
	epoch: u32,
	initialized: bool,
	circle_policy: bool,
	// Per-read work counters, including rebuilds after backwards diagnostic reads.
	visited_count, revealed_count, ordering_work: u64,
}

required_bytes :: proc(object_count: u64, arena_used: u64 = 0) -> (u64, core_types.Status) {
	total := arena_used
	if !simulation.size_add(&total, Reveal, object_count) ||
	   !simulation.size_add(&total, int, object_count) {
		return 0, .QUOTA_EXCEEDED
	}
	return total - arena_used, .OK
}

initialize_active :: proc(active_set: ^Active_Set, prepared_map: ^prepared.Map, arena: ^core_types.Arena) -> core_types.Status {
	object_count := u64(len(prepared_map.objects))
	required, status := required_bytes(object_count, arena.used)
	if status != .OK || arena.used > u64(len(arena.bytes)) || required > u64(len(arena.bytes)) - arena.used {
		return .QUOTA_EXCEEDED
	}
	// Validate every key before claiming arena storage.
	for &object in prepared_map.objects {
		if !core_types.finite(object.time_ms - object.preempt_ms) {
			return .INVALID_ARGUMENT
		}
	}
	active_set.reveals, _ = core_types.arena_take(arena, Reveal, object_count)
	active_set.indices, _ = core_types.arena_take(arena, int, object_count)
	for &object, object_index in prepared_map.objects {
		active_set.reveals[object_index] = {object.time_ms - object.preempt_ms, object_index}
	}
	slice.sort_by(active_set.reveals, proc(left, right: Reveal) -> bool {
		return left.time_ms < right.time_ms || left.time_ms == right.time_ms && left.object_index < right.object_index
	})
	return .OK
}

refresh_active :: proc(active_set: ^Active_Set, projection: simulation.Projection, time_ms: f64, epoch: u32, circle_policy := false) -> core_types.Status {
	if !core_types.finite(time_ms) {
		return .INVALID_ARGUMENT
	}
	if !active_set.initialized || epoch != active_set.epoch || time_ms < active_set.previous_ms || circle_policy != active_set.circle_policy {
		active_set.count = 0
		active_set.next_reveal = 0
	}
	active_set.visited_count = 0
	active_set.revealed_count = 0
	active_set.ordering_work = 0
	// Compact in source order; feedback survives journal acknowledgement.
	retained_count := 0
	for object_index in active_set.indices[:active_set.count] {
		active_set.visited_count += 1
		if feedback_expired(projection, object_index, time_ms, circle_policy) {
			continue
		}
		active_set.indices[retained_count] = object_index
		retained_count += 1
	}
	active_set.count = retained_count
	for active_set.next_reveal < len(active_set.reveals) && active_set.reveals[active_set.next_reveal].time_ms <= time_ms {
		object_index := active_set.reveals[active_set.next_reveal].object_index
		active_set.next_reveal += 1
		active_set.revealed_count += 1
		if feedback_expired(projection, object_index, time_ms, circle_policy) {
			continue
		}
		active_set.indices[active_set.count] = object_index
		active_set.count += 1
	}
	if active_set.count > retained_count {
		// Heap sort bounds an adverse reveal burst to O(active * log(active)),
		// uses no scratch allocation, and preserves unique source index order.
		for root_index := active_set.count / 2 - 1; root_index >= 0; root_index -= 1 {
			sift_active(active_set, root_index, active_set.count)
		}
		for end_index := active_set.count - 1; end_index > 0; end_index -= 1 {
			active_set.indices[0], active_set.indices[end_index] = active_set.indices[end_index], active_set.indices[0]
			sift_active(active_set, 0, end_index)
		}
	}
	active_set.previous_ms = time_ms
	active_set.epoch = epoch
	active_set.initialized = true
	active_set.circle_policy = circle_policy
	return .OK
}

sift_active :: proc(active_set: ^Active_Set, root_index, end_index: int) {
	parent_index := root_index
	for parent_index * 2 + 1 < end_index {
		child_index := parent_index * 2 + 1
		active_set.ordering_work += 1
		if child_index + 1 < end_index && active_set.indices[child_index] < active_set.indices[child_index + 1] {
			child_index += 1
		}
		active_set.ordering_work += 1
		if active_set.indices[parent_index] >= active_set.indices[child_index] {
			break
		}
		active_set.indices[parent_index], active_set.indices[child_index] = active_set.indices[child_index], active_set.indices[parent_index]
		parent_index = child_index
	}
}

package presentation

import "core:slice"
import core_types "../core_types"
import prepared "../prepared"
import simulation "../simulation"

// Conservative retention from pinned DrawableHitCircle's 800 ms lifetime.
// This bounds traversal; it is not a substitute for A22 animation observations.
FEEDBACK_RETENTION_MS :: 800.0

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
	// Per-read work counters, including rebuilds after backwards diagnostic reads.
	visited_count, revealed_count: u64,
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

refresh_active :: proc(active_set: ^Active_Set, projection: simulation.Projection, time_ms: f64, epoch: u32) -> core_types.Status {
	if !core_types.finite(time_ms) {
		return .INVALID_ARGUMENT
	}
	if !active_set.initialized || epoch != active_set.epoch || time_ms < active_set.previous_ms {
		active_set.count = 0
		active_set.next_reveal = 0
	}
	active_set.visited_count = 0
	active_set.revealed_count = 0
	// Compact in source order; feedback survives journal acknowledgement.
	retained_count := 0
	for object_index in active_set.indices[:active_set.count] {
		outcome := simulation.project_object(projection, object_index, time_ms)
		active_set.visited_count += 1
		if outcome.result != .NONE && time_ms > outcome.result_time_ms + FEEDBACK_RETENTION_MS {
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
		outcome := simulation.project_object(projection, object_index, time_ms)
		if outcome.result != .NONE && time_ms > outcome.result_time_ms + FEEDBACK_RETENTION_MS {
			continue
		}
		// Reveal order can differ from source order (different preempt values).
		insertion_index := active_set.count
		for insertion_index > 0 && active_set.indices[insertion_index - 1] > object_index {
			active_set.indices[insertion_index] = active_set.indices[insertion_index - 1]
			insertion_index -= 1
		}
		active_set.indices[insertion_index] = object_index
		active_set.count += 1
	}
	active_set.previous_ms = time_ms
	active_set.epoch = epoch
	active_set.initialized = true
	return .OK
}

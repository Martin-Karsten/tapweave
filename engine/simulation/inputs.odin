package simulation

import core_types "../core_types"

Input_Queue :: struct {
	storage: []core_types.Input_Snapshot,
	read_index, count: int,
	last_sequence: u64,
	last_time_ms: f64,
	has_input: bool,
}

// Effective time is already beatmap-relative. A runtime clock adapter must
// validate raw/effective conversion before calling this pure queue primitive.
enqueue_inputs :: proc(
	queue: ^Input_Queue,
	inputs: []core_types.Input_Snapshot,
	committed_ms: f64,
) -> (
	core_types.Status,
	int,
) {
	// Borrowed source records must not alias any part of the ring storage.
	if core_types.buffers_overlap(
		raw_data(inputs),
		u64(len(inputs)) * size_of(core_types.Input_Snapshot),
		raw_data(queue.storage),
		u64(len(queue.storage)) * size_of(core_types.Input_Snapshot),
	) {
		return .INVALID_ARGUMENT, 0
	}
	if !core_types.finite(committed_ms) {
		return .INVALID_ARGUMENT, 0
	}
	if len(inputs) > min(len(queue.storage), MAX_EVENTS) - queue.count {
		return .QUOTA_EXCEEDED, 0
	}
	previous_sequence := queue.last_sequence
	previous_time_ms := queue.last_time_ms
	has_input := queue.has_input
	for input, input_index in inputs {
		if !core_types.valid_input(input) || input.sequence <= previous_sequence {
			return .INVALID_ARGUMENT, input_index
		}
		if input.effective_time_ms < committed_ms {
			return .LATE_INPUT, input_index
		}
		if has_input && input.effective_time_ms < previous_time_ms {
			return .INVALID_ARGUMENT, input_index
		}
		previous_sequence = input.sequence
		previous_time_ms = input.effective_time_ms
		has_input = true
	}
	// Publish only after validating every record; the ring reuses consumed slots.
	for input in inputs {
		queue.storage[(queue.read_index + queue.count) % len(queue.storage)] = input
		queue.count += 1
	}
	queue.last_sequence = previous_sequence
	queue.last_time_ms = previous_time_ms
	queue.has_input = has_input
	return .OK, 0
}

peek_input :: proc(queue: ^Input_Queue) -> (core_types.Input_Snapshot, bool) {
	if queue.count == 0 {
		return {}, false
	}
	return queue.storage[queue.read_index], true
}

consume_input :: proc(queue: ^Input_Queue) -> (core_types.Input_Snapshot, bool) {
	input, exists := peek_input(queue)
	if !exists {
		return {}, false
	}
	queue.read_index = (queue.read_index + 1) % len(queue.storage)
	queue.count -= 1
	return input, true
}

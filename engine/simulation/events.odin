package simulation
import core_types "../core_types"

Phase :: enum u8 {
	INPUT,
	TRACKING,
	JUDGEMENT,
	PARENT,
	SCORE_HEALTH,
	OUTPUT,
}
Event_Key :: struct {
	time_ms: f64,
	phase: Phase,
	object_index, component_index: u32,
	input_sequence: u64,
}
less :: proc(left, right: Event_Key) -> bool {
	if left.time_ms != right.time_ms {
		return left.time_ms < right.time_ms
	}
	if left.phase != right.phase {
		return left.phase < right.phase
	}
	if left.object_index != right.object_index {
		return left.object_index < right.object_index
	}
	if left.component_index != right.component_index {
		return left.component_index < right.component_index
	}
	return left.input_sequence < right.input_sequence
}
Event :: struct {
	key: Event_Key,
	id: u64,
}
// Borrowed caller-owned buffers. This is a scheduler primitive, not a session
// or a public ABI. No allocation, implicit growth, callbacks, or map dependency.
Event_Queue :: struct {
	storage: []Event,
	count: int,
}
MAX_EVENTS :: 1_000_000
push :: proc(queue: ^Event_Queue, event: Event) -> core_types.Status {
	if !core_types.finite(event.key.time_ms) || u8(event.key.phase) > u8(Phase.OUTPUT) {
		return .INVALID_ARGUMENT
	}
	// Inputs have no target object until dispatched. Their ordering is sequence.
	if event.key.phase == .INPUT &&
	   (event.key.object_index != 0 || event.key.component_index != 0 || event.key.input_sequence == 0) {
		return .INVALID_ARGUMENT
	}
	if queue.count >= len(queue.storage) || queue.count >= MAX_EVENTS {
		return .QUOTA_EXCEEDED
	}
	heap_index := queue.count
	queue.count += 1
	for heap_index > 0 {
		parent_index := (heap_index - 1) / 2
		if !less(event.key, queue.storage[parent_index].key) {
			break
		}
		queue.storage[heap_index] = queue.storage[parent_index]
		heap_index = parent_index
	}
	queue.storage[heap_index] = event
	return .OK
}
peek :: proc(queue: ^Event_Queue) -> (Event, bool) {
	if queue.count == 0 {
		return {}, false
	}
	return queue.storage[0], true
}
pop :: proc(queue: ^Event_Queue) -> (Event, bool) {
	if queue.count == 0 {
		return {}, false
	}
	event := queue.storage[0]
	queue.count -= 1
	if queue.count == 0 {
		return event, true
	}
	replacement_event := queue.storage[queue.count]
	heap_index := 0
	for {
		child_index := heap_index * 2 + 1
		if child_index >= queue.count {
			break
		}
		if child_index + 1 < queue.count &&
		   less(queue.storage[child_index + 1].key, queue.storage[child_index].key) {
			child_index += 1
		}
		if !less(queue.storage[child_index].key, replacement_event.key) {
			break
		}
		queue.storage[heap_index] = queue.storage[child_index]
		heap_index = child_index
	}
	queue.storage[heap_index] = replacement_event
	return event, true
}
// Drain only whole events that fit. The caller advances committed time only
// after the target interval has been completely consumed and dispatched.
drain :: proc(queue: ^Event_Queue, target_ms: f64, output: []Event) -> (int, core_types.Status) {
	// Heap mutations and output writes require disjoint caller buffers.
	if core_types.buffers_overlap(
		raw_data(output),
		u64(len(output)) * size_of(Event),
		raw_data(queue.storage),
		u64(len(queue.storage)) * size_of(Event),
	) {
		return 0, .INVALID_ARGUMENT
	}
	if !core_types.finite(target_ms) {
		return 0, .INVALID_ARGUMENT
	}
	written_count := 0
	for {
		event, exists := peek(queue)
		if !exists || event.key.time_ms > target_ms {
			return written_count, .OK
		}
		if written_count == len(output) {
			return written_count, .OUTPUT_REQUIRED
		}
		output[written_count], _ = pop(queue)
		written_count += 1
	}
}

package simulation_tests

import "core:crypto/sha2"
import "core:math"
import "core:mem"
import "core:testing"
import core_types "../core_types"
import replay "../replay"
import simulation "../simulation"

@(test)
input_overlap_rejection_preserves_ring_and_source :: proc(test: ^testing.T) {
	backing_storage := [5]core_types.Input_Snapshot {
		input(1, 100),
		input(2, 101),
		input(3, 102),
		input(4, 103),
		input(5, 104),
	}
	// Cover identical spans, wraparound, and partial overlap in both directions.
	for read_index in 0 ..< 3 {
		queue := simulation.Input_Queue {
			storage = backing_storage[1:4],
			read_index = read_index,
		}
		for source_start in 0 ..< 3 {
			original_queue := queue
			original_storage := backing_storage
			status: core_types.Status
			record_index: int
			{
				context.allocator = mem.panic_allocator()
				status, record_index = simulation.enqueue_inputs(
					&queue,
					backing_storage[source_start:source_start + 3],
					0,
				)
			}
			testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
			testing.expect_value(test, record_index, 0)
			testing.expect_value(test, queue.count, original_queue.count)
			testing.expect_value(test, raw_data(queue.storage), raw_data(original_queue.storage))
			testing.expect_value(test, len(queue.storage), len(original_queue.storage))
			testing.expect_value(test, queue.read_index, original_queue.read_index)
			testing.expect_value(test, queue.last_sequence, original_queue.last_sequence)
			testing.expect_value(test, queue.last_time_ms, original_queue.last_time_ms)
			testing.expect_value(test, queue.has_input, original_queue.has_input)
			testing.expect_value(test, backing_storage, original_storage)
		}
	}
	// Adjacent slices and empty slices are disjoint and remain usable.
	queue := simulation.Input_Queue {
		storage = backing_storage[:3],
	}
	status, _ := simulation.enqueue_inputs(&queue, backing_storage[3:], 0)
	testing.expect_value(test, status, core_types.Status.OK)
	status, _ = simulation.enqueue_inputs(&queue, backing_storage[:0], 0)
	testing.expect_value(test, status, core_types.Status.OK)
	for expected_sequence in 4 ..< 6 {
		record, exists := simulation.consume_input(&queue)
		testing.expect(test, exists)
		testing.expect_value(test, record.sequence, u64(expected_sequence))
	}
}

@(test)
event_overlap_rejection_preserves_heap_and_outputs :: proc(test: ^testing.T) {
	backing_storage: [6]simulation.Event
	queue := simulation.Event_Queue {
		storage = backing_storage[1:4],
	}
	for event_index in 0 ..< 3 {
		status := simulation.push(&queue, {{f64(event_index), .OUTPUT, 0, 0, 0}, u64(event_index + 1)})
		testing.expect_value(test, status, core_types.Status.OK)
	}
	for output_start in 0 ..< 3 {
		original_queue := queue
		original_storage := backing_storage
		written_count: int
		status: core_types.Status
		{
			context.allocator = mem.panic_allocator()
			written_count, status = simulation.drain(
				&queue,
				3,
				backing_storage[output_start:output_start + 3],
			)
		}
		testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
		testing.expect_value(test, written_count, 0)
		testing.expect_value(test, queue.count, original_queue.count)
		testing.expect_value(test, raw_data(queue.storage), raw_data(original_queue.storage))
		testing.expect_value(test, len(queue.storage), len(original_queue.storage))
		testing.expect_value(test, backing_storage, original_storage)
	}
	written_count, status := simulation.drain(&queue, 3, backing_storage[:0])
	testing.expect_value(test, status, core_types.Status.OUTPUT_REQUIRED)
	testing.expect_value(test, written_count, 0)
	// An adjacent output is allowed; a short drain retains the final event.
	written_count, status = simulation.drain(&queue, 3, backing_storage[4:])
	testing.expect_value(test, status, core_types.Status.OUTPUT_REQUIRED)
	testing.expect_value(test, written_count, 2)
	testing.expect_value(test, backing_storage[4].id, 1)
	testing.expect_value(test, backing_storage[5].id, 2)
	remaining_event, exists := simulation.pop(&queue)
	testing.expect(test, exists)
	testing.expect_value(test, remaining_event.id, 3)
}

@(test)
replay_interpolation_preserves_subnormal_and_extreme_intervals :: proc(test: ^testing.T) {
	smallest_positive := transmute(f64)u64(1)
	largest_finite := transmute(f64)u64(0x7fef_ffff_ffff_ffff)
	intervals := [][2]f64 {
		{0, 3 * smallest_positive},
		{-3 * smallest_positive, 0},
		{-smallest_positive, smallest_positive},
		{-largest_finite, largest_finite},
		{100, 400},
	}
	sample_times := []f64{smallest_positive, -2 * smallest_positive, 0, 0, 200}

	expected_positions := []f64{100, 100, 150, 150, 100}

	for interval, interval_index in intervals {
		frames := []core_types.Input_Snapshot {
			input(1, interval[0], core_types.LEFT),
			input(2, interval[1], core_types.RIGHT),
		}
		frames[1].x = 300
		frames[1].y = -300
		status, _ := replay.validate_frames(frames)
		testing.expect_value(test, status, core_types.Status.OK)
		sampled_frame: core_types.Input_Snapshot
		{
			context.allocator = mem.panic_allocator()
			sampled_frame, status = replay.sample(frames, sample_times[interval_index])
		}
		testing.expect_value(test, status, core_types.Status.OK)
		testing.expect_value(test, sampled_frame.x, expected_positions[interval_index])
		testing.expect_value(test, sampled_frame.y, -expected_positions[interval_index])
		testing.expect_value(test, sampled_frame.action_bits, core_types.LEFT)
		for endpoint_frame in frames {
			sampled_frame, status = replay.sample(frames, endpoint_frame.effective_time_ms)
			testing.expect_value(test, status, core_types.Status.OK)
			testing.expect_value(test, sampled_frame, endpoint_frame)
		}
	}
}

// Mutate canonical bytes and deliberately recompute the checksum so decode must
// reach semantic validation. These offsets describe the internal replay format,
// not the production ABI. Include invalid second frames to catch partial writes.
Codec_Mutation :: struct {
	name: string,
	offset, byte_count: int,
	bits: u64,
	expected_status: core_types.Status,
}

@(test)
replay_decode_rejects_checksummed_malformed_records_transactionally :: proc(test: ^testing.T) {
	identity := replay.Identity {
		schema_version = replay.SCHEMA_VERSION,
		compatibility_version = replay.COMPATIBILITY_VERSION,
		rules_version = replay.RULES_VERSION,
		behavior_id = replay.BEHAVIOR_ID,
		coordinate_version = replay.COORDINATE_VERSION,
		rate = 1,
	}
	frames := []core_types.Input_Snapshot{input(1, 100), input(2, 200)}

	original_bytes: [replay.HEADER_BYTES + 2 * replay.FRAME_BYTES + replay.CHECKSUM_BYTES]byte
	_, encode_status := replay.encode(identity, frames, {}, original_bytes[:])
	testing.expect_value(test, encode_status, core_types.Status.OK)
	SECOND_FRAME_OFFSET :: replay.HEADER_BYTES + replay.FRAME_BYTES
	mutations := []Codec_Mutation {
		{"header reserved count", 44, 4, 1, .INVALID_ARGUMENT},
		{"header reserved tail", 184, 8, 1, .INVALID_ARGUMENT},
		{"frame reserved", SECOND_FRAME_OFFSET + 52, 4, 1, .INVALID_ARGUMENT},
		{"unsupported profile", 24, 4, 1, .UNSUPPORTED},
		{"wrong map digest", 88, 1, 1, .INVALID_ARGUMENT},
		{"nonfinite offset", 56, 8, transmute(u64)math.nan_f64(), .INVALID_ARGUMENT},
		{"nonfinite cursor", SECOND_FRAME_OFFSET + 24, 8, transmute(u64)math.inf_f64(1), .INVALID_ARGUMENT},
		{"nonfinite time", SECOND_FRAME_OFFSET + 16, 8, transmute(u64)math.nan_f64(), .INVALID_ARGUMENT},
		{"unknown action", SECOND_FRAME_OFFSET + 40, 4, 8, .INVALID_ARGUMENT},
		{"unknown flags", SECOND_FRAME_OFFSET + 48, 4, 1, .INVALID_ARGUMENT},
		{"zero sequence", SECOND_FRAME_OFFSET, 8, 0, .INVALID_ARGUMENT},
		{"reused sequence", SECOND_FRAME_OFFSET, 8, 1, .INVALID_ARGUMENT},
		{"offset timestamp", SECOND_FRAME_OFFSET + 8, 8, transmute(u64)f64(201), .INVALID_ARGUMENT},
		{"reversed time", SECOND_FRAME_OFFSET + 8, 8, transmute(u64)f64(99), .INVALID_ARGUMENT},
	}
	for mutation in mutations {
		mutated_bytes := original_bytes
		for byte_index in 0 ..< mutation.byte_count {
			mutated_bytes[mutation.offset + byte_index] = byte(mutation.bits >> u32(byte_index * 8))
		}
		if mutation.name == "reversed time" {
			// Both time fields must agree to reach the ordering check.
			copy(
				mutated_bytes[SECOND_FRAME_OFFSET + 16:SECOND_FRAME_OFFSET + 24],
				mutated_bytes[SECOND_FRAME_OFFSET + 8:SECOND_FRAME_OFFSET + 16],
			)
		}
		checksum: [32]byte
		hasher: sha2.Context_256
		sha2.init_256(&hasher)
		sha2.update(&hasher, mutated_bytes[:len(mutated_bytes) - replay.CHECKSUM_BYTES])
		sha2.final(&hasher, checksum[:])
		copy(mutated_bytes[len(mutated_bytes) - replay.CHECKSUM_BYTES:], checksum[:])
		destination := [2]core_types.Input_Snapshot{input(90, 900), input(91, 901)}

		original_destination := destination
		decoded: replay.Decoded
		decode_status: core_types.Status
		{
			context.allocator = mem.panic_allocator()
			decoded, decode_status = replay.decode(mutated_bytes[:], identity, destination[:])
		}
		testing.expect_value(test, decode_status, mutation.expected_status, value_expr = mutation.name)
		testing.expect_value(test, len(decoded.frames), 0, value_expr = mutation.name)
		testing.expect_value(test, destination, original_destination, value_expr = mutation.name)
	}
}

package simulation_tests
import "core:testing"
import "core:math"
import "core:mem"
import core_types "../core_types"
import scoring "../scoring"
import rules "../osu_rules"
import simulation "../simulation"
import replay "../replay"

@(test)
scoring_properties_counts_and_normalization :: proc(test: ^testing.T) {
	maxima, status := scoring.prepare_maxima([]core_types.Hit_Result{.GREAT, .GREAT})
	testing.expect_value(test, status, core_types.Status.OK)
	score := scoring.create(maxima)
	testing.expect_value(test, scoring.apply(&score, {.GREAT, .GREAT}), core_types.Status.OK)
	testing.expect_value(test, scoring.apply(&score, {.OK, .GREAT}), core_types.Status.OK)
	testing.expect_value(test, score.total, 399177)
	testing.expect_value(test, score.accumulator.numerator, 400)
	testing.expect_value(test, score.accumulator.denominator, 600)
	testing.expect_value(test, score.accumulator.combo, 2)
	testing.expect_value(test, score.accumulator.counts[.GREAT], 1)
	testing.expect_value(test, score.accumulator.counts[.OK], 1)
	for result in core_types.Hit_Result {
		property := core_types.result_properties(result)
		testing.expect(test, !(property.increases_combo && property.breaks_combo))
		testing.expect(test, !(property.hit && property.miss))
	}
	testing.expect(test, !core_types.result_properties(.SMALL_TICK_MISS).breaks_combo)
	testing.expect(test, core_types.result_properties(.SLIDER_TAIL_HIT).accuracy)
}

@(test)
score_rejection_failure_and_rounding :: proc(test: ^testing.T) {
	maxima, _ := scoring.prepare_maxima([]core_types.Hit_Result{.GREAT})
	score := scoring.create(maxima)
	original := score
	testing.expect_value(
		test,
		scoring.apply(&score, {cast(core_types.Hit_Result)99, .GREAT}),
		core_types.Status.INVALID_ARGUMENT,
	)
	testing.expect_value(test, score, original)
	testing.expect_value(test, scoring.apply(&score, {.GREAT, .GREAT}, true), core_types.Status.OK)
	testing.expect_value(test, score, original)
	testing.expect_value(test, scoring.apply(&score, {.MISS, .GREAT}), core_types.Status.OK)
	scoring.fail(&score)
	original = score
	testing.expect_value(test, scoring.apply(&score, {.GREAT, .GREAT}), core_types.Status.INVALID_STATE)
	testing.expect_value(test, score, original)
	expected_rounding := []i64{0, 2, 2, 4}
	for value, rounding_index in ([]f64{0.5, 1.5, 2.5, 3.5}) {
		rounded, status := scoring.round_score(value)
		testing.expect_value(test, status, core_types.Status.OK)
		testing.expect_value(test, rounded, expected_rounding[rounding_index])
	}
	for value in ([]f64{-1, math.nan_f64(), math.inf_f64(1), 9_223_372_036_854_775_808.0}) {
		_, status := scoring.round_score(value)
		testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
	}
	testing.expect_value(test, scoring.rank_for(1, 1), scoring.Rank.A)
	testing.expect_value(test, scoring.rank_for(0.95, 0), scoring.Rank.S)
}

@(test)
hit_window_and_spin_source_semantics :: proc(test: ^testing.T) {
	windows, status := rules.hit_windows(5)
	testing.expect_value(test, status, core_types.Status.OK)
	testing.expect_value(test, windows, rules.Hit_Windows{49.5, 99.5, 149.5})
	testing.expect_value(test, rules.result_for(windows, -400), core_types.Hit_Result.MISS)
	testing.expect_value(test, rules.result_for(windows, 400), core_types.Hit_Result.MISS)
	testing.expect_value(test, rules.result_for(windows, 401), core_types.Hit_Result.NONE)
	testing.expect(test, rules.can_be_hit(windows, 149.5))
	testing.expect(test, !rules.can_be_hit(windows, 150))
	history: rules.Spin_History
	for delta, delta_index in ([]f32{90, 90, -90, -90}) {
		testing.expect_value(
			test,
			rules.report_delta(&history, f64(delta_index), delta),
			core_types.Status.OK,
		)
	}
	testing.expect_value(test, rules.total_rotation(&history), 180)
	original := history
	testing.expect_value(test, rules.report_delta(&history, 0, 90), core_types.Status.LATE_INPUT)
	testing.expect_value(test, history, original)
	testing.expect_value(test, rules.report_delta(&history, 5, 181), core_types.Status.INVALID_ARGUMENT)
	testing.expect_value(test, history, original)
}

@(test)
event_heap_phase_order_and_output_backpressure :: proc(test: ^testing.T) {
	storage: [6]simulation.Event
	queue := simulation.Event_Queue {
		storage = storage[:],
	}
	for phase_index in 0 ..< 6 {
		phase := simulation.Phase(5 - phase_index)
		testing.expect_value(
			test,
			simulation.push(&queue, {{100, phase, 0, 0, phase == .INPUT ? 1 : 0}, u64(phase_index)}),
			core_types.Status.OK,
		)
	}
	original_count := queue.count
	testing.expect_value(
		test,
		simulation.push(&queue, {{math.nan_f64(), .OUTPUT, 0, 0, 0}, 9}),
		core_types.Status.INVALID_ARGUMENT,
	)
	testing.expect_value(test, queue.count, original_count)
	testing.expect_value(
		test,
		simulation.push(&queue, {{200, .OUTPUT, 0, 0, 0}, 9}),
		core_types.Status.QUOTA_EXCEEDED,
	)
	output: [2]simulation.Event
	for phase_index in 0 ..< 3 {
		written, status := simulation.drain(&queue, 100, output[:])
		testing.expect_value(test, written, 2)
		testing.expect_value(
			test,
			status,
			phase_index < 2 ? core_types.Status.OUTPUT_REQUIRED : core_types.Status.OK,
		)
		testing.expect_value(test, output[0].key.phase, simulation.Phase(phase_index * 2))
		testing.expect_value(test, output[1].key.phase, simulation.Phase(phase_index * 2 + 1))
	}
	testing.expect_value(test, queue.count, 0)
}

@(test)
event_stable_key_and_future_retention :: proc(test: ^testing.T) {
	storage: [4]simulation.Event
	queue := simulation.Event_Queue {
		storage = storage[:],
	}
	for event in ([]simulation.Event{{{100, .JUDGEMENT, 1, 1, 0}, 4}, {{100, .JUDGEMENT, 1, 0, 0}, 3}, {{100, .INPUT, 0, 0, 2}, 2}, {{100, .INPUT, 0, 0, 1}, 1}}) {
		testing.expect_value(test, simulation.push(&queue, event), core_types.Status.OK)
	}
	output: [4]simulation.Event
	written, status := simulation.drain(&queue, 99, output[:])
	testing.expect_value(test, written, 0)
	testing.expect_value(test, status, core_types.Status.OK)
	testing.expect_value(test, queue.count, 4)
	written, status = simulation.drain(&queue, 100, output[:])
	for event, event_index in output {
		testing.expect_value(test, event.id, u64(event_index + 1))
	}
}

input :: proc(sequence: u64, time_ms: f64, actions: u32 = 0) -> core_types.Input_Snapshot {
	return {sequence = sequence, raw_time_ms = time_ms, effective_time_ms = time_ms, action_bits = actions}
}
@(test)
input_batch_transaction_and_ring_reuse :: proc(test: ^testing.T) {
	storage: [3]core_types.Input_Snapshot
	queue := simulation.Input_Queue {
		storage = storage[:],
	}
	status, _ := simulation.enqueue_inputs(&queue, []core_types.Input_Snapshot{input(1, 100)}, 0)
	testing.expect_value(test, status, core_types.Status.OK)
	bad_batch := []core_types.Input_Snapshot{input(2, 100), input(3, 101, 8)}
	before := storage
	record_index: int
	status, record_index = simulation.enqueue_inputs(&queue, bad_batch, 100)
	testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
	testing.expect_value(test, record_index, 1)
	testing.expect_value(test, storage, before)
	testing.expect_value(test, queue.count, 1)
	testing.expect_value(test, queue.last_sequence, 1)
	status, _ = simulation.enqueue_inputs(&queue, []core_types.Input_Snapshot{input(2, 99)}, 100)
	testing.expect_value(test, status, core_types.Status.LATE_INPUT)
	status, _ = simulation.enqueue_inputs(
		&queue,
		[]core_types.Input_Snapshot{input(2, 100), input(3, 200)},
		100,
	)
	testing.expect_value(test, status, core_types.Status.OK)
	for _ in 0 ..< 2 {
		simulation.consume_input(&queue)
	}
	status, _ = simulation.enqueue_inputs(
		&queue,
		[]core_types.Input_Snapshot{input(4, 201), input(5, 202)},
		200,
	)
	testing.expect_value(test, status, core_types.Status.OK)
	for sequence in 3 ..< 6 {
		record, exists := simulation.consume_input(&queue)
		testing.expect(test, exists)
		testing.expect_value(test, record.sequence, u64(sequence))
	}
	status, _ = simulation.enqueue_inputs(&queue, []core_types.Input_Snapshot{input(5, 203)}, 202)
	testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
}

@(test)
replay_identity_validation_and_interpolation :: proc(test: ^testing.T) {
	identity := replay.Identity {
		schema_version = 2,
		compatibility_version = 1,
		rules_version = 1,
		behavior_id = 202608042,
		coordinate_version = 1,
		rate = 1,
	}
	testing.expect_value(test, replay.validate_identity(identity, identity), core_types.Status.OK)
	incompatible := identity
	incompatible.prepared_digest[0] = 1
	testing.expect_value(
		test,
		replay.validate_identity(incompatible, identity),
		core_types.Status.INVALID_ARGUMENT,
	)
	incompatible = identity
	incompatible.rate = 1.5
	testing.expect_value(
		test,
		replay.validate_identity(incompatible, identity),
		core_types.Status.UNSUPPORTED,
	)
	frames := []core_types.Input_Snapshot {
		input(1, 100, 1),
		input(2, 200, 2),
		input(3, 200, 0),
		input(4, 300, 1),
	}
	frames[1].x = 100
	frames[2].x = 100
	frames[3].x = 200
	status, _ := replay.validate_frames(frames)
	testing.expect_value(test, status, core_types.Status.OK)
	frame, _ := replay.sample(frames, 150)
	testing.expect_value(test, frame.x, 50)
	testing.expect_value(test, frame.action_bits, 1)
	frame, _ = replay.sample(frames, 200)
	testing.expect_value(test, frame.sequence, 3)
	testing.expect_value(test, frame.action_bits, 0)
	frame, _ = replay.sample(frames, 99)
	testing.expect_value(test, frame.action_bits, 0)
	frames[2].raw_time_ms += 10
	frame_index: int
	status, frame_index = replay.validate_frames(frames)
	testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
	testing.expect_value(test, frame_index, 2)
}

@(test)
primitives_do_not_allocate :: proc(test: ^testing.T) {
	maxima, _ := scoring.prepare_maxima([]core_types.Hit_Result{.GREAT})
	score := scoring.create(maxima)
	event_storage: [8]simulation.Event
	queue := simulation.Event_Queue {
		storage = event_storage[:],
	}
	input_storage: [8]core_types.Input_Snapshot
	inputs := simulation.Input_Queue {
		storage = input_storage[:],
	}
	history: rules.Spin_History
	status: core_types.Status
	{
		context.allocator = mem.panic_allocator()
		status = scoring.apply(&score, {.GREAT, .GREAT})
		rules.report_delta(&history, 0, 90)
		simulation.push(&queue, {{0, .OUTPUT, 0, 0, 0}, 1})
		simulation.pop(&queue)
		simulation.enqueue_inputs(&inputs, []core_types.Input_Snapshot{input(1, 0)}, 0)
		simulation.consume_input(&inputs)
	}
	testing.expect_value(test, status, core_types.Status.OK)
}

@(test)
replay_codec_roundtrip_and_transactional_corruption :: proc(test: ^testing.T) {
	identity := replay.Identity {
		schema_version = 2,
		compatibility_version = 1,
		rules_version = 1,
		behavior_id = 202608042,
		coordinate_version = 1,
		rate = 1,
	}
	identity.raw_digest[3] = 45
	identity.prepared_digest[6] = 78
	frames := []core_types.Input_Snapshot{input(1, 100, 1), input(2, 100, 0), input(3, 200, 2)}
	frames[2].x = 1.0 / 3
	frames[2].sequence = 0xffff_ffff_ffff_fffe
	final_digest: [32]byte
	final_digest[2] = 123
	bytes: [replay.HEADER_BYTES + 3 * replay.FRAME_BYTES + replay.CHECKSUM_BYTES]byte
	destination: [3]core_types.Input_Snapshot
	size, status := replay.encode(identity, frames, final_digest, bytes[:])
	testing.expect_value(test, size, u64(len(bytes)))
	testing.expect_value(test, status, core_types.Status.OK)
	result: replay.Decoded
	{
		context.allocator = mem.panic_allocator()
		result, status = replay.decode(bytes[:], identity, destination[:])
	}
	testing.expect_value(test, status, core_types.Status.OK)
	testing.expect_value(test, result.identity, identity)
	testing.expect_value(test, result.final_digest, final_digest)
	for frame, frame_index in frames {
		testing.expect_value(test, destination[frame_index], frame)
	}
	before := destination
	// Every single-byte corruption is rejected and preserves previous frames.
	for byte_index in 0 ..< len(bytes) {
		bytes[byte_index] ~= 1
		_, status = replay.decode(bytes[:], identity, destination[:])
		testing.expect(test, status != .OK)
		testing.expect_value(test, destination, before)
		bytes[byte_index] ~= 1
	}
	_, status = replay.decode(bytes[:len(bytes) - 1], identity, destination[:])
	testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
	_, status = replay.decode(bytes[:], identity, destination[:2])
	testing.expect_value(test, status, core_types.Status.OUTPUT_REQUIRED)
	testing.expect_value(test, destination, before)
	byte_before := bytes
	_, status = replay.encode(identity, frames, final_digest, bytes[:10])
	testing.expect_value(test, status, core_types.Status.OUTPUT_REQUIRED)
	testing.expect_value(test, bytes, byte_before)
	frames[1].action_bits = 8
	_, status = replay.encode(identity, frames, final_digest, bytes[:])
	testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
	testing.expect_value(test, bytes, byte_before)
}

@(test)
drain_calibration_is_bounded_and_validated :: proc(test: ^testing.T) {
	increases := []scoring.Health_Increase{{1000, 0.03}, {2000, 0.03}, {3000, 0.03}}
	rate, status := scoring.calibrate_drain(increases, nil, 5, 0)
	testing.expect_value(test, status, core_types.Status.OK)
	testing.expect(test, rate > 0 && rate < 0.001)
	{
		context.allocator = mem.panic_allocator()
		_, status = scoring.calibrate_drain(increases, nil, 5, 0)
	}
	testing.expect_value(test, status, core_types.Status.OK)
	rate, status = scoring.calibrate_drain(increases[:1], nil, 5, 0)
	testing.expect_value(test, status, core_types.Status.OK)
	testing.expect_value(test, rate, 0)
	increases[1].amount = math.nan_f64()
	_, status = scoring.calibrate_drain(increases, nil, 5, 0)
	testing.expect_value(test, status, core_types.Status.INVALID_ARGUMENT)
}

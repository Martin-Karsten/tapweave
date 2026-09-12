package simulation_trace

import "core:encoding/json"
import trace_support "../trace_support"
import core_types "../core_types"
import scoring "../scoring"
import rules "../osu_rules"
import simulation "../simulation"
import replay "../replay"
import prepared "../prepared"

Fixture :: struct {
	id, kind: string,
	health_kinds: []string,
	combo_flags: []u32,
	starting_health: f64,
	spans: u32,
	maximum, actual: []core_types.Hit_Result,
	failed_before: []bool,
	difficulty, drain_start_ms, committed_ms: f64,
	increases: []scoring.Health_Increase,
	break_end_times: []f64,
	offsets, deltas, values, targets: []f64,
	events: []simulation.Event,
	frames: []core_types.Input_Snapshot,
}

Score_Value :: struct {
	total: i64,
	accuracy: f64,
	combo, highest_combo: u32,
	numerator, denominator: u64,
	accuracy_count: u32,
	combo_portion: f64,
	bonus: u64,
	rank: scoring.Rank,
	counts: [17]u32,
}

Property_Value :: struct {
	result, minimum: u16,
	base_score: u32,
	hit, miss, scorable, accuracy, increases_combo, breaks_combo, tick, bonus: bool,
}

Window_Value :: struct {
	result: u16,
	can_be_hit: bool,
}

Spin_Value :: struct {
	rotation: f32,
}

Drain_Value :: struct {
	drain_rate: f64,
}

Round_Value :: struct {
	rounded: i64,
}

Input_Value :: struct {
	status: core_types.Status,
	record_index, queued_count: int,
}

Codec_Value :: struct {
	encoded: string,
}

Replay_Value :: struct {
	x, y: f64,
	action_bits: u32,
}

Observation :: struct($T: typeid) {
	schema_version: u32,
	id, kind: string,
	values: T,
}

write_observation :: proc(output: ^[dynamic]byte, fixture: Fixture, values: $T) -> bool {
	bytes, error := json.marshal(
		Observation(T){1, fixture.id, fixture.kind, values},
		{use_enum_names = true},
	)
	defer delete(bytes)
	if error != nil {
		return false
	}
	append(output, ..bytes)
	return true
}

// The pinned JSON default writes only 16 fractional places (8 for f32),
// which is insufficient as exact evidence. These test-only serializers emit
// round-trippable f64 decimals; f32 is widened exactly before serialization.
// This transport is single-threaded, separate from production engine exports.
run :: proc(input: []byte) -> ([]byte, bool) {
	marshalers := make(map[typeid]json.User_Marshaler)
	defer delete(marshalers)
	previous_marshalers := json._user_marshalers
	json._user_marshalers = &marshalers
	defer {
		json._user_marshalers = previous_marshalers
	}
	json.register_user_marshaler(f64, trace_support.marshal_float)
	json.register_user_marshaler(f32, trace_support.marshal_float)
	fixtures: []Fixture
	error := json.unmarshal(input, &fixtures)
	defer {
		for fixture in fixtures {
			delete(fixture.id)
			delete(fixture.kind)
			for object_kind in fixture.health_kinds {
				delete(object_kind)
			}
			delete(fixture.health_kinds)
			delete(fixture.combo_flags)
			delete(fixture.maximum)
			delete(fixture.actual)
			delete(fixture.failed_before)
			delete(fixture.increases)
			delete(fixture.break_end_times)
			delete(fixture.offsets)
			delete(fixture.deltas)
			delete(fixture.values)
			delete(fixture.targets)
			delete(fixture.events)
			delete(fixture.frames)
		}
		delete(fixtures)
	}
	if error != nil || len(fixtures) > 1000 {
		return nil, false
	}
	output: [dynamic]byte
	success := false
	defer {
		if !success {
			delete(output)
		}
	}
	append(&output, '[')
	for fixture, fixture_index in fixtures {
		if fixture_index > 0 {
			append(&output, ',')
		}
		// Test transport limits are deliberately separate from production quotas.
		if len(fixture.actual) > 100_000 ||
		   len(fixture.maximum) > 100_000 ||
		   len(fixture.offsets) > 100_000 ||
		   len(fixture.deltas) > 100_000 ||
		   len(fixture.events) > 100_000 ||
		   len(fixture.frames) > 100_000 {
			return nil, false
		}
		switch fixture.kind {
		case "health":
			if !write_health_observation(&output, fixture) {
				return nil, false
			}
		case "properties":
			values: [17]Property_Value
			for result in core_types.Hit_Result {
				properties := core_types.result_properties(result)
				values[u16(result)] = {
					u16(result),
					u16(rules.minimum_result(result)),
					properties.base_score,
					properties.hit,
					properties.miss,
					properties.scorable,
					properties.accuracy,
					properties.increases_combo,
					properties.breaks_combo,
					properties.tick,
					properties.bonus,
				}
			}
			if !write_observation(&output, fixture, values) {
				return nil, false
			}
		case "score":
			if len(fixture.actual) > len(fixture.maximum) ||
			   (len(fixture.failed_before) != 0 && len(fixture.failed_before) != len(fixture.actual)) {
				return nil, false
			}
			maxima, status := scoring.prepare_maxima(fixture.maximum)
			if status != .OK {
				return nil, false
			}
			score := scoring.create(maxima)
			values := make([]Score_Value, len(fixture.actual))
			defer delete(values)
			for actual, result_index in fixture.actual {
				failed_before := len(fixture.failed_before) > 0 && fixture.failed_before[result_index]
				if scoring.apply(&score, {actual, fixture.maximum[result_index]}, failed_before) != .OK {
					return nil, false
				}
				accumulator := &score.accumulator
				values[result_index] = {
					score.total,
					score.accuracy,
					accumulator.combo,
					accumulator.highest_combo,
					accumulator.numerator,
					accumulator.denominator,
					accumulator.accuracy_count,
					accumulator.combo_portion,
					accumulator.bonus,
					score.rank,
					{},
				}
				for result in core_types.Hit_Result {
					values[result_index].counts[u16(result)] = accumulator.counts[result]
				}
			}
			if !write_observation(&output, fixture, values) {
				return nil, false
			}
		case "windows":
			windows, status := rules.hit_windows(fixture.difficulty)
			if status != .OK {
				return nil, false
			}
			values := make([]Window_Value, len(fixture.offsets))
			defer delete(values)
			for offset, offset_index in fixture.offsets {
				values[offset_index] = {
					u16(rules.result_for(windows, offset)),
					rules.can_be_hit(windows, offset),
				}
			}
			if !write_observation(&output, fixture, values) {
				return nil, false
			}
		case "spin":
			history: rules.Spin_History
			values := make([]Spin_Value, len(fixture.deltas))
			defer delete(values)
			for delta, delta_index in fixture.deltas {
				if rules.report_delta(&history, f64(delta_index), f32(delta)) != .OK {
					return nil, false
				}
				values[delta_index] = {rules.total_rotation(&history)}
			}
			if !write_observation(&output, fixture, values) {
				return nil, false
			}
		case "drain":
			drain_rate, status := scoring.calibrate_drain(
				fixture.increases,
				fixture.break_end_times,
				fixture.difficulty,
				fixture.drain_start_ms,
			)
			if status != .OK {
				return nil, false
			}
			if !write_observation(&output, fixture, []Drain_Value{{drain_rate}}) {
				return nil, false
			}
		case "round":
			values := make([]Round_Value, len(fixture.values))
			defer delete(values)
			for raw_score, score_index in fixture.values {
				rounded, status := scoring.round_score(raw_score)
				if status != .OK {
					return nil, false
				}
				values[score_index] = {rounded}
			}
			if !write_observation(&output, fixture, values) {
				return nil, false
			}
		case "events":
			storage := make([]simulation.Event, len(fixture.events))
			defer delete(storage)
			queue := simulation.Event_Queue {
				storage = storage,
			}
			for event in fixture.events {
				if simulation.push(&queue, event) != .OK {
					return nil, false
				}
			}
			values := make([]simulation.Event, len(fixture.events))
			defer delete(values)
			count := 0
			for target in fixture.targets {
				written, status := simulation.drain(&queue, target, values[count:])
				if status != .OK {
					return nil, false
				}
				count += written
			}
			if !write_observation(&output, fixture, values[:count]) {
				return nil, false
			}
		case "inputs":
			storage: [4]core_types.Input_Snapshot
			queue := simulation.Input_Queue {
				storage = storage[:],
			}
			status, record_index := simulation.enqueue_inputs(&queue, fixture.frames, fixture.committed_ms)
			if status != .OK && queue.count != 0 {
				return nil, false
			}
			if !write_observation(&output, fixture, []Input_Value{{status, record_index, queue.count}}) {
				return nil, false
			}
		case "codec":
			identity := replay.Identity {
				schema_version = 2,
				compatibility_version = 1,
				rules_version = 1,
				behavior_id = 202608042,
				coordinate_version = 1,
				rate = 1,
			}
			size, status := replay.encoded_size(u64(len(fixture.frames)))
			if status != .OK {
				return nil, false
			}
			bytes := make([]byte, int(size))
			defer delete(bytes)
			_, status = replay.encode(identity, fixture.frames, {}, bytes)
			if status != .OK {
				return nil, false
			}
			restored_frames := make([]core_types.Input_Snapshot, len(fixture.frames))
			defer delete(restored_frames)
			_, status = replay.decode(bytes, identity, restored_frames)
			if status != .OK {
				return nil, false
			}
			for frame, frame_index in fixture.frames {
				if frame != restored_frames[frame_index] {
					return nil, false
				}
			}
			encoded := make([]byte, len(bytes) * 2)
			defer delete(encoded)
			digits := "0123456789abcdef"
			for encoded_byte, byte_index in bytes {
				encoded[byte_index * 2] = digits[encoded_byte >> 4]
				encoded[byte_index * 2 + 1] = digits[encoded_byte & 15]
			}
			if !write_observation(&output, fixture, []Codec_Value{{string(encoded)}}) {
				return nil, false
			}
		case "queue_overlap":
			input_storage := [3]core_types.Input_Snapshot {
				{sequence = 1, raw_time_ms = 100, effective_time_ms = 100},
				{sequence = 2, raw_time_ms = 101, effective_time_ms = 101},
				{sequence = 3, raw_time_ms = 102, effective_time_ms = 102},
			}
			original_inputs := input_storage
			input_queue := simulation.Input_Queue {
				storage = input_storage[:],
				read_index = 1,
			}
			input_status, record_index := simulation.enqueue_inputs(&input_queue, input_storage[:], 0)
			if input_status != .INVALID_ARGUMENT ||
			   input_storage != original_inputs ||
			   input_queue.count != 0 ||
			   input_queue.read_index != 1 ||
			   input_queue.has_input ||
			   input_queue.last_sequence != 0 ||
			   input_queue.last_time_ms != 0 {
				return nil, false
			}
			event_storage: [3]simulation.Event
			event_queue := simulation.Event_Queue {
				storage = event_storage[:],
			}
			for event_index in 0 ..< 3 {
				if simulation.push(
					   &event_queue,
					   {{f64(event_index), .OUTPUT, 0, 0, 0}, u64(event_index + 1)},
				   ) !=
				   .OK {
					return nil, false
				}
			}
			original_events := event_storage
			written_count, event_status := simulation.drain(&event_queue, 3, event_storage[:])
			if event_status != .INVALID_ARGUMENT ||
			   written_count != 0 ||
			   event_queue.count != 3 ||
			   event_storage != original_events {
				return nil, false
			}
			values := []Input_Value {
				{input_status, record_index, input_queue.count},
				{event_status, written_count, event_queue.count},
			}
			if !write_observation(&output, fixture, values) {
				return nil, false
			}
		case "slider_position":
			vertices := []prepared.Position{{0, 0}, {100, 0}}
			cumulative := []f64{0, 100}
			object := prepared.Object{spans = fixture.spans, span_duration = 1, end_time_ms = f64(fixture.spans), vertices = vertices, cumulative = cumulative, path_distance = 100}
			values := make([]Replay_Value, len(fixture.targets))
			defer delete(values)
			for target, target_index in fixture.targets {
				position := rules.slider_position(&object, target)
				values[target_index] = {position[0], position[1], 0}
			}
			if !write_observation(&output, fixture, values) {
				return nil, false
			}
		case "replay":
			status, _ := replay.validate_frames(fixture.frames)
			if status != .OK {
				return nil, false
			}
			values := make([]Replay_Value, len(fixture.targets))
			defer delete(values)
			for target, target_index in fixture.targets {
				frame, sample_status := replay.sample(fixture.frames, target)
				if sample_status != .OK {
					return nil, false
				}
				values[target_index] = {frame.x, frame.y, frame.action_bits}
			}
			if !write_observation(&output, fixture, values) {
				return nil, false
			}
		case:
			return nil, false
		}
	}
	append(&output, ']')
	success = true
	return output[:], true
}

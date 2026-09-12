package simulation_trace
import "core:encoding/json"
import "core:io"
import "core:strconv"
import core_types "../core_types"
import scoring "../scoring"
import rules "../osu_rules"
import simulation "../simulation"
import replay "../replay"

Fixture :: struct {
	id, kind: string,
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
	result: u16,
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
marshal_float :: proc(writer: io.Writer, value: any, options: ^json.Marshal_Options) -> json.Marshal_Error {
	number_value: f64
	switch typed_number in value {
	case f64:
		
		number_value = typed_number
	case f32:
		
		number_value = f64(typed_number)
	case:
		
		return json.Marshal_Data_Error.Unsupported_Type
	}
	buffer: [64]byte
	text := strconv.write_float(buffer[:], number_value, 'g', -1, 64)
	if len(text) > 0 && text[0] == '+' {
		text = text[1:]
	}
	_, error := io.write_string(writer, text)
	return error
}
run :: proc(input: []byte) -> ([]byte, bool) {
	marshalers := make(map[typeid]json.User_Marshaler)
	defer delete(marshalers)
	previous_marshalers := json._user_marshalers
	json._user_marshalers = &marshalers
	defer {
		json._user_marshalers = previous_marshalers
	}
	json.register_user_marshaler(f64, marshal_float)
	json.register_user_marshaler(f32, marshal_float)
	fixtures: []Fixture
	error := json.unmarshal(input, &fixtures)
	defer {
		for fixture in fixtures {
			delete(fixture.id)
			delete(fixture.kind)
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
		case "properties":
			
			values: [17]Property_Value
			for result in core_types.Hit_Result {
				properties := core_types.result_properties(result)
				values[u16(result)] = {
					u16(result),
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
			for value, value_index in fixture.values {
				rounded, status := scoring.round_score(value)
				if status != .OK {
					return nil, false
				}
				values[value_index] = {rounded}
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
			for value, byte_index in bytes {
				encoded[byte_index * 2] = digits[value >> 4]
				encoded[byte_index * 2 + 1] = digits[value & 15]
			}
			if !write_observation(&output, fixture, []Codec_Value{{string(encoded)}}) {
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

// Test-only transport over the production runtime and shared simulation.
package gameplay_trace

import "core:encoding/json"
import "core:math"
import core_types "../core_types"
import engine_runtime "../runtime"
import simulation "../simulation"
import audio_protocol "../audio_protocol"
import trace_support "../trace_support"

Fixture :: struct {
	id, map_text: string,
	inputs: []core_types.Input_Snapshot,
	schedule_ms: []f64,
	replay: bool,
}

Judgement :: struct {
	object_index, component_id: u32,
	object_type: string,
	result, maximum: u16,
	time_ms, offset_ms, health: f64,
	score: i64,
	combo: u32,
}

Observation :: struct {
	schema_version: u32,
	id: string,
	judgements: []Judgement,
	recording: []core_types.Input_Snapshot,
	audio: []audio_protocol.Event,
	score: i64,
	accuracy, health, terminal_ms: f64,
	combo, highest_combo: u32,
	counts: [17]u32,
	state, rank: string,
}

run_fixture :: proc(fixture: ^Fixture, output: ^[dynamic]byte) -> bool {
	if len(fixture.map_text) == 0 || len(fixture.map_text) > 8 * 1024 * 1024 ||
	   len(fixture.inputs) > 100_000 || len(fixture.schedule_ms) == 0 || len(fixture.schedule_ms) > 100_000 {
		return false
	}
	for time_ms, frame_index in fixture.schedule_ms {
		if (math.is_nan(time_ms) || math.is_inf(time_ms)) || time_ms < 0 ||
		   (frame_index > 0 && time_ms <= fixture.schedule_ms[frame_index - 1]) {
			return false
		}
	}
	instance, status := engine_runtime.instance_create()
	if status != .OK {
		return false
	}
	defer engine_runtime.instance_destroy(&instance)
	engine, created := engine_runtime.engine_create(&instance)
	if created != .OK {
		return false
	}
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, preparation_error := engine_runtime.map_prepare(&instance, engine, fixture.map_text, true)
	if preparation_error.status != .OK {
		return false
	}
	defer engine_runtime.map_release(&instance, engine, map_handle)
	session_handle, session_status := engine_runtime.session_create(
		&instance, engine, map_handle, 16 * 1024 * 1024, 0, true, u64(max(32, len(fixture.inputs))),
	)
	if session_status != .OK {
		return false
	}
	defer engine_runtime.session_release(&instance, engine, session_handle)
	storage, _ := engine_runtime.session_get(&instance, engine, session_handle)
	session := &storage.simulation
	if fixture.replay {
		status = simulation.load_replay(session, fixture.inputs)
	} else {
		status = simulation.submit_inputs(session, fixture.inputs)
	}
	if status != .OK {
		return false
	}
	for target_ms in fixture.schedule_ms {
		if simulation.advance_session(session, target_ms) != .OK {
			return false
		}
	}
	judgements := make([]Judgement, session.journal_count)
	defer delete(judgements)
	for event, event_index in session.journal[:session.journal_count] {
		object := &session.prepared_map.objects[event.object_id]
		object_type := "HitCircle"
		#partial switch object.kind {
		case .SLIDER:
			object_type = "Slider"
		case .SPINNER:
			object_type = "Spinner"
		}
		for component in object.components {
			if component.id != event.component_id {
				continue
			}
			#partial switch component.kind {
			case .Head:
				object_type = "SliderHeadCircle"
			case .Tick:
				object_type = "SliderTick"
			case .Repeat:
				object_type = "SliderRepeat"
			case .Tail:
				object_type = "SliderTailCircle"
			case .SpinnerTick:
				object_type = "SpinnerTick"
			case .SpinnerBonusTick:
				object_type = "SpinnerBonusTick"
			}
		}
		judgements[event_index] = {
			event.object_id, event.component_id, object_type, u16(event.result), u16(event.maximum),
			event.time_ms, event.offset_ms, event.health_after, event.score_after, event.combo_after,
		}
	}
	rank_names := [7]string{"X", "S", "A", "B", "C", "D", "F"}
	observation := Observation{
		schema_version = 1, id = fixture.id, judgements = judgements,
	recording = session.recording[:session.recording_count],
	audio = session.audio[:session.audio_count],
		score = session.score.total, accuracy = session.score.accuracy,
		health = session.health.amount, terminal_ms = session.terminal_ms,
		combo = session.score.accumulator.combo, highest_combo = session.score.accumulator.highest_combo,
		state = session.state == .FAILED ? "FAILED" : session.state == .PASSED ? "PASSED" : "RUNNING",
		rank = rank_names[int(session.score.rank)],
	}
	for result_count, result_kind in session.score.accumulator.counts {
		observation.counts[int(result_kind)] = result_count
	}
	bytes, marshal_error := json.marshal(observation)
	defer delete(bytes)
	if marshal_error != nil {
		return false
	}
	append(output, ..bytes)
	return true
}

run :: proc(input: []byte) -> ([]byte, bool) {
	marshalers := make(map[typeid]json.User_Marshaler)
	defer delete(marshalers)
	previous_marshalers := json._user_marshalers
	json._user_marshalers = &marshalers
	defer {
		json._user_marshalers = previous_marshalers
	}
	json.register_user_marshaler(f64, trace_support.marshal_float)
	fixtures: []Fixture
	parse_error := json.unmarshal(input, &fixtures)
	defer {
		for fixture in fixtures {
			delete(fixture.id)
			delete(fixture.map_text)
			delete(fixture.inputs)
			delete(fixture.schedule_ms)
		}
		delete(fixtures)
	}
	if parse_error != nil || len(fixtures) == 0 || len(fixtures) > 1000 {
		return nil, false
	}
	output: [dynamic]byte
	succeeded := false
	defer {
		if !succeeded {
			delete(output)
		}
	}
	append(&output, '[')
	for &fixture, fixture_index in fixtures {
		if fixture_index > 0 {
			append(&output, ',')
		}
		if !run_fixture(&fixture, &output) {
			return nil, false
		}
	}
	append(&output, ']')
	succeeded = true
	return output[:], true
}

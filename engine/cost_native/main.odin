package main

import "core:os"
import "core:fmt"
import "core:mem"
import "core:time"
import "core:encoding/json"
import core_types "../core_types"
import engine_runtime "../runtime"
import simulation "../simulation"

main :: proc() {
	assert(len(os.args) == 2)
	input, error := os.read_entire_file(os.args[1], context.allocator)
	assert(error == nil)
	defer delete(input)
	instance, status := engine_runtime.instance_create()
	assert(status == .OK)
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, preparation_error := engine_runtime.map_prepare(&instance, engine, string(input), true)
	assert(preparation_error.status == .OK)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 16 * 1024 * 1024, 0, true, 2048)
	assert(created == .OK)
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	durations: [1000]i64
	input_count := 0
	previous_allocator := context.allocator
	context.allocator = mem.panic_allocator()
	for &duration, input_index in durations {
		if simulation.terminal(&session.simulation) {
			break
		}
		input_time_ms := 1000 + f64(input_index)
		frames := [1]core_types.Input_Snapshot{{sequence = u64(input_index + 1), raw_time_ms = input_time_ms,
			effective_time_ms = input_time_ms, x = 256, y = 192, action_bits = u32((input_index + 1) % 2)}}
		started := time.tick_now()
		assert(simulation.submit_inputs(&session.simulation, frames[:]) == .OK)
		assert(simulation.advance_session(&session.simulation, input_time_ms) == .OK)
		duration = i64(time.tick_since(started))
		input_count += 1
	}
	context.allocator = previous_allocator
	report := struct {
		object_count: int,
		input_count: int,
		work: simulation.Work_Counters,
		index_bytes: int,
		arena_bytes: int,
		judgements, audio_events: int,
		score: i64,
		combo: u32,
		terminal: bool,
		durations_ns: []i64,
	}{
		object_count = len(session.simulation.objects), input_count = input_count, work = session.simulation.work,
		index_bytes = 3 * len(session.simulation.head_candidates.minimum_reveal) * size_of(f64),
		arena_bytes = len(session.arena.bytes), judgements = session.simulation.journal_count,
		audio_events = session.simulation.audio_count, score = session.simulation.score.total,
		combo = session.simulation.score.accumulator.combo, terminal = simulation.terminal(&session.simulation), durations_ns = durations[:input_count],
	}
	encoded, marshal_error := json.marshal(report)
	assert(marshal_error == nil)
	defer delete(encoded)
	fmt.println(string(encoded))
}

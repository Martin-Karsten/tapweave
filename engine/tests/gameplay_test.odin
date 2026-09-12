package tests

import "core:testing"
import "core:math"
import "core:mem"
import core_types "../core_types"
import engine_runtime "../runtime"
import simulation "../simulation"

GAMEPLAY_CIRCLES :: "osu file format v14\n[Difficulty]\nHPDrainRate:0\nOverallDifficulty:5\n[HitObjects]\n64,64,1000,1,0\n256,192,2000,1,0\n"

input_frame :: proc(sequence: u64, time_ms, x, y: f64, actions: u32) -> core_types.Input_Snapshot {
	return {sequence = sequence, raw_time_ms = time_ms, effective_time_ms = time_ms, x = x, y = y, action_bits = actions}
}

@(test)
gameplay_circle_boundaries_outputs_and_cadence :: proc(test: ^testing.T) {
	instance, status := engine_runtime.instance_create()
	testing.expect_value(test, status, core_types.Status.OK)
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, preparation_error := engine_runtime.map_prepare(&instance, engine, GAMEPLAY_CIRCLES, true)
	testing.expect_value(test, preparation_error.status, core_types.Status.OK)
	defer engine_runtime.map_release(&instance, engine, map_handle)
	expected_events: [2]simulation.Judgement_Event
	for cadence, cadence_index in ([]f64{10000, 1000.0 / 30, 1000.0 / 60, 1000.0 / 120, 1000.0 / 144}) {
		session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 32)
		testing.expect_value(test, created, core_types.Status.OK)
		if created != .OK {
			continue
		}
		session, _ := engine_runtime.session_get(&instance, engine, session_handle)
		inputs := []core_types.Input_Snapshot{input_frame(1, 1049.5, 64, 64, 1), input_frame(2, 1500, 64, 64, 0), input_frame(3, 2000, 256, 192, 1)}
		testing.expect_value(test, simulation.submit_inputs(&session.simulation, inputs), core_types.Status.OK)
		for target_ms := cadence; target_ms < 3000; target_ms += cadence {
			testing.expect_value(test, simulation.advance_session(&session.simulation, target_ms), core_types.Status.OK)
		}
		testing.expect_value(test, simulation.advance_session(&session.simulation, 3000), core_types.Status.OK)
		testing.expect_value(test, session.simulation.state, simulation.Session_Status.PASSED)
		testing.expect_value(test, session.simulation.score.total, 1000000)
		testing.expect_value(test, session.simulation.journal_count, 2)
		for event, event_index in session.simulation.journal[:2] {
			testing.expect_value(test, event.result, core_types.Hit_Result.GREAT)
			if cadence_index == 0 {
				expected_events[event_index] = event
			} else {
				testing.expect_value(test, event, expected_events[event_index])
			}
		}
		engine_runtime.session_release(&instance, engine, session_handle)
	}
}

@(test)
gameplay_transactional_input_pause_and_reset :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, _ := engine_runtime.map_prepare(&instance, engine, GAMEPLAY_CIRCLES, true)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 8)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	engine_runtime.map_release(&instance, engine, map_handle)
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	inputs := []core_types.Input_Snapshot{input_frame(1, 1000, 64, 64, 1), input_frame(2, math.nan_f64(), 0, 0, 0)}
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, inputs), core_types.Status.INVALID_ARGUMENT)
	testing.expect_value(test, session.simulation.inputs.count, 0)
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, inputs[:1]), core_types.Status.OK)
	testing.expect_value(test, simulation.pause_session(&session.simulation, 1050), core_types.Status.OK)
	testing.expect_value(test, session.simulation.state, simulation.Session_Status.PAUSED)
	testing.expect_value(test, session.simulation.cursor.action_bits, 0)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 1100), core_types.Status.INVALID_STATE)
	testing.expect_value(test, simulation.resume_session(&session.simulation, 1049), core_types.Status.INVALID_STATE)
	testing.expect_value(test, simulation.resume_session(&session.simulation, 1050), core_types.Status.OK)
	late := []core_types.Input_Snapshot{input_frame(2, 1049, 0, 0, 0)}
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, late), core_types.Status.LATE_INPUT)
	late[0] = input_frame(2, 1050, 0, 0, 0)
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, late), core_types.Status.OK)
	testing.expect_value(test, session.simulation.committed_ms, 1050)
	testing.expect_value(test, engine_runtime.session_reset(&instance, engine, session_handle, 1001), core_types.Status.INVALID_ARGUMENT)
	testing.expect_value(test, session.simulation.journal_count, 1)
	testing.expect_value(test, engine_runtime.session_reset(&instance, engine, session_handle, 0), core_types.Status.OK)
	testing.expect_value(test, session.simulation.journal_count, 0)
	testing.expect_value(test, session.simulation.state, simulation.Session_Status.READY)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 1149.5), core_types.Status.OK)
	testing.expect_value(test, session.simulation.journal_count, 0)
	testing.expect_value(test, simulation.advance_session(&session.simulation, math.nextafter(f64(1149.5), f64(2000))), core_types.Status.OK)
	testing.expect_value(test, session.simulation.journal_count, 1)
	testing.expect_value(test, session.simulation.journal[0].result, core_types.Hit_Result.MISS)
}

@(test)
gameplay_slider_tail_and_spinner_completion :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_text := "osu file format v14\n[Difficulty]\nHPDrainRate:0\nOverallDifficulty:5\nSliderMultiplier:1\nSliderTickRate:1\n[TimingPoints]\n0,1000\n[HitObjects]\n100,100,1000,2,0,L|200:100,1,100\n256,192,3000,8,0,3100\n"
	map_handle, preparation_error := engine_runtime.map_prepare(&instance, engine, map_text, true)
	testing.expect_value(test, preparation_error.status, core_types.Status.OK)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 16)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	engine_runtime.map_release(&instance, engine, map_handle)
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	inputs := []core_types.Input_Snapshot{input_frame(1, 1000, 100, 100, 1), input_frame(2, 1900, 190, 100, 1)}
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, inputs), core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 1964), core_types.Status.OK)
	testing.expect_value(test, session.simulation.journal_count, 2)
	testing.expect_value(test, session.simulation.journal[1].result, core_types.Hit_Result.SLIDER_TAIL_HIT)
	testing.expect_value(test, session.simulation.journal[1].time_ms, 1964)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 4000), core_types.Status.OK)
	testing.expect_value(test, session.simulation.state, simulation.Session_Status.PASSED)
	testing.expect_value(test, session.simulation.objects[1].result, core_types.Hit_Result.GREAT)
}

@(test)
gameplay_note_lock_failure_and_replay_round_trip :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_text := "osu file format v14\n[Difficulty]\nHPDrainRate:10\nOverallDifficulty:5\n[HitObjects]\n64,64,1000,1,0\n256,192,1100,1,0\n320,192,1100,1,0\n64,64,2000,1,0\n64,64,3000,1,0\n64,64,4000,1,0\n64,64,5000,1,0\n"
	map_handle, _ := engine_runtime.map_prepare(&instance, engine, map_text, true)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 32)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	inputs := []core_types.Input_Snapshot{
		input_frame(1, 900, 256, 192, 1),
		input_frame(2, 1000, 256, 192, 0),
		input_frame(3, 1100, 256, 192, 1),
		input_frame(4, 1100, 320, 192, 0),
		input_frame(5, 1100, 320, 192, 1),
	}
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, inputs), core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 1100), core_types.Status.OK)
	testing.expect_value(test, session.simulation.journal_count, 3)
	testing.expect_value(test, session.simulation.journal[1].cause, simulation.Cause.NOTE_LOCK)
	testing.expect_value(test, session.simulation.journal[1].object_id, 0)
	testing.expect_value(test, session.simulation.journal[0].result, core_types.Hit_Result.GREAT)
	testing.expect_value(test, session.simulation.journal[2].result, core_types.Hit_Result.GREAT)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 10000), core_types.Status.OK)
	testing.expect_value(test, session.simulation.state, simulation.Session_Status.FAILED)
	failed_score := session.simulation.score.total
	failed_count := session.simulation.journal_count
	testing.expect_value(test, simulation.advance_session(&session.simulation, 20000), core_types.Status.OK)
	testing.expect_value(test, session.simulation.score.total, failed_score)
	testing.expect_value(test, session.simulation.journal_count, failed_count)
	replay_handle, replay_created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 32)
	testing.expect_value(test, replay_created, core_types.Status.OK)
	if replay_created != .OK {
		return
	}
	replay_session, _ := engine_runtime.session_get(&instance, engine, replay_handle)
	testing.expect_value(test, simulation.load_replay(&replay_session.simulation, session.simulation.recording[:session.simulation.recording_count]), core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&replay_session.simulation, 10000), core_types.Status.OK)
	testing.expect_value(test, replay_session.simulation.journal_count, failed_count)
	for event, event_index in session.simulation.journal[:failed_count] {
		testing.expect_value(test, replay_session.simulation.journal[event_index], event)
	}
}

@(test)
gameplay_spins_and_sparse_live_replay :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_text := "osu file format v14\n[Difficulty]\nHPDrainRate:0\nOverallDifficulty:5\nSliderMultiplier:1\nSliderTickRate:1\n[TimingPoints]\n0,1000\n[HitObjects]\n256,192,1000,8,0,3000\n0,100,4000,2,0,L|400:100,1,400\n"
	map_handle, _ := engine_runtime.map_prepare(&instance, engine, map_text, true)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 131072, 0, true, 64)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	frames: [25]core_types.Input_Snapshot
	positions := [4][2]f64{{356,192},{256,292},{156,192},{256,92}}
	for frame_index in 0 ..< 21 {
		position := positions[frame_index % 4]
		frames[frame_index] = input_frame(u64(frame_index+1), 1000+f64(frame_index)*50, position[0], position[1], 1)
	}
	frames[21] = input_frame(22,3500,0,100,0)
	frames[22] = input_frame(23,4000,0,100,1)
	frames[23] = input_frame(24,7900,390,100,1)
	frames[24] = input_frame(25,8100,390,100,0)
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, frames[:]), core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 9000), core_types.Status.OK)
	testing.expect_value(test, session.simulation.objects[0].spin_history.completed, 5)
	testing.expect_value(test, session.simulation.objects[0].result, core_types.Hit_Result.GREAT)
	testing.expect_value(test, session.simulation.score.accumulator.counts[.SMALL_BONUS], 5)
	testing.expect(test, session.simulation.score.accumulator.counts[.LARGE_TICK_MISS] > 0)
	replay_handle, replay_created := engine_runtime.session_create(&instance, engine, map_handle, 131072, 0, true, 64)
	testing.expect_value(test, replay_created, core_types.Status.OK)
	if replay_created != .OK {
		return
	}
	replay_session, _ := engine_runtime.session_get(&instance, engine, replay_handle)
	testing.expect_value(test, simulation.load_replay(&replay_session.simulation, session.simulation.recording[:session.simulation.recording_count]), core_types.Status.OK)
	for target_ms: f64 = 0; target_ms < 9000; target_ms += 250 {
		testing.expect_value(test, simulation.advance_session(&replay_session.simulation,target_ms),core_types.Status.OK)
	}
	testing.expect_value(test, simulation.advance_session(&replay_session.simulation,9000),core_types.Status.OK)
	testing.expect_value(test, replay_session.simulation.journal_count, session.simulation.journal_count)
	for event, event_index in session.simulation.journal[:session.simulation.journal_count] {
		testing.expect_value(test, replay_session.simulation.journal[event_index], event)
	}
}

@(test)
gameplay_creation_failures_and_allocation_free_hot_paths :: proc(test: ^testing.T) {
	fault_state := Fault_State{context.allocator, 1000}
	allocator := mem.Allocator{fault_allocator, &fault_state}
	instance, _ := engine_runtime.instance_create(16, allocator)
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, _ := engine_runtime.map_prepare(&instance, engine, GAMEPLAY_CIRCLES, true)
	for allowed_allocations in 0 ..< 2 {
		fault_state.remaining = allowed_allocations
		candidate, status := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 16)
		testing.expect_value(test, candidate, core_types.Handle(0))
		testing.expect_value(test, status, core_types.Status.OUT_OF_MEMORY)
		map_resource, _ := engine_runtime.map_get(&instance, engine, map_handle)
		testing.expect_value(test, map_resource.references, 1)
	}
	fault_state.remaining = 100
	candidate, status := engine_runtime.session_create(&instance, engine, map_handle, 16, 0, true, 16)
	testing.expect_value(test, candidate, core_types.Handle(0))
	testing.expect_value(test, status, core_types.Status.QUOTA_EXCEEDED)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 16)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	fault_state.remaining = 0
	context.allocator = mem.panic_allocator()
	frames := []core_types.Input_Snapshot{input_frame(1,1000,64,64,1)}
	testing.expect_value(test, simulation.submit_inputs(&session.simulation,frames),core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation,1000),core_types.Status.OK)
	testing.expect_value(test, simulation.pause_session(&session.simulation,1500),core_types.Status.OK)
	testing.expect_value(test, simulation.resume_session(&session.simulation,1500),core_types.Status.OK)
	testing.expect_value(test, engine_runtime.session_reset(&instance,engine,session_handle,0),core_types.Status.OK)
}

@(test)
gameplay_pause_recording_reproduces_final_results :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, _ := engine_runtime.map_prepare(&instance, engine, GAMEPLAY_CIRCLES, true)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 16)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	before_pause := []core_types.Input_Snapshot{input_frame(1,1000,64,64,1)}
	testing.expect_value(test, simulation.submit_inputs(&session.simulation,before_pause),core_types.Status.OK)
	testing.expect_value(test, simulation.pause_session(&session.simulation,1500),core_types.Status.OK)
	testing.expect_value(test, simulation.resume_session(&session.simulation,1500),core_types.Status.OK)
	after_pause := []core_types.Input_Snapshot{input_frame(2,2000,256,192,1)}
	testing.expect_value(test, simulation.submit_inputs(&session.simulation,after_pause),core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation,3000),core_types.Status.OK)
	replay_handle, replay_created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 16)
	testing.expect_value(test, replay_created, core_types.Status.OK)
	if replay_created != .OK {
		return
	}
	replay_session, _ := engine_runtime.session_get(&instance, engine, replay_handle)
	testing.expect_value(test, simulation.load_replay(&replay_session.simulation,session.simulation.recording[:session.simulation.recording_count]),core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&replay_session.simulation,3000),core_types.Status.OK)
	testing.expect_value(test, replay_session.simulation.journal_count,session.simulation.journal_count)
	for event, event_index in session.simulation.journal[:session.simulation.journal_count] {
		testing.expect_value(test, replay_session.simulation.journal[event_index],event)
	}
}

@(test)
gameplay_pause_keeps_future_input_and_tail_miss_is_ignored :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_text := "osu file format v14\n[Difficulty]\nHPDrainRate:0\nOverallDifficulty:5\nSliderMultiplier:1\nSliderTickRate:1\n[TimingPoints]\n0,1000\n[HitObjects]\n100,100,1000,2,0,L|200:100,1,100\n256,192,2500,1,0\n"
	map_handle, _ := engine_runtime.map_prepare(&instance, engine, map_text, true)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 8)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	frames := []core_types.Input_Snapshot{
		input_frame(1, 1000, 100, 100, 1),
		input_frame(2, 1100, 100, 100, 0),
		input_frame(3, 2500, 256, 192, 1),
	}
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, frames), core_types.Status.OK)
	testing.expect_value(test, simulation.pause_session(&session.simulation, 1200), core_types.Status.OK)
	testing.expect_value(test, session.simulation.committed_ms, 1200)
	testing.expect_value(test, session.simulation.inputs.count, 1)
	testing.expect_value(test, session.simulation.recording[session.simulation.recording_count - 1].effective_time_ms, 1200)
	testing.expect_value(test, simulation.resume_session(&session.simulation, 1200), core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 2100), core_types.Status.OK)
	// Judgement.MinResult for unmodded SliderTailHit is IgnoreMiss.
	testing.expect_value(test, session.simulation.journal[1].result, core_types.Hit_Result.IGNORE_MISS)
	testing.expect_value(test, session.simulation.journal[1].time_ms, 2000)
	testing.expect_value(test, session.simulation.score.accumulator.combo, 1)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 3000), core_types.Status.OK)
	testing.expect_value(test, session.simulation.objects[1].result, core_types.Hit_Result.GREAT)
	testing.expect_value(test, session.simulation.committed_ms, 2500)
	for frame in session.simulation.recording[:session.simulation.recording_count] {
		testing.expect_value(test, frame.flags, 0)
		testing.expect(test, frame.effective_time_ms == 1000 || frame.effective_time_ms == 1100 || frame.effective_time_ms == 1200 || frame.effective_time_ms == 2000 || frame.effective_time_ms == 2500)
	}
}

@(test)
gameplay_sample_ranges_and_work_counters_preserve_reset :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, preparation_error := engine_runtime.map_prepare(&instance, engine, GAMEPLAY_CIRCLES, true)
	testing.expect_value(test, preparation_error.status, core_types.Status.OK)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 8)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	testing.expect_value(test, len(session.simulation.sample_ranges), 2)
	testing.expect_value(test, session.simulation.sample_ranges[0].end, session.simulation.sample_ranges[1].start)
	inputs := []core_types.Input_Snapshot{input_frame(1, 1000, 64, 64, 1)}
	context.allocator = mem.panic_allocator()
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, inputs), core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 1000), core_types.Status.OK)
	testing.expect_value(test, session.simulation.audio_count, 1)
	testing.expect_value(test, session.simulation.work.sample_binding_visits, 1)
	testing.expect_value(test, session.simulation.work.input_candidate_visits, 1)
	testing.expect_value(test, session.simulation.work.tracking_visits, 2)
	testing.expect_value(test, simulation.reset_session(&session.simulation, 0), core_types.Status.OK)
	testing.expect_value(test, session.simulation.work, simulation.Work_Counters{})
	testing.expect_value(test, simulation.submit_inputs(&session.simulation, inputs), core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 1000), core_types.Status.OK)
	testing.expect_value(test, session.simulation.work.sample_binding_visits, 1)
}

@(test)
render_attachment_failure_and_sharing_preserve_map_owner :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, preparation_error := engine_runtime.map_prepare(&instance, engine, GAMEPLAY_CIRCLES, true)
	testing.expect_value(test, preparation_error.status, core_types.Status.OK)
	map_resource, _ := engine_runtime.map_get(&instance, engine, map_handle)
	original_allocator := instance.allocator
	instance.allocator = mem.Allocator{procedure = reject_allocations}
	testing.expect_value(test, engine_runtime.render_resource_create(&instance, engine, map_handle), core_types.Status.OUT_OF_MEMORY)
	testing.expect_value(test, len(map_resource.render_attachment.bytes), 0)
	instance.allocator = original_allocator
	testing.expect_value(test, engine_runtime.render_resource_create(&instance, engine, map_handle), core_types.Status.OK)
	attachment_address := raw_data(map_resource.render_attachment.bytes)
	instance.allocator = mem.Allocator{procedure = reject_allocations}
	testing.expect_value(test, engine_runtime.render_resource_create(&instance, engine, map_handle), core_types.Status.OK)
	instance.allocator = original_allocator
	testing.expect_value(test, raw_data(map_resource.render_attachment.bytes), attachment_address)
	session_handles: [4]core_types.Handle
	for &session_handle in session_handles {
		created: core_types.Status
		session_handle, created = engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 8)
		testing.expect_value(test, created, core_types.Status.OK)
	}
	engine_runtime.map_release(&instance, engine, map_handle)
	for session_handle in session_handles {
		session, _ := engine_runtime.session_get(&instance, engine, session_handle)
		testing.expect_value(test, raw_data(session.map_storage.render_attachment.bytes), attachment_address)
		engine_runtime.session_release(&instance, engine, session_handle)
	}
}

@(test)
draw_reserve_failure_preserves_previous_capacity :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, preparation_error := engine_runtime.map_prepare(&instance, engine, GAMEPLAY_CIRCLES, true)
	testing.expect_value(test, preparation_error.status, core_types.Status.OK)
	testing.expect_value(test, engine_runtime.render_resource_create(&instance, engine, map_handle), core_types.Status.OK)
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 8)
	testing.expect_value(test, created, core_types.Status.OK)
	required, status := engine_runtime.draw_required_bytes(48)
	testing.expect_value(test, status, core_types.Status.OK)
	testing.expect_value(test, engine_runtime.draw_reserve(&instance, engine, session_handle, 48, required), core_types.Status.OK)
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	original_output := raw_data(session.draw_storage.output)
	original_allocator := instance.allocator
	instance.allocator = mem.Allocator{procedure = reject_allocations}
	testing.expect_value(test, engine_runtime.draw_reserve(&instance, engine, session_handle, 48, required), core_types.Status.OUT_OF_MEMORY)
	testing.expect_value(test, raw_data(session.draw_storage.output), original_output)
	instance.allocator = original_allocator
	testing.expect_value(test, engine_runtime.draw_reserve(&instance, engine, session_handle, 48, required - 1), core_types.Status.QUOTA_EXCEEDED)
	testing.expect_value(test, raw_data(session.draw_storage.output), original_output)
	testing.expect_value(test, len(session.draw_storage.instances), 48)
	_, overflow_status := engine_runtime.draw_required_bytes(max(u64))
	testing.expect_value(test, overflow_status, core_types.Status.QUOTA_EXCEEDED)
}

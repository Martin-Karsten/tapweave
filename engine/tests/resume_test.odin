package tests

import "core:testing"
import core_types "../core_types"
import engine_runtime "../runtime"
import simulation "../simulation"

// Ported from TestScenePauseInputHandling's three hit-circle resume cases.
// Upstream: ppy/osu 3c1c96f742e7aae2ff67a7361e058fe91ca3b955, MIT.
// Translate its first object from 0 to 1000 ms; HP0 replaces test-only NoFail.
// Physical paused events are reconciled in the browser, not sent to simulation.
@(test)
resume_retains_actions_and_blocks_only_the_resume_press :: proc(test: ^testing.T) {
	for paused_actions in ([]u32{0, 1, 2}) {
		instance, _ := engine_runtime.instance_create()
		defer engine_runtime.instance_destroy(&instance)
		engine, _ := engine_runtime.engine_create(&instance)
		map_handle, error := engine_runtime.map_prepare(&instance, engine,
			"osu file format v14\n[Difficulty]\nHPDrainRate:0\n[HitObjects]\n256,192,1000,1,0\n256,192,6000,1,0\n256,192,11000,1,0\n256,192,16000,1,0\n", true)
		testing.expect_value(test, error.status, core_types.Status.OK)
		session_handle, status := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 64)
		testing.expect_value(test, status, core_types.Status.OK)
		session, _ := engine_runtime.session_get(&instance, engine, session_handle)
		pause_ms := paused_actions == 0 ? f64(1000) : f64(6000)
		initial := input_frame(1, 1000, 256, 192, paused_actions)
		testing.expect_value(test, simulation.submit_inputs(&session.simulation, []core_types.Input_Snapshot{initial}), core_types.Status.OK)
		testing.expect_value(test, simulation.pause_session(&session.simulation, pause_ms), core_types.Status.OK)
		testing.expect_value(test, session.simulation.cursor.action_bits, paused_actions)
		judgements_before := session.simulation.journal_count
		resume_input := input_frame(2, pause_ms, 256, 192, core_types.LEFT)
		resume_input.flags = paused_actions & core_types.LEFT == 0 ? core_types.BLOCK_NEXT_PRESS : 0
		testing.expect_value(test, simulation.submit_inputs(&session.simulation, []core_types.Input_Snapshot{resume_input}), core_types.Status.INVALID_STATE)
		testing.expect_value(test, simulation.resume_session(&session.simulation, pause_ms), core_types.Status.OK)
		testing.expect_value(test, simulation.submit_inputs(&session.simulation, []core_types.Input_Snapshot{resume_input}), core_types.Status.OK)
		testing.expect_value(test, simulation.advance_session(&session.simulation, pause_ms), core_types.Status.OK)
		testing.expect_value(test, session.simulation.cursor.action_bits, core_types.LEFT)
		testing.expect_value(test, session.simulation.journal_count, judgements_before)
		fresh_press := []core_types.Input_Snapshot{input_frame(3, pause_ms, 256, 192, 0), input_frame(4, pause_ms, 256, 192, 1)}
		testing.expect_value(test, simulation.submit_inputs(&session.simulation, fresh_press), core_types.Status.OK)
		testing.expect_value(test, simulation.advance_session(&session.simulation, pause_ms), core_types.Status.OK)
		testing.expect_value(test, session.simulation.journal_count, judgements_before + 1)
		testing.expect_value(test, simulation.advance_session(&session.simulation, 17000), core_types.Status.OK)
		replay_handle, replay_status := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 64)
		testing.expect_value(test, replay_status, core_types.Status.OK)
		replay_session, _ := engine_runtime.session_get(&instance, engine, replay_handle)
		testing.expect_value(test, simulation.load_replay(&replay_session.simulation, session.simulation.recording[:session.simulation.recording_count]), core_types.Status.OK)
		testing.expect_value(test, simulation.advance_session(&replay_session.simulation, 17000), core_types.Status.OK)
		testing.expect_value(test, replay_session.simulation.journal_count, session.simulation.journal_count)
		for judgement, judgement_index in session.simulation.journal[:session.simulation.journal_count] {
			testing.expect_value(test, replay_session.simulation.journal[judgement_index], judgement)
		}
	}
}

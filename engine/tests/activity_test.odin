package tests

import "core:testing"
import core_types "../core_types"
import engine_runtime "../runtime"
import simulation "../simulation"

// Pinned TestSceneBreakTracker: short breaks, multiple periods, rewind,
// skipped periods, before gameplay. ppy/osu 3c1c96f742e7aae2ff67a7361e058fe91ca3b955 (MIT).
@(test)
activity_matches_pinned_break_boundaries :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create()
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, error := engine_runtime.map_prepare(&instance, engine,
		"osu file format v14\n[Difficulty]\nHPDrainRate:0\n[Events]\n2,6000,6500\n2,8000,8650\n2,10000,14000\n[HitObjects]\n256,192,5000,1,0\n256,192,20000,1,0\n", true)
	testing.expect_value(test, error.status, core_types.Status.OK)
	session_handle, status := engine_runtime.session_create(&instance, engine, map_handle, 65536, 0, true, 64)
	testing.expect_value(test, status, core_types.Status.OK)
	session, _ := engine_runtime.session_get(&instance, engine, session_handle)
	testing.expect_value(test, simulation.session_activity(&session.simulation), simulation.Activity.NOT_PLAYING)
	cases := []struct { time_ms: f64, activity: simulation.Activity }{
		{0, .BREAK}, {2999.999, .BREAK}, {3000, .PLAYING},
		{6000, .PLAYING}, {6250, .PLAYING}, {6500, .PLAYING},
		{7999.999, .PLAYING}, {8000, .BREAK}, {8325, .BREAK}, {8325.001, .PLAYING},
		{10000, .BREAK}, {12000, .BREAK}, {13675, .BREAK}, {13675.001, .PLAYING}, {14500, .PLAYING},
	}
	for boundary in cases {
		testing.expect_value(test, simulation.advance_session(&session.simulation, boundary.time_ms), core_types.Status.OK)
		testing.expect_value(test, simulation.session_activity(&session.simulation), boundary.activity)
	}
	// Reset/replay seeks must not retain a previous break cursor.
	testing.expect_value(test, simulation.reset_session(&session.simulation, 0), core_types.Status.OK)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 8000), core_types.Status.OK)
	testing.expect_value(test, simulation.session_activity(&session.simulation), simulation.Activity.BREAK)
	testing.expect_value(test, simulation.advance_session(&session.simulation, 21000), core_types.Status.OK)
	testing.expect_value(test, simulation.session_activity(&session.simulation), simulation.Activity.NOT_PLAYING)
}

@(test)
activity_abi_validates_owner_span_and_stale_handles :: proc(test: ^testing.T) {
	testing.expect_value(test, engine_runtime.abi_start(), core_types.Status.OK)
	instance := &engine_runtime.abi_instance
	owner, _ := engine_runtime.engine_create(instance)
	defer engine_runtime.engine_release(instance, owner)
	other_owner, _ := engine_runtime.engine_create(instance)
	defer engine_runtime.engine_release(instance, other_owner)
	map_handle, error := engine_runtime.map_prepare(instance, owner,
		"osu file format v14\n[HitObjects]\n256,192,5000,1,0", true)
	testing.expect_value(test, error.status, core_types.Status.OK)
	session_handle, status := engine_runtime.session_create(instance, owner, map_handle, 65536, 0, true, 64)
	testing.expect_value(test, status, core_types.Status.OK)
	output_span := engine_runtime.oe_abi_control() + engine_runtime.ABI_OUTPUT_OFFSET
	testing.expect_value(test, engine_runtime.oe_session_activity(owner, session_handle, output_span), u32(core_types.Status.OK))
	testing.expect(test, engine_runtime.oe_session_activity(other_owner, session_handle, output_span) != 0)
	testing.expect(test, engine_runtime.oe_session_activity(owner, session_handle, 0) != 0)
	testing.expect_value(test, engine_runtime.session_release(instance, owner, session_handle), core_types.Status.OK)
	testing.expect(test, engine_runtime.oe_session_activity(owner, session_handle, output_span) != 0)
}

package tests

import "core:testing"
import gameplay_trace "../gameplay_trace"
import engine_runtime "../runtime"
import core_types "../core_types"

@(test)
gameplay_storage_plan_bounds_session_creation :: proc(test: ^testing.T) {
	instance, status := engine_runtime.instance_create()
	testing.expect_value(test, status, core_types.Status.OK)
	defer engine_runtime.instance_destroy(&instance)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	map_handle, preparation_error := engine_runtime.map_prepare(&instance, engine,
		"osu file format v14\n[HitObjects]\n64,64,1000,1,0\n", true)
	testing.expect_value(test, preparation_error.status, core_types.Status.OK)
	defer engine_runtime.map_release(&instance, engine, map_handle)
	map_resource, _ := engine_runtime.map_get(&instance, engine, map_handle)
	required_bytes, _, _, planned := engine_runtime.gameplay_storage_sizes(&map_resource.prepared_map, 32)
	testing.expect_value(test, planned, core_types.Status.OK)
	testing.expect(test, required_bytes > 0)
	rejected_handle, rejected := engine_runtime.session_create(&instance, engine, map_handle, required_bytes - 1, 0, true, 32)
	testing.expect_value(test, rejected, core_types.Status.QUOTA_EXCEEDED)
	testing.expect_value(test, rejected_handle, core_types.Handle(0))
	session_handle, created := engine_runtime.session_create(&instance, engine, map_handle, required_bytes, 0, true, 32)
	testing.expect_value(test, created, core_types.Status.OK)
	defer engine_runtime.session_release(&instance, engine, session_handle)
}

// Allocation tracking covers transport cleanup after partial JSON decoding,
// failed preparation, and failure after a previous fixture produced output.
@(test)
gameplay_trace_rejects_invalid_batches_transactionally :: proc(test: ^testing.T) {
	for invalid_fixture in ([]string{
		`[`,
		`[]`,
		`[{"id":"bad-map","map_text":"not a beatmap","schedule_ms":[2000]}]`,
		`[{"id":"descending","map_text":"osu file format v14\n[HitObjects]\n64,64,1000,1,0\n","schedule_ms":[2000,1000]}]`,
		`[{"id":"first","map_text":"osu file format v14\n[HitObjects]\n64,64,1000,1,0\n","schedule_ms":[2000]},{"id":"bad-second","map_text":"bad","schedule_ms":[2000]}]`,
	}) {
		output, succeeded := gameplay_trace.run(transmute([]byte)invalid_fixture)
		testing.expect(test, !succeeded)
		testing.expect_value(test, len(output), 0)
		delete(output)
	}
}

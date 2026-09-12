package tests

import "core:testing"
import "core:math"
import "core:mem"
import core_types "../core_types"
import prepared "../prepared"
import rules "../osu_rules"
import simulation "../simulation"
import presentation "../presentation"

@(test)
presentation_transform_round_trips_and_ignores_dpr :: proc(test: ^testing.T) {
	viewports := []presentation.Viewport{
		{0, 0, 512, 384, 1},
		{13.5, 29.25, 1920, 1080, 2},
		{-15, 10, 390, 844, 3},
		{0, 0, 10000, 1, 1.25},
	}
	for viewport in viewports {
		transform, valid := presentation.make_playfield_transform(viewport)
		testing.expect(test, valid)
		points := [][2]f64{{0, 0}, {256, 192}, {512, 384}, {-100, 500}, {12.125, -9.25}}
		for point in points {
			client_x, client_y := presentation.to_client(&transform, point[0], point[1])
			actual_x, actual_y := presentation.to_playfield(&transform, client_x, client_y)
			testing.expect(test, abs(actual_x - point[0]) <= 1e-6)
			testing.expect(test, abs(actual_y - point[1]) <= 1e-6)
		}
		retina_viewport := viewport
		retina_viewport.device_pixel_ratio *= 2
		retina_transform, retina_valid := presentation.make_playfield_transform(retina_viewport)
		testing.expect(test, retina_valid)
		testing.expect_value(test, transform, retina_transform)
	}
}

@(test)
presentation_transform_rejects_invalid_viewports :: proc(test: ^testing.T) {
	viewports := []presentation.Viewport{
		{0, 0, 0, 384, 1},
		{0, 0, 512, -1, 1},
		{0, 0, 512, 384, 0},
		{math.inf_f64(1), 0, 512, 384, 1},
		{0, 0, math.nan_f64(), 384, 1},
	}
	for viewport in viewports {
		_, valid := presentation.make_playfield_transform(viewport)
		testing.expect(test, !valid)
	}
}


@(test)
presentation_active_set_orders_reveals_and_retains_acknowledged_feedback :: proc(test: ^testing.T) {
	objects := [3]prepared.Object{
		{id = 0, time_ms = 1000, preempt_ms = 100},
		{id = 1, time_ms = 1100, preempt_ms = 1000},
		{id = 2, time_ms = 10000, preempt_ms = 1000},
	}
	outcomes: [3]rules.Object_State
	prepared_map := prepared.Map{objects = objects[:]}
	session := simulation.Session{prepared_map = &prepared_map, objects = outcomes[:]}
	projection := simulation.project(&session)
	required, status := presentation.required_bytes(3)
	testing.expect_value(test, status, core_types.Status.OK)
	arena, allocated := core_types.arena_create(required)
	testing.expect_value(test, allocated, core_types.Status.OK)
	defer core_types.arena_destroy(&arena)
	active: presentation.Active_Set
	testing.expect_value(test, presentation.initialize_active(&active, &prepared_map, &arena), core_types.Status.OK)
	context.allocator = mem.panic_allocator()
	testing.expect_value(test, presentation.refresh_active(&active, projection, 200, 1), core_types.Status.OK)
	testing.expect_value(test, active.count, 1)
	testing.expect_value(test, active.indices[0], 1)
	testing.expect_value(test, presentation.refresh_active(&active, projection, 950, 1), core_types.Status.OK)
	testing.expect_value(test, active.count, 2)
	testing.expect_value(test, active.indices[0], 0)
	testing.expect_value(test, active.indices[1], 1)
	outcomes[0].result = .GREAT
	outcomes[0].result_time_ms = 1000
	session.acknowledged_count = 1
	testing.expect_value(test, presentation.refresh_active(&active, projection, 1800, 1), core_types.Status.OK)
	testing.expect_value(test, active.count, 2)
	testing.expect_value(test, presentation.refresh_active(&active, projection, 1801, 1), core_types.Status.OK)
	testing.expect_value(test, active.count, 1)
	testing.expect_value(test, active.visited_count, 2)
	testing.expect_value(test, presentation.refresh_active(&active, projection, 1802, 1), core_types.Status.OK)
	testing.expect_value(test, active.visited_count, 1)
	testing.expect_value(test, active.revealed_count, 0)
	// Backwards diagnostic reads rebuild from sorted reveals without simulation mutation.
	testing.expect_value(test, presentation.refresh_active(&active, projection, 950, 1), core_types.Status.OK)
	testing.expect_value(test, active.count, 2)
	testing.expect_value(test, outcomes[0].result, core_types.Hit_Result.GREAT)
	previous_count := active.count
	testing.expect_value(test, presentation.refresh_active(&active, projection, math.nan_f64(), 1), core_types.Status.INVALID_ARGUMENT)
	testing.expect_value(test, active.count, previous_count)
	testing.expect_value(test, presentation.refresh_active(&active, projection, 0, 2), core_types.Status.OK)
	testing.expect_value(test, active.count, 0)
}

@(test)
presentation_reservation_failure_does_not_claim_storage :: proc(test: ^testing.T) {
	objects := [1]prepared.Object{{time_ms = 1000, preempt_ms = 1000}}
	prepared_map := prepared.Map{objects = objects[:]}
	required, _ := presentation.required_bytes(1)
	arena, _ := core_types.arena_create(required - 1)
	defer core_types.arena_destroy(&arena)
	active: presentation.Active_Set
	testing.expect_value(test, presentation.initialize_active(&active, &prepared_map, &arena), core_types.Status.QUOTA_EXCEEDED)
	testing.expect_value(test, arena.used, 0)
	testing.expect_value(test, len(active.reveals), 0)
	_, status := presentation.required_bytes(max(u64))
	testing.expect_value(test, status, core_types.Status.QUOTA_EXCEEDED)
}

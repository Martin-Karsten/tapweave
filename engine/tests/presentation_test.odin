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
			client_x, client_y := presentation.to_client(transform, point[0], point[1])
			actual_x, actual_y := presentation.to_playfield(transform, client_x, client_y)
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
visual_bounds_cover_normal_rectangle_and_empty_maps :: proc(test: ^testing.T) {
	bounds, valid := presentation.compute_visual_bounds(nil)
	testing.expect(test, valid)
	testing.expect_value(test, bounds, presentation.NORMAL_BOUNDS)
	objects := [1]prepared.Object{{kind = .CIRCLE, id = 0, time_ms = 1000, preempt_ms = 1000, radius = 32,
		position = {256, 192}}}
	bounds, valid = presentation.compute_visual_bounds(objects[:])
	testing.expect(test, valid)
	// A fully contained map keeps the normal rectangle as its fit target.
	testing.expect_value(test, bounds, presentation.NORMAL_BOUNDS)
}

@(test)
visual_bounds_contain_edge_objects_stacks_and_path_extremes :: proc(test: ^testing.T) {
	// Objects at all four corners, positive and negative stack offsets, a
	// curved path with interior extrema outside the rectangle, and a
	// self-intersecting thick slider.
	objects := []prepared.Object{
		{kind = .CIRCLE, id = 0, time_ms = 1000, preempt_ms = 1000, radius = 60,
			position = {0, 0}, index_in_combo = 0},
		{kind = .CIRCLE, id = 1, time_ms = 2000, preempt_ms = 1000, radius = 60,
			position = {512, 384}, stack_offset = {-40, 30}, index_in_combo = 12},
		{kind = .SLIDER, id = 2, time_ms = 4000, end_time_ms = 5000, preempt_ms = 1000, radius = 24,
			position = {-200, 600}, stack_offset = {16, -8}, spans = 3, index_in_combo = 0,
			vertices = []prepared.Position{{-100, -50}, {400, 300}, {-150, 900}, {700, -300}, {-150, 900}},
			cumulative = []f64{0, 600, 1400, 2600, 2600}, path_distance = 2600},
		{kind = .SPINNER, id = 3, time_ms = 6000, end_time_ms = 7000, preempt_ms = 1000,
			position = {256, 192}, spins_required = 2},
	}
	bounds, valid := presentation.compute_visual_bounds(objects)
	testing.expect(test, valid)
	// Big circle at (0,0): approach rings reach 4x radius on every side.
	testing.expect(test, bounds.min_x <= -60 * presentation.APPROACH_MAX_SCALE)
	testing.expect(test, bounds.min_y <= -60 * presentation.APPROACH_MAX_SCALE)
	// Corner circle with negative x stack: stacked position is 472,414; its
	// combo number runs right of the anchor by more than one radius.
	stacked_x, stacked_y := 512.0 - 40, 384.0 + 30
	testing.expect(test, bounds.max_x >= stacked_x + 60 * presentation.APPROACH_MAX_SCALE)
	testing.expect(test, bounds.max_y >= stacked_y + 60 * presentation.APPROACH_MAX_SCALE)
	// Slider path extremes expanded by the rendered body thickness including
	// the tracking ring; stack offsets apply to path vertices.
	body_extent := 24.0 * presentation.TRACKING_RING_SCALE + presentation.NUMERIC_MARGIN
	testing.expect(test, bounds.min_x <= -200 + 16 - 100 - body_extent)
	testing.expect(test, bounds.min_y <= 600 - 8 + -300 - body_extent)
	testing.expect(test, bounds.max_x >= -200 + 16 + 700 + body_extent)
	testing.expect(test, bounds.max_y >= 600 - 8 + 900 + body_extent)
	// Follow points span the gap between the slider tail and next object; the
	// slider head's circle extents already cover its own anchor.
	testing.expect(test, bounds.min_x < -60 * presentation.APPROACH_MAX_SCALE)
	// Spinner extents cannot leave the normal rectangle from the fixed centre.
	testing.expect(test, math.max(presentation.SPINNER_DISC_RADIUS,
		presentation.SPINNER_GLYPH_SCALE * presentation.ROTATED_QUAD_DIAGONAL_FACTOR) + presentation.NUMERIC_MARGIN <= 256)
}

@(test)
visual_bounds_cover_small_circle_feedback_and_number_extents :: proc(test: ^testing.T) {
	// A minimum-size circle at the right edge: judgement feedback numbers run
	// up to 24 units right of the anchor, wider than the 4x approach extent.
	objects := [1]prepared.Object{{kind = .CIRCLE, id = 0, time_ms = 1000, preempt_ms = 1000,
		radius = 5, position = {512, 384}, index_in_combo = 0}}
	bounds, valid := presentation.compute_visual_bounds(objects[:])
	testing.expect(test, valid)
	testing.expect_value(test, bounds.max_x, 512.0 + presentation.FEEDBACK_NUMBER_RIGHT_EXTENT)
	testing.expect(test, bounds.min_x <= 512 - 5 * presentation.APPROACH_MAX_SCALE)
	testing.expect(test, bounds.min_y <= 384 - 5 * presentation.APPROACH_MAX_SCALE)
	testing.expect(test, bounds.max_y >= 384 + 5 * presentation.APPROACH_MAX_SCALE)
}

@(test)
visual_bounds_reject_invalid_geometry :: proc(test: ^testing.T) {
	invalid_maps := [][]prepared.Object{
		{{kind = .CIRCLE, time_ms = 1000, preempt_ms = 1000, radius = 32, position = {math.nan_f64(), 192}}},
		{{kind = .CIRCLE, time_ms = 1000, preempt_ms = 1000, radius = -1}},
		{{kind = .SLIDER, time_ms = 1000, preempt_ms = 1000, radius = 32,
			vertices = []prepared.Position{{math.inf_f64(1), 0}}, cumulative = []f64{0, 100}, path_distance = 100}},
		{{kind = .CIRCLE, time_ms = 1000, preempt_ms = 1000, radius = 32, scale = math.nan_f64()}},
	}
	for objects in invalid_maps {
		_, valid := presentation.compute_visual_bounds(objects)
		testing.expect(test, !valid)
	}
	_, valid := presentation.compute_visual_bounds(nil)
	testing.expect(test, valid)
	testing.expect(test, !presentation.validate_visual_bounds(presentation.Visual_Bounds{10, 10, 5, 5}))
	testing.expect(test, !presentation.validate_visual_bounds(presentation.Visual_Bounds{-presentation.MAX_BOUND_COORDINATE - 1, 0, 512, 384}))
}

@(test)
visual_bounds_fit_centers_round_trips_and_ignores_dpr :: proc(test: ^testing.T) {
	bounds, _ := presentation.compute_visual_bounds([]prepared.Object{
		{kind = .SLIDER, time_ms = 1000, preempt_ms = 1000, radius = 40, position = {-100, -80},
			vertices = []prepared.Position{{0, 0}, {700, 500}}, cumulative = []f64{0, 860}, path_distance = 860},
	})
	viewports := []presentation.Viewport{
		{0, 0, 640, 480, 1},
		{13.5, 29.25, 1920, 1080, 2},
		{-15, 10, 390, 844, 3},
		{0, 0, 3440, 1440, 1},
		{0, 0, 1280, 720, 1},
		{0, 0, 100, 80, 1},
	}
	for viewport in viewports {
		transform, valid := presentation.make_bounds_transform(viewport, bounds)
		testing.expect(test, valid)
		margin := math.min(presentation.FIT_MARGIN_CSS,
			presentation.FIT_MARGIN_MINIMUM_FACTOR * math.min(viewport.css_width, viewport.css_height))
		// The complete bounds fit inside the margin-inset rectangle,
		// centred, at one uniform scale.
		testing.expect(test, transform.client_left >= viewport.css_left)
		testing.expect(test, transform.client_top >= viewport.css_top)
		bounds_left_x, bounds_left_y := presentation.to_client(transform, bounds.min_x, bounds.min_y)
		bounds_right_x, bounds_bottom_y := presentation.to_client(transform, bounds.max_x, bounds.max_y)
		left_gap := bounds_left_x - viewport.css_left
		top_gap := bounds_left_y - viewport.css_top
		right_gap := viewport.css_left + viewport.css_width - bounds_right_x
		bottom_gap := viewport.css_top + viewport.css_height - bounds_bottom_y
		testing.expect(test, abs(left_gap - right_gap) <= 1e-9)
		testing.expect(test, abs(top_gap - bottom_gap) <= 1e-9)
		testing.expect(test, left_gap >= margin - 1e-9 && top_gap >= margin - 1e-9)
		testing.expect(test, right_gap >= margin - 1e-9 && bottom_gap >= margin - 1e-9)
		// Forward and inverse round trips stay within the existing tolerance.
		points := [][2]f64{{bounds.min_x, bounds.min_y}, {bounds.max_x, bounds.max_y},
			{(bounds.min_x + bounds.max_x) / 2, (bounds.min_y + bounds.max_y) / 2}, {-1000, 4000}}
		for point in points {
			client_x, client_y := presentation.to_client(transform, point[0], point[1])
			actual_x, actual_y := presentation.to_playfield(transform, client_x, client_y)
			testing.expect(test, abs(actual_x - point[0]) <= 1e-6)
			testing.expect(test, abs(actual_y - point[1]) <= 1e-6)
		}
		// DPR never enters CSS input conversion.
		retina_viewport := viewport
		retina_viewport.device_pixel_ratio *= 3
		retina_transform, retina_valid := presentation.make_bounds_transform(retina_viewport, bounds)
		testing.expect(test, retina_valid)
		testing.expect_value(test, transform, retina_transform)
		// Fitted geometry remains inside the viewport after the f32 GPU
		// conversion of the final uniforms.
		uniforms, uniforms_valid := presentation.make_viewport_uniforms(transform, viewport)
		testing.expect(test, uniforms_valid)
		corners := [][2]f64{{bounds.min_x, bounds.min_y}, {bounds.max_x, bounds.min_y},
			{bounds.min_x, bounds.max_y}, {bounds.max_x, bounds.max_y}}
		for corner in corners {
			rounded_x := f64(f32(corner[0]))
			rounded_y := f64(f32(corner[1]))
			ndc_x := f64(f32(f32(rounded_x * uniforms.scale_x) + f32(uniforms.shift_x)))
			ndc_y := f64(f32(f32(rounded_y * uniforms.scale_y) + f32(uniforms.shift_y)))
			testing.expect(test, ndc_x >= -1 && ndc_x <= 1)
			testing.expect(test, ndc_y >= -1 && ndc_y <= 1)
		}
	}
}

@(test)
visual_bounds_fit_rejects_invalid_inputs :: proc(test: ^testing.T) {
	valid_bounds := presentation.NORMAL_BOUNDS
	invalid_bounds := []presentation.Visual_Bounds{
		{0, 0, math.nan_f64(), 384},
		{math.inf_f64(1), 0, 512, 384},
		{100, 100, 0, 300},
		{-presentation.MAX_BOUND_COORDINATE * 2, 0, 512, 384},
	}
	for bounds in invalid_bounds {
		_, valid := presentation.make_bounds_transform({0, 0, 1280, 720, 1}, bounds)
		testing.expect(test, !valid)
	}
	invalid_viewports := []presentation.Viewport{
		{0, 0, 0, 720, 1},
		{0, 0, 1280, -5, 1},
		{math.nan_f64(), 0, 1280, 720, 1},
	}
	for viewport in invalid_viewports {
		_, valid := presentation.make_bounds_transform(viewport, valid_bounds)
		testing.expect(test, !valid)
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
presentation_viewport_uniforms_round_through_f32_and_map_the_playfield :: proc(test: ^testing.T) {
	// The exact viewport used by the browser scene suite, plus a full-height
	// playfield viewport and an offset client placement.
	viewports := []presentation.Viewport{
		{0, 0, 512, 384, 1},
		{13, 27, 1024, 768, 2},
		{100, 50, 1024, 768, 1},
	}
	for viewport in viewports {
		transform, valid := presentation.make_playfield_transform(viewport)
		testing.expect(test, valid)
		uniforms, uniforms_valid := presentation.make_viewport_uniforms(transform, viewport)
		testing.expect(test, uniforms_valid)
		// Each operand order matches the executor contract: f64 arithmetic
		// rounded through f32 exactly once at the end.
		testing.expect_value(test, uniforms.scale_x, f64(f32((2.0 * transform.scale) / viewport.css_width)))
		testing.expect_value(test, uniforms.scale_y, f64(f32((-2.0 * transform.scale) / viewport.css_height)))
		testing.expect_value(test, uniforms.shift_x, f64(f32((2.0 * (transform.client_left - viewport.css_left)) / viewport.css_width - 1.0)))
		testing.expect_value(test, uniforms.shift_y, f64(f32(1.0 - (2.0 * (transform.client_top - viewport.css_top)) / viewport.css_height)))
		// Endpoints of a playfield-filling viewport map to the full NDC range.
		// The x scale is an exact binary fraction; the y scale rounds through
		// f32, so its endpoint is checked within f32 accumulation error.
		if viewport.css_width == 512 && viewport.css_height == 384 {
			testing.expect_value(test, uniforms.scale_x * 512 + uniforms.shift_x, 1.0)
			testing.expect(test, abs(uniforms.scale_y * 384 + uniforms.shift_y + 1.0) <= 1e-6)
		}
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

@(test)
presentation_reverse_reveal_burst_has_bounded_ordering_work :: proc(test: ^testing.T) {
	object_count :: 10_000
	objects := make([]prepared.Object, object_count)
	defer delete(objects)
	outcomes := make([]rules.Object_State, object_count)
	defer delete(outcomes)
	for &object, object_index in objects {
		object = {id = u32(object_index), time_ms = f64(object_index + object_count), preempt_ms = f64(2 * object_index)}
	}
	prepared_map := prepared.Map{objects = objects}
	session := simulation.Session{prepared_map = &prepared_map, objects = outcomes}
	required, _ := presentation.required_bytes(object_count)
	arena, _ := core_types.arena_create(required)
	defer core_types.arena_destroy(&arena)
	active_set: presentation.Active_Set
	testing.expect_value(test, presentation.initialize_active(&active_set, &prepared_map, &arena), core_types.Status.OK)
	context.allocator = mem.panic_allocator()
	testing.expect_value(test, presentation.refresh_active(&active_set, simulation.project(&session), object_count, 1), core_types.Status.OK)
	testing.expect_value(test, active_set.count, object_count)
	for source_index, active_index in active_set.indices[:active_set.count] {
		testing.expect_value(test, source_index, active_index)
	}
	// Algorithmic comparison bound, not a performance approval threshold.
	testing.expect(test, active_set.ordering_work < 4 * object_count * 14)
	testing.expect_value(test, presentation.refresh_active(&active_set, simulation.project(&session), object_count + 1, 1), core_types.Status.OK)
	testing.expect_value(test, active_set.ordering_work, 0)
}

@(test)
projection_component_and_cursor_history_survive_journal_ack :: proc(test: ^testing.T) {
	objects: [1]prepared.Object
	outcomes := [1]rules.Object_State{{component_start = 0}}
	components := [1]simulation.Component_State{{result = .LARGE_TICK_HIT, time_ms = 1500}}
	journal := [1]simulation.Judgement_Event{{sequence = 1, time_ms = 1500, component_id = 0, result = .LARGE_TICK_HIT}}
	recording := [1]core_types.Input_Snapshot{{sequence = 2, effective_time_ms = 1500, x = 300, y = 192}}
	prepared_map := prepared.Map{objects = objects[:]}
	session := simulation.Session{
		prepared_map = &prepared_map, objects = outcomes[:], components = components[:],
		journal = journal[:], journal_count = 1, acknowledged_count = 1,
		recording = recording[:], recording_count = 1, cursor = recording[0],
	}
	context.allocator = mem.panic_allocator()
	projection := simulation.project(&session)
	testing.expect_value(test, simulation.project_component(projection, 0, 0), components[0])
	testing.expect_value(test, len(projection.feedback), 1)
	testing.expect_value(test, projection.feedback[0], journal[0])
	testing.expect_value(test, projection.cursor_history[0], recording[0])
	testing.expect_value(test, projection.cursor, recording[0])
}

@(test)
circle_draw_curves_are_readonly_and_counted :: proc(test: ^testing.T) {
	object := prepared.Object{kind = .CIRCLE, id = 3, time_ms = 1000, preempt_ms = 1200,
		fade_in_ms = 800, radius = 32, position = {256, 192}}
	instances: [24]presentation.Instance
	context.allocator = mem.panic_allocator()
	counter: presentation.Builder
	presentation.circle(&counter, &object, .NONE, 0, 400)
	testing.expect_value(test, counter.count, 4)
	builder := presentation.Builder{instances = instances[:]}
	presentation.circle(&builder, &object, .NONE, 0, 400)
	testing.expect_value(test, builder.count, counter.count)
	presentation.order_instances(instances[:builder.count])
	testing.expect_value(test, instances[0].alpha, 0.75)
	testing.expect_value(test, instances[3].scale_x, 80)
	testing.expect_value(test, instances[3].alpha, f64(f32(0.45)))
	builder.count = 0
	presentation.circle(&builder, &object, .GREAT, 1000, 1100)
	testing.expect_value(test, builder.count, 1)
	testing.expect_value(test, instances[0].primitive, presentation.Primitive.RING)
	testing.expect_value(test, instances[0].scale_x, 39)
	testing.expect_value(test, instances[0].alpha, f64(f32(0.925)))
	builder.count = 0
	presentation.circle(&builder, &object, .GREAT, 1000, math.nextafter_f64(1040, 0))
	testing.expect_value(test, builder.count, 4)
	builder.count = 0
	presentation.circle(&builder, &object, .GREAT, 1000, 1040)
	testing.expect_value(test, builder.count, 1)
	builder.count = 0
	presentation.circle(&builder, &object, .MISS, 1100, 1150)
	testing.expect_value(test, builder.count, 3)
	testing.expect_value(test, instances[0].alpha, 0.5)
	builder.count = 0
	presentation.circle(&builder, &object, .GREAT, 1000, 1800)
	testing.expect_value(test, builder.count, 0)
	// Future committed outcomes are not projected as already-hit in past reads.
	presentation.circle(&builder, &object, .GREAT, 1000, 400)
	testing.expect_value(test, builder.count, 4)
}

@(test)
semantic_history_expires_without_duplicates_and_rebuilds_after_seek :: proc(test: ^testing.T) {
	feedback := [2]simulation.Judgement_Event{
		{time_ms = 1000, object_id = 1, result = .GREAT},
		{time_ms = 1050, object_id = 0, result = .MISS},
	}
	cursor := [2]core_types.Input_Snapshot{{effective_time_ms = 1000}, {effective_time_ms = 1050}}
	feedback_indices, cursor_indices: [2]int
	miss_durations := [2]f64{100, 100}
	history := presentation.Semantic_History{feedback_indices = feedback_indices[:], cursor_indices = cursor_indices[:],
		miss_durations_by_id = miss_durations[:]}
	projection := simulation.Projection{feedback = feedback[:], cursor_history = cursor[:]}
	context.allocator = mem.panic_allocator()
	presentation.refresh_history(&history, projection, 1060, 1)
	testing.expect_value(test, history.feedback_count, 2)
	testing.expect_value(test, history.cursor_count, 2)
	presentation.refresh_history(&history, projection, 1060, 1)
	testing.expect_value(test, history.feedback_count, 2)
	testing.expect_value(test, history.next_feedback, 2)
	presentation.refresh_history(&history, projection, 1150, 1)
	testing.expect_value(test, history.feedback_count, 1)
	testing.expect_value(test, history.feedback_indices[0], 0)
	presentation.refresh_history(&history, projection, 2051, 1)
	testing.expect_value(test, history.feedback_count, 0)
	testing.expect_value(test, history.cursor_count, 0)
	presentation.refresh_history(&history, projection, 1050, 1)
	testing.expect_value(test, history.feedback_count, 2)
	projection.feedback = feedback[:0]
	projection.cursor_history = cursor[:0]
	presentation.refresh_history(&history, projection, 0, 2)
	testing.expect_value(test, history.feedback_count, 0)
	testing.expect_value(test, history.next_feedback, 0)
	testing.expect_value(test, history.cursor_count, 0)
}

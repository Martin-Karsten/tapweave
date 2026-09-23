package presentation_trace

import presentation "../presentation"
import prepared "../prepared"
import core_types "../core_types"
import rules "../osu_rules"
import simulation "../simulation"
import "core:math"

VIEWPORT_CASE_COUNT :: 4
CIRCLE_SAMPLE_COUNT :: 15
CIRCLE_CASE_COUNT :: 3 * 3 * CIRCLE_SAMPLE_COUNT
SEMANTIC_CASE_COUNT :: 7
CASE_COUNT :: VIEWPORT_CASE_COUNT + CIRCLE_CASE_COUNT + SEMANTIC_CASE_COUNT
VALUE_COUNT :: 9

// Shared test fixture values. These are local contract cases, not an upstream oracle.
case_values :: proc(case_index: u32) -> [VALUE_COUNT]f64 {
	if case_index >= VIEWPORT_CASE_COUNT + CIRCLE_CASE_COUNT {
		return semantic_values(case_index - VIEWPORT_CASE_COUNT - CIRCLE_CASE_COUNT)
	}
	if case_index >= VIEWPORT_CASE_COUNT {
		return circle_values(case_index - VIEWPORT_CASE_COUNT)
	}
	viewports := [VIEWPORT_CASE_COUNT]presentation.Viewport{
		{0, 0, 512, 384, 1},
		{13.5, 29.25, 1920, 1080, 2},
		{-15, 10, 390, 844, 3},
		{0, 0, 10000, 1, 1.25},
	}
	if case_index >= CASE_COUNT {
		return {}
	}
	transform, valid := presentation.make_playfield_transform(viewports[case_index])
	if !valid {
		return {}
	}
	return {transform.scale, transform.client_left, transform.client_top,
		transform.inverse[0], transform.inverse[1], transform.inverse[2],
		transform.inverse[3], transform.inverse[4], transform.inverse[5]}
}

// Source-derived regression cases. These preserve ADR-002 input segments; the
// independent drawable matrix separately diagnoses upstream update sampling
// and the one-update tracking feedback lag.
semantic_values :: proc(case_index: u32) -> [VALUE_COUNT]f64 {
	if case_index >= SEMANTIC_CASE_COUNT {
		return {}
	}
	objects: [1]prepared.Object
	outcomes: [1]rules.Object_State
	projection := simulation.Projection{prepared_objects = objects[:], outcomes = outcomes[:]}
	instances: [64]presentation.Instance
	builder := presentation.Builder{instances = instances[:]}
	values: [VALUE_COUNT]f64
	if case_index < 4 {
		objects[0] = {kind = .SPINNER, time_ms = 1000, end_time_ms = 2000, spins_required = 2, fade_in_ms = 800}
		// Both rotation directions, with and without a held pre-start sample.
		direction := case_index % 2 == 0 ? 1.0 : -1.0
		if case_index >= 2 {
			rules.update_spinner(&objects[0], &outcomes[0], {x = 356, y = 192, action_bits = 1}, 999)
		}
		first_time_ms := case_index < 2 ? 1000.0 : 1250.0
		rules.update_spinner(&objects[0], &outcomes[0], {x = 256, y = 192 + 100 * direction, action_bits = 1}, first_time_ms)
		values[0] = f64(rules.total_rotation(&outcomes[0].spin_history))
		rules.update_spinner(&objects[0], &outcomes[0], {x = 156, y = 192, action_bits = 1}, first_time_ms)
		values[1] = f64(rules.total_rotation(&outcomes[0].spin_history))
		rules.update_spinner(&objects[0], &outcomes[0], {x = 256, y = 192 - 100 * direction, action_bits = 1}, 1500)
		values[2] = f64(rules.total_rotation(&outcomes[0].spin_history))
		// End is exclusive for rotation accumulation.
		rules.update_spinner(&objects[0], &outcomes[0], {x = 356, y = 192, action_bits = 1}, 2000)
		values[3] = f64(rules.total_rotation(&outcomes[0].spin_history))
		values[4] = simulation.project_object(projection, 0, 2000).rotation
		presentation.spinner(&builder, projection, 0, 2000)
		for instance in instances[:builder.count] {
			if instance.primitive == .RING && instance.layer == 20 && instance.ordinal == 1 {
				values[5] = instance.progress
			}
		}
		// Presentation reads never change accumulated state, even backwards.
		_ = simulation.project_object(projection, 0, 1100)
		values[6] = f64(rules.total_rotation(&outcomes[0].spin_history))
		return values
	}
	vertices := [2]prepared.Position{{0, 0}, {140, 0}}
	lengths := [2]f64{0, 140}
	span_count := case_index - 3
	objects[0] = {kind = .SLIDER, time_ms = 1000, end_time_ms = 1000 + f64(span_count) * 500,
		spans = span_count, span_duration = 500, position = {150, 180}, radius = 32,
		vertices = vertices[:], cumulative = lengths[:], path_distance = 140, fade_in_ms = 800}
	rules.update_tracking(&objects[0], &outcomes[0], {x = 150, y = 180, action_bits = 1}, 1250)
	values[0] = outcomes[0].tracking ? 1 : 0
	rules.update_tracking(&objects[0], &outcomes[0], {x = 220, y = 180, action_bits = 1}, 1250)
	values[1] = outcomes[0].tracking ? 1 : 0
	outcome := simulation.project_object(projection, 0, 1250)
	values[2] = outcome.tracking ? 1 : 0
	values[3], values[4] = outcome.position[0], outcome.position[1]
	projection.paused = true
	values[5] = simulation.project_object(projection, 0, 1250).tracking ? 1 : 0
	projection.paused = false
	values[6] = simulation.project_object(projection, 0, 1250).tracking ? 1 : 0
	return values
}

circle_values :: proc(case_index: u32) -> [VALUE_COUNT]f64 {
	results := [3]core_types.Hit_Result{.NONE, .GREAT, .MISS}
	result_times := [3]f64{875, 1000, 1125}
	elapsed_times := [CIRCLE_SAMPLE_COUNT]f64{-1, 0, 1,
		math.nextafter_f64(40, 0), 40, math.nextafter_f64(40, 100),
		math.nextafter_f64(100, 0), 100, math.nextafter_f64(100, 200),
		399, 400, 799, math.nextafter_f64(800, 0), 800, 801}
	if case_index >= 3 * 3 * CIRCLE_SAMPLE_COUNT {
		return {}
	}
	result_time_ms := result_times[(case_index / CIRCLE_SAMPLE_COUNT) % 3]
	result := results[case_index / (3 * CIRCLE_SAMPLE_COUNT)]
	object := prepared.Object{kind = .CIRCLE, id = 0, time_ms = 1000,
		preempt_ms = 1200, fade_in_ms = 800, radius = 32, position = {256, 192}}
	instances: [24]presentation.Instance
	builder := presentation.Builder{instances = instances[:]}
	sample_index := case_index % CIRCLE_SAMPLE_COUNT
	requested_ms := result_time_ms + elapsed_times[sample_index]
	// Take neighbours after adding the anchor: adding a small relative ULP can
	// otherwise round straight back to the absolute boundary being tested.
	switch sample_index {
	case 3:
		requested_ms = math.nextafter_f64(result_time_ms + 40, 0)
	case 5:
		requested_ms = math.nextafter_f64(result_time_ms + 40, 10000)
	case 6:
		requested_ms = math.nextafter_f64(result_time_ms + 100, 0)
	case 8:
		requested_ms = math.nextafter_f64(result_time_ms + 100, 10000)
	case 12:
		requested_ms = math.nextafter_f64(result_time_ms + 800, 0)
	}
	presentation.circle(&builder, &object, result, result_time_ms, requested_ms)
	values: [VALUE_COUNT]f64
	values[0] = f64(builder.count)
	for instance in instances[:builder.count] {
		if instance.layer == 20 && instance.primitive == .DISC {
			values[1], values[2] = instance.alpha, instance.scale_x
		}
		if instance.layer == 20 && instance.primitive == .GLYPH {
			values[3] += 1
		}
		if instance.layer == 30 {
			values[4], values[5] = instance.alpha, instance.scale_x
		}
		if instance.layer == 40 {
			values[6], values[7] = instance.alpha, instance.scale_x
		}
		if instance.layer == 20 && instance.primitive == .RING {
			values[8] = instance.alpha
		}
	}
	return values
}

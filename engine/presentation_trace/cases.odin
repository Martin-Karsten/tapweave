package presentation_trace

import presentation "../presentation"
import prepared "../prepared"
import core_types "../core_types"
import "core:math"

VIEWPORT_CASE_COUNT :: 4
CIRCLE_SAMPLE_COUNT :: 15
CASE_COUNT :: VIEWPORT_CASE_COUNT + 3 * 3 * CIRCLE_SAMPLE_COUNT
VALUE_COUNT :: 9

// Shared test fixture values. These are local contract cases, not an upstream oracle.
case_values :: proc(case_index: u32) -> [VALUE_COUNT]f64 {
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

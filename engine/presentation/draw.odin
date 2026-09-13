package presentation

import "core:slice"
import core_types "../core_types"
import prepared "../prepared"
import simulation "../simulation"

Primitive :: enum u32 {
	DISC = 1,
	RING,
	GLYPH,
	PATH,
	RECTANGLE,
}
Instance :: struct {
	primitive: Primitive,
	layer, object_id, component_id, ordinal, flags: u32,
	x, y, scale_x, scale_y, rotation, alpha, progress: f64,
	colour, glyph, geometry_first, geometry_count: u32,
	clip_start, clip_end: f64,
}
Builder :: struct {
	instances: []Instance,
	count: int,
}

emit :: proc(builder: ^Builder, instance: Instance) {
	if instance.alpha <= 0 {
		return
	}
	if builder.count < len(builder.instances) {
		builder.instances[builder.count] = instance
	}
	builder.count += 1
}

// Original Tapweave colours. Timing follows the pinned drawable curves where
// noted; full A22 comparisons remain a separate acceptance gate.
OBJECT_COLOUR :: u32(0xffddac46)
WHITE_COLOUR :: u32(0xffffffff)
MISS_COLOUR :: u32(0xff6875ee)

shape :: proc(builder: ^Builder, primitive: Primitive, layer: u32, object_id, component_id, ordinal: u32,
	position: prepared.Position, radius, alpha: f64, colour: u32, progress: f64 = 0) {
	emit(builder, {
		primitive = primitive, layer = layer, object_id = object_id, component_id = component_id, ordinal = ordinal,
		x = position[0], y = position[1], scale_x = radius, scale_y = radius, alpha = clamp(alpha, 0, 1),
		colour = colour, progress = progress, geometry_count = 6,
	})
}

fade_in :: proc(object: ^prepared.Object, time_ms: f64) -> f64 {
	if time_ms < object.time_ms - object.preempt_ms {
		return 0
	}
	if object.fade_in_ms <= 0 {
		return 1
	}
	return f64(f32(clamp((time_ms - (object.time_ms - object.preempt_ms)) / object.fade_in_ms, 0, 1)))
}

number :: proc(builder: ^Builder, displayed_number: u64, position: prepared.Position, size: f64,
	layer, object_id, component_id, first_ordinal, colour: u32, alpha: f64 = 1) {
	digits: [20]u32
	digit_count := 0
	remaining_number := displayed_number
	for {
		digits[digit_count] = u32(remaining_number % 10)
		digit_count += 1
		remaining_number /= 10
		if remaining_number == 0 {
			break
		}
	}
	for digit_index in 0 ..< digit_count {
		emit(builder, {
			primitive = .GLYPH, layer = layer, object_id = object_id, component_id = component_id,
			ordinal = first_ordinal + u32(digit_index), x = position[0] + f64(digit_index) * size,
			y = position[1], scale_x = size, scale_y = size, alpha = alpha, colour = colour,
			glyph = 48 + digits[digit_count - digit_index - 1], geometry_count = 6,
		})
	}
}

circle :: proc(builder: ^Builder, object: ^prepared.Object, result: core_types.Hit_Result,
	result_time_ms, time_ms: f64, component_id: u32 = max(u32)) {
	position := object.position + object.stack_offset
	alpha := fade_in(object, time_ms)
	if result != .NONE && time_ms >= result_time_ms {
		elapsed_ms := time_ms - result_time_ms
		if core_types.result_properties(result).hit {
			// MainCirclePiece hides the circle/number after its 40 ms flash and
			// expands to 1.5 over 400 ms with OutQuad. Drawable lifetime is separate.
			growth := f64(clamp(f32(elapsed_ms) / f32(400), 0, 1))
			scale := f64(f32(1) + f32(growth * (2 - growth)) * f32(0.5))
			if elapsed_ms < 40 {
				shape(builder, .DISC, 20, object.id, component_id, 0, position, object.radius * scale, alpha, OBJECT_COLOUR)
				shape(builder, .RING, 20, object.id, component_id, 1, position, object.radius * scale, alpha, WHITE_COLOUR)
				number(builder, u64(max(0, object.index_in_combo) + 1), position - prepared.Position{object.radius * scale / 4, object.radius * scale / 4},
					object.radius * scale / 2, 20, object.id, component_id, 2, WHITE_COLOUR, alpha)
			}
			feedback_alpha := elapsed_ms < 800 ? f64(f32(1 - clamp((elapsed_ms - 40) / 800, 0, 1))) * alpha : 0
			shape(builder, .RING, 40, object.id, component_id, 0, position, object.radius * scale, feedback_alpha, WHITE_COLOUR)
		} else {
			alpha *= f64(f32(1 - clamp(elapsed_ms / 100, 0, 1)))
			shape(builder, .DISC, 20, object.id, component_id, 0, position, object.radius, alpha, MISS_COLOUR)
			shape(builder, .RING, 20, object.id, component_id, 1, position, object.radius, alpha, WHITE_COLOUR)
			number(builder, u64(max(0, object.index_in_combo) + 1), position - prepared.Position{object.radius / 4, object.radius / 4},
				object.radius / 2, 20, object.id, component_id, 2, WHITE_COLOUR, alpha)
		}
		return
	}
	shape(builder, .DISC, 20, object.id, component_id, 0, position, object.radius, alpha, OBJECT_COLOUR)
	shape(builder, .RING, 20, object.id, component_id, 1, position, object.radius, alpha, WHITE_COLOUR)
	number(builder, u64(max(0, object.index_in_combo) + 1), position - prepared.Position{object.radius / 4, object.radius / 4},
		object.radius / 2, 20, object.id, component_id, 2, WHITE_COLOUR, alpha)
	if object.preempt_ms > 0 {
		// Framework Vector2 interpolation casts elapsed/duration to f32 before
		// division. Scalar alpha interpolation instead uses f64 with f32 endpoints.
		approach_progress := clamp(f32(time_ms - (object.time_ms - object.preempt_ms)) / f32(object.preempt_ms), 0, 1)
		approach_scale := f32(4) + approach_progress * f32(-3)
		approach_fade_ms := min(object.fade_in_ms * 2, object.preempt_ms)
		approach_endpoint := f64(f32(0.9))
		approach_alpha := approach_fade_ms > 0 ? f64(f32(approach_endpoint * clamp((time_ms - (object.time_ms - object.preempt_ms)) / approach_fade_ms, 0, 1))) : approach_endpoint
		if time_ms >= object.time_ms {
			approach_alpha = f64(f32(approach_endpoint + clamp((time_ms - object.time_ms) / 50, 0, 1) * -approach_endpoint))
		}
		shape(builder, .RING, 30, object.id, component_id, 0, position,
			object.radius * f64(approach_scale), approach_alpha, WHITE_COLOUR)
	}
}

build_objects :: proc(builder: ^Builder, active_set: ^Active_Set, projection: simulation.Projection, time_ms: f64) {
	for object_index in active_set.indices[:active_set.count] {
		object := &projection.prepared_objects[object_index]
		outcome := simulation.project_object(projection, object_index, time_ms)
		switch object.kind {
		case .CIRCLE:
			circle(builder, object, outcome.result, outcome.result_time_ms, time_ms)
		case .SLIDER, .SPINNER:
			// These families require their own visual policies before draw
			// capability can be advertised. No JS fallback animation is implied.
		}
	}
}

order_instances :: proc(instances: []Instance) {
	slice.sort_by(instances, proc(left, right: Instance) -> bool {
		if left.layer != right.layer {
			return left.layer < right.layer
		}
		if left.object_id != right.object_id {
			return left.object_id < right.object_id
		}
		if left.component_id != right.component_id {
			return left.component_id < right.component_id
		}
		return left.ordinal < right.ordinal
	})
}

// Ordered instances start a new batch wherever the run of equal layer and
// primitive ends. The transport starts the first batch itself.
starts_batch :: proc(current, previous: Instance) -> bool {
	return current.layer != previous.layer || current.primitive != previous.primitive
}

// Miss feedback duration: circles fade over the pinned 100 ms miss window,
// other families use the shared retention window.
miss_duration_ms :: proc(object: ^prepared.Object) -> f64 {
	return object.kind == .CIRCLE ? 100 : FEEDBACK_RETENTION_MS
}

// Timing ports from osu! 2026.804.2, Copyright (c) ppy Pty Ltd.
// Licensed under MIT; see THIRD_PARTY_NOTICES.md. Graphics are original Tapweave.
package presentation

import "core:math"
import "core:slice"
import core_types "../core_types"
import prepared "../prepared"
import simulation "../simulation"

Geometry_Source :: prepared.Object
Geometry_Range :: struct {
	first, count: u32,
}

path_position :: proc(object: ^prepared.Object, progress: f64) -> prepared.Position {
	origin := object.position + object.stack_offset
	if len(object.vertices) == 0 {
		return origin
	}
	distance := clamp(progress, 0, 1) * object.path_distance
	lower_index, upper_index := 0, len(object.cumulative)
	for lower_index < upper_index {
		middle_index := lower_index + (upper_index - lower_index) / 2
		if object.cumulative[middle_index] < distance {
			lower_index = middle_index + 1
		} else {
			upper_index = middle_index
		}
	}
	if lower_index == 0 {
		return origin + object.vertices[0]
	}
	if lower_index >= len(object.vertices) {
		return origin + object.vertices[len(object.vertices) - 1]
	}
	segment_length := object.cumulative[lower_index] - object.cumulative[lower_index - 1]
	weight := segment_length > 0 ? (distance - object.cumulative[lower_index - 1]) / segment_length : 0
	return origin + object.vertices[lower_index - 1] + weight * (object.vertices[lower_index] - object.vertices[lower_index - 1])
}

// SnakingSliderBody.UpdateProgress with default snaking in/out enabled.
slider_clip :: proc(object: ^prepared.Object, head_hit: bool, time_ms: f64) -> (f64, f64) {
	clip_start := 0.0
	clip_end := object.preempt_ms > 0 ? clamp((time_ms - (object.time_ms - object.preempt_ms)) / (object.preempt_ms / 3), 0, 1) : 1
	duration := object.end_time_ms - object.time_ms
	completion := head_hit && duration > 0 ? clamp((time_ms - object.time_ms) / duration, 0, 1) : 0
	span_progress := completion * f64(object.spans)
	span := u32(span_progress)
	progress := math.mod(span_progress, 1)
	if span % 2 == 1 {
		progress = 1 - progress
	}
	if object.spans > 0 && span >= object.spans - 1 {
		if min(span, object.spans - 1) % 2 == 1 {
			clip_end = progress
		} else {
			clip_start = progress
		}
	}
	return min(clip_start, clip_end), max(clip_start, clip_end)
}

slider :: proc(builder: ^Builder, projection: simulation.Projection, object_index: int, geometry: Geometry_Range, time_ms: f64) {
	object := &projection.prepared_objects[object_index]
	outcome := simulation.project_object(projection, object_index, time_ms)
	alpha := fade_in(object, time_ms)
	if outcome.result != .NONE && time_ms >= outcome.result_time_ms {
		alpha *= f64(f32(1 - clamp((time_ms - outcome.result_time_ms) / 240, 0, 1)))
	}
	if alpha <= 0 {
		return
	}
	head_hit := outcome.head_result != .NONE && core_types.result_properties(outcome.head_result).hit && time_ms >= outcome.head_time_ms
	clip_start, clip_end := slider_clip(object, head_hit, time_ms)
	body_alpha := alpha
	if head_hit && outcome.result != .NONE && core_types.result_properties(outcome.result).hit && time_ms >= outcome.result_time_ms {
		body_alpha *= 1 - clamp((time_ms - outcome.result_time_ms) / 40, 0, 1)
	}
	if geometry.count > 0 && clip_end > clip_start {
		emit(builder, {primitive = .PATH, layer = 10, object_id = object.id, x = object.position[0] + object.stack_offset[0],
			y = object.position[1] + object.stack_offset[1], scale_x = 1, scale_y = 1, alpha = body_alpha * 0.65,
			colour = combo_colour(object), geometry_first = geometry.first, geometry_count = geometry.count,
			clip_start = clip_start, clip_end = clip_end})
		// Dynamic round clipping caps share the body's stencil coverage. They
		// never require rebuilding static mesh geometry as the slider snakes.
		for cap_index in 0 ..< 2 {
			cap_position := path_position(object, cap_index == 0 ? clip_start : clip_end)
			emit(builder, {primitive = .DISC, layer = 10, object_id = object.id, ordinal = u32(cap_index + 1), flags = 1,
				x = cap_position[0], y = cap_position[1], scale_x = object.radius, scale_y = object.radius,
				alpha = body_alpha * 0.65, colour = combo_colour(object), geometry_count = 6})
		}
	}
	for &component, component_index in object.components {
		state := simulation.project_component(projection, object_index, component_index)
		if component.kind == .Head || component.kind == .LegacyLastTick {
			continue
		}
		position := component.position + object.stack_offset
		judged := state.result != .NONE && time_ms >= state.time_ms
		hit := judged && core_types.result_properties(state.result).hit
		elapsed_ms := max(0, time_ms - state.time_ms)
		#partial switch component.kind {
		case .Tick:
			preempt := (component.time_ms - component.span_start_ms) / 2 + (component.span_index > 0 ? 200 : object.preempt_ms * f64(f32(0.66)))
			arrival_ms := component.time_ms - preempt
			tick_alpha := f64(f32(clamp((time_ms - arrival_ms) / 150, 0, 1)))
			tick_scale := tick_reveal_scale(time_ms - arrival_ms)
			if judged {
				result_alpha := f64(f32(clamp((state.time_ms - arrival_ms) / 150, 0, 1)))
				remaining := 1 - clamp(elapsed_ms / 150, 0, 1)
				tick_alpha = f64(f32(result_alpha * remaining * remaining * remaining * remaining * remaining))
				if hit {
					growth := clamp(elapsed_ms / 150, 0, 1)
					tick_scale = tick_reveal_scale(state.time_ms - arrival_ms) * (1 + 0.5 * growth * (2 - growth))
				}
			} else if time_ms >= component.time_ms {
				tick_alpha = 0
			}
			shape(builder, .DISC, 15, object.id, component.id, 0, position, object.radius * 0.125 * tick_scale, alpha * tick_alpha, WHITE_COLOUR)
		case .Repeat, .Tail:
			arrival_ms := component.span_index == 0 ? object.time_ms - object.preempt_ms : component.time_ms - 2 * object.span_duration
			fade_duration := component.kind == .Repeat ? 150.0 : object.fade_in_ms
			if component.span_index > 0 {
				fade_duration = min(object.span_duration, fade_duration)
			} else {
				arrival_ms += object.preempt_ms / 3
			}
			component_alpha := fade_duration > 0 ? clamp((time_ms - arrival_ms) / fade_duration, 0, 1) : (time_ms >= arrival_ms ? 1.0 : 0.0)
			if judged {
				if component.kind == .Repeat {
					remaining := 1 - clamp(elapsed_ms / max(0.001, min(300, object.span_duration)), 0, 1)
					component_alpha *= hit ? remaining * remaining : remaining
				} else {
					component_alpha *= hit ? (elapsed_ms < 800 ? 1.0 : 0.0) : 1 - clamp(elapsed_ms / 100, 0, 1)
				}
			}
			if component.kind == .Repeat {
				endpoint := component.span_index % 2 == 0 ? clip_end : clip_start
				if hit {
					endpoint = component.span_index % 2 == 0 ? 1 : 0
				}
				position = path_position(object, endpoint)
				aim := path_position(object, clamp(endpoint + (component.span_index % 2 == 0 ? -0.001 : 0.001), 0, 1))
				angle := math.atan2(aim[1] - position[1], aim[0] - position[0])
				emit(builder, {primitive = .GLYPH, layer = 20, object_id = object.id, component_id = component.id,
					x = position[0], y = position[1], scale_x = object.radius * 0.6, scale_y = object.radius * 0.6,
					alpha = alpha * component_alpha, colour = WHITE_COLOUR, glyph = 62, geometry_count = 6, rotation = angle})
			} else {
				shape(builder, .RING, 15, object.id, component.id, 0, position, object.radius, alpha * component_alpha, WHITE_COLOUR)
			}
		case:
		}
	}
	circle(builder, object, outcome.head_result, outcome.head_time_ms, time_ms, 0)
	if time_ms >= object.time_ms && time_ms <= object.end_time_ms {
		shape(builder, .DISC, 35, object.id, max(u32), 0, outcome.position, object.radius * 0.7, alpha, WHITE_COLOUR)
		if outcome.tracking {
			shape(builder, .RING, 35, object.id, max(u32), 1, outcome.position, object.radius * 2.4, alpha * 0.65, ACCENT_COLOUR)
		}
	}
}

spinner :: proc(builder: ^Builder, projection: simulation.Projection, object_index: int, time_ms: f64) {
	object := &projection.prepared_objects[object_index]
	outcome := simulation.project_object(projection, object_index, time_ms)
	alpha := fade_in(object, time_ms)
	if outcome.result != .NONE && time_ms >= outcome.result_time_ms {
		alpha *= f64(f32(1 - clamp((time_ms - outcome.result_time_ms) / 240, 0, 1)))
	}
	progress := object.spins_required == 0 ? 1 : f64(clamp(f32(outcome.rotation) / f32(360) / f32(object.spins_required), 0, 1))
	position := prepared.Position{256, 192}
	shape(builder, .DISC, 5, object.id, 0, 0, position, 140, alpha * 0.2, ACCENT_COLOUR)
	shape(builder, .RING, 20, object.id, 0, 0, position, 128, alpha, WHITE_COLOUR)
	if progress > 0 {
		shape(builder, .RING, 20, object.id, 0, 1, position, 115, alpha, ACCENT_COLOUR, progress)
	}
	emit(builder, {primitive = .GLYPH, layer = 30, object_id = object.id, x = 256, y = 192,
		scale_x = 70, scale_y = 70, alpha = alpha, colour = WHITE_COLOUR, glyph = 62,
		rotation = outcome.rotation * math.PI / 180, geometry_count = 6})
	number(builder, u64(progress * 100), {235, 270}, 12, 30, object.id, 0, 1, WHITE_COLOUR, alpha)
	bonus := max(0, int(outcome.rotation / 360) - int(object.spins_required))
	if bonus > 0 {
		number(builder, u64(bonus), {250, 300}, 12, 30, object.id, 0, 10, ACCENT_COLOUR, alpha, centred = true)
	}
}

follow_points :: proc(builder: ^Builder, previous, object: ^prepared.Object, time_ms: f64) {
	if previous.kind == .SPINNER || object.kind == .SPINNER || object.new_combo {
		return
	}
	start := previous.end_position + previous.stack_offset
	difference := object.position + object.stack_offset - start
	distance := f64(int(math.sqrt(f32(difference[0]) * f32(difference[0]) + f32(difference[1]) * f32(difference[1]))))
	if distance <= 80 {
		return
	}
	for point_distance := 48.0; point_distance < distance - 32; point_distance += 32 {
		fraction := f64(f32(point_distance) / f32(distance))
		fade_out_ms := previous.end_time_ms + fraction * (object.time_ms - previous.end_time_ms)
		fade_in_ms := fade_out_ms - 800 * min(1, previous.preempt_ms / 450)
		fade := object.fade_in_ms > 0 ? clamp((time_ms - fade_in_ms) / object.fade_in_ms, 0, 1) : 1
		alpha := fade * (object.fade_in_ms > 0 ? 1 - clamp((time_ms - fade_out_ms) / object.fade_in_ms, 0, 1) : f64(time_ms < fade_out_ms ? 1 : 0))
		position := start + (fraction - 0.1 * (1 - fade) * (1 - fade)) * difference
		shape(builder, .DISC, 3, object.id, 0, u32(point_distance), position, 3 * object.scale * (1.5 - 0.5 * fade * (2 - fade)), f64(f32(alpha)), WHITE_COLOUR)
	}
}

// The fitted view one draw uses: bounds-fit transform plus the CSS viewport.
// Background coverage and HUD placement derive from this single view so map
// fitting, input conversion and overlays cannot disagree.
Scene_View :: struct {
	transform: Playfield_Transform,
	viewport: Viewport,
}

hud :: proc(builder: ^Builder, score: u64, accuracy, health: f64, combo: u32, view: Scene_View) {
	// Viewport-anchored HUD placement: positions convert through the fitted
	// inverse transform, sizes use a viewport-based scale independent of map
	// bounds. Glyphs, values, colours and ordering are unchanged.
	hs := hud_scale(view.viewport)
	unit := hs / view.transform.scale
	left_x, top_y := to_playfield(view.transform, view.viewport.css_left + 12 * hs, view.viewport.css_top + 12 * hs)
	right_x, _ := to_playfield(view.transform, view.viewport.css_left + view.viewport.css_width - 12 * hs, view.viewport.css_top)
	_, bottom_y := to_playfield(view.transform, view.viewport.css_left, view.viewport.css_top + view.viewport.css_height - 26 * hs)
	number(builder, score, {left_x, top_y}, 8 * unit, 60, 0, 0, 0, WHITE_COLOUR)
	accuracy_hundredths := u64(clamp(accuracy, 0, 1) * 10000)
	// Accuracy block keeps the original 422..485 right-anchored offsets,
	// scaled by the HUD unit.
	number(builder, accuracy_hundredths / 100, {right_x - 63 * unit, top_y}, 8 * unit, 60, 0, 1, 0, WHITE_COLOUR)
	for digit_index in 0 ..< 2 {
		digit := digit_index == 0 ? (accuracy_hundredths / 10) % 10 : accuracy_hundredths % 10
		emit(builder, {primitive = .GLYPH, layer = 60, component_id = 1, ordinal = u32(4 + digit_index),
			x = right_x - 31 * unit + f64(digit_index) * 8 * unit, y = top_y, scale_x = 8 * unit, scale_y = 8 * unit,
			alpha = 1, colour = WHITE_COLOUR, glyph = 48 + u32(digit), geometry_count = 6})
	}
	emit(builder, {primitive = .GLYPH, layer = 60, component_id = 1, ordinal = 3, x = right_x - 39 * unit, y = top_y,
		scale_x = 8 * unit, scale_y = 8 * unit, alpha = 1, colour = WHITE_COLOUR, glyph = 46, geometry_count = 6})
	emit(builder, {primitive = .GLYPH, layer = 60, component_id = 1, ordinal = 6, x = right_x - 8 * unit, y = top_y,
		scale_x = 8 * unit, scale_y = 8 * unit, alpha = 1, colour = WHITE_COLOUR, glyph = 37, geometry_count = 6})
	number(builder, u64(combo), {left_x, bottom_y}, 12 * unit, 60, 0, 2, 0, ACCENT_COLOUR)
	centre_x, centre_y := to_playfield(view.transform,
		view.viewport.css_left + view.viewport.css_width / 2, view.viewport.css_top + 6 * hs)
	emit(builder, {primitive = .RECTANGLE, layer = 60, object_id = 0, component_id = 3,
		x = centre_x, y = centre_y, scale_x = 100 * unit, scale_y = 2 * unit, alpha = 0.3, colour = WHITE_COLOUR, geometry_count = 6})
	emit(builder, {primitive = .RECTANGLE, layer = 60, object_id = 0, component_id = 3, ordinal = 1,
		x = centre_x + (clamp(health, 0, 1) - 1) * 100 * unit,
		y = centre_y, scale_x = clamp(health, 0, 1) * 100 * unit,
		scale_y = 2 * unit, alpha = 1, colour = ACCENT_COLOUR, geometry_count = 6})
}

build_scene :: proc(builder: ^Builder, active: ^Active_Set, history: ^Semantic_History,
	projection: simulation.Projection, ranges: []Geometry_Range, time_ms: f64, view: Scene_View) {
	// Background covering the complete canvas: the inverse-fitted viewport
	// rectangle with a small overshoot so f32 rounding cannot leave edges.
	half_width := view.viewport.css_width / 2 / view.transform.scale + 2 / view.transform.scale
	half_height := view.viewport.css_height / 2 / view.transform.scale + 2 / view.transform.scale
	background_x, background_y := to_playfield(view.transform,
		view.viewport.css_left + view.viewport.css_width / 2, view.viewport.css_top + view.viewport.css_height / 2)
	emit(builder, {primitive = .RECTANGLE, layer = 0, x = background_x, y = background_y,
		scale_x = half_width, scale_y = half_height, alpha = 1, colour = BACKGROUND_COLOUR, geometry_count = 6})
	starfield(builder, view, time_ms)
	for object_index in active.indices[:active.count] {
		object := &projection.prepared_objects[object_index]
		if object_index > 0 {
			follow_points(builder, &projection.prepared_objects[object_index - 1], object, time_ms)
		}
		switch object.kind {
		case .CIRCLE:
			outcome := simulation.project_object(projection, object_index, time_ms)
			circle(builder, object, outcome.result, outcome.result_time_ms, time_ms)
		case .SLIDER:
			slider(builder, projection, object_index, ranges[object_index], time_ms)
		case .SPINNER:
			spinner(builder, projection, object_index, time_ms)
		}
	}
	for feedback_index in history.feedback_indices[:history.feedback_count] {
		event := projection.feedback[feedback_index]
		object := &projection.prepared_objects[event.object_id]
		position := object.position + object.stack_offset
		if event.component_id != max(u32) && int(event.component_id) < len(object.components) {
			position = object.components[event.component_id].position + object.stack_offset
		}
		alpha := 1 - clamp((time_ms - event.time_ms) / 800, 0, 1)
		hit := core_types.result_properties(event.result).hit
		if event.result == .IGNORE_HIT || event.result == .IGNORE_MISS {
			continue
		}
		if hit {
			number(builder, event.result == .GREAT ? 300 : event.result == .OK ? 100 : event.result == .MEH ? 50 : 10,
				position, 8, 45, event.object_id, event.component_id, 0, ACCENT_COLOUR, alpha, centred = true)
		} else {
			emit(builder, {primitive = .GLYPH, layer = 45, object_id = event.object_id, component_id = event.component_id,
				x = position[0], y = position[1], scale_x = 12, scale_y = 12, alpha = alpha,
				colour = MISS_COLOUR, glyph = 88, geometry_count = 6})
		}
	}
	// Original semantic trail: deterministic receipt history, independent of RAF.
	// This is an explicit cosmetic policy, not a port of framework sprite sampling.
	first_cursor := max(0, history.cursor_count - 2048)
	for cursor_index in first_cursor ..< history.cursor_count {
		snapshot := projection.cursor_history[history.cursor_indices[cursor_index]]
		age := time_ms - snapshot.effective_time_ms
		if age < 0 || age >= 120 {
			continue
		}
		shape(builder, .DISC, 70, 0, 0, u32(cursor_index), {snapshot.x, snapshot.y}, 3,
			math.pow(1 - age / 120, 1.7) * 0.5, ACCENT_COLOUR)
	}
	shape(builder, .RING, 75, 0, 0, 0, {projection.cursor.x, projection.cursor.y}, 9, 1, WHITE_COLOUR)
	shape(builder, .DISC, 75, 0, 0, 1, {projection.cursor.x, projection.cursor.y}, 3, 1, ACCENT_COLOUR)
}

STARFIELD_STAR_COUNT :: 40

// Deterministic backdrop garnish: a quiet anime night sky behind the
// playfield, echoing the product shell's star-dotted menu backdrops. Stars
// derive only from a fixed seed and beatmap time, so sessions and replays
// stay reproducible, and they sit on layer 1 under every gameplay element.
starfield :: proc(builder: ^Builder, view: Scene_View, time_ms: f64) {
	half_width := view.viewport.css_width / 2 / view.transform.scale + 2 / view.transform.scale
	half_height := view.viewport.css_height / 2 / view.transform.scale + 2 / view.transform.scale
	centre_x, centre_y := to_playfield(view.transform,
		view.viewport.css_left + view.viewport.css_width / 2, view.viewport.css_top + view.viewport.css_height / 2)
	random_state := u32(0x13579bdf)
	for star_index in 0 ..< STARFIELD_STAR_COUNT {
		random_state = random_state * 1103515245 + 12345
		position_x := centre_x + (f64(random_state >> 8 & 0xffff) / 65535 * 2 - 1) * half_width
		random_state = random_state * 1103515245 + 12345
		position_y := centre_y + (f64(random_state >> 8 & 0xffff) / 65535 * 2 - 1) * half_height
		random_state = random_state * 1103515245 + 12345
		radius := 1.2 + f64(random_state >> 8 & 0xffff) / 65535 * 1.4
		random_state = random_state * 1103515245 + 12345
		twinkle_phase := f64(random_state >> 8 & 0xffff) / 65535 * 2 * math.PI
		random_state = random_state * 1103515245 + 12345
		colour_roll := random_state >> 8 & 0xffff
		star_colour := WHITE_COLOUR
		if colour_roll < 9830 {
			star_colour = ACCENT_COLOUR
		} else if colour_roll < 16384 {
			star_colour = COMBO_COLOURS[1]
		} else if colour_roll < 22938 {
			star_colour = COMBO_COLOURS[2]
		}
		twinkle := 0.75 + 0.25 * math.sin(time_ms * 0.0011 + twinkle_phase)
		star_alpha := 0.05 + 0.08 * f64(colour_roll % 512) / 512
		shape(builder, .DISC, 1, 0, 0, u32(star_index), {position_x, position_y}, radius, star_alpha * twinkle, star_colour)
	}
}

starts_scene_batch :: proc(current, previous: Instance) -> bool {
	return current.layer != previous.layer || current.flags != previous.flags || current.geometry_first != previous.geometry_first ||
		current.geometry_count != previous.geometry_count || current.primitive == .PATH || previous.primitive == .PATH
}

initialize_scene_reveals :: proc(active: ^Active_Set, objects: []prepared.Object) {
	for &reveal in active.reveals {
		object_index := reveal.object_index
		if object_index > 0 && !objects[object_index].new_combo && objects[object_index].kind != .SPINNER && objects[object_index - 1].kind != .SPINNER {
			reveal.time_ms = min(reveal.time_ms, objects[object_index - 1].end_time_ms - 800)
		}
	}
	slice.sort_by(active.reveals, proc(left, right: Reveal) -> bool {
		return left.time_ms < right.time_ms || left.time_ms == right.time_ms && left.object_index < right.object_index
	})
}

finish_scene :: proc(builder: ^Builder) {
	for &instance in builder.instances[:min(builder.count, len(builder.instances))] {
		// Glyph artwork is pre-proportioned inside its em-square cell, so
		// quads need no per-digit scale correction.
		instance.x = f64(f32(instance.x))
		instance.y = f64(f32(instance.y))
		instance.scale_x = f64(f32(instance.scale_x))
		instance.scale_y = f64(f32(instance.scale_y))
		instance.rotation = f64(f32(instance.rotation))
		instance.alpha = f64(f32(instance.alpha))
		instance.progress = f64(f32(instance.progress))
	}
}

// Framework DefaultEasingFunction.OutElasticHalf, endpoint-corrected.
tick_reveal_scale :: proc(elapsed_ms: f64) -> f64 {
	progress := f64(clamp(f32(elapsed_ms) / f32(600), 0, 1))
	elastic_constant := 2 * math.PI / 0.3
	offset := math.pow(2.0, -10.0) * math.sin((0.5 - 0.075) * elastic_constant)
	easing := math.pow(2.0, -10 * progress) * math.sin((0.5 * progress - 0.075) * elastic_constant) + 1 - offset * progress
	return f64(f32(0.5) + f32(easing) * f32(0.5))
}

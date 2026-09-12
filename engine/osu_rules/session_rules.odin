// Portions ported from pinned osu! sources (2026.804.2).
// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See THIRD_PARTY_NOTICES.md. Scheduling policy is specified in ADR-002.
package osu_rules

import "core:math"
import prepared "../prepared"
import core_types "../core_types"

Object_State :: struct {
	result, head_result: core_types.Hit_Result,
	result_time_ms, head_time_ms: f64,
	tracking, has_any_key_time: bool,
	any_key_time_ms: f64,
	head_action, previous_actions: u32,
	spin_history: Spin_History,
	last_angle: f32,
	has_angle: bool,
	component_start: int,
}

maximum_result :: proc(object: ^prepared.Object, component_index: int) -> core_types.Hit_Result {
	if component_index < 0 {
		return object.kind == .SLIDER ? .IGNORE_HIT : .GREAT
	}
	switch object.components[component_index].kind {
	case .Head:
		return .GREAT
	case .Tick, .Repeat:
		return .LARGE_TICK_HIT
	case .Tail:
		return .SLIDER_TAIL_HIT
	case .SpinnerTick:
		return .SMALL_BONUS
	case .SpinnerBonusTick:
		return .LARGE_BONUS
	case .LegacyLastTick:
		return .NONE
	}
	return .NONE
}

minimum_result :: proc(maximum: core_types.Hit_Result) -> core_types.Hit_Result {
	// Pinned Judgement.MinResult (including the unmodded slider tail).
	#partial switch maximum {
	case .SMALL_BONUS, .LARGE_BONUS, .IGNORE_HIT, .SLIDER_TAIL_HIT:
		return .IGNORE_MISS
	case .SMALL_TICK_HIT:
		return .SMALL_TICK_MISS
	case .LARGE_TICK_HIT:
		return .LARGE_TICK_MISS
	case:
		return .MISS
	}
}

// Prepared vertices are relative to the object's unstacked position.
slider_position :: proc(object: ^prepared.Object, time_ms: f64) -> prepared.Position {
	position := object.position + object.stack_offset
	if len(object.vertices) == 0 || object.span_duration <= 0 {
		return position
	}
	// HasPathWithRepeatsExtensions.ProgressAt: preserve duration division,
	// multiplication, remainder and the exact-endpoint span parity.
	object_progress := clamp((time_ms - object.time_ms) / (object.end_time_ms - object.time_ms), 0, 1)
	span_progress := object_progress * f64(object.spans)
	progress := math.mod(span_progress, 1)
	if u32(span_progress) % 2 == 1 {
		progress = 1 - progress
	}
	distance := progress * object.path_distance
	lower_index := 0
	upper_index := len(object.cumulative)
	for lower_index < upper_index {
		middle_index := lower_index + (upper_index - lower_index) / 2
		if object.cumulative[middle_index] < distance {
			lower_index = middle_index + 1
		} else {
			upper_index = middle_index
		}
	}
	if lower_index == 0 {
		return position + object.vertices[0]
	}
	if lower_index >= len(object.vertices) {
		return position + object.vertices[len(object.vertices) - 1]
	}
	previous_distance := object.cumulative[lower_index - 1]
	segment_length := object.cumulative[lower_index] - previous_distance
	if abs(segment_length) <= 1e-7 {
		return position + object.vertices[lower_index - 1]
	}
	weight := (distance - previous_distance) / segment_length
	// SliderPath.PositionAt casts interpolation weight and output to f32.
	for coordinate_index in 0 ..< 2 {
		previous_coordinate := f32(object.vertices[lower_index - 1][coordinate_index])
		next_coordinate := f32(object.vertices[lower_index][coordinate_index])
		position[coordinate_index] += f64(previous_coordinate + (next_coordinate - previous_coordinate) * f32(weight))
	}
	return position
}

in_radius :: proc(input: core_types.Input_Snapshot, position: prepared.Position, radius: f64) -> bool {
	distance_x := f32(input.x) - f32(position[0])
	distance_y := f32(input.y) - f32(position[1])
	return distance_x * distance_x + distance_y * distance_y <= f32(radius) * f32(radius)
}

update_tracking :: proc(object: ^prepared.Object, object_state: ^Object_State, input: core_types.Input_Snapshot, time_ms: f64, expanded := false) {
	if object_state.head_action == 0 {
		object_state.has_any_key_time = false
	} else if !object_state.has_any_key_time {
		other_action := object_state.head_action == core_types.LEFT ? core_types.RIGHT : core_types.LEFT
		if object_state.previous_actions & other_action == 0 {
			object_state.has_any_key_time = true
			object_state.any_key_time_ms = time_ms
		}
	}
	valid_actions := input.action_bits & (core_types.LEFT | core_types.RIGHT)
	if object_state.head_action != 0 && (!object_state.has_any_key_time || time_ms <= object_state.any_key_time_ms) {
		valid_actions &= object_state.head_action
	}
	radius := f32(object.radius)
	if object_state.tracking || expanded {
		radius *= 2.4
	}
	object_state.tracking = valid_actions != 0 && in_radius(input, slider_position(object, time_ms), f64(radius))
	object_state.previous_actions = input.action_bits
}

update_spinner :: proc(object: ^prepared.Object, object_state: ^Object_State, input: core_types.Input_Snapshot, time_ms: f64) {
	angle := -f32(math.atan2(f32(input.x) - 256, f32(input.y) - 192)) * (f32(180) / f32(math.PI))
	rotation_delta := object_state.has_angle ? angle - object_state.last_angle : f32(0)
	if rotation_delta > 180 {
		rotation_delta -= 360
	}
	if rotation_delta < -180 {
		rotation_delta += 360
	}
	if time_ms >= object.time_ms && time_ms < object.end_time_ms && input.action_bits & 3 != 0 {
		report_delta(&object_state.spin_history, time_ms, rotation_delta)
	}
	object_state.last_angle = angle
	object_state.has_angle = true
}

spinner_result :: proc(object: ^prepared.Object, object_state: ^Object_State) -> core_types.Hit_Result {
	progress := object.spins_required == 0 ? f32(1) : total_rotation(&object_state.spin_history) / 360 / f32(object.spins_required)
	if progress >= 1 {
		return .GREAT
	}
	if progress > 0.9 {
		return .OK
	}
	if progress > 0.75 {
		return .MEH
	}
	return .MISS
}

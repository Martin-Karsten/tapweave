// Copyright (c) ppy Pty Ltd. MIT. Full-map stacking and combo processing.
package osu_prepare

import prepared "../prepared"
import core_types "../core_types"
import "core:math"

stack_near :: proc(first, second: prepared.Position) -> bool {
	difference := to32(first) - to32(second)
	return math.sqrt(f64(difference.x) * f64(difference.x) + f64(difference.y) * f64(difference.y)) < 3
}

apply_stacking :: proc(
	objects: []prepared.Object,
	version: u32,
	leniency: f32,
	work_budget: ^core_types.Work_Budget,
) -> bool {
	for &object, index in objects {
		if !core_types.spend_work(work_budget, 1) {
			return false
		}
		if index > 0 {
			previous := &objects[index - 1]
			object.combo_index = previous.combo_index
			object.combo_index_with_offsets = previous.combo_index_with_offsets
			object.index_in_combo = previous.index_in_combo + 1
		}
		if object.kind != .SPINNER && (index == 0 || objects[index - 1].kind == .SPINNER) {
			object.new_combo = true
		}
		if object.kind != .SPINNER && object.new_combo {
			object.combo_index += 1
			object.combo_index_with_offsets += i32(object.combo_offset) + 1
			object.index_in_combo = 0
			if index > 0 {
				objects[index - 1].last_in_combo = true
			}
		}
	}
	if version >= 6 {
		for outer_index := len(objects) - 1; outer_index > 0; outer_index -= 1 {
			if !core_types.spend_work(work_budget, 1) {
				return false
			}
			current := &objects[outer_index]
			if current.stack_height != 0 || current.kind == .SPINNER {
				continue
			}
			threshold := f32(current.preempt_ms) * leniency
			is_circle := current.kind == .CIRCLE
			for previous_index := outer_index - 1; previous_index >= 0; previous_index -= 1 {
				if !core_types.spend_work(work_budget, 1) {
					return false
				}
				previous := &objects[previous_index]
				if previous.kind == .SPINNER {
					continue
				}
				if is_circle {
					if f32(i32(current.time_ms) - i32(previous.end_time_ms)) > threshold {
						break
					}
					if previous.kind == .SLIDER && stack_near(previous.end_position, current.position) {
						offset := current.stack_height - previous.stack_height + 1
						for affected_index in previous_index + 1 ..= outer_index {
							if !core_types.spend_work(work_budget, 1) {
								return false
							}
							if stack_near(previous.end_position, objects[affected_index].position) {
								objects[affected_index].stack_height -= offset
							}
						}
						break
					}
					if stack_near(previous.position, current.position) {
						previous.stack_height = current.stack_height + 1
						current = previous
					}
				} else {
					if current.time_ms - previous.time_ms > f64(threshold) {
						break
					}
					if stack_near(previous.end_position, current.position) {
						previous.stack_height = current.stack_height + 1
						current = previous
					}
				}
			}
		}
	} else {
		for &current, index in objects {
			if !core_types.spend_work(work_budget, 1) {
				return false
			}
			if current.stack_height != 0 && current.kind != .SLIDER {
				continue
			}
			end_time := current.end_time_ms
			slider_stack := i32(0)
			endpoint := current.position
			if current.kind == .SLIDER {
				path := Path {
					vertices = current.vertices,
					cumulative = current.cumulative,
					distance = current.path_distance,
				}
				relative, _ := position_at(&path, 1)
				endpoint = to64(to32(current.position) + to32(relative))
			}
			for &following in objects[index + 1:] {
				if !core_types.spend_work(work_budget, 1) {
					return false
				}
				if following.time_ms - f64(f32(current.preempt_ms) * leniency) > end_time {
					break
				}
				if stack_near(following.position, current.position) {
					current.stack_height += 1
					end_time = following.time_ms
				} else if stack_near(following.position, endpoint) {
					slider_stack += 1
					following.stack_height -= slider_stack
					end_time = following.time_ms
				}
			}
		}
	}
	for &object in objects {
		if !core_types.spend_work(work_budget, 1) {
			return false
		}
		if object.kind != .SPINNER {
			offset := f64(f32(object.stack_height) * f32(object.scale) * f32(-6.4))
			object.stack_offset = {offset, offset}
		}
	}
	return true
}

// Copyright (c) ppy Pty Ltd. MIT. Ports pinned preparation semantics.
package osu_prepare

import core_types "../core_types"
import beatmap_decode "../beatmap_decode"
import prepared "../prepared"
import "core:mem"
import "core:math"
import "core:slice"

PREPARATION_PROFILE :: prepared.IDENTITY_PROFILE
MAX_COMPONENTS :: u64(1_000_000)
MAX_PATH_VERTICES :: 100_000
MAX_CONTROL_POINTS :: 65_536
Prepare_Scratch :: struct {
	arena: core_types.Arena,
	positions: []Position_F64,
	markers: []Path_Marker,
	controls: []Control_Point,
	node_banks: []Sample_Bank,
	node_sounds: []u32,
	geometry: Geometry_Workspace,
}

// Count and fill use identical aligned reservations; no guessed padding budget.
create_scratch :: proc(
	decoded: ^beatmap_decode.Map,
	limit: u64,
	allocator: mem.Allocator,
) -> (
	Prepare_Scratch,
	core_types.Status,
) {
	control_point_count, node_count := u64(0), u64(0)
	for raw_object in decoded.objects {
		if raw_object.kind != .SLIDER {
			continue
		}
		token_count := u64(1)
		for character in raw_object.path {
			if character == '|' {
				token_count += 1
			}
		}
		control_point_count = max(control_point_count, token_count)
		node_count = max(node_count, u64(raw_object.spans) + 1)
	}
	if control_point_count == 0 {
		return {}, .OK
	}
	if control_point_count > MAX_CONTROL_POINTS {
		return {}, .QUOTA_EXCEEDED
	}
	result: Prepare_Scratch
	builder := Map_Builder {
		limit = limit,
		arena = &result.arena,
	}
	for pass in 0 ..< 2 {
		builder.used = 0
		builder.fill = pass == 1
		result.positions = map_take(&builder, Position_F64, control_point_count)
		result.markers = map_take(&builder, Path_Marker, control_point_count)
		result.controls = map_take(&builder, Control_Point, control_point_count)
		result.node_banks = map_take(&builder, Sample_Bank, node_count)
		result.node_sounds = map_take(&builder, u32, node_count)
		result.geometry.vertices = map_take(&builder, Position_F64, MAX_PATH_VERTICES)
		result.geometry.cumulative = map_take(&builder, f64, MAX_PATH_VERTICES + 1)
		result.geometry.segment_ends = map_take(&builder, f64, control_point_count)
		result.geometry.scratch = map_take(&builder, Position_F32, control_point_count * 4)
		result.geometry.stack = map_take(&builder, Position_F32, control_point_count * 64)
		if builder.error.status != .OK {
			core_types.arena_destroy(&result.arena)
			return {}, builder.error.status
		}
		if pass == 0 {
			status: core_types.Status
			result.arena, status = core_types.arena_create(builder.used, allocator)
			if status != .OK {
				return {}, status
			}
		}
	}
	return result, .OK
}

difficulty_range :: proc(value, low, middle, high: f64) -> f64 {
	if value > 5 {
		return middle + (high - middle) * ((value - 5) / 5)
	}
	if value < 5 {
		return middle + (middle - low) * ((value - 5) / 5)
	}
	return middle
}

prepare_map :: proc(
	decoded: ^beatmap_decode.Map,
	points: ^Points,
	quota := core_types.DEFAULT_QUOTAS.arena_bytes,
	allocator := context.allocator,
	duration_limit := core_types.DEFAULT_QUOTAS.duration_ms,
	work_budget: ^core_types.Work_Budget = nil,
) -> (
	result: prepared.Map,
	error: core_types.Error,
) {
	local_budget := core_types.Work_Budget {
		remaining = core_types.DEFAULT_PREPARATION_WORK,
	}
	work_budget := work_budget
	if work_budget == nil {
		work_budget = &local_budget
	}
	if !core_types.spend_work(work_budget, 2 * u64(len(decoded.text))) {
		return {}, {status = .QUOTA_EXCEEDED, code = .PREPARATION_WORK}
	}
	result.difficulty = {
		decoded.difficulty.health_drain_rate,
		decoded.difficulty.circle_size,
		decoded.difficulty.overall_difficulty,
		decoded.difficulty.approach_rate,
		decoded.difficulty.slider_multiplier,
		decoded.difficulty.tick_rate,
	}
	result.stack_leniency = decoded.stack_leniency
	scratch, status := create_scratch(decoded, quota, allocator)
	if status != .OK {
		return {}, {status = status, code = .ARENA_BYTES, limit = quota}
	}
	defer core_types.arena_destroy(&scratch.arena)
	builder := Map_Builder {
		limit = quota - u64(len(scratch.arena.bytes)),
		work_budget = work_budget,
	}

	for pass in 0 ..< 2 {
		builder.used = 0
		builder.fill = pass == 1
		builder.arena = &result.arena
		prepare_shared_records(&builder, &result, decoded, points)
		result.objects = map_take(&builder, prepared.Object, u64(len(decoded.objects)))
		builder.component_count = 0
		for &raw_object, object_index in decoded.objects {
			object := prepare_object(&builder, &raw_object, decoded, points, &scratch, duration_limit)
			if builder.error.status != .OK {
				prepared.destroy_map(&result)
				return {}, builder.error
			}
			component_count := builder.component_count
			if component_count > MAX_COMPONENTS {
				prepared.destroy_map(&result)
				return {}, {status = .QUOTA_EXCEEDED, code = .PATH, requested = component_count, limit = MAX_COMPONENTS}
			}
			if builder.fill {
				result.objects[object_index] = object
			}
		}
		result.schedule = map_take(
			&builder,
			prepared.Schedule_Entry,
			builder.component_count + u64(len(decoded.objects)),
		)
		if builder.error.status != .OK {
			prepared.destroy_map(&result)
			return {}, builder.error
		}
		if pass == 0 {
			result.arena, status = core_types.arena_create(builder.used, allocator)
			if status != .OK {
				return {}, {status = status}
			}
		}
	}

	if !apply_stacking(result.objects, decoded.format_version, f32(decoded.stack_leniency), work_budget) {
		prepared.destroy_map(&result)
		return {}, {status = .QUOTA_EXCEEDED, code = .PREPARATION_WORK}
	}
	schedule_index := 0
	for object, object_index in result.objects {
		result.schedule[schedule_index] = {object.time_ms, u32(object_index), max(u32)}
		schedule_index += 1
		for component, component_index in object.components {
			result.schedule[schedule_index] = {component.time_ms, u32(object_index), u32(component_index)}
			schedule_index += 1
		}
	}
	// Charge an upper bound on comparison-sort work before entering the sort.
	sort_levels := u64(0)
	for remaining_entries := u64(len(result.schedule)); remaining_entries > 0; remaining_entries >>= 1 {
		sort_levels += 1
	}
	sort_work, sort_work_valid := core_types.checked_product(u64(len(result.schedule)), sort_levels)
	if !sort_work_valid || !core_types.spend_work(work_budget, sort_work) {
		prepared.destroy_map(&result)
		return {}, {status = .QUOTA_EXCEEDED, code = .PREPARATION_WORK}
	}
	slice.sort_by(
		result.schedule,
		proc(first, second: prepared.Schedule_Entry) -> bool {
			if first.time_ms != second.time_ms {
				return first.time_ms < second.time_ms
			}
			if first.object_index != second.object_index {
				return first.object_index < second.object_index
			}
			// Top-level arrival precedes nested records at the same timestamp.
			if first.component_index == max(u32) {
				return second.component_index != max(u32)
			}
			if second.component_index == max(u32) {
				return false
			}
			return first.component_index < second.component_index
		},
	)
	prepared.compute_identity(&result, decoded.text)
	return result, {}
}

prepare_object :: proc(
	builder: ^Map_Builder,
	raw_object: ^beatmap_decode.Raw_Object,
	decoded: ^beatmap_decode.Map,
	points: ^Points,
	scratch: ^Prepare_Scratch,
	duration_limit: u64,
) -> prepared.Object {
	object := prepared.Object {
		id = raw_object.id,
		kind = prepared.Object_Kind(raw_object.kind),
		time_ms = raw_object.time_ms,
		end_time_ms = raw_object.end_time_ms,
		position = {raw_object.x, raw_object.y},
		end_position = {raw_object.x, raw_object.y},
		new_combo = raw_object.new_combo,
		combo_offset = raw_object.combo_offset,
	}
	object.scale = f64(
		f32(f32(1 - f64(f32(0.7)) * ((decoded.difficulty.circle_size - 5) / 5)) / 2) * f32(1.00041),
	)
	object.radius = 64 * object.scale
	object.preempt_ms = math.trunc(difficulty_range(decoded.difficulty.approach_rate, 1800, 1200, 450))
	object.fade_in_ms = 400 * min(1, object.preempt_ms / 450)
	primary_point := query(points.sample, .SAMPLE, object.end_time_ms + 5)
	bank := parse_bank(raw_object.hit_sample, {}, raw_object.kind == .SLIDER)
	if raw_object.kind == .SLIDER {
		if !core_types.spend_work(builder.work_budget, u64(raw_object.spans) + 1) {
			builder.error = {
				status = .QUOTA_EXCEEDED,
				code = .PREPARATION_WORK,
				line = raw_object.line,
			}
			return object
		}
		prepare_node_fields(raw_object, scratch.node_banks, scratch.node_sounds)
		controls, valid := parse_path(
			raw_object,
			decoded.format_version,
			scratch.positions,
			scratch.markers,
			scratch.controls,
		)
		if !valid {
			builder.error = {
				status = .MALFORMED_MAP,
				code = .PATH,
				line = raw_object.line,
			}
			return object
		}
		options := Geometry_Options {
			adjust_length = raw_object.length > 0,
			expected_length = raw_object.length,
			work_limit = 100_000_000,
		}
		legacy_path, geometry_status := build_path(
			controls,
			options,
			scratch.geometry,
			&builder.work_budget.remaining,
		)
		if geometry_status != .OK {
			builder.error = {
				status = .QUOTA_EXCEEDED,
				code = geometry_status == .Work_Limit ? .PREPARATION_WORK : .PATH,
				line = raw_object.line,
			}
			return object
		}
		legacy_distance := legacy_path.distance
		object.spans = abs(legacy_distance) <= 1e-7 ? 1 : raw_object.spans
		options.optimise_catmull = true
		path: Path
		path, geometry_status = build_path(
			controls,
			options,
			scratch.geometry,
			&builder.work_budget.remaining,
		)
		if geometry_status != .OK {
			builder.error = {
				status = .QUOTA_EXCEEDED,
				code = geometry_status == .Work_Limit ? .PREPARATION_WORK : .PATH,
				line = raw_object.line,
			}
			return object
		}
		object.path_distance = path.distance
		object.calculated_distance = path.calculated_length
		object.vertices = copy_vertices(builder, path.vertices)
		object.cumulative = copy_lengths(builder, path.cumulative)
		timing := query(points.timing, .TIMING, raw_object.time_ms)
		difficulty := query(points.difficulty, .DIFFICULTY, raw_object.time_ms)
		adjusted := timing.beat_length * (f64(clamp(f32(100 / difficulty.slider_velocity), 10, 1000)) / 100)
		object.velocity = 100 * decoded.difficulty.slider_multiplier / adjusted
		object.end_time_ms = raw_object.time_ms + f64(object.spans) * path.distance / object.velocity
		object.span_duration = (object.end_time_ms - raw_object.time_ms) / f64(object.spans)
		if !finite(object.end_time_ms) || abs(object.end_time_ms) > f64(duration_limit) {
			builder.error = {
				status = .QUOTA_EXCEEDED,
				code = .DURATION,
				line = raw_object.line,
			}
			return object
		}
		object.generate_ticks = difficulty.generate_ticks
		multiplier := decoded.format_version < 8 ? 1 / difficulty.slider_velocity : 1
		object.tick_distance =
			object.generate_ticks ? object.velocity * timing.beat_length / decoded.difficulty.tick_rate * multiplier : 0
		endpoint, _ := position_at(&path, f64(object.spans % 2))
		object.end_position = to64(to32(object.position) + to32(endpoint))
		primary_point = query(points.sample, .SAMPLE, raw_object.time_ms + 6)
		object.samples = make_samples(builder, raw_object.hit_sound, bank, primary_point)

		legacy_velocity :=
			100 * decoded.difficulty.slider_multiplier * difficulty.slider_velocity / timing.beat_length
		legacy_duration := f64(object.spans) * legacy_distance / legacy_velocity
		tail_node := object.spans
		if object.spans != raw_object.spans {
			tail_node = raw_object.spans
		}
		object.tail_samples = node_samples(
			builder,
			scratch,
			tail_node,
			query(points.sample, .SAMPLE, raw_object.time_ms + legacy_duration + 5),
		)
		object.auxiliary_samples = slider_auxiliary(
			builder,
			raw_object,
			bank,
			primary_point,
			object.tail_samples,
			sample_count(scratch.node_sounds[tail_node]),
		)
		object.components = slider_components(
			builder,
			&object,
			raw_object,
			points,
			&path,
			legacy_duration,
			scratch,
			bank,
		)
	} else {
		object.samples = make_samples(builder, raw_object.hit_sound, bank, primary_point)
		if raw_object.kind == .SPINNER {
			duration := (object.end_time_ms - object.time_ms) / 1000
			object.spins_required = i32(
				difficulty_range(decoded.difficulty.overall_difficulty, 90, 150, 225) / 60 * duration +
				0.0001,
			)
			object.maximum_bonus_spins = max(
				0,
				i32(
					difficulty_range(decoded.difficulty.overall_difficulty, 250, 380, 430) / 60 * duration +
					0.0001,
				) -
				object.spins_required -
				2,
			)
			total := object.spins_required + object.maximum_bonus_spins + 2
			builder.component_count += u64(total)
			object.components = map_take(builder, prepared.Component, u64(total))
			if builder.error.status != .OK {
				return object
			}
			object.auxiliary_samples = make_samples(
				builder,
				raw_object.hit_sound,
				bank,
				primary_point,
				"spinnerspin",
				1,
			)
			for index in 0 ..< int(total) {
				component := prepared.Component {
					id = u32(index),
					kind = index < int(object.spins_required + 2) ? .SpinnerTick : .SpinnerBonusTick,
					time_ms = object.time_ms + f64(f32(index + 1) / f32(total)) * (object.end_time_ms - object.time_ms),
					position = {},
				}
				if component.kind == .SpinnerBonusTick {
					selected := u32(1)
					for bit in ([3]u32{4, 2, 8}) {
						if raw_object.hit_sound & bit != 0 {
							selected = bit
							break
						}
					}
					component.samples = make_samples(
						builder,
						raw_object.hit_sound,
						bank,
						primary_point,
						"spinnerbonus",
						selected,
					)
				}
				if builder.fill && builder.error.status == .OK {
					object.components[index] = component
				}
			}
		}
	}
	if builder.fill && builder.error.status == .OK {
		for &component in object.components {
			component.event_time_ms = component.time_ms
			if component.kind == .Repeat {
				component.event_time_ms = component.span_start_ms + object.span_duration
			}
		}
	}
	return object
}

slider_components :: proc(
	builder: ^Map_Builder,
	object: ^prepared.Object,
	raw_object: ^beatmap_decode.Raw_Object,
	points: ^Points,
	path: ^Path,
	legacy_duration: f64,
	scratch: ^Prepare_Scratch,
	bank: Sample_Bank,
) -> []prepared.Component {
	length := min(100000, object.path_distance)
	tick_spacing := object.generate_ticks ? clamp(object.tick_distance, 0, length) : length
	tick_count := 0
	if tick_spacing > 0 {
		distance := tick_spacing
		for distance <= length && distance < length - object.velocity * 10 {
			tick_count += 1
			if tick_count > int(MAX_COMPONENTS) {
				builder.error = {
					status = .QUOTA_EXCEEDED,
					code = .PATH,
				}
				return nil
			}
			distance += tick_spacing
		}
	}
	count := u64(object.spans) * u64(tick_count) + u64(object.spans) + 2
	if count > MAX_COMPONENTS {
		builder.error = {
			status = .QUOTA_EXCEEDED,
			code = .PATH,
			requested = count,
			limit = MAX_COMPONENTS,
		}
		return nil
	}
	builder.component_count += count
	result := map_take(builder, prepared.Component, count)
	if builder.error.status != .OK {
		return nil
	}
	output_index := 0
	for span := u32(0); span < object.spans; span += 1 {
		span_start := object.time_ms + f64(span) * object.span_duration
		if span == 0 {
			samples := node_samples(builder, scratch, 0, query(points.sample, .SAMPLE, object.time_ms + 5))
			if builder.fill && builder.error.status == .OK {
				result[output_index] = {
					id = u32(output_index),
					kind = .Head,
					time_ms = object.time_ms,
					span_start_ms = object.time_ms,
					position = object.position,
					samples = samples,
				}
			}
			output_index += 1
		}
		// Accumulate forward distances exactly as upstream, then reverse the emitted slice.
		tick_start := output_index
		distance := tick_spacing
		for _ in 0 ..< tick_count {
			progress := distance / length
			time_progress := span % 2 == 1 ? 1 - progress : progress
			position, _ := position_at(path, progress)
			samples := make_samples(
				builder,
				raw_object.hit_sound,
				bank,
				query(points.sample, .SAMPLE, object.time_ms + 6),
				"slidertick",
				1,
			)
			if builder.fill && builder.error.status == .OK {
				result[output_index] = {
					id = u32(output_index),
					kind = .Tick,
					time_ms = span_start + time_progress * object.span_duration,
					span_start_ms = span_start,
					progress = progress,
					span_index = span,
					position = to64(to32(object.position) + to32(position)),
					samples = samples,
				}
			}
			output_index += 1
			distance += tick_spacing
		}
		if builder.fill && builder.error.status == .OK && span % 2 == 1 {
			slice.reverse(result[tick_start:output_index])
			for &component, index in result[tick_start:output_index] {
				component.id = u32(tick_start + index)
			}
		}
		if span + 1 < object.spans {
			progress := f64((span + 1) % 2)
			position, _ := position_at(path, progress)
			samples := node_samples(
				builder,
				scratch,
				span + 1,
				query(
					points.sample,
					.SAMPLE,
					object.time_ms + f64(span + 1) * legacy_duration / f64(object.spans) + 5,
				),
			)
			if builder.fill && builder.error.status == .OK {
				result[output_index] = {
					id = u32(output_index),
					kind = .Repeat,
					time_ms = object.time_ms + f64(span + 1) * object.span_duration,
					span_start_ms = span_start,
					progress = progress,
					span_index = span,
					position = to64(to32(object.position) + to32(position)),
					samples = samples,
				}
			}
			output_index += 1
		}
	}
	final_span_start := object.time_ms + f64(object.spans - 1) * object.span_duration
	legacy_time := max(
		object.time_ms + f64(object.spans) * object.span_duration / 2,
		final_span_start + object.span_duration - 36,
	)
	progress := object.span_duration == 0 ? 0 : (legacy_time - final_span_start) / object.span_duration
	if object.spans % 2 == 0 {
		progress = 1 - progress
	}
	legacy_position, _ := position_at(path, progress)
	if builder.fill && builder.error.status == .OK {
		result[output_index] = {
			id = u32(output_index),
			kind = .LegacyLastTick,
			time_ms = legacy_time,
			span_start_ms = final_span_start,
			progress = progress,
			span_index = object.spans - 1,
			position = to64(to32(object.position) + to32(legacy_position)),
		}
		result[output_index + 1] = {
			id = u32(output_index + 1),
			kind = .Tail,
			time_ms = object.time_ms + f64(object.spans) * object.span_duration,
			span_start_ms = final_span_start,
			progress = f64(object.spans % 2),
			span_index = object.spans - 1,
			position = object.end_position,
		}
	}
	return result
}

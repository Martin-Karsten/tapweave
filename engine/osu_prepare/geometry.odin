// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// Source-informed port of pinned SliderPath and PathApproximator algorithms.
// See ../reference/geometry/manifest.json and ../reference/sources/*LICENCE.
package osu_prepare

import "core:math"

// Geometry-only API. No decoder, timing, session, or production ABI assumptions.
Position_F64 :: [2]f64
Position_F32 :: [2]f32
Path_Kind :: enum {
	None,
	Linear,
	Bezier,
	Catmull,
	Perfect,
}

Control_Point :: struct {
	position: Position_F64,
	kind: Path_Kind, // None continues a segment; a marker ends/starts at this point.
	degree: u32, // Bezier: 0 means full degree; positive means clamped uniform B-spline.
}

Geometry_Status :: enum {
	OK,
	Invalid_Input,
	Buffer_Too_Small,
	Work_Limit,
	Numeric_Error,
}

Geometry_Options :: struct {
	adjust_length: bool,
	expected_length: f64,
	optimise_catmull: bool, // Explicit for standalone geometry; prepare_map selects the upstream mode.
	work_limit: u64,
}

Geometry_Workspace :: struct {
	vertices: []Position_F64,
	cumulative: []f64, // At least vertices capacity + 1 (duplicate-tail upstream case).
	segment_ends: []f64,
	scratch: []Position_F32, // At least 4 * control point count, reused by each segment.
	stack: []Position_F32, // Flattening stack; each frame uses control point count slots.
}

// Borrows workspace memory until it is reused. Never reuse a published path's
// workspace for a replacement candidate. Failure publishes an empty Path, but
// may overwrite candidate workspace; inputs/workspace slices must not overlap.
Path :: struct {
	vertices: []Position_F64,
	cumulative: []f64,
	segment_ends: []f64, // Pre-adjustment distances, matching upstream GetSegmentEnds.
	calculated_length, distance: f64,
}

Builder :: struct {
	workspace: Geometry_Workspace,
	vertex_count, segment_end_count: int,
	remaining_work: u64,
	status: Geometry_Status,
	skip_first: bool,
	optimised_length: f64,
}

to32 :: proc(position: Position_F64) -> Position_F32 {
	return {f32(position[0]), f32(position[1])}
}

to64 :: proc(position: Position_F32) -> Position_F64 {
	return {f64(position[0]), f64(position[1])}
}

finite :: proc(value: f64) -> bool {
	return !math.is_nan(value) && !math.is_inf(value)
}

length32 :: proc(vector: Position_F32) -> f32 {
	return f32(math.sqrt(f64(vector[0] * vector[0] + vector[1] * vector[1])))
}

spend :: proc(builder: ^Builder, work_cost: u64) -> bool {
	if builder.status != .OK {
		return false
	}
	if work_cost > builder.remaining_work {
		builder.status = .Work_Limit
		return false
	}
	builder.remaining_work -= work_cost
	return true
}

emit :: proc(builder: ^Builder, vertex: Position_F32) {
	if !spend(builder, 1) {
		return
	}
	if !finite(f64(vertex[0])) || !finite(f64(vertex[1])) {
		builder.status = .Numeric_Error
		return
	}
	if builder.skip_first {
		builder.skip_first = false
		if builder.vertex_count > 0 && builder.workspace.vertices[builder.vertex_count - 1] == to64(vertex) {
			return
		}
	}
	if builder.vertex_count == len(builder.workspace.vertices) {
		builder.status = .Buffer_Too_Small
		return
	}
	builder.workspace.vertices[builder.vertex_count] = to64(vertex)
	builder.vertex_count += 1
}

build_path :: proc(
	control_points: []Control_Point,
	options: Geometry_Options,
	workspace: Geometry_Workspace,
	remaining_work: ^u64 = nil,
) -> (
	Path,
	Geometry_Status,
) {
	control_point_count := len(control_points)
	if options.adjust_length && (!finite(options.expected_length) || options.expected_length < 0) {
		return {}, .Invalid_Input
	}
	// Division avoids unchecked multiplication on wasm32.
	if len(workspace.scratch) / 4 < control_point_count ||
	   (control_point_count > 0 && len(workspace.stack) / control_point_count < 1) ||
	   len(workspace.cumulative) <= len(workspace.vertices) ||
	   len(workspace.segment_ends) < control_point_count {
		return {}, .Buffer_Too_Small
	}
	for control_point in control_points {
		if control_point.kind < .None ||
		   control_point.kind > .Perfect ||
		   (control_point.kind != .Bezier && control_point.degree != 0) {
			return {}, .Invalid_Input
		}
		for coordinate in control_point.position {
			if !finite(coordinate) || !finite(f64(f32(coordinate))) {
				return {}, .Invalid_Input
			}
		}
	}
	available_work := options.work_limit
	if remaining_work != nil {
		available_work = min(available_work, remaining_work^)
	}
	builder := Builder {
		workspace = workspace,
		remaining_work = available_work,
	}
	defer {
		if remaining_work != nil {
			remaining_work^ -= available_work - builder.remaining_work
		}
	}
	segment_start_index := 0
	for control_point, control_point_index in control_points {
		if control_point.kind == .None && control_point_index < control_point_count - 1 {
			continue
		}
		segment := control_points[segment_start_index:control_point_index + 1]
		if len(segment) == 1 {
			emit(&builder, to32(segment[0].position))
		} else {
			builder.skip_first = true
			subpath(&builder, segment, options.optimise_catmull)
		}
		if builder.status != .OK {
			return {}, builder.status
		}
		if control_point_index > 0 {
			builder.workspace.segment_ends[builder.segment_end_count] = f64(builder.vertex_count - 1)
			builder.segment_end_count += 1
		}
		segment_start_index = control_point_index
	}
	calculated_length := builder.optimised_length
	cumulative_count := 1
	workspace.cumulative[0] = 0
	for vertex_index in 0 ..< builder.vertex_count - 1 {
		calculated_length += f64(
			length32(
				to32(workspace.vertices[vertex_index + 1]) -
				to32(workspace.vertices[vertex_index]),
			),
		)
		if !finite(calculated_length) {
			return {}, .Numeric_Error
		}
		workspace.cumulative[cumulative_count] = calculated_length
		cumulative_count += 1
	}
	for &segment_end_distance in workspace.segment_ends[:builder.segment_end_count] {
		segment_end_distance = workspace.cumulative[int(segment_end_distance)]
	}
	if options.adjust_length && calculated_length != options.expected_length {
		expected_length := options.expected_length
		if builder.vertex_count >= 2 &&
		   workspace.vertices[builder.vertex_count - 1] == workspace.vertices[builder.vertex_count - 2] &&
		   expected_length > calculated_length {
			// Upstream intentionally does not extend an equal final pair.
			workspace.cumulative[cumulative_count] = calculated_length
			cumulative_count += 1
		} else {
			cumulative_count -= 1
			path_end_index := builder.vertex_count - 1
			if calculated_length > expected_length {
				for cumulative_count > 0 && workspace.cumulative[cumulative_count - 1] >= expected_length {
					cumulative_count -= 1
					builder.vertex_count -= 1
					path_end_index -= 1
				}
			}
			if path_end_index <= 0 {
				workspace.cumulative[cumulative_count] = 0
				cumulative_count += 1
			} else {
				segment_delta :=
					to32(workspace.vertices[path_end_index]) - to32(workspace.vertices[path_end_index - 1])
				segment_length := length32(segment_delta)
				if segment_length == 0 || !finite(f64(segment_length)) {
					return {}, .Numeric_Error
				}
				direction := segment_delta * (f32(1) / segment_length)
				adjusted_endpoint :=
					to32(workspace.vertices[path_end_index - 1]) +
					direction * f32(expected_length - workspace.cumulative[cumulative_count - 1])
				if !finite(f64(adjusted_endpoint[0])) || !finite(f64(adjusted_endpoint[1])) {
					return {}, .Numeric_Error
				}
				workspace.vertices[path_end_index] = to64(adjusted_endpoint)
				workspace.cumulative[cumulative_count] = expected_length
				cumulative_count += 1
			}
		}
	}
	return Path {
			workspace.vertices[:builder.vertex_count],
			workspace.cumulative[:cumulative_count],
			workspace.segment_ends[:builder.segment_end_count],
			calculated_length,
			workspace.cumulative[cumulative_count - 1],
		},
		.OK
}

position_at :: proc(path: ^Path, progress: f64) -> (Position_F64, Geometry_Status) {
	if !finite(progress) {
		return {}, .Invalid_Input
	}
	if len(path.vertices) == 0 {
		return {}, .OK
	}
	target_distance := clamp(progress, 0, 1) * path.distance
	// Match .NET BinarySearch's equal-item selection, including duplicate lengths.
	lower_index, upper_index, vertex_index := 0, len(path.cumulative) - 1, 0
	for lower_index <= upper_index {
		middle_index := lower_index + (upper_index - lower_index) / 2
		if path.cumulative[middle_index] == target_distance {
			vertex_index = middle_index
			break
		}
		if path.cumulative[middle_index] < target_distance {
			lower_index = middle_index + 1
		} else {
			upper_index = middle_index - 1
		}
		vertex_index = lower_index
	}
	if vertex_index <= 0 {
		return path.vertices[0], .OK
	}
	if vertex_index >= len(path.vertices) {
		return path.vertices[len(path.vertices) - 1], .OK
	}
	previous_distance, next_distance := path.cumulative[vertex_index - 1], path.cumulative[vertex_index]
	if abs(previous_distance - next_distance) <= 1e-7 {
		return path.vertices[vertex_index - 1], .OK
	}
	previous_vertex, next_vertex := to32(path.vertices[vertex_index - 1]), to32(path.vertices[vertex_index])
	return to64(
			previous_vertex +
			(next_vertex - previous_vertex) *
				f32((target_distance - previous_distance) / (next_distance - previous_distance)),
		),
		.OK
}

subpath :: proc(builder: ^Builder, control_points: []Control_Point, optimise_catmull: bool) {
	segment_kind := control_points[0].kind
	if segment_kind == .None {
		segment_kind = .Linear
	}
	#partial switch segment_kind {
	case .Linear:
		for control_point in control_points {
			emit(builder, to32(control_point.position))
			if builder.status != .OK {
				return
			}
		}
	case .Catmull:
		catmull(builder, control_points, optimise_catmull)
	case .Perfect:
		if len(control_points) == 3 && arc(builder, control_points) {
			return
		}
		bspline(builder, control_points, 0)
	case .Bezier:
		bspline(builder, control_points, control_points[0].degree)
	case:
		builder.status = .Invalid_Input
	}
}

// All f32 intermediate operations below preserve upstream Vector2 arithmetic;
// the public path exposes their values as f64 without inventing extra precision.
subdivide :: proc(parent_points, left_points, right_points, midpoints: []Position_F32) {
	control_point_count := len(parent_points)
	copy(midpoints, parent_points)
	for subdivision_index in 0 ..< control_point_count {
		left_points[subdivision_index] = midpoints[0]
		right_points[control_point_count - subdivision_index - 1] =
			midpoints[control_point_count - subdivision_index - 1]
		for midpoint_index in 0 ..< control_point_count - subdivision_index - 1 {
			midpoints[midpoint_index] = (midpoints[midpoint_index] + midpoints[midpoint_index + 1]) / 2
		}
	}
}

flatten :: proc(builder: ^Builder, control_points: []Position_F32, stack_frame_stride: int) {
	control_point_count := len(control_points)
	subdivision_scratch := builder.workspace.scratch[stack_frame_stride:2 * stack_frame_stride]
	combined_points := builder.workspace.scratch[2 * stack_frame_stride:4 * stack_frame_stride]
	copy(builder.workspace.stack[:control_point_count], control_points)
	pending_frame_count := 1
	for pending_frame_count > 0 {
		if !spend(builder, u64(control_point_count) * u64(control_point_count) + 1) {
			return
		}
		parent_points := builder.workspace.stack[(pending_frame_count - 1) *
		stack_frame_stride:][:control_point_count]
		is_flat_enough := true
		for control_point_index in 1 ..< control_point_count - 1 {
			second_difference :=
				parent_points[control_point_index - 1] -
				2 * parent_points[control_point_index] +
				parent_points[control_point_index + 1]
			if second_difference[0] * second_difference[0] + second_difference[1] * second_difference[1] >
			   f32(0.25) {
				is_flat_enough = false
				break
			}
		}
		if is_flat_enough {
			subdivide(
				parent_points,
				combined_points[:control_point_count],
				combined_points[control_point_count:][:control_point_count],
				subdivision_scratch[:control_point_count],
			)
			// Combine left and right, omitting their shared midpoint.
			for control_point_index in 0 ..< control_point_count - 1 {
				combined_points[control_point_count + control_point_index] =
					combined_points[control_point_count + control_point_index + 1]
			}
			emit(builder, parent_points[0])
			for control_point_index in 1 ..< control_point_count - 1 {
				emit(
					builder,
					f32(0.25) *
					(combined_points[2 * control_point_index - 1] +
							2 * combined_points[2 * control_point_index] +
							combined_points[2 * control_point_index + 1]),
				)
			}
			if builder.status != .OK {
				return
			}
			pending_frame_count -= 1
		} else {
			if pending_frame_count >= len(builder.workspace.stack) / stack_frame_stride {
				builder.status = .Buffer_Too_Small
				return
			}
			next_frame := builder.workspace.stack[pending_frame_count *
			stack_frame_stride:][:control_point_count]
			subdivide(
				parent_points,
				combined_points[:control_point_count],
				parent_points,
				subdivision_scratch[:control_point_count],
			)
			copy(next_frame, combined_points[:control_point_count])
			pending_frame_count += 1
		}
	}
}

bspline :: proc(builder: ^Builder, control_points: []Control_Point, requested_degree: u32) {
	control_point_count := len(control_points)
	degree := control_point_count - 1
	if requested_degree > 0 {
		degree = int(min(u64(requested_degree), u64(degree)))
	}
	knot_points := builder.workspace.scratch[:control_point_count]
	for control_point, knot_index in control_points {
		knot_points[knot_index] = to32(control_point.position)
	}
	// Boehm knot insertion, followed by depth-first Bezier subdivision.
	bezier_segment := builder.workspace.scratch[2 * control_point_count:][:degree + 1]
	for knot_index in 0 ..< control_point_count - 1 - degree {
		bezier_segment[0] = knot_points[knot_index]
		for insertion_index in 0 ..< degree - 1 {
			bezier_segment[insertion_index + 1] = knot_points[knot_index + 1]
			for point_offset in 1 ..< degree - insertion_index {
				if !spend(builder, 1) {
					return
				}
				knot_weight := min(point_offset, control_point_count - 1 - degree - knot_index)
				knot_points[knot_index + point_offset] =
					(f32(knot_weight) * knot_points[knot_index + point_offset] +
						knot_points[knot_index + point_offset + 1]) /
					f32(knot_weight + 1)
			}
		}
		bezier_segment[degree] = knot_points[knot_index + 1]
		flatten(builder, bezier_segment, control_point_count)
		if builder.status != .OK {
			return
		}
	}
	flatten(builder, knot_points[control_point_count - 1 - degree:], control_point_count)
	if builder.status == .OK {
		emit(builder, to32(control_points[control_point_count - 1].position))
	}
}

catmull_point :: proc(
	previous_point, start_point, end_point, next_point: Position_F32,
	progress: f32,
) -> Position_F32 {
	progress_squared := progress * progress
	progress_cubed := progress * progress_squared
	return(
		f32(0.5) *
		(2 * start_point +
				(-previous_point + end_point) * progress +
				(2 * previous_point - 5 * start_point + 4 * end_point - next_point) * progress_squared +
				(-previous_point + 3 * start_point - 3 * end_point + next_point) * progress_cubed) \
	)
}

catmull :: proc(builder: ^Builder, control_points: []Control_Point, optimise_catmull: bool) {
	has_optimisation_start := false
	optimisation_start, previous_sample: Position_F32
	accumulated_segment_length: f64
	sample_index: u64
	sample_count := u64(len(control_points) - 1) * 100
	for segment_index in 0 ..< len(control_points) - 1 {
		previous_point := to32(control_points[max(0, segment_index - 1)].position)
		start_point := to32(control_points[segment_index].position)
		end_point := to32(control_points[segment_index + 1].position)
		next_point := end_point + end_point - start_point
		if segment_index < len(control_points) - 2 {
			next_point = to32(control_points[segment_index + 2].position)
		}
		for step in 0 ..< 50 {
			for sample_edge in 0 ..< 2 {
				if !spend(builder, 1) {
					return
				}
				sample_position := catmull_point(
					previous_point,
					start_point,
					end_point,
					next_point,
					f32(step + sample_edge) / 50,
				)
				if !optimise_catmull {
					emit(builder, sample_position)
				} else if !has_optimisation_start {
					emit(builder, sample_position)
					optimisation_start = sample_position
					has_optimisation_start = true
				} else {
					distance_from_start := f64(length32(sample_position - optimisation_start))
					accumulated_segment_length += f64(length32(sample_position - previous_sample))
					if distance_from_start > 6 ||
					   (sample_index + 1) % 100 == 0 ||
					   sample_index + 1 == sample_count {
						emit(builder, sample_position)
						builder.optimised_length += accumulated_segment_length - distance_from_start
						has_optimisation_start = false
						accumulated_segment_length = 0
					}
				}
				if builder.status != .OK {
					return
				}
				previous_sample = sample_position
				sample_index += 1
			}
		}
	}
}

arc :: proc(builder: ^Builder, control_points: []Control_Point) -> bool {
	start_point, middle_point, end_point :=
		to32(control_points[0].position), to32(control_points[1].position), to32(control_points[2].position)
	triangle_cross_product :=
		(middle_point[1] - start_point[1]) * (end_point[0] - start_point[0]) -
		(middle_point[0] - start_point[0]) * (end_point[1] - start_point[1])
	if abs(triangle_cross_product) <= f32(1e-3) {
		return false
	}
	centre_denominator :=
		2 *
		(start_point[0] * (middle_point - end_point)[1] +
				middle_point[0] * (end_point - start_point)[1] +
				end_point[0] * (start_point - middle_point)[1])
	start_squared_length := start_point[0] * start_point[0] + start_point[1] * start_point[1]
	middle_squared_length := middle_point[0] * middle_point[0] + middle_point[1] * middle_point[1]
	end_squared_length := end_point[0] * end_point[0] + end_point[1] * end_point[1]
	centre :=
		Position_F32 {
			start_squared_length * (middle_point - end_point)[1] +
			middle_squared_length * (end_point - start_point)[1] +
			end_squared_length * (start_point - middle_point)[1],
			start_squared_length * (end_point - middle_point)[0] +
			middle_squared_length * (start_point - end_point)[0] +
			end_squared_length * (middle_point - start_point)[0],
		} /
		centre_denominator
	start_from_centre, end_from_centre := start_point - centre, end_point - centre
	radius := length32(start_from_centre)
	if !finite(f64(radius)) || radius == 0 {
		builder.status = .Numeric_Error
		return true
	}
	start_angle := math.atan2(f64(start_from_centre[1]), f64(start_from_centre[0]))
	end_angle := math.atan2(f64(end_from_centre[1]), f64(end_from_centre[0]))
	for end_angle < start_angle {
		end_angle += 2 * math.PI
	}
	direction: f64 = 1
	angular_extent := end_angle - start_angle
	start_to_end, start_to_middle := end_point - start_point, middle_point - start_point
	if start_to_end[1] * start_to_middle[0] - start_to_end[0] * start_to_middle[1] < 0 {
		direction = -1
		angular_extent = 2 * math.PI - angular_extent
	}
	sample_count: f64 = 2
	if 2 * radius > f32(0.1) {
		sample_count = max(2, math.ceil(angular_extent / (2 * math.acos(f64(f32(1) - f32(0.1) / radius)))))
	}
	// SliderPath's large-arc fallback (not a guessed geometry quota).
	if !finite(sample_count) || sample_count >= 1000 {
		return false
	}
	for sample_index in 0 ..< int(sample_count) {
		angle := start_angle + direction * (f64(sample_index) / (sample_count - 1)) * angular_extent
		emit(builder, centre + Position_F32{f32(math.cos(angle)), f32(math.sin(angle))} * radius)
		if builder.status != .OK {
			return true
		}
	}
	return true
}

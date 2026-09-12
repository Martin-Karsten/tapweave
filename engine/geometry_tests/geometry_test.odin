package geometry_tests

import "core:testing"
import "core:mem"
import "core:math"
import geometry "../osu_prepare"

create_workspace :: proc(control_point_count: int, vertex_capacity := 4096) -> geometry.Geometry_Workspace {
	return {
		make([]geometry.Position_F64, vertex_capacity),
		make([]f64, vertex_capacity + 1),
		make([]f64, control_point_count),
		make([]geometry.Position_F32, 4 * control_point_count),
		make([]geometry.Position_F32, 64 * control_point_count),
	}
}

destroy_workspace :: proc(workspace: ^geometry.Geometry_Workspace) {
	delete(workspace.vertices)
	delete(workspace.cumulative)
	delete(workspace.segment_ends)
	delete(workspace.scratch)
	delete(workspace.stack)
	workspace^ = {}
}

DEFAULT_OPTIONS :: geometry.Geometry_Options {
	work_limit = 10_000_000,
}

@(test)
linear_lengths_queries_and_adjustment :: proc(test: ^testing.T) {
	points := []geometry.Control_Point{{{0, 0}, .Linear, 0}, {{3, 4}, .None, 0}, {{6, 4}, .None, 0}}
	workspace := create_workspace(len(points))
	defer destroy_workspace(&workspace)
	path, status := geometry.build_path(points, DEFAULT_OPTIONS, workspace)
	testing.expect_value(test, status, geometry.Geometry_Status.OK)
	testing.expect_value(test, path.distance, 8)
	position, _ := geometry.position_at(&path, 0.5)
	testing.expect(test, abs(position[0] - 2.4) < 1e-6 && abs(position[1] - 3.2) < 1e-6)
	options := DEFAULT_OPTIONS
	options.adjust_length = true
	options.expected_length = 6
	path, status = geometry.build_path(points, options, workspace)
	testing.expect_value(test, status, geometry.Geometry_Status.OK)
	position, _ = geometry.position_at(&path, 1)
	testing.expect_value(test, position, geometry.Position_F64{4, 4})
	testing.expect_value(test, path.calculated_length, 8)
	testing.expect_value(test, path.segment_ends[0], 8)
	options.expected_length = 10
	path, status = geometry.build_path(points, options, workspace)
	position, _ = geometry.position_at(&path, 2)
	testing.expect_value(test, position, geometry.Position_F64{8, 4})
	options.expected_length = 0
	path, status = geometry.build_path(points, options, workspace)
	testing.expect_value(test, status, geometry.Geometry_Status.OK)
	testing.expect_value(test, path.distance, 0)
	testing.expect_value(test, len(path.vertices), 1)
}

@(test)
duplicate_tail_and_empty_path :: proc(test: ^testing.T) {
	points := []geometry.Control_Point{{{0, 0}, .Linear, 0}, {{10, 0}, .None, 0}, {{10, 0}, .None, 0}}
	workspace := create_workspace(len(points))
	defer destroy_workspace(&workspace)
	options := DEFAULT_OPTIONS
	options.adjust_length = true
	options.expected_length = 20
	path, status := geometry.build_path(points, options, workspace)
	testing.expect_value(test, status, geometry.Geometry_Status.OK)
	testing.expect_value(test, path.distance, 10)
	testing.expect_value(test, len(path.cumulative), len(path.vertices) + 1)
	path, status = geometry.build_path(nil, options, workspace)
	testing.expect_value(test, status, geometry.Geometry_Status.OK)
	testing.expect_value(test, path.distance, 0)
	position, _ := geometry.position_at(&path, 1)
	testing.expect_value(test, position, geometry.Position_F64{})
}

@(test)
curve_endpoints_and_mixed_segments :: proc(test: ^testing.T) {
	points := []geometry.Control_Point {
		{{0, 0}, .Bezier, 0},
		{{50, 100}, .None, 0},
		{{100, 0}, .Linear, 0},
		{{200, 0}, .None, 0},
	}
	workspace := create_workspace(len(points))
	defer destroy_workspace(&workspace)
	path, status := geometry.build_path(points, DEFAULT_OPTIONS, workspace)
	testing.expect_value(test, status, geometry.Geometry_Status.OK)
	testing.expect_value(test, len(path.segment_ends), 2)
	testing.expect_value(test, path.vertices[0], geometry.Position_F64{0, 0})
	testing.expect_value(test, path.vertices[len(path.vertices) - 1], geometry.Position_F64{200, 0})
	testing.expect(test, path.segment_ends[0] > 100)
	testing.expect(test, abs(path.distance - path.segment_ends[0] - 100) < 1e-5)
	for length_index in 1 ..< len(path.cumulative) {
		testing.expect(test, path.cumulative[length_index] >= path.cumulative[length_index - 1])
	}
}

@(test)
bounded_failure_and_preserved_previous_path :: proc(test: ^testing.T) {
	points := []geometry.Control_Point{{{0, 0}, .Bezier, 0}, {{50, 100}, .None, 0}, {{100, 0}, .None, 0}}
	original_workspace := create_workspace(len(points))
	defer destroy_workspace(&original_workspace)
	original_path, status := geometry.build_path(points, DEFAULT_OPTIONS, original_workspace)
	testing.expect_value(test, status, geometry.Geometry_Status.OK)
	previous_distance := original_path.distance
	previous_midpoint, _ := geometry.position_at(&original_path, 0.5)
	small_workspace := create_workspace(len(points), 1)
	defer destroy_workspace(&small_workspace)
	failed_path, failure_status := geometry.build_path(points, DEFAULT_OPTIONS, small_workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.Buffer_Too_Small)
	testing.expect_value(test, len(failed_path.vertices), 0)
	testing.expect_value(test, original_path.distance, previous_distance)
	preserved_midpoint, _ := geometry.position_at(&original_path, 0.5)
	testing.expect_value(test, preserved_midpoint, previous_midpoint)
	options := DEFAULT_OPTIONS
	options.work_limit = 1
	failed_path, failure_status = geometry.build_path(points, options, small_workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.Work_Limit)
	testing.expect_value(test, len(failed_path.vertices), 0)
	small_workspace.vertices = small_workspace.vertices[:0]
	failed_path, failure_status = geometry.build_path(points, DEFAULT_OPTIONS, small_workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.Buffer_Too_Small)
}

@(test)
invalid_values_and_scratch_capacity :: proc(test: ^testing.T) {
	points := []geometry.Control_Point{{{0, 0}, .Perfect, 0}, {{50, 50}, .None, 0}, {{100, 0}, .None, 0}}
	workspace := create_workspace(len(points))
	defer destroy_workspace(&workspace)
	options := DEFAULT_OPTIONS
	options.adjust_length = true
	options.expected_length = -1
	_, failure_status := geometry.build_path(points, options, workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.Invalid_Input)
	points[1].position[0] = math.nan_f64()
	_, failure_status = geometry.build_path(points, DEFAULT_OPTIONS, workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.Invalid_Input)
	points[1].position[0] = math.inf_f64(1)
	_, failure_status = geometry.build_path(points, DEFAULT_OPTIONS, workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.Invalid_Input)
	points[1].position[0] = 50
	short_workspace := workspace
	short_workspace.scratch = short_workspace.scratch[:1]
	_, failure_status = geometry.build_path(points, DEFAULT_OPTIONS, short_workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.Buffer_Too_Small)
	points[0].kind = .Bezier
	short_workspace = workspace
	short_workspace.stack = short_workspace.stack[:len(points)]
	_, failure_status = geometry.build_path(points, DEFAULT_OPTIONS, short_workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.Buffer_Too_Small)
	points[0].degree = 0xffff_ffff // Clamps without converting an overflowing u32 to wasm32 int.
	_, failure_status = geometry.build_path(points, DEFAULT_OPTIONS, workspace)
	testing.expect_value(test, failure_status, geometry.Geometry_Status.OK)
}

@(test)
geometry_does_not_allocate :: proc(test: ^testing.T) {
	points := []geometry.Control_Point{{{0, 0}, .Bezier, 0}, {{50, 100}, .None, 0}, {{100, 0}, .None, 0}}
	workspace := create_workspace(len(points))
	defer destroy_workspace(&workspace)
	status: geometry.Geometry_Status
	kinds := []geometry.Path_Kind{.Linear, .Bezier, .Catmull, .Perfect}
	{
		context.allocator = mem.panic_allocator()
		for kind in kinds {
			points[0].kind = kind
			for _ in 0 ..< 50 {
				_, status = geometry.build_path(points, DEFAULT_OPTIONS, workspace)
				if status != .OK {
					break
				}
			}
		}
	}
	testing.expect_value(test, status, geometry.Geometry_Status.OK)
}

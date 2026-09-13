package tests

import "core:testing"
import "core:mem"
import "core:math"
import presentation "../presentation"
import prepared "../prepared"
import core_types "../core_types"
import engine_runtime "../runtime"
import render_webgl "../render_webgl"

@(test)
scene_mesh_count_fill_degenerate_reversals_and_clipping :: proc(test: ^testing.T) {
	points := [5]prepared.Position{{0, 0}, {0, 0}, {100, 0}, {0, 0}, {0, 100}}
	lengths := [5]f64{0, 0, 100, 200, 300}
	object := prepared.Object{kind = .SLIDER, radius = 32, path_distance = 300,
		vertices = points[:], cumulative = lengths[:], time_ms = 1000, end_time_ms = 2000,
		preempt_ms = 1200, spans = 2}
	count := render_webgl.Mesh_Builder{valid = true}
	render_webgl.quad(&count)
	expected := render_webgl.path(&count, &object)
	vertices := make([]render_webgl.Vertex, count.vertex_count)
	defer delete(vertices)
	indices := make([]u32, count.index_count)
	defer delete(indices)
	context.allocator = mem.panic_allocator()
	builder := render_webgl.Mesh_Builder{valid = true, vertices = vertices, indices = indices}
	render_webgl.quad(&builder)
	actual := render_webgl.path(&builder, &object)
	testing.expect_value(test, actual, expected)
	testing.expect_value(test, builder.vertex_count, count.vertex_count)
	testing.expect_value(test, builder.index_count, count.index_count)
	testing.expect(test, builder.valid)
	for vertex in vertices {
		for coordinate in vertex {
			testing.expect(test, !math.is_nan(coordinate) && !math.is_inf(coordinate))
		}
		testing.expect(test, vertex[2] >= 0 && vertex[2] <= 1)
	}
	for vertex_index in indices {
		testing.expect(test, int(vertex_index) < len(vertices))
	}
	clip_start, clip_end := presentation.slider_clip(&object, false, 0)
	testing.expect_value(test, clip_start, 0.0)
	testing.expect_value(test, clip_end, 0.5)
	clip_start, clip_end = presentation.slider_clip(&object, true, 1750)
	testing.expect_value(test, clip_start, 0.0)
	testing.expect_value(test, clip_end, 0.5)
	clip_start, clip_end = presentation.slider_clip(&object, false, 1750)
	testing.expect_value(test, clip_start, 0.0)
	testing.expect_value(test, clip_end, 1.0)
}

// Port of TestSceneSliderSnaking.TestSnakingEnabled(0,1,2), pinned osu!
// 3c1c96f742e7aae2ff67a7361e058fe91ca3b955. Copyright ppy Pty Ltd, MIT.
// Replaces Player/autoplay/seek with prepared data and semantic head success.
// Preserves the three repeat cases, +100/+200 sample times and directional
// assertions. Disabled snaking is outside the default profile.
@(test)
scene_snaking_enabled_upstream_assertion_port :: proc(test: ^testing.T) {
	points := [2]prepared.Position{{0, 0}, {300, 200}}
	length := math.sqrt(300.0 * 300 + 200.0 * 200)
	lengths := [2]f64{0, length}
	for slider_index in 0 ..< 3 {
		object := prepared.Object{kind = .SLIDER, position = {100, 100}, time_ms = 3000 + f64(slider_index) * 10000,
			preempt_ms = 1200, spans = u32(slider_index + 1), span_duration = 3605,
			vertices = points[:], cumulative = lengths[:], path_distance = length}
		object.end_time_ms = object.time_ms + object.span_duration * f64(object.spans)
		_, initial_end := presentation.slider_clip(&object, true, object.time_ms - 1200)
		_, later_end := presentation.slider_clip(&object, true, object.time_ms - 1100)
		initial_position := presentation.path_position(&object, initial_end)
		later_position := presentation.path_position(&object, later_end)
		testing.expect(test, later_position[0] > initial_position[0] && later_position[1] > initial_position[1])
		for span_index in 0 ..< slider_index + 1 {
			start_ms := object.time_ms + 100 + object.span_duration * f64(span_index)
			initial_start, initial_finish := presentation.slider_clip(&object, true, start_ms)
			later_start, later_finish := presentation.slider_clip(&object, true, start_ms + 100)
			if span_index < slider_index {
				testing.expect_value(test, initial_start, later_start)
				testing.expect_value(test, initial_finish, later_finish)
			} else if span_index % 2 == 0 {
				testing.expect(test, later_start > initial_start)
			} else {
				testing.expect(test, later_finish < initial_finish)
			}
		}
	}
}

@(test)
scene_attachment_allocation_failures_are_transactional :: proc(test: ^testing.T) {
	fault := Fault_State{context.allocator, 100}
	allocator := mem.Allocator{fault_allocator, &fault}
	instance, _ := engine_runtime.instance_create(16, allocator)
	defer testing.expect_value(test, engine_runtime.instance_destroy(&instance), core_types.Status.OK)
	owner, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, owner)
	map_handle, error := engine_runtime.map_prepare(&instance, owner,
		"osu file format v14\n[HitObjects]\n100,100,1000,2,0,L|300:200,1,230", true)
	testing.expect_value(test, error.status, core_types.Status.OK)
	if error.status != .OK {
		return
	}
	map_resource, _ := engine_runtime.map_get(&instance, owner, map_handle)
	digest := map_resource.prepared_map.prepared_digest
	for allowed_allocations in 0 ..< 2 {
		fault.remaining = allowed_allocations
		testing.expect_value(test, engine_runtime.scene_resource_create(&instance, owner, map_handle), core_types.Status.OUT_OF_MEMORY)
		testing.expect_value(test, len(map_resource.scene_attachment.bytes), 0)
		testing.expect_value(test, map_resource.prepared_map.prepared_digest, digest)
	}
	fault.remaining = 100
	testing.expect_value(test, engine_runtime.scene_resource_create(&instance, owner, map_handle), core_types.Status.OK)
	resource_pointer := raw_data(map_resource.scene_attachment.bytes)
	fault.remaining = 0
	testing.expect_value(test, engine_runtime.scene_resource_create(&instance, owner, map_handle), core_types.Status.OK)
	testing.expect(test, raw_data(map_resource.scene_attachment.bytes) == resource_pointer)
	fault.remaining = 100
}

// The browser executor trusts engine emission; every instance policy rule and
// the clipping-cap adjacency contract must therefore reject here.
@(test)
scene_policy_validation_rejects_invalid_emissions :: proc(test: ^testing.T) {
	valid_scene := [5]presentation.Instance{
		{primitive = .PATH, layer = 10, object_id = 7, flags = 0, geometry_first = 0, geometry_count = 12, alpha = 1, clip_start = 0, clip_end = 1},
		{primitive = .DISC, layer = 10, object_id = 7, flags = 1, geometry_first = 0, geometry_count = 6, alpha = 0.5},
		{primitive = .DISC, layer = 10, object_id = 7, flags = 1, geometry_first = 0, geometry_count = 6, alpha = 0.5},
		{primitive = .GLYPH, layer = 20, object_id = 7, glyph = 48, geometry_first = 0, geometry_count = 6, alpha = 1},
		{primitive = .DISC, layer = 20, object_id = 7, geometry_first = 0, geometry_count = 6, alpha = 0.7},
	}
	testing.expect_value(test, presentation.validate_scene(valid_scene[:], 12), core_types.Status.OK)
	testing.expect_value(test, presentation.validate_scene(valid_scene[:0], 0), core_types.Status.OK)
	expect_invalid := proc(test: ^testing.T, instances: []presentation.Instance, indices_count: u32) {
		testing.expect_value(test, presentation.validate_scene(instances, indices_count), core_types.Status.INVALID_STATE)
	}
	primitive_out_of_range := valid_scene
	primitive_out_of_range[3].primitive = cast(presentation.Primitive)6
	expect_invalid(test, primitive_out_of_range[:], 12)
	flags_out_of_range := valid_scene
	flags_out_of_range[0].flags = 2
	expect_invalid(test, flags_out_of_range[:], 12)
	cap_on_non_disc := valid_scene
	cap_on_non_disc[1].primitive = .RING
	expect_invalid(test, cap_on_non_disc[:], 12)
	cap_off_coverage_layer := valid_scene
	cap_off_coverage_layer[1].layer = 15
	expect_invalid(test, cap_off_coverage_layer[:], 12)
	empty_geometry := valid_scene
	empty_geometry[3].geometry_count = 0
	expect_invalid(test, empty_geometry[:], 12)
	quad_geometry_misaligned := valid_scene
	quad_geometry_misaligned[3].geometry_count = 4
	expect_invalid(test, quad_geometry_misaligned[:], 12)
	quad_geometry_offset := valid_scene
	quad_geometry_offset[4].geometry_first = 6
	expect_invalid(test, quad_geometry_offset[:], 12)
	geometry_beyond_attachment := valid_scene
	geometry_beyond_attachment[0].geometry_first = 6
	geometry_beyond_attachment[0].geometry_count = 12
	expect_invalid(test, geometry_beyond_attachment[:], 12)
	glyph_beyond_atlas := valid_scene
	glyph_beyond_atlas[3].glyph = 128
	expect_invalid(test, glyph_beyond_atlas[:], 12)
	alpha_above_one := valid_scene
	alpha_above_one[0].alpha = 1.1
	expect_invalid(test, alpha_above_one[:], 12)
	negative_scale := valid_scene
	negative_scale[4].scale_x = -1
	expect_invalid(test, negative_scale[:], 12)
	reversed_clip := valid_scene
	reversed_clip[0].clip_start = 0.5
	reversed_clip[0].clip_end = 0.25
	expect_invalid(test, reversed_clip[:], 12)
	clip_beyond_unit := valid_scene
	clip_beyond_unit[0].clip_end = 1.5
	expect_invalid(test, clip_beyond_unit[:], 12)
	non_finite_position := valid_scene
	non_finite_position[0].x = math.nan_f64()
	expect_invalid(test, non_finite_position[:], 12)
	cap_without_path := [1]presentation.Instance{
		{primitive = .DISC, layer = 10, object_id = 7, flags = 1, geometry_first = 0, geometry_count = 6, alpha = 0.5},
	}
	expect_invalid(test, cap_without_path[:], 12)
	cap_of_other_object := valid_scene
	cap_of_other_object[1].object_id = 8
	expect_invalid(test, cap_of_other_object[:], 12)
	coverage_broken_between_path_and_cap := [5]presentation.Instance{
		valid_scene[0],
		{primitive = .DISC, layer = 10, object_id = 9, flags = 0, geometry_first = 0, geometry_count = 6, alpha = 0.5},
		valid_scene[1],
		valid_scene[3],
		valid_scene[4],
	}
	expect_invalid(test, coverage_broken_between_path_and_cap[:], 12)
}

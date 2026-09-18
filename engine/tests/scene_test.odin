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

// Deserialize the shared kind-30 transform scratch output.
read_transform_output :: proc() -> presentation.Playfield_Transform {
	bytes := engine_runtime.abi_storage.bytes[engine_runtime.ABI_TRANSFORM_OUTPUT_OFFSET:engine_runtime.ABI_TRANSFORM_OUTPUT_OFFSET + engine_runtime.ABI_PLAYFIELD_TRANSFORM_SIZE]
	return {
		scale = engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_SCALE_OFFSET),
		client_left = engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_CLIENT_LEFT_OFFSET),
		client_top = engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_CLIENT_TOP_OFFSET),
		inverse = {
			engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_INVERSE_A_OFFSET),
			engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_INVERSE_B_OFFSET),
			engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_INVERSE_C_OFFSET),
			engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_INVERSE_D_OFFSET),
			engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_INVERSE_E_OFFSET),
			engine_runtime.get_f64(bytes, engine_runtime.ABI_PLAYFIELD_TRANSFORM_INVERSE_F_OFFSET),
		},
	}
}

write_viewport_record :: proc(left, top, width, height, ratio: f64) {
	bytes := engine_runtime.abi_storage.bytes[:engine_runtime.ABI_VIEWPORT_SIZE]
	engine_runtime.put_header(bytes, engine_runtime.ABI_VIEWPORT_KIND, engine_runtime.ABI_VIEWPORT_SIZE)
	engine_runtime.put_f64(bytes, engine_runtime.ABI_VIEWPORT_CSS_LEFT_OFFSET, left)
	engine_runtime.put_f64(bytes, engine_runtime.ABI_VIEWPORT_CSS_TOP_OFFSET, top)
	engine_runtime.put_f64(bytes, engine_runtime.ABI_VIEWPORT_CSS_WIDTH_OFFSET, width)
	engine_runtime.put_f64(bytes, engine_runtime.ABI_VIEWPORT_CSS_HEIGHT_OFFSET, height)
	engine_runtime.put_f64(bytes, engine_runtime.ABI_VIEWPORT_DEVICE_PIXEL_RATIO_OFFSET, ratio)
}

// Scene resources publish the complete visual bounds computed during
// preparation; every session sharing the attachment reuses them, and the
// session transform export fits those bounds with full handle validation.
@(test)
scene_attachment_bounds_and_session_transform_are_validated_and_shared :: proc(test: ^testing.T) {
	testing.expect_value(test, engine_runtime.abi_start(), core_types.Status.OK)
	// ABI exports always resolve against the shared instance.
	instance := &engine_runtime.abi_instance
	owner, _ := engine_runtime.engine_create(instance)
	defer engine_runtime.engine_release(instance, owner)
	map_text := "osu file format v14\n[HitObjects]\n-60,-40,1000,1,0\n560,420,2000,1,0\n100,100,4000,2,0,L|700:520,1,900"
	map_handle, map_error := engine_runtime.map_prepare(instance, owner, map_text, true)
	testing.expect_value(test, map_error.status, core_types.Status.OK)
	if map_error.status != .OK {
		return
	}
	testing.expect_value(test, engine_runtime.scene_resource_create(instance, owner, map_handle), core_types.Status.OK)
	map_resource, _ := engine_runtime.map_get(instance, owner, map_handle)
	attachment_bytes := map_resource.scene_attachment.bytes
	expected_bounds, bounds_valid := presentation.compute_visual_bounds(map_resource.prepared_map.objects)
	testing.expect(test, bounds_valid)
	testing.expect_value(test, map_resource.scene_attachment.visual_bounds, expected_bounds)
	// Published bounds survive repeat creation: the attachment is reused.
	testing.expect_value(test, engine_runtime.scene_resource_create(instance, owner, map_handle), core_types.Status.OK)
	testing.expect(test, raw_data(map_resource.scene_attachment.bytes) == raw_data(attachment_bytes))

	session_handle, session_created := engine_runtime.session_create(instance, owner, map_handle, 262144, 0, true, 8)
	testing.expect_value(test, session_created, core_types.Status.OK)
	if session_created != .OK {
		return
	}
	defer testing.expect_value(test, engine_runtime.session_release(instance, owner, session_handle), core_types.Status.OK)
	mailbox := engine_runtime.oe_abi_control()
	output_span := mailbox + engine_runtime.ABI_OUTPUT_OFFSET
	write_viewport_record(13.5, 29.25, 1280, 720, 1)
	// Steady-state transform queries allocate nothing.
	previous_allocator := context.allocator
	context.allocator = mem.panic_allocator()
	testing.expect_value(test,
		core_types.Status(engine_runtime.oe_session_playfield_transform(owner, session_handle, mailbox, output_span)),
		core_types.Status.OK)
	expected_fit, fit_valid := presentation.make_bounds_transform({13.5, 29.25, 1280, 720, 1}, expected_bounds)
	testing.expect(test, fit_valid)
	testing.expect_value(test, read_transform_output(), expected_fit)
	context.allocator = previous_allocator
	// A second session of the same map shares the cached bounds.
	second_session, second_created := engine_runtime.session_create(instance, owner, map_handle, 262144, 0, true, 8)
	testing.expect_value(test, second_created, core_types.Status.OK)
	defer testing.expect_value(test, engine_runtime.session_release(instance, owner, second_session), core_types.Status.OK)
	testing.expect_value(test,
		core_types.Status(engine_runtime.oe_session_playfield_transform(owner, second_session, mailbox, output_span)),
		core_types.Status.OK)
	testing.expect_value(test, read_transform_output(), expected_fit)
	// DPR never changes the CSS transform.
	write_viewport_record(13.5, 29.25, 1280, 720, 3)
	testing.expect_value(test,
		core_types.Status(engine_runtime.oe_session_playfield_transform(owner, session_handle, mailbox, output_span)),
		core_types.Status.OK)
	testing.expect_value(test, read_transform_output(), expected_fit)
	// Invalid viewport: rejection preserves the previous published bytes.
	write_viewport_record(0, 0, 0, 720, 1)
	testing.expect_value(test,
		core_types.Status(engine_runtime.oe_session_playfield_transform(owner, session_handle, mailbox, output_span)),
		core_types.Status.INVALID_ARGUMENT)
	testing.expect_value(test, read_transform_output(), expected_fit)
	// Wrong output span address.
	write_viewport_record(0, 0, 1280, 720, 1)
	testing.expect_value(test,
		core_types.Status(engine_runtime.oe_session_playfield_transform(owner, session_handle, mailbox, mailbox + engine_runtime.ABI_ERROR_OFFSET)),
		core_types.Status.INVALID_ARGUMENT)
	// Stale session handle.
	released_session, released_created := engine_runtime.session_create(instance, owner, map_handle, 262144, 0, true, 8)
	testing.expect_value(test, released_created, core_types.Status.OK)
	testing.expect_value(test, engine_runtime.session_release(instance, owner, released_session), core_types.Status.OK)
	testing.expect(test, engine_runtime.oe_session_playfield_transform(owner, released_session, mailbox, output_span) != 0)
	// A session whose map never published scene resources has no attachment.
	bare_map, bare_error := engine_runtime.map_prepare(instance, owner, map_text, true)
	testing.expect_value(test, bare_error.status, core_types.Status.OK)
	bare_session, bare_created := engine_runtime.session_create(instance, owner, bare_map, 262144, 0, true, 8)
	testing.expect_value(test, bare_created, core_types.Status.OK)
	defer testing.expect_value(test, engine_runtime.session_release(instance, owner, bare_session), core_types.Status.OK)
	testing.expect_value(test,
		core_types.Status(engine_runtime.oe_session_playfield_transform(owner, bare_session, mailbox, output_span)),
		core_types.Status.INVALID_STATE)
}

// The scene draw consumes the same cached bounds: its frame transform equals
// the fitted transform for the attachment and remains stable across time, and
// emitted map geometry lands inside the viewport.
@(test)
scene_draw_frame_transform_fits_the_attachment_bounds :: proc(test: ^testing.T) {
	testing.expect_value(test, engine_runtime.abi_start(), core_types.Status.OK)
	instance := &engine_runtime.abi_instance
	owner, _ := engine_runtime.engine_create(instance)
	defer engine_runtime.engine_release(instance, owner)
	map_text := "osu file format v14\n[HitObjects]\n-60,-40,1000,1,0\n560,420,2000,1,0"
	map_handle, map_error := engine_runtime.map_prepare(instance, owner, map_text, true)
	testing.expect_value(test, map_error.status, core_types.Status.OK)
	if map_error.status != .OK {
		return
	}
	testing.expect_value(test, engine_runtime.scene_resource_create(instance, owner, map_handle), core_types.Status.OK)
	session_handle, session_created := engine_runtime.session_create(instance, owner, map_handle, 262144, 0, true, 8)
	testing.expect_value(test, session_created, core_types.Status.OK)
	if session_created != .OK {
		return
	}
	defer testing.expect_value(test, engine_runtime.session_release(instance, owner, session_handle), core_types.Status.OK)
	reserve := engine_runtime.abi_storage.bytes[:engine_runtime.ABI_SCENE_RESERVE_SIZE]
	for &reserve_byte in reserve {
		reserve_byte = 0
	}
	engine_runtime.put_header(reserve, engine_runtime.ABI_SCENE_RESERVE_KIND, engine_runtime.ABI_SCENE_RESERVE_SIZE)
	engine_runtime.put_u32(reserve, engine_runtime.ABI_SCENE_RESERVE_INSTANCE_CAPACITY_OFFSET, 4096)
	engine_runtime.put_u64(reserve, engine_runtime.ABI_SCENE_RESERVE_ARENA_BYTES_OFFSET, 4 * 1024 * 1024)
	mailbox := engine_runtime.oe_abi_control()
	testing.expect_value(test,
		core_types.Status(engine_runtime.oe_session_scene_reserve(owner, session_handle, mailbox, mailbox + engine_runtime.ABI_OUTPUT_OFFSET)),
		core_types.Status.OK)
	write_viewport_record(0, 0, 1280, 720, 1)
	map_resource, _ := engine_runtime.map_get(instance, owner, map_handle)
	expected_fit, fit_valid := presentation.make_bounds_transform({0, 0, 1280, 720, 1}, map_resource.scene_attachment.visual_bounds)
	testing.expect(test, fit_valid)
	draw_times := [3]f64{500, 1500, 2500}
	for draw_time_ms in draw_times {
		testing.expect_value(test,
			core_types.Status(engine_runtime.oe_session_scene_draw(owner, session_handle, draw_time_ms, mailbox, mailbox + engine_runtime.ABI_OUTPUT_OFFSET)),
			core_types.Status.OK)
		session, _ := engine_runtime.session_get(instance, owner, session_handle)
		frame_bytes := session.scene_storage.output
		frame_scale := engine_runtime.get_f64(frame_bytes, engine_runtime.ABI_SCENE_FRAME_SCALE_OFFSET)
		frame_left := engine_runtime.get_f64(frame_bytes, engine_runtime.ABI_SCENE_FRAME_CLIENT_LEFT_OFFSET)
		frame_top := engine_runtime.get_f64(frame_bytes, engine_runtime.ABI_SCENE_FRAME_CLIENT_TOP_OFFSET)
		instance_count := engine_runtime.get_u32(frame_bytes, engine_runtime.ABI_SCENE_FRAME_INSTANCES_COUNT_OFFSET)
		testing.expect_value(test, frame_scale, expected_fit.scale)
		testing.expect_value(test, frame_left, expected_fit.client_left)
		testing.expect_value(test, frame_top, expected_fit.client_top)
		// Every emitted map and HUD instance lands inside the visible viewport
		// after the forward transform; the background (layer 0) overshoots it.
		for instance in session.scene_storage.instances[:instance_count] {
			if instance.layer == 0 {
				continue
			}
			client_x, client_y := presentation.to_client(expected_fit, instance.x, instance.y)
			testing.expect(test, client_x >= -1 && client_x <= 1281)
			testing.expect(test, client_y >= -1 && client_y <= 721)
		}
	}
}

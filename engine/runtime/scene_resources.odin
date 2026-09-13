package engine_runtime

import "base:runtime"
import "core:mem"
import core_types "../core_types"
import presentation "../presentation"
import render_webgl "../render_webgl"
import simulation "../simulation"

Scene_Attachment :: struct {
	arena: core_types.Arena,
	bytes: []byte,
	ranges: []presentation.Geometry_Range,
}

scene_resource_create :: proc(instance: ^Instance, engine, map_handle: core_types.Handle) -> core_types.Status {
	map_resource, status := map_get(instance, engine, map_handle)
	if status != .OK {
		return status
	}
	if !map_resource.fully_prepared {
		return .UNSUPPORTED
	}
	if len(map_resource.scene_attachment.bytes) > 0 {
		return .OK
	}
	builder := render_webgl.Mesh_Builder{valid = true}
	render_webgl.quad(&builder)
	for &object in map_resource.prepared_map.objects {
		if object.kind == .SLIDER {
			render_webgl.path(&builder, &object)
		}
		if !builder.valid {
			return .QUOTA_EXCEEDED
		}
	}
	vertex_count, index_count := builder.vertex_count, builder.index_count
	vertex_offset := u64(ABI_SCENE_RESOURCE_SIZE)
	index_offset := vertex_offset + u64(vertex_count) * size_of(render_webgl.Vertex)
	atlas_offset := (index_offset + u64(index_count) * 4 + 7) / 8 * 8
	vertex_shader_offset := atlas_offset + render_webgl.ATLAS_WIDTH * render_webgl.ATLAS_HEIGHT * 4
	fragment_shader_offset := (vertex_shader_offset + u64(len(render_webgl.VERTEX_SHADER)) + 7) / 8 * 8
	byte_count := (fragment_shader_offset + u64(len(render_webgl.FRAGMENT_SHADER)) + 7) / 8 * 8
	if byte_count > render_webgl.MAX_RESOURCE_BYTES {
		return .QUOTA_EXCEEDED
	}
	candidate_bytes := byte_count
	if !simulation.size_add(&candidate_bytes, presentation.Geometry_Range, u64(len(map_resource.prepared_map.objects))) {
		return .QUOTA_EXCEEDED
	}
	scratch_bytes: u64
	if !simulation.size_add(&scratch_bytes, render_webgl.Vertex, u64(vertex_count)) ||
	   !simulation.size_add(&scratch_bytes, u32, u64(index_count)) {
		return .QUOTA_EXCEEDED
	}
	engine_state, _ := engine_get(instance, engine)
	used := u64(len(map_resource.decoded.arena.bytes)) + u64(len(map_resource.points.arena.bytes)) +
		u64(len(map_resource.prepared_map.arena.bytes)) + u64(len(map_resource.prepared_map.description.bytes)) +
		u64(len(map_resource.render_attachment.bytes))
	if used + candidate_bytes + scratch_bytes > engine_state.quotas.arena_bytes || candidate_bytes + scratch_bytes > u64(max(u32)) {
		return .QUOTA_EXCEEDED
	}
	candidate: Scene_Attachment
	candidate.arena, status = core_types.arena_create(candidate_bytes, instance.allocator)
	if status != .OK {
		return status
	}
	scratch, scratch_status := core_types.arena_create(scratch_bytes, instance.allocator)
	if scratch_status != .OK {
		core_types.arena_destroy(&candidate.arena)
		return scratch_status
	}
	defer core_types.arena_destroy(&scratch)
	words, _ := core_types.arena_take(&candidate.arena, u64, byte_count / 8)
	candidate.bytes = mem.slice_ptr(cast(^byte)raw_data(words), int(byte_count))
	candidate.ranges, _ = core_types.arena_take(&candidate.arena, presentation.Geometry_Range, u64(len(map_resource.prepared_map.objects)))
	builder = {valid = true}
	builder.vertices, _ = core_types.arena_take(&scratch, render_webgl.Vertex, u64(vertex_count))
	builder.indices, _ = core_types.arena_take(&scratch, u32, u64(index_count))
	render_webgl.quad(&builder)
	for &object, object_index in map_resource.prepared_map.objects {
		if object.kind == .SLIDER {
			candidate.ranges[object_index] = render_webgl.path(&builder, &object)
		}
	}
	bytes := candidate.bytes
	put_header(bytes, ABI_SCENE_RESOURCE_KIND, ABI_SCENE_RESOURCE_SIZE)
	put_u64(bytes, ABI_SCENE_RESOURCE_RESOURCE_ID_OFFSET, u64(map_handle))
	put_u32(bytes, ABI_SCENE_RESOURCE_ATTACHMENT_VERSION_OFFSET, 1)
	put_u64(bytes, ABI_SCENE_RESOURCE_TOTAL_BYTES_OFFSET, byte_count)
	copy(bytes[ABI_SCENE_RESOURCE_PREPARED_DIGEST_0_OFFSET:], map_resource.prepared_map.prepared_digest[:])
	put_relative_span(bytes, ABI_SCENE_RESOURCE_VERTICES_OFFSET_OFFSET, int(vertex_offset), vertex_count, 32)
	put_relative_span(bytes, ABI_SCENE_RESOURCE_INDICES_OFFSET_OFFSET, int(index_offset), index_count, 4)
	put_relative_span(bytes, ABI_SCENE_RESOURCE_ATLAS_OFFSET_OFFSET, int(atlas_offset), render_webgl.ATLAS_WIDTH * render_webgl.ATLAS_HEIGHT * 4, 1)
	put_relative_span(bytes, ABI_SCENE_RESOURCE_VERTEX_SHADER_OFFSET_OFFSET, int(vertex_shader_offset), len(render_webgl.VERTEX_SHADER), 1)
	put_relative_span(bytes, ABI_SCENE_RESOURCE_FRAGMENT_SHADER_OFFSET_OFFSET, int(fragment_shader_offset), len(render_webgl.FRAGMENT_SHADER), 1)
	put_u32(bytes, ABI_SCENE_RESOURCE_ATLAS_WIDTH_OFFSET, render_webgl.ATLAS_WIDTH)
	put_u32(bytes, ABI_SCENE_RESOURCE_ATLAS_HEIGHT_OFFSET, render_webgl.ATLAS_HEIGHT)
	for vertex, vertex_index in builder.vertices {
		for coordinate, coordinate_index in vertex {
			put_f64(bytes, int(vertex_offset) + vertex_index * 32 + coordinate_index * 8, coordinate)
		}
	}
	for vertex_index, index_index in builder.indices {
		put_u32(bytes, int(index_offset) + index_index * 4, vertex_index)
	}
	render_webgl.fill_atlas(bytes[int(atlas_offset):int(vertex_shader_offset)])
	copy(bytes[int(vertex_shader_offset):], render_webgl.VERTEX_SHADER)
	copy(bytes[int(fragment_shader_offset):], render_webgl.FRAGMENT_SHADER)
	// Sole ownership transfer after both passes and all allocation have succeeded.
	map_resource.scene_attachment = candidate
	return .OK
}

@(export)
oe_map_scene_resources :: proc "c" (engine, map_handle: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	if !output_span_valid(span_output) {
		return abi_status(.INVALID_ARGUMENT)
	}
	status := scene_resource_create(&abi_instance, engine, map_handle)
	if status != .OK {
		return abi_status(status)
	}
	map_resource, _ := map_get(&abi_instance, engine, map_handle)
	bytes := map_resource.scene_attachment.bytes
	abi_span(uintptr(raw_data(bytes)), u32(len(bytes)))
	return abi_status(.OK)
}

@(export)
oe_session_scene_resources :: proc "c" (engine, session_handle: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_output_get(engine, session_handle, span_output)
	if status != .OK {
		return abi_status(status)
	}
	bytes := session.map_storage.scene_attachment.bytes
	if len(bytes) == 0 {
		return abi_status(.INVALID_STATE)
	}
	abi_span(uintptr(raw_data(bytes)), u32(len(bytes)))
	return abi_status(.OK)
}

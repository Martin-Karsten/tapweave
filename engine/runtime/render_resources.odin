package engine_runtime

import "base:runtime"
import core_types "../core_types"

// A real minimal immutable attachment. W04 extends geometry/atlas generation;
// this payload is a unit quad, a white pixel, and original executable shaders.
RENDER_VERTEX_SHADER :: `#version 300 es
layout(location=0) in vec2 position;
uniform mat3 transform;
void main() { gl_Position = vec4((transform * vec3(position, 1.0)).xy, 0.0, 1.0); }
`
RENDER_FRAGMENT_SHADER :: `#version 300 es
precision mediump float;
uniform vec4 colour;
out vec4 output_colour;
void main() { output_colour = colour; }
`

render_resource_size :: proc() -> u64 {
	return ABI_RENDER_RESOURCE_SIZE + 64 + 24 + 8 +
		(u64(len(RENDER_VERTEX_SHADER)) + 7) / 8 * 8 +
		(u64(len(RENDER_FRAGMENT_SHADER)) + 7) / 8 * 8
}

render_resource_create :: proc(instance: ^Instance, engine, map_handle: core_types.Handle) -> core_types.Status {
	map_resource, status := map_get(instance, engine, map_handle)
	if status != .OK {
		return status
	}
	if !map_resource.fully_prepared {
		return .UNSUPPORTED
	}
	if len(map_resource.render_attachment.bytes) != 0 {
		return .OK
	}
	engine_state, _ := engine_get(instance, engine)
	required := render_resource_size()
	used := u64(len(map_resource.decoded.arena.bytes)) + u64(len(map_resource.points.arena.bytes)) +
		u64(len(map_resource.prepared_map.arena.bytes)) + u64(len(map_resource.prepared_map.description.bytes))
	if required > u64(max(u32)) || used > engine_state.quotas.arena_bytes || required > engine_state.quotas.arena_bytes - used {
		return .QUOTA_EXCEEDED
	}
	candidate, allocation_status := core_types.arena_create(required, instance.allocator)
	if allocation_status != .OK {
		return allocation_status
	}
	bytes := candidate.bytes
	put_header(bytes, ABI_RENDER_RESOURCE_KIND, ABI_RENDER_RESOURCE_SIZE)
	put_u64(bytes, ABI_RENDER_RESOURCE_RESOURCE_ID_OFFSET, u64(map_handle))
	put_u32(bytes, ABI_RENDER_RESOURCE_ATTACHMENT_VERSION_OFFSET, 1)
	put_u64(bytes, ABI_RENDER_RESOURCE_TOTAL_BYTES_OFFSET, required)
	copy(bytes[ABI_RENDER_RESOURCE_PREPARED_DIGEST_0_OFFSET:], map_resource.prepared_map.prepared_digest[:])
	vertex_offset := ABI_RENDER_RESOURCE_SIZE
	put_relative_span(bytes, ABI_RENDER_RESOURCE_VERTICES_OFFSET_OFFSET, vertex_offset, 4, 16)
	vertices := [4][2]f64{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}}
	for vertex, vertex_index in vertices {
		put_f64(bytes, vertex_offset + vertex_index * 16, vertex[0])
		put_f64(bytes, vertex_offset + vertex_index * 16 + 8, vertex[1])
	}
	index_offset := vertex_offset + 64
	put_relative_span(bytes, ABI_RENDER_RESOURCE_INDICES_OFFSET_OFFSET, index_offset, 6, 4)
	for vertex_index, index_index in ([6]u32{0, 1, 2, 0, 2, 3}) {
		put_u32(bytes, index_offset + index_index * 4, vertex_index)
	}
	atlas_offset := index_offset + 24
	put_relative_span(bytes, ABI_RENDER_RESOURCE_ATLAS_OFFSET_OFFSET, atlas_offset, 4, 1)
	put_u32(bytes, atlas_offset, max(u32))
	put_u32(bytes, ABI_RENDER_RESOURCE_ATLAS_WIDTH_OFFSET, 1)
	put_u32(bytes, ABI_RENDER_RESOURCE_ATLAS_HEIGHT_OFFSET, 1)
	vertex_shader_offset := atlas_offset + 8
	put_relative_span(bytes, ABI_RENDER_RESOURCE_VERTEX_SHADER_OFFSET_OFFSET, vertex_shader_offset, len(RENDER_VERTEX_SHADER), 1)
	copy(bytes[vertex_shader_offset:], RENDER_VERTEX_SHADER)
	fragment_shader_offset := vertex_shader_offset + (len(RENDER_VERTEX_SHADER) + 7) / 8 * 8
	put_relative_span(bytes, ABI_RENDER_RESOURCE_FRAGMENT_SHADER_OFFSET_OFFSET, fragment_shader_offset, len(RENDER_FRAGMENT_SHADER), 1)
	copy(bytes[fragment_shader_offset:], RENDER_FRAGMENT_SHADER)
	// Transfer the sole owner only after the complete payload has been written.
	map_resource.render_attachment = candidate
	return .OK
}

@(export)
oe_map_render_resources :: proc "c" (engine, map_handle: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	if !output_span_valid(span_output) {
		return abi_status(.INVALID_ARGUMENT)
	}
	status := render_resource_create(&abi_instance, engine, map_handle)
	if status != .OK {
		return abi_status(status)
	}
	map_resource, _ := map_get(&abi_instance, engine, map_handle)
	bytes := map_resource.render_attachment.bytes
	abi_span(uintptr(raw_data(bytes)), u32(len(bytes)))
	return abi_status(.OK)
}

@(export)
oe_session_render_resources :: proc "c" (engine, session_handle: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_output_get(engine, session_handle, span_output)
	if status != .OK {
		return abi_status(status)
	}
	bytes := session.map_storage.render_attachment.bytes
	if len(bytes) == 0 {
		return abi_status(.INVALID_STATE)
	}
	abi_span(uintptr(raw_data(bytes)), u32(len(bytes)))
	return abi_status(.OK)
}

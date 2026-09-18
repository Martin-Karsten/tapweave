package engine_runtime

import "base:runtime"
import core_types "../core_types"
import presentation "../presentation"
import simulation "../simulation"

ABI_TRANSFORM_OUTPUT_OFFSET :: 672

// One viewport reader: the playfield transport and the draw transport decode
// the same input record through the same path.
read_viewport_transform :: proc(viewport_address: uintptr) -> (presentation.Playfield_Transform, presentation.Viewport, core_types.Status) {
	status := abi_record(viewport_address, ABI_VIEWPORT_KIND, ABI_VIEWPORT_SIZE)
	if status != .OK {
		return {}, {}, status
	}
	input_bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	viewport := presentation.Viewport{
		css_left = get_f64(input_bytes, ABI_VIEWPORT_CSS_LEFT_OFFSET),
		css_top = get_f64(input_bytes, ABI_VIEWPORT_CSS_TOP_OFFSET),
		css_width = get_f64(input_bytes, ABI_VIEWPORT_CSS_WIDTH_OFFSET),
		css_height = get_f64(input_bytes, ABI_VIEWPORT_CSS_HEIGHT_OFFSET),
		device_pixel_ratio = get_f64(input_bytes, ABI_VIEWPORT_DEVICE_PIXEL_RATIO_OFFSET),
	}
	transform, valid := presentation.make_playfield_transform(viewport)
	if !valid {
		return {}, {}, .INVALID_ARGUMENT
	}
	return transform, viewport, .OK
}

// Session-aware viewport reader: fits the session's cached complete visual
// bounds instead of the normal 512x384 rectangle. Every gameplay consumer
// (drawing, uniforms and pointer conversion) shares this one helper so the
// forward origin and the inverse coefficients cannot disagree.
read_bounds_transform :: proc(attachment: ^Scene_Attachment, viewport_address: uintptr) -> (presentation.Playfield_Transform, presentation.Viewport, core_types.Status) {
	status := abi_record(viewport_address, ABI_VIEWPORT_KIND, ABI_VIEWPORT_SIZE)
	if status != .OK {
		return {}, {}, status
	}
	input_bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	viewport := presentation.Viewport{
		css_left = get_f64(input_bytes, ABI_VIEWPORT_CSS_LEFT_OFFSET),
		css_top = get_f64(input_bytes, ABI_VIEWPORT_CSS_TOP_OFFSET),
		css_width = get_f64(input_bytes, ABI_VIEWPORT_CSS_WIDTH_OFFSET),
		css_height = get_f64(input_bytes, ABI_VIEWPORT_CSS_HEIGHT_OFFSET),
		device_pixel_ratio = get_f64(input_bytes, ABI_VIEWPORT_DEVICE_PIXEL_RATIO_OFFSET),
	}
	transform, valid := presentation.make_bounds_transform(viewport, attachment.visual_bounds)
	if !valid {
		return {}, {}, .INVALID_ARGUMENT
	}
	return transform, viewport, .OK
}

// Serialize one kind-30 transform into the shared mailbox scratch region.
// Callers publish the output span only afterwards; the bytes must be copied
// immediately and never retained across a growing WASM call.
write_transform_output :: proc(transform: presentation.Playfield_Transform) {
	bytes := abi_storage.bytes[ABI_TRANSFORM_OUTPUT_OFFSET:ABI_TRANSFORM_OUTPUT_OFFSET + ABI_PLAYFIELD_TRANSFORM_SIZE]
	put_header(bytes, ABI_PLAYFIELD_TRANSFORM_KIND, ABI_PLAYFIELD_TRANSFORM_SIZE)
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_SCALE_OFFSET, transform.scale)
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_CLIENT_LEFT_OFFSET, transform.client_left)
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_CLIENT_TOP_OFFSET, transform.client_top)
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_A_OFFSET, transform.inverse[0])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_B_OFFSET, transform.inverse[1])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_C_OFFSET, transform.inverse[2])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_D_OFFSET, transform.inverse[3])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_E_OFFSET, transform.inverse[4])
	put_f64(bytes, ABI_PLAYFIELD_TRANSFORM_INVERSE_F_OFFSET, transform.inverse[5])
	abi_span(abi_base() + ABI_TRANSFORM_OUTPUT_OFFSET, ABI_PLAYFIELD_TRANSFORM_SIZE)
}

// Independent coordinate capability; this does not advertise object rendering.
@(export)
oe_playfield_transform :: proc "c" (engine: core_types.Handle, viewport_address, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	_, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return abi_status(status)
	}
	if !output_span_valid(span_output) {
		return abi_status(.INVALID_ARGUMENT)
	}
	transform, _, transform_status := read_viewport_transform(viewport_address)
	if transform_status != .OK {
		return abi_status(transform_status)
	}
	write_transform_output(transform)
	return abi_status(.OK)
}

// Session-aware transform over the validated session's cached visual bounds.
// The session's scene attachment must exist; its absence is the established
// INVALID_STATE. Allocation-free; output publishes only after full validation.
@(export)
oe_session_playfield_transform :: proc "c" (engine, session_handle: core_types.Handle, viewport_address, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_output_get(engine, session_handle, span_output)
	if status != .OK {
		return abi_status(status)
	}
	if len(session.map_storage.scene_attachment.bytes) == 0 {
		return abi_status(.INVALID_STATE)
	}
	transform, _, transform_status := read_bounds_transform(&session.map_storage.scene_attachment, viewport_address)
	if transform_status != .OK {
		return abi_status(transform_status)
	}
	write_transform_output(transform)
	return abi_status(.OK)
}

// Readonly active projection, independent of the gameplay/audio journal buffer.
// This transport alone does not advertise the complete rendering capability.
@(export)
oe_session_presentation :: proc "c" (engine, session_handle: core_types.Handle, time_ms: f64, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_output_get(engine, session_handle, span_output)
	if status != .OK {
		return abi_status(status)
	}
	if !core_types.finite(time_ms) {
		return abi_status(.INVALID_ARGUMENT)
	}
	simulation_state := &session.simulation
	projection := simulation.project(simulation_state)
	active_set := &session.active_presentation
	status = presentation.refresh_active(active_set, projection, time_ms, simulation_state.epoch)
	if status != .OK {
		return abi_status(status)
	}
	bytes := session.presentation_output
	total_bytes := ABI_PRESENTATION_FRAME_SIZE + active_set.count * ABI_PRESENTATION_OBJECT_SIZE
	put_header(bytes, ABI_PRESENTATION_FRAME_KIND, ABI_PRESENTATION_FRAME_SIZE)
	put_u32(bytes, ABI_PRESENTATION_FRAME_STATE_OFFSET, u32(simulation_state.state))
	put_u32(bytes, ABI_PRESENTATION_FRAME_EPOCH_OFFSET, simulation_state.epoch)
	put_f64(bytes, ABI_PRESENTATION_FRAME_COMMITTED_MS_OFFSET, simulation_state.committed_ms)
	put_f64(bytes, ABI_PRESENTATION_FRAME_PRESENTATION_MS_OFFSET, time_ms)
	put_u32(bytes, ABI_PRESENTATION_FRAME_OBJECTS_OFFSET_OFFSET, ABI_PRESENTATION_FRAME_SIZE)
	put_u32(bytes, ABI_PRESENTATION_FRAME_OBJECTS_COUNT_OFFSET, u32(active_set.count))
	put_u32(bytes, ABI_PRESENTATION_FRAME_OBJECTS_STRIDE_OFFSET, ABI_PRESENTATION_OBJECT_SIZE)
	put_u32(bytes, ABI_PRESENTATION_FRAME_RESERVED_OFFSET, 0)
	put_u64(bytes, ABI_PRESENTATION_FRAME_TOTAL_BYTES_OFFSET, u64(total_bytes))
	put_u64(bytes, ABI_PRESENTATION_FRAME_VISITED_COUNT_OFFSET, active_set.visited_count)
	put_u64(bytes, ABI_PRESENTATION_FRAME_REVEALED_COUNT_OFFSET, active_set.revealed_count)
	put_f64(bytes, ABI_PRESENTATION_FRAME_CURSOR_X_OFFSET, simulation_state.cursor.x)
	put_f64(bytes, ABI_PRESENTATION_FRAME_CURSOR_Y_OFFSET, simulation_state.cursor.y)
	for object_index, active_index in active_set.indices[:active_set.count] {
		object := &session.map_storage.prepared_map.objects[object_index]
		outcome := simulation.project_object(projection, object_index, time_ms)
		record := bytes[ABI_PRESENTATION_FRAME_SIZE + active_index * ABI_PRESENTATION_OBJECT_SIZE:]
		put_header(record, ABI_PRESENTATION_OBJECT_KIND, ABI_PRESENTATION_OBJECT_SIZE)
		put_u32(record, ABI_PRESENTATION_OBJECT_OBJECT_ID_OFFSET, object.id)
		put_u32(record, ABI_PRESENTATION_OBJECT_OBJECT_KIND_OFFSET, u32(object.kind))
		put_u32(record, ABI_PRESENTATION_OBJECT_RESULT_OFFSET, u32(outcome.result))
		put_u32(record, ABI_PRESENTATION_OBJECT_HEAD_RESULT_OFFSET, u32(outcome.head_result))
		put_u32(record, ABI_PRESENTATION_OBJECT_TRACKING_OFFSET, u32(outcome.tracking))
		put_u32(record, ABI_PRESENTATION_OBJECT_RESERVED_OFFSET, 0)
		put_f64(record, ABI_PRESENTATION_OBJECT_RESULT_TIME_MS_OFFSET, outcome.result_time_ms)
		put_f64(record, ABI_PRESENTATION_OBJECT_HEAD_TIME_MS_OFFSET, outcome.head_time_ms)
		put_f64(record, ABI_PRESENTATION_OBJECT_POSITION_X_OFFSET, outcome.position[0])
		put_f64(record, ABI_PRESENTATION_OBJECT_POSITION_Y_OFFSET, outcome.position[1])
		put_f64(record, ABI_PRESENTATION_OBJECT_ROTATION_OFFSET, outcome.rotation)
		put_f64(record, ABI_PRESENTATION_OBJECT_START_TIME_MS_OFFSET, object.time_ms)
		put_f64(record, ABI_PRESENTATION_OBJECT_RADIUS_OFFSET, object.radius)
		put_f64(record, ABI_PRESENTATION_OBJECT_PREEMPT_MS_OFFSET, object.preempt_ms)
	}
	abi_span(uintptr(raw_data(bytes)), u32(total_bytes))
	return abi_status(.OK)
}


ABI_OUTPUT_CAPABILITIES_OFFSET :: ABI_TRANSFORM_OUTPUT_OFFSET + ABI_PLAYFIELD_TRANSFORM_SIZE

@(export)
oe_output_capabilities :: proc "c" (engine: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	_, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return abi_status(status)
	}
	if !output_span_valid(span_output) {
		return abi_status(.INVALID_ARGUMENT)
	}
	bytes := abi_storage.bytes[ABI_OUTPUT_CAPABILITIES_OFFSET:ABI_OUTPUT_CAPABILITIES_OFFSET + ABI_OUTPUT_CAPABILITIES_SIZE]
	put_header(bytes, ABI_OUTPUT_CAPABILITIES_KIND, ABI_OUTPUT_CAPABILITIES_SIZE)
	put_u32(bytes, ABI_OUTPUT_CAPABILITIES_COMPACT_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_OUTPUT_CAPABILITIES_PROJECTION_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_OUTPUT_CAPABILITIES_FLAGS_OFFSET, 0)
	put_u32(bytes, ABI_OUTPUT_CAPABILITIES_RESERVED_OFFSET, 0)
	abi_span(uintptr(raw_data(bytes)), ABI_OUTPUT_CAPABILITIES_SIZE)
	return abi_status(.OK)
}

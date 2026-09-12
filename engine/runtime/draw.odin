package engine_runtime

import "base:runtime"
import "core:mem"
import core_types "../core_types"
import presentation "../presentation"
import simulation "../simulation"

ABI_RENDER_CAPACITY_OUTPUT :: 800
MAX_DRAW_INSTANCES :: 1_000_000

Draw_Storage :: struct {
	arena: core_types.Arena,
	instances: []presentation.Instance,
	output: []byte,
}

draw_required_bytes :: proc(instance_count: u64) -> (u64, core_types.Status) {
	if instance_count > u64(max(u32)) {
		return 0, .QUOTA_EXCEEDED
	}
	total: u64
	if !simulation.size_add(&total, presentation.Instance, instance_count) ||
	   !simulation.size_add(&total, u64, (ABI_DRAW_FRAME_SIZE + instance_count * (ABI_DRAW_INSTANCE_SIZE + ABI_DRAW_BATCH_SIZE) + 7) / 8) ||
	   total > u64(max(u32)) {
		return 0, .QUOTA_EXCEEDED
	}
	return total, .OK
}

write_render_capacity :: proc(session: ^Session, requested, required: u32, required_bytes: u64) {
	bytes := abi_storage.bytes[ABI_RENDER_CAPACITY_OUTPUT:ABI_RENDER_CAPACITY_OUTPUT + ABI_RENDER_CAPACITY_SIZE]
	put_header(bytes, ABI_RENDER_CAPACITY_KIND, ABI_RENDER_CAPACITY_SIZE)
	put_u32(bytes, ABI_RENDER_CAPACITY_REQUESTED_INSTANCES_OFFSET, requested)
	put_u32(bytes, ABI_RENDER_CAPACITY_REQUIRED_INSTANCES_OFFSET, required)
	put_u64(bytes, ABI_RENDER_CAPACITY_REQUIRED_BYTES_OFFSET, required_bytes)
	put_u64(bytes, ABI_RENDER_CAPACITY_RESOURCE_ID_OFFSET, get_u64(session.map_storage.render_attachment.bytes, ABI_RENDER_RESOURCE_RESOURCE_ID_OFFSET))
	put_u32(bytes, ABI_RENDER_CAPACITY_EPOCH_OFFSET, session.simulation.epoch)
	put_u32(bytes, ABI_RENDER_CAPACITY_FLAGS_OFFSET, 0)
	abi_span(uintptr(raw_data(bytes)), ABI_RENDER_CAPACITY_SIZE)
}

draw_reserve :: proc(instance: ^Instance, engine, session_handle: core_types.Handle, instance_count: u64, arena_bytes: u64) -> core_types.Status {
	session, status := session_get(instance, engine, session_handle)
	if status != .OK {
		return status
	}
	if !session.gameplay || len(session.map_storage.render_attachment.bytes) == 0 ||
	   session.simulation.state != .READY && session.simulation.state != .PAUSED {
		return .INVALID_STATE
	}
	for object in session.map_storage.prepared_map.objects {
		if object.kind != .CIRCLE {
			return .UNSUPPORTED
		}
	}
	required_bytes, count_status := draw_required_bytes(instance_count)
	if count_status != .OK {
		return count_status
	}
	engine_state, _ := engine_get(instance, engine)
	used := u64(len(session.arena.bytes))
	if instance_count == 0 || instance_count > MAX_DRAW_INSTANCES || arena_bytes < required_bytes || arena_bytes > u64(max(u32)) ||
	   used > engine_state.quotas.arena_bytes || arena_bytes > engine_state.quotas.arena_bytes - used {
		return .QUOTA_EXCEEDED
	}
	candidate: Draw_Storage
	candidate.arena, status = core_types.arena_create(arena_bytes, instance.allocator)
	if status != .OK {
		return status
	}
	candidate.instances, _ = core_types.arena_take(&candidate.arena, presentation.Instance, instance_count)
	word_count := (ABI_DRAW_FRAME_SIZE + instance_count * (ABI_DRAW_INSTANCE_SIZE + ABI_DRAW_BATCH_SIZE) + 7) / 8
	words, _ := core_types.arena_take(&candidate.arena, u64, word_count)
	candidate.output = mem.slice_ptr(cast(^byte)raw_data(words), len(words) * 8)
	core_types.arena_destroy(&session.draw_storage.arena)
	// Sole ownership transfer: candidate is not accessed after publication.
	session.draw_storage = candidate
	return .OK
}

@(export)
oe_session_render_reserve :: proc "c" (engine, session_handle: core_types.Handle, request_address, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return abi_status(.INVALID_ARGUMENT)
	}
	if len(session.map_storage.render_attachment.bytes) == 0 {
		return abi_status(.INVALID_STATE)
	}
	status = abi_record(request_address, ABI_RENDER_RESERVE_KIND, ABI_RENDER_RESERVE_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	if get_u32(bytes, ABI_RENDER_RESERVE_FLAGS_OFFSET) != 0 || get_u64(bytes, ABI_RENDER_RESERVE_RESERVED_OFFSET) != 0 {
		return abi_status(.UNSUPPORTED)
	}
	requested := get_u32(bytes, ABI_RENDER_RESERVE_INSTANCE_CAPACITY_OFFSET)
	// Conservative count for the currently implemented circle producer. It is
	// not a final slider/spinner capacity declaration or an animation capability.
	required := u32(len(session.map_storage.prepared_map.objects)) * 24
	required_bytes, _ := draw_required_bytes(u64(required))
	if requested == 0 {
		write_render_capacity(session, requested, required, required_bytes)
		return abi_status(.OK)
	}
	status = draw_reserve(&abi_instance, engine, session_handle, u64(requested), get_u64(bytes, ABI_RENDER_RESERVE_ARENA_BYTES_OFFSET))
	if status != .OK {
		return abi_status(status)
	}
	write_render_capacity(session, requested, required, required_bytes)
	return abi_status(.OK)
}

write_draw_instance :: proc(bytes: []byte, instance: presentation.Instance) {
	put_header(bytes, ABI_DRAW_INSTANCE_KIND, ABI_DRAW_INSTANCE_SIZE)
	put_u32(bytes, ABI_DRAW_INSTANCE_PRIMITIVE_OFFSET, u32(instance.primitive))
	put_u32(bytes, ABI_DRAW_INSTANCE_LAYER_OFFSET, instance.layer)
	put_u32(bytes, ABI_DRAW_INSTANCE_OBJECT_ID_OFFSET, instance.object_id)
	put_u32(bytes, ABI_DRAW_INSTANCE_COMPONENT_ID_OFFSET, instance.component_id)
	put_u32(bytes, ABI_DRAW_INSTANCE_ORDINAL_OFFSET, instance.ordinal)
	put_u32(bytes, ABI_DRAW_INSTANCE_FLAGS_OFFSET, instance.flags)
	put_f64(bytes, ABI_DRAW_INSTANCE_X_OFFSET, instance.x)
	put_f64(bytes, ABI_DRAW_INSTANCE_Y_OFFSET, instance.y)
	put_f64(bytes, ABI_DRAW_INSTANCE_SCALE_X_OFFSET, instance.scale_x)
	put_f64(bytes, ABI_DRAW_INSTANCE_SCALE_Y_OFFSET, instance.scale_y)
	put_f64(bytes, ABI_DRAW_INSTANCE_ROTATION_OFFSET, instance.rotation)
	put_f64(bytes, ABI_DRAW_INSTANCE_ALPHA_OFFSET, instance.alpha)
	put_f64(bytes, ABI_DRAW_INSTANCE_PROGRESS_OFFSET, instance.progress)
	put_u32(bytes, ABI_DRAW_INSTANCE_COLOUR_OFFSET, instance.colour)
	put_u32(bytes, ABI_DRAW_INSTANCE_GLYPH_OFFSET, instance.glyph)
	put_u32(bytes, ABI_DRAW_INSTANCE_GEOMETRY_FIRST_OFFSET, instance.geometry_first)
	put_u32(bytes, ABI_DRAW_INSTANCE_GEOMETRY_COUNT_OFFSET, instance.geometry_count)
	put_u64(bytes, ABI_DRAW_INSTANCE_RESERVED_OFFSET, 0)
}

@(export)
oe_session_draw :: proc "c" (engine, session_handle: core_types.Handle, time_ms: f64, viewport_address, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET || !core_types.finite(time_ms) {
		return abi_status(.INVALID_ARGUMENT)
	}
	if len(session.draw_storage.output) == 0 || len(session.map_storage.render_attachment.bytes) == 0 {
		return abi_status(.INVALID_STATE)
	}
	status = abi_record(viewport_address, ABI_VIEWPORT_KIND, ABI_VIEWPORT_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	viewport_bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	transform, valid := presentation.make_playfield_transform({
		get_f64(viewport_bytes, ABI_VIEWPORT_CSS_LEFT_OFFSET), get_f64(viewport_bytes, ABI_VIEWPORT_CSS_TOP_OFFSET),
		get_f64(viewport_bytes, ABI_VIEWPORT_CSS_WIDTH_OFFSET), get_f64(viewport_bytes, ABI_VIEWPORT_CSS_HEIGHT_OFFSET),
		get_f64(viewport_bytes, ABI_VIEWPORT_DEVICE_PIXEL_RATIO_OFFSET),
	})
	if !valid {
		return abi_status(.INVALID_ARGUMENT)
	}
	simulation_state := &session.simulation
	projection := simulation.project(simulation_state)
	status = presentation.refresh_active(&session.active_presentation, projection, time_ms, simulation_state.epoch)
	if status != .OK {
		return abi_status(status)
	}
	counter: presentation.Builder
	presentation.build_objects(&counter, &session.active_presentation, projection, time_ms)
	if counter.count > len(session.draw_storage.instances) {
		required_bytes, _ := draw_required_bytes(u64(counter.count))
		write_render_capacity(session, u32(len(session.draw_storage.instances)), u32(counter.count), required_bytes)
		return abi_status(.OUTPUT_REQUIRED)
	}
	builder := presentation.Builder{instances = session.draw_storage.instances}
	presentation.build_objects(&builder, &session.active_presentation, projection, time_ms)
	instances := builder.instances[:builder.count]
	presentation.order_instances(instances)
	bytes := session.draw_storage.output
	instance_offset := ABI_DRAW_FRAME_SIZE
	batch_offset := instance_offset + len(instances) * ABI_DRAW_INSTANCE_SIZE
	batch_count := 0
	for instance, instance_index in instances {
		write_draw_instance(bytes[instance_offset + instance_index * ABI_DRAW_INSTANCE_SIZE:], instance)
		if instance_index == 0 || instance.layer != instances[instance_index - 1].layer || instance.primitive != instances[instance_index - 1].primitive {
			record := bytes[batch_offset + batch_count * ABI_DRAW_BATCH_SIZE:]
			put_header(record, ABI_DRAW_BATCH_KIND, ABI_DRAW_BATCH_SIZE)
			put_u32(record, ABI_DRAW_BATCH_LAYER_OFFSET, instance.layer)
			put_u32(record, ABI_DRAW_BATCH_PRIMITIVE_OFFSET, u32(instance.primitive))
			put_u32(record, ABI_DRAW_BATCH_FIRST_INSTANCE_OFFSET, u32(instance_index))
			put_u32(record, ABI_DRAW_BATCH_INSTANCE_COUNT_OFFSET, 1)
			put_u64(record, ABI_DRAW_BATCH_RESERVED_OFFSET, 0)
			batch_count += 1
		} else {
			record := bytes[batch_offset + (batch_count - 1) * ABI_DRAW_BATCH_SIZE:]
			put_u32(record, ABI_DRAW_BATCH_INSTANCE_COUNT_OFFSET, get_u32(record, ABI_DRAW_BATCH_INSTANCE_COUNT_OFFSET) + 1)
		}
	}
	total_bytes := batch_offset + batch_count * ABI_DRAW_BATCH_SIZE
	put_header(bytes, ABI_DRAW_FRAME_KIND, ABI_DRAW_FRAME_SIZE)
	put_u32(bytes, ABI_DRAW_FRAME_EPOCH_OFFSET, simulation_state.epoch)
	put_u32(bytes, ABI_DRAW_FRAME_STATE_OFFSET, u32(simulation_state.state))
	put_u64(bytes, ABI_DRAW_FRAME_RESOURCE_ID_OFFSET, get_u64(session.map_storage.render_attachment.bytes, ABI_RENDER_RESOURCE_RESOURCE_ID_OFFSET))
	put_f64(bytes, ABI_DRAW_FRAME_PRESENTATION_MS_OFFSET, time_ms)
	put_f64(bytes, ABI_DRAW_FRAME_COMMITTED_MS_OFFSET, simulation_state.committed_ms)
	put_f64(bytes, ABI_DRAW_FRAME_SCALE_OFFSET, transform.scale)
	put_f64(bytes, ABI_DRAW_FRAME_CLIENT_LEFT_OFFSET, transform.client_left)
	put_f64(bytes, ABI_DRAW_FRAME_CLIENT_TOP_OFFSET, transform.client_top)
	put_u64(bytes, ABI_DRAW_FRAME_SCORE_OFFSET, u64(simulation_state.score.total))
	put_f64(bytes, ABI_DRAW_FRAME_ACCURACY_OFFSET, simulation_state.score.accuracy)
	put_f64(bytes, ABI_DRAW_FRAME_HEALTH_OFFSET, simulation_state.health.amount)
	put_u32(bytes, ABI_DRAW_FRAME_COMBO_OFFSET, simulation_state.score.accumulator.combo)
	put_u32(bytes, ABI_DRAW_FRAME_HIGHEST_COMBO_OFFSET, simulation_state.score.accumulator.highest_combo)
	put_relative_span(bytes, ABI_DRAW_FRAME_INSTANCES_OFFSET_OFFSET, instance_offset, len(instances), ABI_DRAW_INSTANCE_SIZE)
	put_relative_span(bytes, ABI_DRAW_FRAME_BATCHES_OFFSET_OFFSET, batch_offset, batch_count, ABI_DRAW_BATCH_SIZE)
	put_u64(bytes, ABI_DRAW_FRAME_TOTAL_BYTES_OFFSET, u64(total_bytes))
	abi_span(uintptr(raw_data(bytes)), u32(total_bytes))
	return abi_status(.OK)
}

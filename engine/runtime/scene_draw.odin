package engine_runtime

import "base:runtime"
import "core:mem"
import "core:slice"
import "core:math"
import core_types "../core_types"
import presentation "../presentation"
import simulation "../simulation"

scene_required_bytes :: proc(instance_count: u64, feedback_capacity: u64 = 0, cursor_capacity: u64 = 0, object_count: u64 = 0) -> (u64, core_types.Status) {
	if instance_count > u64(max(u32)) {
		return 0, .QUOTA_EXCEEDED
	}
	total: u64
	if !simulation.size_add(&total, presentation.Instance, instance_count) ||
	   !simulation.size_add(&total, u64, (ABI_SCENE_FRAME_SIZE + instance_count * (ABI_SCENE_INSTANCE_SIZE + ABI_SCENE_BATCH_SIZE) + 7) / 8) ||
	   !simulation.size_add(&total, int, feedback_capacity) || !simulation.size_add(&total, int, cursor_capacity) ||
	   !simulation.size_add(&total, f64, object_count) ||
	   !simulation.size_add(&total, presentation.Reveal, object_count) || !simulation.size_add(&total, int, object_count) ||
	   total > u64(max(u32)) {
		return 0, .QUOTA_EXCEEDED
	}
	return total, .OK
}

write_scene_capacity :: proc(session: ^Session, requested, required: u32, required_bytes: u64) {
	bytes := abi_storage.bytes[ABI_RENDER_CAPACITY_OUTPUT:ABI_RENDER_CAPACITY_OUTPUT + ABI_RENDER_CAPACITY_SIZE]
	put_header(bytes, ABI_RENDER_CAPACITY_KIND, ABI_RENDER_CAPACITY_SIZE)
	put_u32(bytes, ABI_RENDER_CAPACITY_REQUESTED_INSTANCES_OFFSET, requested)
	put_u32(bytes, ABI_RENDER_CAPACITY_REQUIRED_INSTANCES_OFFSET, required)
	put_u64(bytes, ABI_RENDER_CAPACITY_REQUIRED_BYTES_OFFSET, required_bytes)
	put_u64(bytes, ABI_RENDER_CAPACITY_RESOURCE_ID_OFFSET, get_u64(session.map_storage.scene_attachment.bytes, ABI_SCENE_RESOURCE_RESOURCE_ID_OFFSET))
	put_u32(bytes, ABI_RENDER_CAPACITY_EPOCH_OFFSET, session.simulation.epoch)
	put_u32(bytes, ABI_RENDER_CAPACITY_FLAGS_OFFSET, 0)
	abi_span(uintptr(raw_data(bytes)), ABI_RENDER_CAPACITY_SIZE)
}

scene_reserve :: proc(instance: ^Instance, engine, session_handle: core_types.Handle, instance_count: u64, arena_bytes: u64) -> core_types.Status {
	session, status := session_get(instance, engine, session_handle)
	if status != .OK {
		return status
	}
	if !session.gameplay || len(session.map_storage.scene_attachment.bytes) == 0 ||
	   session.simulation.state != .READY && session.simulation.state != .PAUSED {
		return .INVALID_STATE
	}
	feedback_capacity := u64(len(session.simulation.journal))
	cursor_capacity := u64(len(session.simulation.recording))
	object_count := u64(len(session.simulation.objects))
	required_bytes, count_status := scene_required_bytes(instance_count, feedback_capacity, cursor_capacity, object_count)
	if count_status != .OK {
		return count_status
	}
	engine_state, _ := engine_get(instance, engine)
	used := u64(len(session.draw_storage.arena.bytes)) + u64(len(session.scene_storage.arena.bytes)) +
		u64(len(session.arena.bytes)) + u64(len(session.voice_storage.arena.bytes))
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
	word_count := (ABI_SCENE_FRAME_SIZE + instance_count * (ABI_SCENE_INSTANCE_SIZE + ABI_SCENE_BATCH_SIZE) + 7) / 8
	words, _ := core_types.arena_take(&candidate.arena, u64, word_count)
	candidate.output = mem.slice_ptr(cast(^byte)raw_data(words), len(words) * 8)
	candidate.history.feedback_indices, _ = core_types.arena_take(&candidate.arena, int, feedback_capacity)
	candidate.history.cursor_indices, _ = core_types.arena_take(&candidate.arena, int, cursor_capacity)
	candidate.history.miss_durations_by_id, _ = core_types.arena_take(&candidate.arena, f64, object_count)
	for &object in session.map_storage.prepared_map.objects {
		candidate.history.miss_durations_by_id[object.id] = presentation.miss_duration_ms(&object)
	}
	active_status := presentation.initialize_active(&candidate.active, &session.map_storage.prepared_map, &candidate.arena)
	if active_status != .OK {
		core_types.arena_destroy(&candidate.arena)
		return active_status
	}
	presentation.initialize_scene_reveals(&candidate.active, session.map_storage.prepared_map.objects)
	core_types.arena_destroy(&session.scene_storage.arena)
	// Sole ownership transfer: candidate is not accessed after publication.
	session.scene_storage = candidate
	return .OK
}

@(export)
oe_session_scene_reserve :: proc "c" (engine, session_handle: core_types.Handle, request_address, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_output_get(engine, session_handle, span_output)
	if status != .OK {
		return abi_status(status)
	}
	if len(session.map_storage.scene_attachment.bytes) == 0 ||
	   session.simulation.state != .READY && session.simulation.state != .PAUSED {
		return abi_status(.INVALID_STATE)
	}
	status = abi_record(request_address, ABI_SCENE_RESERVE_KIND, ABI_SCENE_RESERVE_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	if get_u32(bytes, ABI_SCENE_RESERVE_FLAGS_OFFSET) != 0 || get_u64(bytes, ABI_SCENE_RESERVE_RESERVED_OFFSET) != 0 {
		return abi_status(.UNSUPPORTED)
	}
	requested := get_u32(bytes, ABI_SCENE_RESERVE_INSTANCE_CAPACITY_OFFSET)
	// Conservative bounded scene count; a zero request performs no allocation.
	required, capacity_status := scene_capacity_count(&abi_instance, engine, session)
	if capacity_status != .OK {
		return abi_status(capacity_status)
	}
	required_bytes, _ := scene_required_bytes(u64(required), u64(len(session.simulation.journal)), u64(len(session.simulation.recording)), u64(len(session.simulation.objects)))
	if requested == 0 {
		write_scene_capacity(session, requested, required, required_bytes)
		return abi_status(.OK)
	}
	status = scene_reserve(&abi_instance, engine, session_handle, u64(requested), get_u64(bytes, ABI_SCENE_RESERVE_ARENA_BYTES_OFFSET))
	if status != .OK {
		return abi_status(status)
	}
	write_scene_capacity(session, requested, required, required_bytes)
	return abi_status(.OK)
}

write_scene_instance :: proc(bytes: []byte, instance: presentation.Instance) {
	put_header(bytes, ABI_SCENE_INSTANCE_KIND, ABI_SCENE_INSTANCE_SIZE)
	put_u32(bytes, ABI_SCENE_INSTANCE_PRIMITIVE_OFFSET, u32(instance.primitive))
	put_u32(bytes, ABI_SCENE_INSTANCE_LAYER_OFFSET, instance.layer)
	put_u32(bytes, ABI_SCENE_INSTANCE_OBJECT_ID_OFFSET, instance.object_id)
	put_u32(bytes, ABI_SCENE_INSTANCE_COMPONENT_ID_OFFSET, instance.component_id)
	put_u32(bytes, ABI_SCENE_INSTANCE_ORDINAL_OFFSET, instance.ordinal)
	put_u32(bytes, ABI_SCENE_INSTANCE_FLAGS_OFFSET, instance.flags)
	put_f64(bytes, ABI_SCENE_INSTANCE_X_OFFSET, instance.x)
	put_f64(bytes, ABI_SCENE_INSTANCE_Y_OFFSET, instance.y)
	put_f64(bytes, ABI_SCENE_INSTANCE_SCALE_X_OFFSET, instance.scale_x)
	put_f64(bytes, ABI_SCENE_INSTANCE_SCALE_Y_OFFSET, instance.scale_y)
	put_f64(bytes, ABI_SCENE_INSTANCE_ROTATION_OFFSET, instance.rotation)
	put_f64(bytes, ABI_SCENE_INSTANCE_ALPHA_OFFSET, instance.alpha)
	put_f64(bytes, ABI_SCENE_INSTANCE_PROGRESS_OFFSET, instance.progress)
	put_u32(bytes, ABI_SCENE_INSTANCE_COLOUR_OFFSET, instance.colour)
	put_u32(bytes, ABI_SCENE_INSTANCE_GLYPH_OFFSET, instance.glyph)
	put_u32(bytes, ABI_SCENE_INSTANCE_GEOMETRY_FIRST_OFFSET, instance.geometry_first)
	put_u32(bytes, ABI_SCENE_INSTANCE_GEOMETRY_COUNT_OFFSET, instance.geometry_count)
	put_u64(bytes, ABI_SCENE_INSTANCE_RESERVED_OFFSET, 0)
	put_f64(bytes, ABI_SCENE_INSTANCE_CLIP_START_OFFSET, instance.clip_start)
	put_f64(bytes, ABI_SCENE_INSTANCE_CLIP_END_OFFSET, instance.clip_end)
}

@(export)
oe_session_scene_draw :: proc "c" (engine, session_handle: core_types.Handle, time_ms: f64, viewport_address, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_output_get(engine, session_handle, span_output)
	if status != .OK {
		return abi_status(status)
	}
	if !core_types.finite(time_ms) {
		return abi_status(.INVALID_ARGUMENT)
	}
	if len(session.scene_storage.output) == 0 || len(session.map_storage.scene_attachment.bytes) == 0 {
		return abi_status(.INVALID_STATE)
	}
	transform, transform_status := read_viewport_transform(viewport_address)
	if transform_status != .OK {
		return abi_status(transform_status)
	}
	simulation_state := &session.simulation
	projection := simulation.project(simulation_state)
	status = presentation.refresh_active(&session.scene_storage.active, projection, time_ms, simulation_state.epoch, true)
	if status != .OK {
		return abi_status(status)
	}
	// One build: the builder counts past capacity without writing, so the
	// same pass yields both the required-count check and the instances.
	builder := presentation.Builder{instances = session.scene_storage.instances}
	presentation.refresh_history(&session.scene_storage.history, projection, time_ms, simulation_state.epoch)
	presentation.build_scene(&builder, &session.scene_storage.active, &session.scene_storage.history, projection,
		session.map_storage.scene_attachment.ranges, time_ms)
	scene_summary := simulation.score_summary(simulation_state, simulation_state.committed_ms)
	presentation.hud(&builder, u64(scene_summary.score), scene_summary.accuracy, scene_summary.health, scene_summary.combo)
	presentation.finish_scene(&builder)
	if builder.count > len(session.scene_storage.instances) {
		required_bytes, _ := scene_required_bytes(u64(builder.count), u64(len(session.simulation.journal)), u64(len(session.simulation.recording)), u64(len(session.simulation.objects)))
		write_scene_capacity(session, u32(len(session.scene_storage.instances)), u32(builder.count), required_bytes)
		return abi_status(.OUTPUT_REQUIRED)
	}
	presentation.refresh_history(&session.scene_storage.history, projection, time_ms, simulation_state.epoch)
	instances := builder.instances[:builder.count]
	presentation.order_instances(instances)
	bytes := session.scene_storage.output
	instance_offset := ABI_SCENE_FRAME_SIZE
	batch_offset := instance_offset + len(instances) * ABI_SCENE_INSTANCE_SIZE
	batch_count := 0
	for instance, instance_index in instances {
		write_scene_instance(bytes[instance_offset + instance_index * ABI_SCENE_INSTANCE_SIZE:], instance)
		if instance_index == 0 || presentation.starts_scene_batch(instance, instances[instance_index - 1]) {
			record := bytes[batch_offset + batch_count * ABI_SCENE_BATCH_SIZE:]
			put_header(record, ABI_SCENE_BATCH_KIND, ABI_SCENE_BATCH_SIZE)
			put_u32(record, ABI_SCENE_BATCH_LAYER_OFFSET, instance.layer)
			put_u32(record, ABI_SCENE_BATCH_PRIMITIVE_OFFSET, instance.primitive == .PATH ? 4 : 0)
			put_u32(record, ABI_SCENE_BATCH_FIRST_INSTANCE_OFFSET, u32(instance_index))
			put_u32(record, ABI_SCENE_BATCH_INSTANCE_COUNT_OFFSET, 1)
			put_u64(record, ABI_SCENE_BATCH_RESERVED_OFFSET, 0)
			batch_count += 1
		} else {
			record := bytes[batch_offset + (batch_count - 1) * ABI_SCENE_BATCH_SIZE:]
			put_u32(record, ABI_SCENE_BATCH_INSTANCE_COUNT_OFFSET, get_u32(record, ABI_SCENE_BATCH_INSTANCE_COUNT_OFFSET) + 1)
		}
	}
	total_bytes := batch_offset + batch_count * ABI_SCENE_BATCH_SIZE
	put_header(bytes, ABI_SCENE_FRAME_KIND, ABI_SCENE_FRAME_SIZE)
	put_u32(bytes, ABI_SCENE_FRAME_EPOCH_OFFSET, simulation_state.epoch)
	put_u32(bytes, ABI_SCENE_FRAME_STATE_OFFSET, u32(simulation_state.state))
	put_u64(bytes, ABI_SCENE_FRAME_RESOURCE_ID_OFFSET, get_u64(session.map_storage.scene_attachment.bytes, ABI_SCENE_RESOURCE_RESOURCE_ID_OFFSET))
	put_f64(bytes, ABI_SCENE_FRAME_PRESENTATION_MS_OFFSET, time_ms)
	put_f64(bytes, ABI_SCENE_FRAME_COMMITTED_MS_OFFSET, simulation_state.committed_ms)
	put_f64(bytes, ABI_SCENE_FRAME_SCALE_OFFSET, transform.scale)
	put_f64(bytes, ABI_SCENE_FRAME_CLIENT_LEFT_OFFSET, transform.client_left)
	put_f64(bytes, ABI_SCENE_FRAME_CLIENT_TOP_OFFSET, transform.client_top)
	summary := simulation.score_summary(simulation_state, simulation_state.committed_ms)
	put_u64(bytes, ABI_SCENE_FRAME_SCORE_OFFSET, u64(summary.score))
	put_f64(bytes, ABI_SCENE_FRAME_ACCURACY_OFFSET, summary.accuracy)
	put_f64(bytes, ABI_SCENE_FRAME_HEALTH_OFFSET, summary.health)
	put_u32(bytes, ABI_SCENE_FRAME_COMBO_OFFSET, summary.combo)
	put_u32(bytes, ABI_SCENE_FRAME_HIGHEST_COMBO_OFFSET, summary.highest_combo)
	put_relative_span(bytes, ABI_SCENE_FRAME_INSTANCES_OFFSET_OFFSET, instance_offset, len(instances), ABI_SCENE_INSTANCE_SIZE)
	put_relative_span(bytes, ABI_SCENE_FRAME_BATCHES_OFFSET_OFFSET, batch_offset, batch_count, ABI_SCENE_BATCH_SIZE)
	put_u64(bytes, ABI_SCENE_FRAME_TOTAL_BYTES_OFFSET, u64(total_bytes))
	abi_span(uintptr(raw_data(bytes)), u32(total_bytes))
	return abi_status(.OK)
}

@(export)
oe_scene_capabilities :: proc "c" (engine: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	_, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return abi_status(status)
	}
	if !output_span_valid(span_output) {
		return abi_status(.INVALID_ARGUMENT)
	}
	bytes := abi_storage.bytes[ABI_RENDER_CAPACITY_OUTPUT:ABI_RENDER_CAPACITY_OUTPUT + ABI_SCENE_CAPABILITIES_SIZE]
	put_header(bytes, ABI_SCENE_CAPABILITIES_KIND, ABI_SCENE_CAPABILITIES_SIZE)
	put_u32(bytes, ABI_SCENE_CAPABILITIES_RESOURCE_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_SCENE_CAPABILITIES_DRAW_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_SCENE_CAPABILITIES_PRIMITIVE_MASK_OFFSET, 31)
	put_u32(bytes, ABI_SCENE_CAPABILITIES_FLAGS_OFFSET, 0) // No aggregate Play or upstream acceptance claim.
	put_u32(bytes, ABI_SCENE_CAPABILITIES_MAX_INSTANCES_OFFSET, MAX_DRAW_INSTANCES)
	put_u32(bytes, ABI_SCENE_CAPABILITIES_MAX_COMMANDS_OFFSET, MAX_DRAW_INSTANCES)
	put_u32(bytes, ABI_SCENE_CAPABILITIES_MAX_UPLOAD_BYTES_OFFSET, MAX_DRAW_INSTANCES * 64)
	put_u32(bytes, ABI_SCENE_CAPABILITIES_RESERVED_OFFSET, 0)
	abi_span(uintptr(raw_data(bytes)), ABI_SCENE_CAPABILITIES_SIZE)
	return abi_status(.OK)
}

Scene_Capacity_Event :: struct {
	time_ms: f64,
	weight: i64,
}

scene_capacity_count :: proc(instance: ^Instance, engine: core_types.Handle, session: ^Session) -> (u32, core_types.Status) {
	objects := session.map_storage.prepared_map.objects
	engine_state, _ := engine_get(instance, engine)
	byte_count := u64(len(objects)) * 2 * size_of(Scene_Capacity_Event)
	used := u64(len(session.arena.bytes)) + u64(len(session.voice_storage.arena.bytes)) +
		u64(len(session.draw_storage.arena.bytes)) + u64(len(session.scene_storage.arena.bytes))
	if byte_count > u64(max(u32)) || used > engine_state.quotas.arena_bytes || byte_count > engine_state.quotas.arena_bytes - used {
		return 0, .QUOTA_EXCEEDED
	}
	if len(objects) == 0 {
		return 2176, .OK
	}
	scratch, status := core_types.arena_create(byte_count, instance.allocator)
	if status != .OK {
		return 0, status
	}
	defer core_types.arena_destroy(&scratch)
	events, _ := core_types.arena_take(&scratch, Scene_Capacity_Event, u64(len(objects)) * 2)
	for &object, object_index in objects {
		weight := i64(64 + len(object.components) * 24)
		reveal_ms := object.time_ms - object.preempt_ms
		if object_index > 0 && !object.new_combo && object.kind != .SPINNER && objects[object_index - 1].kind != .SPINNER {
			previous := &objects[object_index - 1]
			difference := object.position + object.stack_offset - previous.end_position - previous.stack_offset
			distance := math.sqrt(difference[0] * difference[0] + difference[1] * difference[1])
			if !core_types.finite(distance) || distance > 32_000_000 {
				return 0, .QUOTA_EXCEEDED
			}
			weight += i64(distance / 32)
			reveal_ms = min(reveal_ms, previous.end_time_ms - 800)
		}
		// Contains all supported judgement feedback including late circle hits.
		expiry_ms := max(object.end_time_ms, object.time_ms + 400) + 800
		events[object_index * 2] = {reveal_ms, weight}
		events[object_index * 2 + 1] = {expiry_ms, -weight}
	}
	slice.sort_by(events, proc(left, right: Scene_Capacity_Event) -> bool {
		return left.time_ms < right.time_ms || left.time_ms == right.time_ms && left.weight > right.weight
	})
	active_weight: i64
	maximum_weight: i64
	for event in events {
		active_weight += event.weight
		maximum_weight = max(maximum_weight, active_weight)
	}
	required := u64(maximum_weight) + 128 + min(u64(len(session.simulation.recording)), 2048)
	if required > MAX_DRAW_INSTANCES {
		return 0, .QUOTA_EXCEEDED
	}
	return u32(required), .OK
}

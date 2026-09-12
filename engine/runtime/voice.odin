package engine_runtime

import "base:runtime"
import core_types "../core_types"
import audio_protocol "../audio_protocol"
import simulation "../simulation"

Voice_Storage :: struct {
	arena: core_types.Arena,
	capacity: u32,
	authoritative: bool,
}
ABI_VOICE_CAPACITY_OUTPUT :: 880
ABI_TRANSPORT_CAPABILITIES_OUTPUT :: 920
MAX_VOICE_COMMANDS :: 1_000_000

voice_required_bytes :: proc(command_count: u64) -> (u64, core_types.Status) {
	if command_count > MAX_VOICE_COMMANDS {
		return 0, .QUOTA_EXCEEDED
	}
	return ABI_VOICE_FRAME_SIZE + command_count * ABI_VOICE_COMMAND_SIZE, .OK
}

voice_reserve :: proc(instance: ^Instance, engine, session_handle: core_types.Handle, command_count: u64, arena_bytes: u64, authoritative := false) -> core_types.Status {
	session, status := session_get(instance, engine, session_handle)
	if status != .OK {
		return status
	}
	if !session.gameplay || session.simulation.state != .READY && session.simulation.state != .PAUSED {
		return .INVALID_STATE
	}
	required, count_status := voice_storage_bytes(session, command_count, authoritative)
	if count_status != .OK {
		return count_status
	}
	if (authoritative || session.voice_storage.authoritative) && session.simulation.state != .READY {
		return .INVALID_STATE
	}
	if authoritative && command_count < simulation.voice_command_capacity(&session.simulation) {
		return .QUOTA_EXCEEDED
	}
	engine_state, _ := engine_get(instance, engine)
	used := u64(len(session.arena.bytes)) + u64(len(session.draw_storage.arena.bytes))
	if command_count == 0 || arena_bytes < required || arena_bytes > u64(max(u32)) ||
		used > engine_state.quotas.arena_bytes || arena_bytes > engine_state.quotas.arena_bytes - used {
		return .QUOTA_EXCEEDED
	}
	candidate, allocated := core_types.arena_create(arena_bytes, instance.allocator)
	if allocated != .OK {
		return allocated
	}
	core_types.arena_destroy(&session.voice_storage.arena)
	// Sole ownership transfer. The prior publication survives every failure.
	session.voice_storage.arena = candidate
	session.voice_storage.capacity = u32(command_count)
	session.voice_storage.authoritative = authoritative
	session.simulation.voices = {}
	if authoritative {
		output_bytes, _ := voice_required_bytes(command_count)
		session.voice_storage.arena.used = output_bytes
		session.simulation.voices.commands, _ = core_types.arena_take(&session.voice_storage.arena, audio_protocol.Command, command_count)
		session.simulation.voices.states, _ = core_types.arena_take(&session.voice_storage.arena, simulation.Voice_State, u64(len(session.simulation.sample_bindings)))
		session.simulation.voices.deadlines.minimum_reveal, _ = core_types.arena_take(&session.voice_storage.arena, f64, simulation.candidate_slots(len(session.simulation.objects)))
		simulation.reset_voices(&session.simulation)
	}
	return .OK
}

voice_storage_bytes :: proc(session: ^Session, command_count: u64, authoritative: bool) -> (u64, core_types.Status) {
	required, status := voice_required_bytes(command_count)
	if status != .OK {
		return 0, status
	}
	if authoritative && (!simulation.size_add(&required, audio_protocol.Command, command_count) || !simulation.size_add(&required, simulation.Voice_State, u64(len(session.simulation.sample_bindings))) || !simulation.size_add(&required, f64, simulation.candidate_slots(len(session.simulation.objects)))) {
		return 0, .QUOTA_EXCEEDED
	}
	return required, .OK
}

write_voice_capacity :: proc(session: ^Session, requested, required: u32, authoritative := false) {
	bytes := abi_storage.bytes[ABI_VOICE_CAPACITY_OUTPUT:ABI_VOICE_CAPACITY_OUTPUT + ABI_VOICE_CAPACITY_SIZE]
	put_header(bytes, ABI_VOICE_CAPACITY_KIND, ABI_VOICE_CAPACITY_SIZE)
	put_u32(bytes, ABI_VOICE_CAPACITY_REQUESTED_COMMANDS_OFFSET, requested)
	put_u32(bytes, ABI_VOICE_CAPACITY_REQUIRED_COMMANDS_OFFSET, required)
	required_bytes, _ := voice_storage_bytes(session, u64(required), authoritative)
	put_u64(bytes, ABI_VOICE_CAPACITY_REQUIRED_BYTES_OFFSET, required_bytes)
	put_u32(bytes, ABI_VOICE_CAPACITY_EPOCH_OFFSET, session.simulation.epoch)
	put_u32(bytes, ABI_VOICE_CAPACITY_FLAGS_OFFSET, 0)
	abi_span(uintptr(raw_data(bytes)), ABI_VOICE_CAPACITY_SIZE)
}

@(export)
oe_session_voice_reserve :: proc "c" (engine, session_handle: core_types.Handle, request_address, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return abi_status(.INVALID_ARGUMENT)
	}
	status = abi_record(request_address, ABI_VOICE_RESERVE_KIND, ABI_VOICE_RESERVE_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	request := abi_storage.bytes[:ABI_INPUT_SIZE]
	if get_u32(request, ABI_VOICE_RESERVE_FLAGS_OFFSET) > 1 || get_u64(request, ABI_VOICE_RESERVE_RESERVED_OFFSET) != 0 {
		return abi_status(.UNSUPPORTED)
	}
	requested := get_u32(request, ABI_VOICE_RESERVE_COMMAND_CAPACITY_OFFSET)
	authoritative := get_u32(request, ABI_VOICE_RESERVE_FLAGS_OFFSET) == 1
	required_count := authoritative ? simulation.voice_command_capacity(&session.simulation) : u64(len(session.simulation.audio))
	if required_count > MAX_VOICE_COMMANDS {
		return abi_status(.QUOTA_EXCEEDED)
	}
	required := u32(required_count)
	_, count_status := voice_required_bytes(u64(required))
	if count_status != .OK {
		return abi_status(count_status)
	}
	if requested != 0 {
		status = voice_reserve(&abi_instance, engine, session_handle, u64(requested), get_u64(request, ABI_VOICE_RESERVE_ARENA_BYTES_OFFSET), authoritative)
		if status != .OK {
			return abi_status(status)
		}
	}
	write_voice_capacity(session, requested, required, authoritative)
	return abi_status(.OK)
}

write_voice_command :: proc(bytes: []byte, command: audio_protocol.Command) {
	put_header(bytes, ABI_VOICE_COMMAND_KIND, ABI_VOICE_COMMAND_SIZE)
	put_u64(bytes, ABI_VOICE_COMMAND_SEQUENCE_OFFSET, command.sequence)
	put_u32(bytes, ABI_VOICE_COMMAND_EPOCH_OFFSET, command.epoch)
	put_u32(bytes, ABI_VOICE_COMMAND_COMMAND_KIND_OFFSET, u32(command.command_kind))
	put_f64(bytes, ABI_VOICE_COMMAND_TIME_MS_OFFSET, command.time_ms)
	put_u64(bytes, ABI_VOICE_COMMAND_VOICE_ID_OFFSET, command.voice_id)
	put_u64(bytes, ABI_VOICE_COMMAND_ASSET_ID_OFFSET, command.asset_id)
	put_f64(bytes, ABI_VOICE_COMMAND_VOLUME_OFFSET, command.volume)
	put_f64(bytes, ABI_VOICE_COMMAND_PAN_OFFSET, command.pan)
	put_f64(bytes, ABI_VOICE_COMMAND_RATE_OFFSET, command.rate)
	put_f64(bytes, ABI_VOICE_COMMAND_DURATION_MS_OFFSET, command.duration_ms)
	put_f64(bytes, ABI_VOICE_COMMAND_LATENESS_THRESHOLD_MS_OFFSET, command.lateness_threshold_ms)
	put_u32(bytes, ABI_VOICE_COMMAND_PARAMETER_MASK_OFFSET, command.parameter_mask)
	put_u32(bytes, ABI_VOICE_COMMAND_LATE_POLICY_OFFSET, u32(command.late_policy))
	put_u32(bytes, ABI_VOICE_COMMAND_OBJECT_ID_OFFSET, command.object_id)
	put_u32(bytes, ABI_VOICE_COMMAND_COMPONENT_ID_OFFSET, command.component_id)
	put_u32(bytes, ABI_VOICE_COMMAND_FLAGS_OFFSET, command.flags)
	put_u32(bytes, ABI_VOICE_COMMAND_RESERVED_OFFSET, 0)
}

@(export)
oe_session_voice_output :: proc "c" (engine, session_handle: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return abi_status(.INVALID_ARGUMENT)
	}
	if len(session.voice_storage.arena.bytes) == 0 {
		return abi_status(.INVALID_STATE)
	}
	simulation_state := &session.simulation
	events := simulation_state.audio[simulation_state.acknowledged_audio_count:simulation_state.audio_count]
	command_count := session.voice_storage.authoritative ? simulation_state.voices.count - simulation_state.voices.acknowledged : len(events)
	if command_count > int(session.voice_storage.capacity) {
		write_voice_capacity(session, session.voice_storage.capacity, u32(command_count), session.voice_storage.authoritative)
		return abi_status(.OUTPUT_REQUIRED)
	}
	if session.output_token == max(u64) {
		return abi_status(.QUOTA_EXCEEDED)
	}
	for event in events {
		if !audio_protocol.valid_command(audio_protocol.one_shot_command(event)) {
			return abi_status(.INVALID_STATE)
		}
	}
	bytes := session.voice_storage.arena.bytes
	for command_index := 0; command_index < command_count; command_index += 1 {
		command: audio_protocol.Command
		if session.voice_storage.authoritative {
			command = simulation_state.voices.commands[simulation_state.voices.acknowledged + command_index]
		} else {
			command = audio_protocol.one_shot_command(events[command_index])
		}
		command.epoch = simulation_state.epoch
		write_voice_command(bytes[ABI_VOICE_FRAME_SIZE + command_index * ABI_VOICE_COMMAND_SIZE:], command)
	}
	session.output_token += 1
	// A voice-only read never consumes unseen gameplay judgement records.
	session.output_judgement_count = simulation_state.acknowledged_count
	session.output_audio_count = simulation_state.audio_count
	session.output_voice_count = simulation_state.voices.count
	put_header(bytes, ABI_VOICE_FRAME_KIND, ABI_VOICE_FRAME_SIZE)
	put_u32(bytes, ABI_VOICE_FRAME_EPOCH_OFFSET, simulation_state.epoch)
	put_u32(bytes, ABI_VOICE_FRAME_FLAGS_OFFSET, session.voice_storage.authoritative ? 1 : 0)
	put_u64(bytes, ABI_VOICE_FRAME_BATCH_TOKEN_OFFSET, session.output_token)
	put_f64(bytes, ABI_VOICE_FRAME_COMMITTED_MS_OFFSET, simulation_state.committed_ms)
	put_relative_span(bytes, ABI_VOICE_FRAME_COMMANDS_OFFSET_OFFSET, ABI_VOICE_FRAME_SIZE, command_count, ABI_VOICE_COMMAND_SIZE)
	put_u32(bytes, ABI_VOICE_FRAME_RESERVED_OFFSET, 0)
	total_bytes := ABI_VOICE_FRAME_SIZE + command_count * ABI_VOICE_COMMAND_SIZE
	put_u64(bytes, ABI_VOICE_FRAME_TOTAL_BYTES_OFFSET, u64(total_bytes))
	put_u64(bytes, ABI_VOICE_FRAME_RESERVED_TAIL_OFFSET, 0)
	abi_span(uintptr(raw_data(bytes)), u32(total_bytes), session.output_token)
	return abi_status(.OK)
}

@(export)
oe_transport_capabilities :: proc "c" (engine: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	_, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return abi_status(status)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return abi_status(.INVALID_ARGUMENT)
	}
	bytes := abi_storage.bytes[ABI_TRANSPORT_CAPABILITIES_OUTPUT:ABI_TRANSPORT_CAPABILITIES_OUTPUT + ABI_TRANSPORT_CAPABILITIES_SIZE]
	put_header(bytes, ABI_TRANSPORT_CAPABILITIES_KIND, ABI_TRANSPORT_CAPABILITIES_SIZE)
	put_u32(bytes, ABI_TRANSPORT_CAPABILITIES_RESOURCE_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_TRANSPORT_CAPABILITIES_CIRCLE_ANIMATION_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_TRANSPORT_CAPABILITIES_DRAW_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_TRANSPORT_CAPABILITIES_VOICE_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_TRANSPORT_CAPABILITIES_VOICE_COMMAND_MASK_OFFSET, 15) // Opt-in authoritative producer; legacy reserve stays one-shot.
	put_u32(bytes, ABI_TRANSPORT_CAPABILITIES_FLAGS_OFFSET, 1) // Circle-only draw producer.
	put_u32(bytes, ABI_TRANSPORT_CAPABILITIES_MAX_DRAW_INSTANCES_OFFSET, MAX_DRAW_INSTANCES)
	put_u32(bytes, ABI_TRANSPORT_CAPABILITIES_RESERVED_OFFSET, 0)
	abi_span(uintptr(raw_data(bytes)), ABI_TRANSPORT_CAPABILITIES_SIZE)
	return abi_status(.OK)
}

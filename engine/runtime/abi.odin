package engine_runtime

import "base:runtime"
import core_types "../core_types"
import simulation "../simulation"

// ABI v2 M0 bootstrap mailbox: input [0,256), result [256,288), error
// [320,384), read-only capability record [512,576). Addresses outside the
// mailbox are never dereferenced. Large map bytes use engine-owned inbox tokens.
ABI_MAILBOX_SIZE :: 1024
ABI_INPUT_SIZE :: 256
ABI_OUTPUT_OFFSET :: 256
ABI_OUTPUT_SIZE :: 24
ABI_ERROR_OFFSET :: 320
ABI_CAPABILITIES_OFFSET :: 512
ABI_PREPARATION_CAPABILITIES_OFFSET :: 576
ABI_BYTE_SPAN_ADDRESS_OFFSET :: 0
ABI_BYTE_SPAN_COUNT_OFFSET :: 8
ABI_BYTE_SPAN_RESERVED_OFFSET :: 12
ABI_BYTE_SPAN_TOKEN_OFFSET :: 16
ABI_Mailbox :: struct #align (16) {
	bytes: [ABI_MAILBOX_SIZE]byte,
}
abi_storage: ABI_Mailbox
abi_instance: Instance
abi_ready: bool
get_u32 :: proc(bytes: []byte, byte_offset: int) -> u32 {
	return(
		u32(bytes[byte_offset]) |
		u32(bytes[byte_offset + 1]) << 8 |
		u32(bytes[byte_offset + 2]) << 16 |
		u32(bytes[byte_offset + 3]) << 24 \
	)
}

get_u64 :: proc(bytes: []byte, byte_offset: int) -> u64 {
	return u64(get_u32(bytes, byte_offset)) | u64(get_u32(bytes, byte_offset + 4)) << 32
}

put_u32 :: proc(bytes: []byte, byte_offset: int, value: u32) {
	for byte_index in 0 ..< 4 {
		bytes[byte_offset + byte_index] = byte(value >> u32(byte_index * 8))
	}
}

put_u64 :: proc(bytes: []byte, byte_offset: int, value: u64) {
	put_u32(bytes, byte_offset, u32(value))
	put_u32(bytes, byte_offset + 4, u32(value >> 32))
}

put_header :: proc(bytes: []byte, kind, size: u32) {
	put_u32(bytes, ABI_RECORD_KIND_OFFSET, kind | 1 << 16)
	put_u32(bytes, ABI_RECORD_BYTE_SIZE_OFFSET, size)
}

abi_base :: proc() -> uintptr {
	return uintptr(&abi_storage.bytes[0])
}

abi_start :: proc() -> core_types.Status {
	context = runtime.default_context()
	if !abi_ready {
		status: core_types.Status
		abi_instance, status = instance_create()
		if status != .OK {
			return status
		}
		abi_ready = true
	}
	return .OK
}

abi_error :: proc(error: core_types.Error) -> u32 {
	bytes := abi_storage.bytes[ABI_ERROR_OFFSET:ABI_ERROR_OFFSET + ABI_ERROR_SIZE]
	for &value in bytes {
		value = 0
	}
	put_header(bytes, ABI_ERROR_KIND, ABI_ERROR_SIZE)
	put_u32(bytes, ABI_ERROR_STATUS_OFFSET, u32(error.status))
	put_u32(bytes, ABI_ERROR_CODE_OFFSET, u32(error.code))
	put_u32(bytes, ABI_ERROR_LINE_OFFSET, error.line)
	put_u32(bytes, ABI_ERROR_COLUMN_OFFSET, error.column)
	put_u64(bytes, ABI_ERROR_REQUESTED_OFFSET, error.requested)
	put_u64(bytes, ABI_ERROR_LIMIT_OFFSET, error.limit)
	put_u32(bytes, ABI_ERROR_SEVERITY_OFFSET, error.status == .OK ? 0 : 1)
	put_u32(bytes, ABI_ERROR_MESSAGE_STRIDE_OFFSET, 1)
	return u32(error.status)
}

abi_status :: proc(status: core_types.Status) -> u32 {
	return abi_error({status = status})
}

abi_record :: proc(address: uintptr, kind, minimum: u32) -> core_types.Status {
	if address != abi_base() {
		return .INVALID_ARGUMENT
	}
	bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	if get_u32(bytes, ABI_RECORD_KIND_OFFSET) != (kind | 1 << 16) {
		return .UNSUPPORTED
	}
	size := get_u32(bytes, ABI_RECORD_BYTE_SIZE_OFFSET)
	if size < minimum || size > ABI_INPUT_SIZE || size & 7 != 0 {
		return .INVALID_ARGUMENT
	}
	return .OK
}

abi_outputs :: proc(output_address, error_address: uintptr) -> bool {
	return output_address == abi_base() + ABI_OUTPUT_OFFSET && error_address == abi_base() + ABI_ERROR_OFFSET
}

abi_span :: proc(address: uintptr, count: u32, token: u64 = 0) {
	bytes := abi_storage.bytes[ABI_OUTPUT_OFFSET:ABI_OUTPUT_OFFSET + ABI_OUTPUT_SIZE]
	put_u64(bytes, ABI_BYTE_SPAN_ADDRESS_OFFSET, u64(address))
	put_u32(bytes, ABI_BYTE_SPAN_COUNT_OFFSET, count)
	put_u32(bytes, ABI_BYTE_SPAN_RESERVED_OFFSET, 0)
	put_u64(bytes, ABI_BYTE_SPAN_TOKEN_OFFSET, token)
}

@(export)
oe_abi_control :: proc "c" () -> uintptr {
	context = runtime.default_context()
	return abi_base()
}

@(export)
oe_engine_create :: proc "c" (creation_info, handle_output, error: uintptr) -> u32 {
	context = runtime.default_context()
	if !abi_outputs(handle_output, error) {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	status := abi_record(creation_info, ABI_ENGINE_CREATE_KIND, ABI_ENGINE_CREATE_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	if get_u32(abi_storage.bytes[:], ABI_ENGINE_CREATE_FLAGS_OFFSET) != 1 ||
	   get_u32(abi_storage.bytes[:], ABI_ENGINE_CREATE_RESERVED_OFFSET) != 0 {
		return abi_status(.UNSUPPORTED)
	}
	status = abi_start()
	if status != .OK {
		return abi_status(status)
	}
	handle, created := engine_create(&abi_instance)
	if created == .OK {
		put_u64(abi_storage.bytes[:], ABI_OUTPUT_OFFSET, u64(handle))
	}
	return abi_status(created)
}

@(export)
oe_engine_capabilities :: proc "c" (engine: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	engine_state, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return abi_status(status)
	}
	bytes := abi_storage.bytes[ABI_CAPABILITIES_OFFSET:ABI_CAPABILITIES_OFFSET + ABI_CAPABILITIES_SIZE]
	put_header(bytes, ABI_CAPABILITIES_KIND, ABI_CAPABILITIES_SIZE)
	put_u32(bytes, ABI_CAPABILITIES_ABI_MAJOR_OFFSET, 2)
	put_u32(bytes, ABI_CAPABILITIES_ABI_MINOR_OFFSET, 0)
	put_u32(bytes, ABI_CAPABILITIES_FOUNDATION_OFFSET, 1)
	put_u32(bytes, ABI_CAPABILITIES_GAMEPLAY_OFFSET, 0)
	put_u32(bytes, ABI_CAPABILITIES_LEGACY_MAX_OFFSET, 14)
	put_u32(bytes, ABI_CAPABILITIES_LAZER_VERSION_OFFSET, 128)
	put_u64(bytes, ABI_CAPABILITIES_RAW_BYTES_OFFSET, engine_state.quotas.raw_bytes)
	put_u64(bytes, ABI_CAPABILITIES_ARENA_BYTES_OFFSET, engine_state.quotas.arena_bytes)
	put_u64(bytes, ABI_CAPABILITIES_BUILD_ID_OFFSET, 1)
	put_u32(bytes, ABI_CAPABILITIES_BEHAVIOR_ID_OFFSET, 202608042)
	put_u32(bytes, ABI_CAPABILITIES_NUMERIC_MODE_OFFSET, 3)
	abi_span(abi_base() + ABI_CAPABILITIES_OFFSET, ABI_CAPABILITIES_SIZE)
	return abi_status(.OK)
}

@(export)
oe_buffer_reserve :: proc "c" (
	engine: core_types.Handle,
	kind: u32,
	count: u64,
	span_output: uintptr,
) -> u32 {
	context = runtime.default_context()
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	if kind != 1 {
		return abi_status(.UNSUPPORTED)
	}
	bytes, token, status := buffer_reserve(&abi_instance, engine, count)
	if status == .OK {
		abi_span(uintptr(raw_data(bytes)), u32(len(bytes)), token)
	}
	return abi_status(status)
}

@(export)
oe_map_prepare :: proc "c" (engine: core_types.Handle, creation_info, handle_output, error: uintptr) -> u32 {
	context = runtime.default_context()
	if !abi_outputs(handle_output, error) {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	status := abi_record(creation_info, ABI_MAP_PREPARE_KIND, ABI_MAP_PREPARE_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	// Flag 1 is foundation; flag 2 requests immutable M1 preparation.
	if (get_u32(bytes, ABI_MAP_PREPARE_FLAGS_OFFSET) != 1 &&
		   get_u32(bytes, ABI_MAP_PREPARE_FLAGS_OFFSET) != 2) ||
	   get_u32(bytes, ABI_MAP_PREPARE_RESERVED_OFFSET) != 0 {
		return abi_status(.UNSUPPORTED)
	}
	engine_state, found := engine_get(&abi_instance, engine)
	if found != .OK {
		return abi_status(found)
	}
	token, offset, count :=
		get_u64(bytes, ABI_MAP_PREPARE_TOKEN_OFFSET),
		u64(get_u32(bytes, ABI_MAP_PREPARE_OFFSET_OFFSET)),
		u64(get_u32(bytes, ABI_MAP_PREPARE_COUNT_OFFSET))
	if token == 0 ||
	   token != engine_state.token ||
	   offset > u64(len(engine_state.inbox.bytes)) ||
	   count > u64(len(engine_state.inbox.bytes)) - offset {
		return abi_status(.INVALID_ARGUMENT)
	}
	handle, preparation_error := map_prepare(
		&abi_instance,
		engine,
		string(engine_state.inbox.bytes[int(offset):int(offset + count)]),
		get_u32(bytes, ABI_MAP_PREPARE_FLAGS_OFFSET) == 2,
	)
	if preparation_error.status == .OK {
		put_u64(abi_storage.bytes[:], ABI_OUTPUT_OFFSET, u64(handle))
	}
	return abi_error(preparation_error)
}

@(export)
oe_map_describe :: proc "c" (engine, map_handle: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	map_resource, status := map_get(&abi_instance, engine, map_handle)
	if status != .OK {
		return abi_status(status)
	}
	if map_resource.fully_prepared {
		bytes := map_resource.prepared_map.description.bytes
		abi_span(uintptr(raw_data(bytes)), u32(len(bytes)))
		return abi_status(.OK)
	}
	bytes := map_resource.descriptor[:]
	put_header(bytes, ABI_MAP_DESCRIPTOR_KIND, ABI_MAP_DESCRIPTOR_SIZE)
	put_u32(bytes, ABI_MAP_DESCRIPTOR_FORMAT_VERSION_OFFSET, map_resource.decoded.format_version)
	put_u32(bytes, ABI_MAP_DESCRIPTOR_FOUNDATION_OFFSET, 1)
	put_u32(bytes, ABI_MAP_DESCRIPTOR_OBJECTS_OFFSET, u32(len(map_resource.decoded.objects)))
	put_u32(bytes, ABI_MAP_DESCRIPTOR_RAW_TIMING_OFFSET, u32(len(map_resource.decoded.timing)))
	put_u64(
		bytes,
		ABI_MAP_DESCRIPTOR_LIVE_ARENA_BYTES_OFFSET,
		u64(len(map_resource.decoded.arena.bytes) + len(map_resource.points.arena.bytes)),
	)
	abi_span(uintptr(raw_data(bytes)), ABI_MAP_DESCRIPTOR_SIZE)
	return abi_status(.OK)
}

@(export)
oe_session_create :: proc "c" (
	engine, map_handle: core_types.Handle,
	creation_info, handle_output, error: uintptr,
) -> u32 {
	context = runtime.default_context()
	if !abi_outputs(handle_output, error) {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	gameplay := creation_info == abi_base() && get_u32(abi_storage.bytes[:], ABI_RECORD_KIND_OFFSET) == ABI_GAMEPLAY_CREATE_KIND | 1 << 16
	kind := gameplay ? ABI_GAMEPLAY_CREATE_KIND : ABI_SESSION_CREATE_KIND
	size := gameplay ? ABI_GAMEPLAY_CREATE_SIZE : ABI_SESSION_CREATE_SIZE
	status := abi_record(creation_info, u32(kind), u32(size))
	if status != .OK {
		return abi_status(status)
	}
	bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	expected_flags := gameplay ? u32(2) : u32(1)
	if get_u32(bytes, ABI_SESSION_CREATE_FLAGS_OFFSET) != expected_flags || get_u32(bytes, ABI_SESSION_CREATE_RESERVED_OFFSET) != 0 {
		return abi_status(.UNSUPPORTED)
	}
	input_capacity: u64 = 4096
	if gameplay {
		if get_u32(bytes, ABI_GAMEPLAY_CREATE_RESERVED_36_OFFSET) != 0 {
			return abi_status(.INVALID_ARGUMENT)
		}
		input_capacity = u64(get_u32(bytes, ABI_GAMEPLAY_CREATE_INPUT_CAPACITY_OFFSET))
	}
	handle, created := session_create(
		&abi_instance, engine, map_handle,
		get_u64(bytes, ABI_SESSION_CREATE_ARENA_BYTES_OFFSET),
		get_f64(bytes, ABI_SESSION_CREATE_LEAD_IN_MS_OFFSET),
		gameplay, input_capacity,
	)
	if created == .OK {
		put_u64(abi_storage.bytes[:], ABI_OUTPUT_OFFSET, u64(handle))
	}
	return abi_status(created)
}

@(export)
oe_session_reset :: proc "c" (engine, session: core_types.Handle, lead_in_ms: f64) -> u32 {
	context = runtime.default_context()
	return abi_status(session_reset(&abi_instance, engine, session, lead_in_ms))
}

@(export)
oe_engine_release :: proc "c" (engine: core_types.Handle) -> u32 {
	context = runtime.default_context()
	return abi_status(engine_release(&abi_instance, engine))
}

@(export)
oe_map_retain :: proc "c" (engine, map_handle: core_types.Handle) -> u32 {
	context = runtime.default_context()
	return abi_status(map_retain(&abi_instance, engine, map_handle))
}

@(export)
oe_map_release :: proc "c" (engine, map_handle: core_types.Handle) -> u32 {
	context = runtime.default_context()
	return abi_status(map_release(&abi_instance, engine, map_handle))
}

@(export)
oe_session_release :: proc "c" (engine, session: core_types.Handle) -> u32 {
	context = runtime.default_context()
	return abi_status(session_release(&abi_instance, engine, session))
}

@(export)
oe_session_inputs :: proc "c" (engine, session_handle: core_types.Handle, records: uintptr, error: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if records != abi_base() || error != abi_base() + ABI_ERROR_OFFSET {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	engine_state, _ := engine_get(&abi_instance, engine)
	if get_u64(bytes, ABI_BYTE_SPAN_ADDRESS_OFFSET) != u64(uintptr(raw_data(engine_state.inbox.bytes))) || get_u32(bytes, ABI_BYTE_SPAN_RESERVED_OFFSET) != 0 {
		return abi_status(.INVALID_ARGUMENT)
	}
	byte_count := get_u32(bytes, ABI_BYTE_SPAN_COUNT_OFFSET)
	if byte_count % ABI_INPUT_SNAPSHOT_SIZE != 0 {
		return abi_status(.INVALID_ARGUMENT)
	}
	return abi_status(gameplay_inputs(engine, session, get_u64(bytes, ABI_BYTE_SPAN_TOKEN_OFFSET), 0, byte_count / ABI_INPUT_SNAPSHOT_SIZE))
}

@(export)
oe_session_inputs_from_reserved :: proc "c" (engine, session_handle: core_types.Handle, token: u64, count: u32, error: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if error != abi_base() + ABI_ERROR_OFFSET {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	return abi_status(gameplay_inputs(engine, session, token, 0, count))
}

@(export)
oe_session_advance :: proc "c" (engine, session_handle: core_types.Handle, time_ms: f64, output: uintptr) -> u32 {
	context = runtime.default_context()
	return session_advance_output(engine, session_handle, time_ms, output, true)
}

@(export)
oe_session_advance_output :: proc "c" (engine, session_handle: core_types.Handle, time_ms: f64, output: uintptr) -> u32 {
	context = runtime.default_context()
	return session_advance_output(engine, session_handle, time_ms, output, false)
}

session_advance_output :: proc(engine, session_handle: core_types.Handle, time_ms: f64, output: uintptr, include_objects: bool) -> u32 {
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if output != abi_base() + ABI_OUTPUT_OFFSET || !core_types.finite(time_ms) {
		return abi_status(.INVALID_ARGUMENT)
	}
	if session.output_token == max(u64) {
		return abi_status(.QUOTA_EXCEEDED)
	}
	status = simulation.advance_session(&session.simulation, time_ms)
	if status != .OK {
		return abi_status(status)
	}
	return abi_status(gameplay_snapshot(session, time_ms, include_objects))
}

@(export)
oe_session_snapshot :: proc "c" (engine, session_handle: core_types.Handle, time_ms: f64, output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if output != abi_base() + ABI_OUTPUT_OFFSET || !core_types.finite(time_ms) {
		return abi_status(.INVALID_ARGUMENT)
	}
	if session.output_token == max(u64) {
		return abi_status(.QUOTA_EXCEEDED)
	}
	status = .OK
	if status != .OK {
		return abi_status(status)
	}
	return abi_status(gameplay_snapshot(session, time_ms))
}

@(export)
oe_session_pause :: proc "c" (engine, session_handle: core_types.Handle, time_ms: f64, output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if output != abi_base() + ABI_OUTPUT_OFFSET || !core_types.finite(time_ms) {
		return abi_status(.INVALID_ARGUMENT)
	}
	if session.output_token == max(u64) {
		return abi_status(.QUOTA_EXCEEDED)
	}
	status = simulation.pause_session(&session.simulation, time_ms)
	if status != .OK {
		return abi_status(status)
	}
	return abi_status(gameplay_snapshot(session, time_ms))
}

@(export)
oe_session_resume :: proc "c" (engine, session_handle: core_types.Handle, anchor: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	status = abi_record(anchor, ABI_CLOCK_ANCHOR_KIND, ABI_CLOCK_ANCHOR_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	if get_f64(bytes, ABI_CLOCK_ANCHOR_RATE_OFFSET) != 1 || get_u32(bytes, ABI_CLOCK_ANCHOR_FLAGS_OFFSET) != 0 || get_u32(bytes, ABI_CLOCK_ANCHOR_RESERVED_OFFSET) != 0 {
		return abi_status(.UNSUPPORTED)
	}
	if !core_types.finite(get_f64(bytes, ABI_CLOCK_ANCHOR_AUDIO_SECONDS_OFFSET)) {
		return abi_status(.INVALID_ARGUMENT)
	}
	return abi_status(simulation.resume_session(&session.simulation, get_f64(bytes, ABI_CLOCK_ANCHOR_BEATMAP_MS_OFFSET)))
}

@(export)
oe_session_result :: proc "c" (engine, session_handle: core_types.Handle, output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if output != abi_base() + ABI_OUTPUT_OFFSET {
		return abi_status(.INVALID_ARGUMENT)
	}
	return abi_status(gameplay_result(session))
}

@(export)
oe_preparation_capabilities :: proc "c" (engine: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return u32(core_types.Status.INVALID_ARGUMENT)
	}
	_, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return abi_status(status)
	}
	bytes := abi_storage.bytes[ABI_PREPARATION_CAPABILITIES_OFFSET:ABI_PREPARATION_CAPABILITIES_OFFSET +
	ABI_PREPARATION_CAPABILITIES_SIZE]
	put_header(bytes, ABI_PREPARATION_CAPABILITIES_KIND, ABI_PREPARATION_CAPABILITIES_SIZE)
	put_u32(bytes, ABI_PREPARATION_CAPABILITIES_PREPARATION_VERSION_OFFSET, 2)
	put_u32(bytes, ABI_PREPARATION_CAPABILITIES_BEHAVIOR_ID_OFFSET, 202608042)
	put_u32(bytes, ABI_PREPARATION_CAPABILITIES_NUMERIC_MODE_OFFSET, 3)
	put_u32(bytes, ABI_PREPARATION_CAPABILITIES_RESERVED_OFFSET, 0)
	abi_span(abi_base() + ABI_PREPARATION_CAPABILITIES_OFFSET, ABI_PREPARATION_CAPABILITIES_SIZE)
	return abi_status(.OK)
}

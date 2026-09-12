package engine_runtime

import "base:runtime"
import "core:crypto/sha2"
import "core:mem"
import core_types "../core_types"
import simulation "../simulation"
import presentation "../presentation"
import prepared "../prepared"
import replay "../replay"

put_f64 :: proc(bytes: []byte, byte_offset: int, number: f64) {
	canonical := number == 0 ? f64(0) : number
	put_u64(bytes, byte_offset, transmute(u64)canonical)
}

get_f64 :: proc(bytes: []byte, byte_offset: int) -> f64 {
	return transmute(f64)get_u64(bytes, byte_offset)
}

// Share checked reservation sizes with test transports and preflight callers.
// Keep allocation layouts in the runtime, not duplicated in fixture runners.
gameplay_storage_sizes :: proc(prepared_map: ^prepared.Map, input_capacity: u64) -> (required_bytes, output_bytes, presentation_bytes: u64, status: core_types.Status) {
	simulation_bytes: u64
	simulation_bytes, status = simulation.required_bytes(prepared_map, input_capacity)
	if status != .OK {
		return 0, 0, 0, status
	}
	_, judgement_count, _ := simulation.counts(prepared_map)
	output_bytes = u64(ABI_SESSION_SNAPSHOT_SIZE)
	if !simulation.size_add(&output_bytes, [ABI_SESSION_OBJECT_SIZE]byte, u64(len(prepared_map.objects))) ||
	   !simulation.size_add(&output_bytes, [ABI_JUDGEMENT_SIZE]byte, judgement_count) ||
	   !simulation.size_add(&output_bytes, [ABI_AUDIO_EVENT_SIZE]byte, simulation.sample_count(prepared_map)) {
		return 0, 0, 0, .QUOTA_EXCEEDED
	}
	replay_bytes, _ := replay.encoded_size(simulation.recording_capacity(prepared_map, input_capacity))
	output_bytes = max(output_bytes, replay_bytes, ABI_FINAL_RESULT_SIZE + 17 * ABI_RESULT_COUNT_SIZE)
	presentation_bytes = u64(ABI_PRESENTATION_FRAME_SIZE)
	if !simulation.size_add(&presentation_bytes, [ABI_PRESENTATION_OBJECT_SIZE]byte, u64(len(prepared_map.objects))) {
		return 0, 0, 0, .QUOTA_EXCEEDED
	}
	required_bytes = simulation_bytes
	if !simulation.size_add(&required_bytes, core_types.Input_Snapshot, simulation.recording_capacity(prepared_map, input_capacity)) ||
	   !simulation.size_add(&required_bytes, presentation.Reveal, u64(len(prepared_map.objects))) ||
	   !simulation.size_add(&required_bytes, int, u64(len(prepared_map.objects))) ||
	   !simulation.size_add(&required_bytes, u64, (presentation_bytes + 7) / 8) ||
	   !simulation.size_add(&required_bytes, u64, (output_bytes + 7) / 8) {
		return 0, 0, 0, .QUOTA_EXCEEDED
	}
	return required_bytes, output_bytes, presentation_bytes, .OK
}

gameplay_initialize :: proc(session: ^Session, input_capacity: u64) -> core_types.Status {
	prepared_map := &session.map_storage.prepared_map
	required_bytes, output_bytes, presentation_bytes, status := gameplay_storage_sizes(prepared_map, input_capacity)
	if status != .OK {
		return status
	}
	if required_bytes > u64(len(session.arena.bytes)) {
		return .QUOTA_EXCEEDED
	}
	status = simulation.initialize(&session.simulation, prepared_map, &session.arena, input_capacity, session.lead_in_ms)
	if status != .OK {
		return status
	}
	session.input_candidate, _ = core_types.arena_take(&session.arena, core_types.Input_Snapshot, simulation.recording_capacity(prepared_map, input_capacity))
	status = presentation.initialize_active(&session.active_presentation, prepared_map, &session.arena)
	if status != .OK {
		return status
	}
	presentation_words, _ := core_types.arena_take(&session.arena, u64, (presentation_bytes + 7) / 8)
	session.presentation_output = mem.slice_ptr(cast(^byte)raw_data(presentation_words), len(presentation_words) * 8)
	output_words, _ := core_types.arena_take(&session.arena, u64, (output_bytes + 7) / 8)
	session.output = mem.slice_ptr(cast(^byte)raw_data(output_words), len(output_words) * 8)
	return .OK
}

write_judgement :: proc(bytes: []byte, event: simulation.Judgement_Event) {
	put_header(bytes, ABI_JUDGEMENT_KIND, ABI_JUDGEMENT_SIZE)
	put_u64(bytes, ABI_JUDGEMENT_SEQUENCE_OFFSET, event.sequence)
	put_f64(bytes, ABI_JUDGEMENT_TIME_MS_OFFSET, event.time_ms)
	put_u32(bytes, ABI_JUDGEMENT_OBJECT_ID_OFFSET, event.object_id)
	put_u32(bytes, ABI_JUDGEMENT_COMPONENT_ID_OFFSET, event.component_id)
	put_u32(bytes, ABI_JUDGEMENT_RESULT_OFFSET, u32(event.result))
	put_u32(bytes, ABI_JUDGEMENT_CAUSE_OFFSET, u32(event.cause))
	put_f64(bytes, ABI_JUDGEMENT_OFFSET_MS_OFFSET, event.offset_ms)
	put_u32(bytes, ABI_JUDGEMENT_COMBO_BEFORE_OFFSET, event.combo_before)
	put_u32(bytes, ABI_JUDGEMENT_COMBO_AFTER_OFFSET, event.combo_after)
	put_f64(bytes, ABI_JUDGEMENT_HEALTH_BEFORE_OFFSET, event.health_before)
	put_f64(bytes, ABI_JUDGEMENT_HEALTH_AFTER_OFFSET, event.health_after)
	put_u64(bytes, ABI_JUDGEMENT_SCORE_AFTER_OFFSET, u64(event.score_after))
}

gameplay_digest :: proc(session: ^Session) -> [32]byte {
	hasher: sha2.Context_256
	sha2.init_256(&hasher)
	sha2.update(&hasher, session.map_storage.prepared_map.prepared_digest[:])
	bytes: [ABI_JUDGEMENT_SIZE]byte
	for event in session.simulation.journal[:session.simulation.journal_count] {
		write_judgement(bytes[:], event)
		sha2.update(&hasher, bytes[:])
	}
	result: [32]byte
	sha2.final(&hasher, result[:])
	return result
}

gameplay_snapshot :: proc(session: ^Session, presentation_ms: f64, include_objects: bool = true) -> core_types.Status {
	if !core_types.finite(presentation_ms) {
		return .INVALID_ARGUMENT
	}
	if session.output_token == max(u64) {
		return .QUOTA_EXCEEDED
	}
	simulation_state := &session.simulation
	bytes := session.output
	object_offset := ABI_SESSION_SNAPSHOT_SIZE
	object_count := include_objects ? len(simulation_state.objects) : 0
	judgement_offset := object_offset + object_count * ABI_SESSION_OBJECT_SIZE
	judgement_count := simulation_state.journal_count - simulation_state.acknowledged_count
	audio_offset := judgement_offset + judgement_count * ABI_JUDGEMENT_SIZE
	audio_count := simulation_state.audio_count - simulation_state.acknowledged_audio_count
	total_bytes := audio_offset + audio_count * ABI_AUDIO_EVENT_SIZE
	// Kinds 19 and 31 intentionally share the generated summary layout.
	put_header(bytes, include_objects ? ABI_SESSION_SNAPSHOT_KIND : ABI_GAMEPLAY_OUTPUT_KIND, ABI_SESSION_SNAPSHOT_SIZE)
	put_u32(bytes, ABI_SESSION_SNAPSHOT_STATE_OFFSET, u32(simulation_state.state))
	put_u32(bytes, ABI_SESSION_SNAPSHOT_EPOCH_OFFSET, simulation_state.epoch)
	put_f64(bytes, ABI_SESSION_SNAPSHOT_COMMITTED_MS_OFFSET, simulation_state.committed_ms)
	put_f64(bytes, ABI_SESSION_SNAPSHOT_PRESENTATION_MS_OFFSET, presentation_ms)
	put_u64(bytes, ABI_SESSION_SNAPSHOT_SCORE_OFFSET, u64(simulation_state.score.total))
	put_f64(bytes, ABI_SESSION_SNAPSHOT_ACCURACY_OFFSET, simulation_state.score.accuracy)
	put_f64(bytes, ABI_SESSION_SNAPSHOT_HEALTH_OFFSET, simulation.sample_health(simulation_state, simulation_state.committed_ms))
	put_u32(bytes, ABI_SESSION_SNAPSHOT_COMBO_OFFSET, simulation_state.score.accumulator.combo)
	put_u32(bytes, ABI_SESSION_SNAPSHOT_HIGHEST_COMBO_OFFSET, simulation_state.score.accumulator.highest_combo)
	put_u32(bytes, ABI_SESSION_SNAPSHOT_OBJECTS_OFFSET_OFFSET, u32(object_offset))
	put_u32(bytes, ABI_SESSION_SNAPSHOT_OBJECTS_COUNT_OFFSET, u32(object_count))
	put_u32(bytes, ABI_SESSION_SNAPSHOT_OBJECTS_STRIDE_OFFSET, ABI_SESSION_OBJECT_SIZE)
	put_u32(bytes, ABI_SESSION_SNAPSHOT_JUDGEMENTS_OFFSET_OFFSET, u32(judgement_offset))
	put_u32(bytes, ABI_SESSION_SNAPSHOT_JUDGEMENTS_COUNT_OFFSET, u32(judgement_count))
	put_u32(bytes, ABI_SESSION_SNAPSHOT_JUDGEMENTS_STRIDE_OFFSET, ABI_JUDGEMENT_SIZE)
	session.output_token += 1
	session.output_judgement_count = simulation_state.journal_count
	session.output_audio_count = simulation_state.audio_count
	put_u32(bytes, ABI_SESSION_SNAPSHOT_AUDIO_OFFSET_OFFSET, u32(audio_offset))
	put_u32(bytes, ABI_SESSION_SNAPSHOT_AUDIO_COUNT_OFFSET, u32(audio_count))
	put_u32(bytes, ABI_SESSION_SNAPSHOT_AUDIO_STRIDE_OFFSET, ABI_AUDIO_EVENT_SIZE)
	put_u32(bytes, ABI_SESSION_SNAPSHOT_RESERVED_OFFSET, 0)
	put_u64(bytes, ABI_SESSION_SNAPSHOT_BATCH_TOKEN_OFFSET, session.output_token)
	put_u64(bytes, ABI_SESSION_SNAPSHOT_TOTAL_BYTES_OFFSET, u64(total_bytes))
	projection := simulation.project(simulation_state)
	for object_index in 0 ..< object_count {
		object_state := simulation.project_object(projection, object_index, presentation_ms)
		object := &simulation_state.prepared_map.objects[object_index]
		record := bytes[object_offset + object_index * ABI_SESSION_OBJECT_SIZE:]
		put_header(record, ABI_SESSION_OBJECT_KIND, ABI_SESSION_OBJECT_SIZE)
		put_u32(record, ABI_SESSION_OBJECT_OBJECT_ID_OFFSET, object.id)
		put_u32(record, ABI_SESSION_OBJECT_RESULT_OFFSET, u32(object_state.result))
		put_u32(record, ABI_SESSION_OBJECT_HEAD_RESULT_OFFSET, u32(object_state.head_result))
		put_u32(record, ABI_SESSION_OBJECT_TRACKING_OFFSET, u32(object_state.tracking))
		put_f64(record, ABI_SESSION_OBJECT_RESULT_TIME_MS_OFFSET, object_state.result_time_ms)
		put_f64(record, ABI_SESSION_OBJECT_HEAD_TIME_MS_OFFSET, object_state.head_time_ms)
		put_f64(record, ABI_SESSION_OBJECT_ROTATION_OFFSET, object_state.rotation)
		position := object_state.position
		put_f64(record, ABI_SESSION_OBJECT_POSITION_X_OFFSET, position[0])
		put_f64(record, ABI_SESSION_OBJECT_POSITION_Y_OFFSET, position[1])
	}
	for event, event_index in simulation_state.journal[simulation_state.acknowledged_count:simulation_state.journal_count] {
		write_judgement(bytes[judgement_offset + event_index * ABI_JUDGEMENT_SIZE:], event)
	}
	for event, audio_index in simulation_state.audio[simulation_state.acknowledged_audio_count:simulation_state.audio_count] {
		record := bytes[audio_offset + audio_index * ABI_AUDIO_EVENT_SIZE:]
		put_header(record, ABI_AUDIO_EVENT_KIND, ABI_AUDIO_EVENT_SIZE)
		put_u64(record, ABI_AUDIO_EVENT_SEQUENCE_OFFSET, event.sequence)
		put_u32(record, ABI_AUDIO_EVENT_EPOCH_OFFSET, event.epoch)
		put_u32(record, ABI_AUDIO_EVENT_FLAGS_OFFSET, u32(event.missing))
		put_f64(record, ABI_AUDIO_EVENT_TIME_MS_OFFSET, event.time_ms)
		put_u64(record, ABI_AUDIO_EVENT_ASSET_ID_OFFSET, event.asset_id)
		put_f64(record, ABI_AUDIO_EVENT_VOLUME_OFFSET, event.volume)
		put_u32(record, ABI_AUDIO_EVENT_OBJECT_ID_OFFSET, event.object_id)
		put_u32(record, ABI_AUDIO_EVENT_COMPONENT_ID_OFFSET, event.component_id)
		put_u32(record, ABI_AUDIO_EVENT_SAMPLE_INDEX_OFFSET, event.sample_index)
		put_u32(record, ABI_AUDIO_EVENT_KIND_OFFSET, 1)
	}
	abi_span(uintptr(raw_data(bytes)), u32(total_bytes), session.output_token)
	return .OK
}

gameplay_get :: proc(engine, session_handle: core_types.Handle) -> (^Session, core_types.Status) {
	session, status := session_get(&abi_instance, engine, session_handle)
	if status != .OK {
		return nil, status
	}
	if !session.gameplay {
		return nil, .UNSUPPORTED
	}
	return session, .OK
}

@(export)
oe_simulation_capabilities :: proc "c" (engine: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	_, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return abi_status(status)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return abi_status(.INVALID_ARGUMENT)
	}
	bytes := abi_storage.bytes[640:640 + ABI_SIMULATION_CAPABILITIES_SIZE]
	put_header(bytes, ABI_SIMULATION_CAPABILITIES_KIND, ABI_SIMULATION_CAPABILITIES_SIZE)
	put_u32(bytes, ABI_SIMULATION_CAPABILITIES_SIMULATION_VERSION_OFFSET, 1)
	put_u32(bytes, ABI_SIMULATION_CAPABILITIES_RULES_VERSION_OFFSET, replay.RULES_VERSION)
	put_u32(bytes, ABI_SIMULATION_CAPABILITIES_FLAGS_OFFSET, 1)
	put_u32(bytes, ABI_SIMULATION_CAPABILITIES_MAX_INPUTS_OFFSET, replay.MAX_FRAMES)
	abi_span(uintptr(raw_data(bytes)), ABI_SIMULATION_CAPABILITIES_SIZE)
	return abi_status(.OK)
}

@(export)
oe_session_acknowledge :: proc "c" (engine, session_handle: core_types.Handle, token: u64) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if token == 0 || token != session.output_token {
		return abi_status(.INVALID_ARGUMENT)
	}
	session.simulation.acknowledged_count = session.output_judgement_count
	session.simulation.acknowledged_audio_count = session.output_audio_count
	return abi_status(.OK)
}

gameplay_inputs :: proc(engine: core_types.Handle, session: ^Session, token: u64, offset, count: u32) -> core_types.Status {
	engine_state, status := engine_get(&abi_instance, engine)
	if status != .OK {
		return status
	}
	byte_count := u64(count) * ABI_INPUT_SNAPSHOT_SIZE
	if token == 0 || token != engine_state.token || u64(offset) > u64(len(engine_state.inbox.bytes)) || byte_count > u64(len(engine_state.inbox.bytes)) - u64(offset) {
		return .INVALID_ARGUMENT
	}
	if u64(count) > u64(len(session.input_candidate)) {
		return .QUOTA_EXCEEDED
	}
	for input_index in 0 ..< int(count) {
		bytes := engine_state.inbox.bytes[int(offset) + input_index * ABI_INPUT_SNAPSHOT_SIZE:]
		if get_u32(bytes, ABI_RECORD_KIND_OFFSET) != ABI_INPUT_SNAPSHOT_KIND | 1 << 16 || get_u32(bytes, ABI_RECORD_BYTE_SIZE_OFFSET) != ABI_INPUT_SNAPSHOT_SIZE {
			return .UNSUPPORTED
		}
		if get_u32(bytes, ABI_INPUT_SNAPSHOT_RESERVED_OFFSET) != 0 {
			return .INVALID_ARGUMENT
		}
		source_focus := get_u32(bytes, ABI_INPUT_SNAPSHOT_SOURCE_FOCUS_OFFSET)
		session.input_candidate[input_index] = {
			sequence = get_u64(bytes, ABI_INPUT_SNAPSHOT_SEQUENCE_OFFSET),
			raw_time_ms = get_f64(bytes, ABI_INPUT_SNAPSHOT_RAW_TIME_MS_OFFSET),
			effective_time_ms = get_f64(bytes, ABI_INPUT_SNAPSHOT_EFFECTIVE_TIME_MS_OFFSET),
			x = get_f64(bytes, ABI_INPUT_SNAPSHOT_X_OFFSET),
			y = get_f64(bytes, ABI_INPUT_SNAPSHOT_Y_OFFSET),
			action_bits = get_u32(bytes, ABI_INPUT_SNAPSHOT_ACTION_BITS_OFFSET),
			source = u16(source_focus), focus_epoch = u16(source_focus >> 16),
			flags = get_u32(bytes, ABI_INPUT_SNAPSHOT_FLAGS_OFFSET),
		}
	}
	return simulation.submit_inputs(&session.simulation, session.input_candidate[:int(count)])
}

gameplay_result :: proc(session: ^Session) -> core_types.Status {
	simulation_state := &session.simulation
	if !simulation.terminal(simulation_state) {
		return .INVALID_STATE
	}
	bytes := session.output
	put_header(bytes, ABI_FINAL_RESULT_KIND, ABI_FINAL_RESULT_SIZE)
	put_u32(bytes, ABI_FINAL_RESULT_STATE_OFFSET, u32(simulation_state.state))
	put_u32(bytes, ABI_FINAL_RESULT_RANK_OFFSET, u32(simulation_state.score.rank))
	put_f64(bytes, ABI_FINAL_RESULT_TERMINAL_MS_OFFSET, simulation_state.terminal_ms)
	put_u64(bytes, ABI_FINAL_RESULT_SCORE_OFFSET, u64(simulation_state.score.total))
	put_f64(bytes, ABI_FINAL_RESULT_ACCURACY_OFFSET, simulation_state.score.accuracy)
	put_f64(bytes, ABI_FINAL_RESULT_HEALTH_OFFSET, simulation.sample_health(simulation_state, simulation_state.terminal_ms))
	put_u64(bytes, ABI_FINAL_RESULT_NUMERATOR_OFFSET, simulation_state.score.accumulator.numerator)
	put_u64(bytes, ABI_FINAL_RESULT_DENOMINATOR_OFFSET, simulation_state.score.accumulator.denominator)
	put_u32(bytes, ABI_FINAL_RESULT_COMBO_OFFSET, simulation_state.score.accumulator.combo)
	put_u32(bytes, ABI_FINAL_RESULT_HIGHEST_COMBO_OFFSET, simulation_state.score.accumulator.highest_combo)
	digest := gameplay_digest(session)
	copy(bytes[ABI_FINAL_RESULT_RAW_DIGEST_0_OFFSET:], simulation_state.prepared_map.raw_digest[:])
	copy(bytes[ABI_FINAL_RESULT_PREPARED_DIGEST_0_OFFSET:], simulation_state.prepared_map.prepared_digest[:])
	copy(bytes[ABI_FINAL_RESULT_JUDGEMENT_DIGEST_0_OFFSET:], digest[:])
	put_u32(bytes, ABI_FINAL_RESULT_COUNTS_OFFSET_OFFSET, ABI_FINAL_RESULT_SIZE)
	put_u32(bytes, ABI_FINAL_RESULT_COUNTS_COUNT_OFFSET, 17)
	put_u32(bytes, ABI_FINAL_RESULT_COUNTS_STRIDE_OFFSET, ABI_RESULT_COUNT_SIZE)
	put_u32(bytes, ABI_FINAL_RESULT_BEHAVIOR_ID_OFFSET, 202608042)
	put_u32(bytes, ABI_FINAL_RESULT_RULES_VERSION_OFFSET, replay.RULES_VERSION)
	put_u32(bytes, ABI_FINAL_RESULT_ABI_MAJOR_OFFSET, 2)
	put_f64(bytes, ABI_FINAL_RESULT_RATE_OFFSET, 1)
	put_f64(bytes, ABI_FINAL_RESULT_OFFSET_0_OFFSET, 0)
	put_f64(bytes, ABI_FINAL_RESULT_OFFSET_1_OFFSET, 0)
	put_f64(bytes, ABI_FINAL_RESULT_OFFSET_2_OFFSET, 0)
	put_f64(bytes, ABI_FINAL_RESULT_OFFSET_3_OFFSET, 0)
	for result_index in 0 ..< 17 {
		record := bytes[ABI_FINAL_RESULT_SIZE + result_index * ABI_RESULT_COUNT_SIZE:]
		put_header(record, ABI_RESULT_COUNT_KIND, ABI_RESULT_COUNT_SIZE)
		result := core_types.Hit_Result(result_index)
		put_u32(record, ABI_RESULT_COUNT_RESULT_OFFSET, u32(result_index))
		put_u32(record, ABI_RESULT_COUNT_ACTUAL_OFFSET, simulation_state.score.accumulator.counts[result])
		put_u32(record, ABI_RESULT_COUNT_MAXIMUM_OFFSET, simulation_state.score.maxima.counts[result])
		put_u32(record, ABI_RESULT_COUNT_RESERVED_OFFSET, 0)
	}
	abi_span(uintptr(raw_data(bytes)), ABI_FINAL_RESULT_SIZE + 17 * ABI_RESULT_COUNT_SIZE)
	return .OK
}

session_identity :: proc(session: ^Session) -> replay.Identity {
	return {
		schema_version = replay.SCHEMA_VERSION,
		compatibility_version = replay.COMPATIBILITY_VERSION,
		rules_version = replay.RULES_VERSION,
		behavior_id = replay.BEHAVIOR_ID,
		coordinate_version = replay.COORDINATE_VERSION,
		rate = 1,
		raw_digest = session.map_storage.prepared_map.raw_digest,
		prepared_digest = session.map_storage.prepared_map.prepared_digest,
	}
}

@(export)
oe_session_replay_load :: proc "c" (engine, session_handle: core_types.Handle, token: u64, byte_count: u32) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	simulation_state := &session.simulation
	if simulation_state.state != .READY || simulation_state.inputs.count != 0 || simulation_state.recording_count != 0 {
		return abi_status(.INVALID_STATE)
	}
	engine_state, _ := engine_get(&abi_instance, engine)
	if token == 0 || token != engine_state.token || u64(byte_count) > u64(len(engine_state.inbox.bytes)) {
		return abi_status(.INVALID_ARGUMENT)
	}
	decoded, decoded_status := replay.decode(engine_state.inbox.bytes[:int(byte_count)], session_identity(session), session.input_candidate)
	if decoded_status != .OK {
		return abi_status(decoded_status)
	}
	status = simulation.load_replay(simulation_state, decoded.frames)
	if status != .OK {
		return abi_status(status)
	}
	simulation_state.replay_mode = true
	simulation_state.replay_frames = simulation_state.recording[:simulation_state.recording_count]
	return abi_status(.OK)
}

@(export)
oe_session_replay_export :: proc "c" (engine, session_handle: core_types.Handle, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET {
		return abi_status(.INVALID_ARGUMENT)
	}
	if !simulation.terminal(&session.simulation) {
		return abi_status(.INVALID_STATE)
	}
	byte_count, encoded := replay.encode(session_identity(session), session.simulation.recording[:session.simulation.recording_count], gameplay_digest(session), session.output)
	if encoded == .OK {
		abi_span(uintptr(raw_data(session.output)), u32(byte_count))
	}
	return abi_status(encoded)
}

@(export)
oe_session_replay_seek :: proc "c" (engine, session_handle: core_types.Handle, time_ms: f64, span_output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	simulation_state := &session.simulation
	if !simulation_state.replay_mode {
		return abi_status(.INVALID_STATE)
	}
	if span_output != abi_base() + ABI_OUTPUT_OFFSET || !core_types.finite(time_ms) || time_ms < simulation_state.lead_in_ms {
		return abi_status(.INVALID_ARGUMENT)
	}
	if simulation_state.epoch == max(u32) || session.output_token == max(u64) {
		return abi_status(.QUOTA_EXCEEDED)
	}
	// The immutable READY simulation_state is the initial checkpoint. Reset reconstructs
	// its queues in reserved storage, then resimulates; it never reverses rules.
	frame_count := simulation_state.recording_count
	copy(session.input_candidate, simulation_state.replay_frames)
	status = simulation.reset_session(simulation_state, simulation_state.lead_in_ms)
	if status != .OK {
		return abi_status(status)
	}
	status = simulation.load_replay(simulation_state, session.input_candidate[:frame_count])
	assert(status == .OK)
	simulation_state.replay_mode = true
	simulation_state.replay_frames = simulation_state.recording[:frame_count]
	status = simulation.advance_session(simulation_state, time_ms)
	assert(status == .OK)
	simulation_state.acknowledged_count = simulation_state.journal_count
	simulation_state.acknowledged_audio_count = simulation_state.audio_count
	return abi_status(gameplay_snapshot(session, time_ms))
}

@(export)
oe_session_bind_sample :: proc "c" (engine, session_handle: core_types.Handle, binding_address: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if session.simulation.state != .READY || session.simulation.replay_mode {
		return abi_status(.INVALID_STATE)
	}
	status = abi_record(binding_address, ABI_SAMPLE_BINDING_KIND, ABI_SAMPLE_BINDING_SIZE)
	if status != .OK {
		return abi_status(status)
	}
	bytes := abi_storage.bytes[:ABI_INPUT_SIZE]
	object_id := get_u32(bytes, ABI_SAMPLE_BINDING_OBJECT_ID_OFFSET)
	component_id := get_u32(bytes, ABI_SAMPLE_BINDING_COMPONENT_ID_OFFSET)
	sample_index := get_u32(bytes, ABI_SAMPLE_BINDING_SAMPLE_INDEX_OFFSET)
	candidate_index := get_u32(bytes, ABI_SAMPLE_BINDING_CANDIDATE_INDEX_OFFSET)
	asset_id := get_u64(bytes, ABI_SAMPLE_BINDING_ASSET_ID_OFFSET)
	for &binding in session.simulation.sample_bindings {
		if binding.object_id == object_id && binding.component_id == component_id && binding.sample_index == sample_index {
			if u64(candidate_index) >= u64(len(binding.sample.candidates)) {
				return abi_status(.INVALID_ARGUMENT)
			}
			binding.candidate_assets[candidate_index] = asset_id
			binding.asset_id = 0
			for candidate_asset in binding.candidate_assets {
				if candidate_asset != 0 {
					binding.asset_id = candidate_asset
					break
				}
			}
			return abi_status(.OK)
		}
	}
	return abi_status(.INVALID_ARGUMENT)
}

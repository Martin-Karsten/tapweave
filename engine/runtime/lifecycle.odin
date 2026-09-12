package engine_runtime

import core_types "../core_types"
import beatmap_decode "../beatmap_decode"
import osu_prepare "../osu_prepare"
import prepared "../prepared"
import simulation "../simulation"
import presentation "../presentation"
import "core:mem"
import "core:math"

// One instance is confined to one calling thread. The registry outlives engines,
// retaining generations across disposal so old handles cannot resurrect.
Instance :: struct {
	table: Handle_Table,
	allocator: mem.Allocator,
}

Engine :: struct {
	quotas: core_types.Quotas,
	inbox: core_types.Arena,
	token: u64,
}

Map_Resource :: struct {
	descriptor: [32]byte,
	decoded: beatmap_decode.Map,
	points: osu_prepare.Points,
	prepared_map: prepared.Map,
	render_attachment: core_types.Arena,
	fully_prepared: bool,
	references, external_references: u32,
}

// One published output batch: the token the host acknowledges and the
// per-stream counts that acknowledgement settles.
Session_Outputs :: struct {
	token: u64,
	judgement_count, audio_count, voice_count: int,
}

outputs_exhausted :: proc(outputs: ^Session_Outputs) -> bool {
	return outputs.token == max(u64)
}

outputs_publish :: proc(outputs: ^Session_Outputs, judgement_count, audio_count, voice_count: int) -> core_types.Status {
	if outputs_exhausted(outputs) {
		return .QUOTA_EXCEEDED
	}
	outputs.token += 1
	outputs.judgement_count = judgement_count
	outputs.audio_count = audio_count
	outputs.voice_count = voice_count
	return .OK
}

// Reset replaces the batch so a stale acknowledgement token cannot settle a
// fresh session's streams.
outputs_reset :: proc(outputs: ^Session_Outputs) -> core_types.Status {
	if outputs_exhausted(outputs) {
		return .QUOTA_EXCEEDED
	}
	outputs.token += 1
	outputs.judgement_count = 0
	outputs.audio_count = 0
	outputs.voice_count = 0
	return .OK
}

Session :: struct {
	map_storage: ^Map_Resource,
	arena: core_types.Arena,
	lead_in_ms: f64,
	gameplay: bool,
	simulation: simulation.Session,
	output: []byte,
	presentation_output: []byte,
	active_presentation: presentation.Active_Set,
	draw_storage: Draw_Storage,
	voice_storage: Voice_Storage,
	input_candidate: []core_types.Input_Snapshot,
	outputs: Session_Outputs,
}

instance_create :: proc(
	capacity: u32 = 256,
	allocator := context.allocator,
) -> (
	Instance,
	core_types.Status,
) {
	table, status := table_create(capacity, allocator)
	return Instance{table, allocator}, status
}

instance_destroy :: proc(instance: ^Instance) -> core_types.Status {
	return table_destroy(&instance.table)
}

engine_create :: proc(
	instance: ^Instance,
	quotas := core_types.DEFAULT_QUOTAS,
) -> (
	core_types.Handle,
	core_types.Status,
) {
	if !core_types.valid_quotas(quotas) {
		return 0, .INVALID_ARGUMENT
	}
	engine_state, allocation_error := new(Engine, instance.allocator)
	if allocation_error != nil {
		return 0, .OUT_OF_MEMORY
	}
	engine_state.quotas = quotas
	handle, status := insert(&instance.table, 0, .ENGINE, engine_state)
	if status != .OK {
		free(engine_state, instance.allocator)
	}
	return handle, status
}

engine_get :: proc(instance: ^Instance, handle: core_types.Handle) -> (^Engine, core_types.Status) {
	value, status := lookup(&instance.table, handle, 0, .ENGINE)
	return cast(^Engine)value, status
}

map_get :: proc(
	instance: ^Instance,
	engine, map_handle: core_types.Handle,
) -> (
	^Map_Resource,
	core_types.Status,
) {
	_, valid := engine_get(instance, engine)
	if valid != .OK {
		return nil, valid
	}
	value, status := lookup(&instance.table, map_handle, engine, .MAP)
	return cast(^Map_Resource)value, status
}

session_get :: proc(
	instance: ^Instance,
	engine, session: core_types.Handle,
) -> (
	^Session,
	core_types.Status,
) {
	_, valid := engine_get(instance, engine)
	if valid != .OK {
		return nil, valid
	}
	value, status := lookup(&instance.table, session, engine, .SESSION)
	return cast(^Session)value, status
}

buffer_reserve :: proc(
	instance: ^Instance,
	engine: core_types.Handle,
	bytes: u64,
) -> (
	[]byte,
	u64,
	core_types.Status,
) {
	engine_state, status := engine_get(instance, engine)
	if status != .OK {
		return nil, 0, status
	}
	if bytes > engine_state.quotas.raw_bytes || engine_state.token == max(u64) {
		return nil, 0, .QUOTA_EXCEEDED
	}
	candidate, allocated := core_types.arena_create(bytes, instance.allocator)
	if allocated != .OK {
		return nil, 0, allocated
	}
	core_types.arena_destroy(&engine_state.inbox)
	engine_state.inbox = candidate
	candidate = {} // Ownership transferred to the engine.
	engine_state.token += 1
	return engine_state.inbox.bytes, engine_state.token, .OK
}

map_prepare :: proc(
	instance: ^Instance,
	engine: core_types.Handle,
	text: string,
	full_preparation: bool = false,
) -> (
	core_types.Handle,
	core_types.Error,
) {
	engine_state, status := engine_get(instance, engine)
	if status != .OK {
		return 0, {status = status}
	}
	map_resource, allocation := new(Map_Resource, instance.allocator)
	if allocation != nil {
		return 0, {status = .OUT_OF_MEMORY}
	}
	committed := false
	defer {
		if !committed {
			beatmap_decode.destroy(&map_resource.decoded)
			osu_prepare.destroy(&map_resource.points)
			prepared.destroy_map(&map_resource.prepared_map)
			core_types.arena_destroy(&map_resource.render_attachment)
			free(map_resource, instance.allocator)
		}
	}
	error: core_types.Error
	map_resource.decoded, error = beatmap_decode.decode(text, engine_state.quotas, instance.allocator)
	if error.status != .OK {
		return 0, error
	}
	// All map allocations count against the same arena quota.
	work_budget := core_types.Work_Budget {
		remaining = core_types.DEFAULT_PREPARATION_WORK,
	}
	map_resource.points, status = osu_prepare.resolve(
		&map_resource.decoded,
		engine_state.quotas.arena_bytes - u64(len(map_resource.decoded.arena.bytes)),
		instance.allocator,
		&work_budget,
	)
	if status != .OK {
		if work_budget.exhausted {
			return 0, {
				status = status,
				code = .PREPARATION_WORK,
				limit = core_types.DEFAULT_PREPARATION_WORK,
			}
		}
		requested :=
			u64(len(map_resource.decoded.arena.bytes)) +
			4 * u64(len(map_resource.decoded.timing)) * size_of(osu_prepare.Point)
		return 0, {
			status = status,
			code = .ARENA_BYTES,
			requested = requested,
			limit = engine_state.quotas.arena_bytes,
		}
	}
	if full_preparation {
		used := u64(len(map_resource.decoded.arena.bytes) + len(map_resource.points.arena.bytes))
		map_resource.prepared_map, error = osu_prepare.prepare_map(
			&map_resource.decoded,
			&map_resource.points,
			engine_state.quotas.arena_bytes - used,
			instance.allocator,
			engine_state.quotas.duration_ms,
			&work_budget,
		)
		if error.status != .OK {
			return 0, error
		}
		used += u64(len(map_resource.prepared_map.arena.bytes))
		status = prepared.describe(
			&map_resource.prepared_map,
			engine_state.quotas.arena_bytes - used,
			instance.allocator,
		)
		if status != .OK {
			return 0, {status = status, code = .ARENA_BYTES, limit = engine_state.quotas.arena_bytes}
		}
		map_resource.fully_prepared = true
	}
	map_resource.references = 1
	map_resource.external_references = 1
	handle, inserted := insert(&instance.table, engine, .MAP, map_resource)
	if inserted != .OK {
		return 0, {status = inserted}
	}
	committed = true
	return handle, {}
}

map_retain :: proc(instance: ^Instance, engine, map_handle: core_types.Handle) -> core_types.Status {
	map_resource, status := map_get(instance, engine, map_handle)
	if status != .OK {
		return status
	}
	if map_resource.references == max(u32) {
		return .QUOTA_EXCEEDED
	}
	map_resource.references += 1
	map_resource.external_references += 1
	return .OK
}

map_drop :: proc(instance: ^Instance, map_resource: ^Map_Resource) {
	map_resource.references -= 1
	if map_resource.references == 0 {
		beatmap_decode.destroy(&map_resource.decoded)
		osu_prepare.destroy(&map_resource.points)
		prepared.destroy_map(&map_resource.prepared_map)
		core_types.arena_destroy(&map_resource.render_attachment)
		free(map_resource, instance.allocator)
	}
}

map_release :: proc(instance: ^Instance, engine, map_handle: core_types.Handle) -> core_types.Status {
	_, valid := engine_get(instance, engine)
	if valid != .OK {
		return valid
	}
	slot, status := resolve_slot(&instance.table, map_handle, engine, .MAP)
	if status != .OK {
		return status
	}
	if slot.released {
		return .OK
	}
	map_resource := cast(^Map_Resource)slot.value
	if map_resource.external_references > 1 {
		map_resource.external_references -= 1
		map_drop(instance, map_resource)
		return .OK
	}
	_, released := release(&instance.table, map_handle, engine, .MAP)
	if released == .OK {
		map_resource.external_references = 0
		map_drop(instance, map_resource)
	}
	return released
}

session_create :: proc(
	instance: ^Instance,
	engine, map_handle: core_types.Handle,
	bytes: u64 = 4096,
	lead_in_ms: f64 = 0,
	gameplay: bool = false,
	input_capacity: u64 = 4096,
) -> (
	core_types.Handle,
	core_types.Status,
) {
	map_resource, status := map_get(instance, engine, map_handle)
	if status != .OK {
		return 0, status
	}
	engine_state, _ := engine_get(instance, engine)
	if math.is_nan(lead_in_ms) || math.is_inf(lead_in_ms) {
		return 0, .INVALID_ARGUMENT
	}
	if bytes > engine_state.quotas.arena_bytes || map_resource.references == max(u32) {
		return 0, .QUOTA_EXCEEDED
	}
	session_state, allocation_error := new(Session, instance.allocator)
	if allocation_error != nil {
		return 0, .OUT_OF_MEMORY
	}
	committed := false
	defer {
		if !committed {
			core_types.arena_destroy(&session_state.arena)
			core_types.arena_destroy(&session_state.draw_storage.arena)
			core_types.arena_destroy(&session_state.voice_storage.arena)
			free(session_state, instance.allocator)
		}
	}
	session_state.arena, status = core_types.arena_create(bytes, instance.allocator)
	if status != .OK {
		return 0, status
	}
	session_state.map_storage = map_resource
	session_state.lead_in_ms = lead_in_ms
	session_state.gameplay = gameplay
	if gameplay {
		if !map_resource.fully_prepared {
			return 0, .INVALID_STATE
		}
		status = gameplay_initialize(session_state, input_capacity)
		if status != .OK {
			return 0, status
		}
	}
	handle, inserted := insert(&instance.table, engine, .SESSION, session_state)
	if inserted != .OK {
		return 0, inserted
	}
	map_resource.references += 1
	committed = true
	return handle, .OK
}

session_reset :: proc(
	instance: ^Instance,
	engine, session: core_types.Handle,
	lead_in_ms: f64,
) -> core_types.Status {
	session_state, status := session_get(instance, engine, session)
	if status != .OK {
		return status
	}
	if math.is_nan(lead_in_ms) || math.is_inf(lead_in_ms) {
		return .INVALID_ARGUMENT
	}
	if session_state.gameplay {
		if outputs_exhausted(&session_state.outputs) {
			return .QUOTA_EXCEEDED
		}
		status = simulation.reset_session(&session_state.simulation, lead_in_ms)
		if status != .OK {
			return status
		}
		status = outputs_reset(&session_state.outputs)
		if status != .OK {
			return status
		}
	} else {
		core_types.arena_reset(&session_state.arena)
	}
	session_state.lead_in_ms = lead_in_ms
	return .OK
}

session_release :: proc(instance: ^Instance, engine, session: core_types.Handle) -> core_types.Status {
	_, valid := engine_get(instance, engine)
	if valid != .OK {
		return valid
	}
	value, status := release(&instance.table, session, engine, .SESSION)
	if status != .OK || value == nil {
		return status
	}
	session_state := cast(^Session)value
	map_drop(instance, session_state.map_storage)
	core_types.arena_destroy(&session_state.arena)
	core_types.arena_destroy(&session_state.draw_storage.arena)
	core_types.arena_destroy(&session_state.voice_storage.arena)
	free(session_state, instance.allocator)
	return .OK
}

engine_release :: proc(instance: ^Instance, engine: core_types.Handle) -> core_types.Status {
	slot, status := resolve_slot(&instance.table, engine, 0, .ENGINE)
	if status != .OK {
		return status
	}
	if slot.released {
		return .OK
	}
	// Sessions drop their internal references before external map references.
	for &child, index in instance.table.slots {
		if child.live && child.owner == engine && child.kind == .SESSION {
			handle := core_types.Handle(u64(child.generation) << 32 | u64(index + 1))
			session_release(instance, engine, handle)
		}
	}
	for &child, index in instance.table.slots {
		if child.live && child.owner == engine && child.kind == .MAP {
			map_resource := cast(^Map_Resource)child.value
			map_resource.references -= map_resource.external_references - 1
			map_resource.external_references = 1
			handle := core_types.Handle(u64(child.generation) << 32 | u64(index + 1))
			map_release(instance, engine, handle)
		}
	}
	value, released := release(&instance.table, engine, 0, .ENGINE)
	if value != nil {
		engine_state := cast(^Engine)value
		core_types.arena_destroy(&engine_state.inbox)
		free(engine_state, instance.allocator)
	}
	return released
}

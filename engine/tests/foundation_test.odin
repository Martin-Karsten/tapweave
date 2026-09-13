package tests

import "core:testing"
import "core:fmt"
import "core:mem"
import core_types "../core_types"
import beatmap_decode "../beatmap_decode"
import engine_runtime "../runtime"
import trace_support "../trace_support"
import simulation "../simulation"
import prepared "../prepared"

@(test)
versions_defaults_and_owned_text :: proc(test: ^testing.T) {
	versions := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 128}
	for version in versions {
		text := fmt.aprintf(
			"\xef\xbb\xbfosu file format v%d\n[Difficulty]\nOverallDifficulty: 7\n[HitObjects]\n12.75,-12.75,100,1,0\n",
			version,
		)
		decoded_map, error := beatmap_decode.decode(text)
		delete(text)
		testing.expect_value(test, error.status, core_types.Status.OK)
		if error.status != .OK {
			continue
		}
		testing.expect_value(test, decoded_map.difficulty.approach_rate, 7)
		testing.expect_value(test, decoded_map.difficulty.slider_multiplier, 1.4)
		testing.expect_value(test, decoded_map.objects[0].time_ms, version < 5 ? 124.0 : 100.0)
		testing.expect_value(test, decoded_map.objects[0].x, version == 128 ? 12.75 : 12.0)
		testing.expect_value(test, decoded_map.objects[0].y, version == 128 ? -12.75 : -12.0)
		beatmap_decode.destroy(&decoded_map)
	}
}

@(test)
errors_are_typed_and_transactional :: proc(test: ^testing.T) {
	Case :: struct {
		text: string,
		status: core_types.Status,
		code: core_types.Error_Code,
		line: u32,
	}
	cases := []Case {
		{"", .MALFORMED_MAP, .HEADER, 1},
		{"osu file format v15", .UNSUPPORTED, .FORMAT_VERSION, 1},
		{"osu file format v127", .UNSUPPORTED, .FORMAT_VERSION, 1},
		{"osu file format v129", .UNSUPPORTED, .FORMAT_VERSION, 1},
		{"osu file format v0", .UNSUPPORTED, .FORMAT_VERSION, 1},
		{"osu file format vwat", .MALFORMED_MAP, .HEADER, 1},
		{"\xff", .MALFORMED_MAP, .UTF8, 0},
		{"osu file format v14\n[General]\nMode: 3", .UNSUPPORTED, .MODE, 3},
		{"osu file format v14\n[Difficulty]\nCircleSize: NaN", .MALFORMED_MAP, .NUMBER, 3},
		{"osu file format v14\n[Difficulty]\nCircleSize: 1e999", .MALFORMED_MAP, .NUMBER, 3},
		{"osu file format v14\n[HitObjects]\n0,0,100,128,0", .UNSUPPORTED, .OBJECT_TYPE, 3},
		{"osu file format v14\n[HitObjects]\n0,0,100", .MALFORMED_MAP, .FIELD_COUNT, 3},
		{"osu file format v14\n[HitObjects]\n0,0,100,99999999999999,0", .MALFORMED_MAP, .NUMBER, 3},
		{"osu file format v14\n[TimingPoints]\n0,NaN,4,1,0,100,1,0", .MALFORMED_MAP, .NUMBER, 3},
	}
	for test_case in cases {
		decoded_map, error := beatmap_decode.decode(test_case.text)
		testing.expect_value(test, error.status, test_case.status)
		testing.expect_value(test, error.code, test_case.code)
		testing.expect_value(test, error.line, test_case.line)
		testing.expect(test, decoded_map.arena.bytes == nil)
	}
}

@(test)
sorting_timing_and_slider_syntax :: proc(test: ^testing.T) {
	text :: "osu file format v128\n[TimingPoints]\n0,500\n0,NaN,4,2,3,80,0,1\n[HitObjects]\n100,100,200,1,0\n0,0,100,2,0,B|10:10|L|20:20,2,30\n0,0,100,8,0,500\n"
	decoded_map, error := beatmap_decode.decode(text)
	testing.expect_value(test, error.status, core_types.Status.OK)
	if error.status != .OK {
		return
	}
	defer beatmap_decode.destroy(&decoded_map)
	testing.expect_value(test, decoded_map.objects[0].id, 1)
	testing.expect_value(test, decoded_map.objects[1].id, 2)
	testing.expect_value(test, decoded_map.objects[2].id, 0)
	testing.expect_value(test, decoded_map.objects[0].path, "B|10:10|L|20:20")
	testing.expect_value(test, decoded_map.objects[0].spans, 2)
	testing.expect_value(test, decoded_map.objects[1].x, 256)
	testing.expect(test, !decoded_map.timing[1].generate_ticks && decoded_map.timing[1].beat_length == 0)
}

@(test)
quotas_and_arena_boundaries :: proc(test: ^testing.T) {
	quotas := core_types.DEFAULT_QUOTAS
	quotas.objects = 0
	decoded_map, error := beatmap_decode.decode("osu file format v14\n[HitObjects]\n0,0,0,1,0", quotas)
	testing.expect_value(test, error.code, core_types.Error_Code.OBJECTS)
	testing.expect_value(test, error.requested, 1)
	testing.expect_value(test, error.limit, 0)
	testing.expect(test, decoded_map.arena.bytes == nil)
	_, ok := core_types.checked_add(0xffff_ffff_ffff_ffff, 1)
	testing.expect(test, !ok)
	_, ok = core_types.checked_product(0xffff_ffff_ffff_ffff, 2)
	testing.expect(test, !ok)
	arena, status := core_types.arena_create(16)
	testing.expect_value(test, status, core_types.Status.OK)
	defer core_types.arena_destroy(&arena)
	_, ok = core_types.arena_take(&arena, byte, 1)
	testing.expect(test, ok)
	words, fits := core_types.arena_take(&arena, u64, 1)
	testing.expect(test, fits && uintptr(raw_data(words)) % 8 == 0)
	_, ok = core_types.arena_take(&arena, byte, 1)
	testing.expect(test, !ok && arena.used == 16)
	core_types.arena_reset(&arena)
	testing.expect_value(test, arena.used, 0)
}

@(test)
handle_ownership_reuse_and_wrap :: proc(test: ^testing.T) {
	table, status := engine_runtime.table_create(1)
	testing.expect_value(test, status, core_types.Status.OK)
	value: u32
	first, _ := engine_runtime.insert(&table, 7, .MAP, &value)
	_, status = engine_runtime.lookup(&table, first, 8, .MAP)
	testing.expect_value(test, status, core_types.Status.STALE_HANDLE)
	_, status = engine_runtime.lookup(&table, first, 7, .SESSION)
	testing.expect_value(test, status, core_types.Status.STALE_HANDLE)
	testing.expect_value(test, engine_runtime.table_destroy(&table), core_types.Status.INVALID_STATE)
	pointer: rawptr
	pointer, status = engine_runtime.release(&table, first, 7, .MAP)
	testing.expect(test, pointer == &value && status == .OK)
	pointer, status = engine_runtime.release(&table, first, 7, .MAP)
	testing.expect(test, pointer == nil && status == .OK)
	second, _ := engine_runtime.insert(&table, 8, .MAP, &value)
	testing.expect(test, second != first)
	_, status = engine_runtime.release(&table, first, 7, .MAP)
	testing.expect_value(test, status, core_types.Status.STALE_HANDLE)
	engine_runtime.release(&table, second, 8, .MAP)
	table.slots[0].generation = 0xffff_ffff
	_, status = engine_runtime.insert(&table, 8, .MAP, &value)
	testing.expect_value(test, status, core_types.Status.QUOTA_EXCEEDED)
	testing.expect_value(test, engine_runtime.table_destroy(&table), core_types.Status.OK)
}

reject_allocations :: proc(
	data: rawptr,
	mode: mem.Allocator_Mode,
	size, alignment: int,
	old_memory: rawptr,
	old_size: int,
	location := #caller_location,
) -> (
	[]byte,
	mem.Allocator_Error,
) {
	return nil, .Out_Of_Memory
}

@(test)
allocation_failure_and_replacement :: proc(test: ^testing.T) {
	valid :: "osu file format v14\n[Metadata]\nTitle: kept\n[HitObjects]\n0,0,0,1,0"
	original, error := beatmap_decode.decode(valid)
	testing.expect_value(test, error.status, core_types.Status.OK)
	defer beatmap_decode.destroy(&original)
	failing := mem.Allocator {
		procedure = reject_allocations,
	}
	candidate, failure := beatmap_decode.decode(valid, allocator = failing)
	testing.expect_value(test, failure.status, core_types.Status.OUT_OF_MEMORY)
	testing.expect(test, candidate.arena.bytes == nil)
	testing.expect_value(test, original.metadata.title, "kept")
	// Invalid input never reaches an allocator, even one that panics on use.
	candidate, failure = beatmap_decode.decode("bad header", allocator = mem.panic_allocator())
	testing.expect_value(test, failure.code, core_types.Error_Code.HEADER)
	quotas := core_types.DEFAULT_QUOTAS
	quotas.arena_bytes = 1
	candidate, failure = beatmap_decode.decode(valid, quotas, mem.panic_allocator())
	testing.expect_value(test, failure.code, core_types.Error_Code.ARENA_BYTES)
	quotas = core_types.DEFAULT_QUOTAS
	quotas.raw_bytes += 1
	candidate, failure = beatmap_decode.decode(valid, quotas, mem.panic_allocator())
	testing.expect_value(test, failure.code, core_types.Error_Code.QUOTAS)
}

@(test)
integrated_lifecycle_matrix :: proc(test: ^testing.T) {
	instance, created := engine_runtime.instance_create(32)
	testing.expect_value(test, created, core_types.Status.OK)
	defer testing.expect_value(test, engine_runtime.instance_destroy(&instance), core_types.Status.OK)
	small :: "osu file format v14\n[Metadata]\nTitle: shared\n[TimingPoints]\n100,-50,4,2,1,70,0,1\n[HitObjects]\n0,0,100,1,0"
	line :: "\n0,0,101,1,0"
	large := make([]byte, len(small) + 9999 * len(line))
	defer delete(large)
	copy(large, small)
	for object_index in 0 ..< 9999 {
		copy(large[len(small) + object_index * len(line):], line)
	}
	for cycle in 0 ..< 50 {
		engine, status := engine_runtime.engine_create(&instance)
		testing.expect_value(test, status, core_types.Status.OK)
		other, _ := engine_runtime.engine_create(&instance)
		text :: "osu file format v14\n[Metadata]\nTitle: shared\n[TimingPoints]\n100,-50,4,2,1,70,0,1\n[HitObjects]\n0,0,100,1,0"
		map_handle, error := engine_runtime.map_prepare(
			&instance,
			engine,
			cycle % 2 == 0 ? text : string(large),
		)
		testing.expect_value(test, error.status, core_types.Status.OK)
		original, _ := engine_runtime.map_get(&instance, engine, map_handle)
		testing.expect_value(
			test,
			engine_runtime.map_retain(&instance, other, map_handle),
			core_types.Status.STALE_HANDLE,
		)
		failed, failure := engine_runtime.map_prepare(&instance, engine, "invalid")
		testing.expect_value(test, failed, core_types.Handle(0))
		testing.expect_value(test, failure.status, core_types.Status.MALFORMED_MAP)
		testing.expect_value(test, original.decoded.metadata.title, "shared")
		testing.expect_value(
			test,
			engine_runtime.map_retain(&instance, engine, map_handle),
			core_types.Status.OK,
		)
		sessions: [4]core_types.Handle
		for &session_handle in sessions {
			session_handle, status = engine_runtime.session_create(
				&instance,
				engine,
				map_handle,
				cycle % 2 == 0 ? 128 : 1024 * 1024,
			)
			testing.expect_value(test, status, core_types.Status.OK)
		}
		testing.expect_value(
			test,
			engine_runtime.map_release(&instance, engine, map_handle),
			core_types.Status.OK,
		)
		testing.expect_value(
			test,
			engine_runtime.map_release(&instance, engine, map_handle),
			core_types.Status.OK,
		)
		testing.expect_value(
			test,
			engine_runtime.map_release(&instance, engine, map_handle),
			core_types.Status.OK,
		)
		_, invalid := engine_runtime.map_get(&instance, engine, map_handle)
		testing.expect_value(test, invalid, core_types.Status.STALE_HANDLE)
		for session_handle in sessions {
			session_state, _ := engine_runtime.session_get(&instance, engine, session_handle)
			testing.expect_value(test, session_state.map_storage.decoded.metadata.title, "shared")
			for reset in 0 ..< 20 {
				session_state.arena.bytes[0] = 99
				testing.expect_value(
					test,
					engine_runtime.session_reset(&instance, engine, session_handle, f64(reset)),
					core_types.Status.OK,
				)
				testing.expect_value(test, session_state.arena.bytes[0], byte(0))
			}
		}
		testing.expect_value(
			test,
			engine_runtime.session_release(&instance, engine, sessions[0]),
			core_types.Status.OK,
		)
		testing.expect_value(
			test,
			engine_runtime.session_release(&instance, engine, sessions[0]),
			core_types.Status.OK,
		)
		testing.expect_value(test, engine_runtime.engine_release(&instance, engine), core_types.Status.OK)
		testing.expect_value(test, engine_runtime.engine_release(&instance, engine), core_types.Status.OK)
		testing.expect_value(test, engine_runtime.engine_release(&instance, other), core_types.Status.OK)
		_, stale := engine_runtime.session_get(&instance, engine, sessions[1])
		testing.expect_value(test, stale, core_types.Status.STALE_HANDLE)
	}
}

Fault_State :: struct {
	underlying: mem.Allocator,
	remaining: int,
}

fault_allocator :: proc(
	data: rawptr,
	mode: mem.Allocator_Mode,
	size, alignment: int,
	old_memory: rawptr,
	old_size: int,
	location := #caller_location,
) -> (
	[]byte,
	mem.Allocator_Error,
) {
	state := cast(^Fault_State)data
	if mode == .Alloc || mode == .Resize || mode == .Alloc_Non_Zeroed || mode == .Resize_Non_Zeroed {
		if state.remaining == 0 {
			return nil, .Out_Of_Memory
		}
		state.remaining -= 1
	}
	return state.underlying.procedure(
		state.underlying.data,
		mode,
		size,
		alignment,
		old_memory,
		old_size,
		location,
	)
}

@(test)
integrated_failures_are_transactional :: proc(test: ^testing.T) {
	state := Fault_State{context.allocator, 100}
	allocator := mem.Allocator{fault_allocator, &state}
	instance, _ := engine_runtime.instance_create(8, allocator)
	defer testing.expect_value(test, engine_runtime.instance_destroy(&instance), core_types.Status.OK)
	engine, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine)
	text :: "osu file format v14\n[TimingPoints]\n100,500\n[HitObjects]\n0,0,0,1,0"
	map_handle, error := engine_runtime.map_prepare(&instance, engine, text)
	testing.expect_value(test, error.status, core_types.Status.OK)
	for allowed in 0 ..< 3 {
		state.remaining = allowed
		candidate, error := engine_runtime.map_prepare(&instance, engine, text)
		testing.expect_value(test, candidate, core_types.Handle(0))
		testing.expect_value(test, error.status, core_types.Status.OUT_OF_MEMORY)
		original, status := engine_runtime.map_get(&instance, engine, map_handle)
		testing.expect_value(test, status, core_types.Status.OK)
		testing.expect_value(test, len(original.decoded.objects), 1)
	}
	for allowed in 0 ..< 2 {
		state.remaining = allowed
		session_handle, status := engine_runtime.session_create(&instance, engine, map_handle)
		testing.expect_value(test, session_handle, core_types.Handle(0))
		testing.expect_value(test, status, core_types.Status.OUT_OF_MEMORY)
		original, _ := engine_runtime.map_get(&instance, engine, map_handle)
		testing.expect_value(test, original.references, u32(1))
	}
	state.remaining = 100
	_, token, status := engine_runtime.buffer_reserve(&instance, engine, 100)
	testing.expect_value(test, status, core_types.Status.OK)
	state.remaining = 0
	_, failed_token, failed_status := engine_runtime.buffer_reserve(&instance, engine, 1000)
	testing.expect_value(test, failed_status, core_types.Status.OUT_OF_MEMORY)
	testing.expect_value(test, failed_token, u64(0))
	engine_handle, _ := engine_runtime.engine_get(&instance, engine)
	testing.expect_value(test, engine_handle.token, token)
	testing.expect_value(test, len(engine_handle.inbox.bytes), 100)
}

@(test)
full_registry_rolls_back_candidates :: proc(test: ^testing.T) {
	instance, _ := engine_runtime.instance_create(3)
	defer testing.expect_value(test, engine_runtime.instance_destroy(&instance), core_types.Status.OK)
	engine_handle, _ := engine_runtime.engine_create(&instance)
	defer engine_runtime.engine_release(&instance, engine_handle)
	text :: "osu file format v14\n[TimingPoints]\n0,500"
	map_handle, error := engine_runtime.map_prepare(&instance, engine_handle, text)
	testing.expect_value(test, error.status, core_types.Status.OK)
	session_handle, status := engine_runtime.session_create(&instance, engine_handle, map_handle)
	testing.expect_value(test, status, core_types.Status.OK)
	failed, failure := engine_runtime.map_prepare(&instance, engine_handle, text)
	testing.expect_value(test, failed, core_types.Handle(0))
	testing.expect_value(test, failure.status, core_types.Status.QUOTA_EXCEEDED)
	failed_session, failed_status := engine_runtime.session_create(&instance, engine_handle, map_handle)
	testing.expect_value(test, failed_session, core_types.Handle(0))
	testing.expect_value(test, failed_status, core_types.Status.QUOTA_EXCEEDED)
	decoded_map, _ := engine_runtime.map_get(&instance, engine_handle, map_handle)
	testing.expect_value(test, decoded_map.references, u32(2))
	testing.expect_value(
		test,
		engine_runtime.session_reset(&instance, engine_handle, session_handle, 0),
		core_types.Status.OK,
	)
}

@(test)
sample_locations_and_tolerant_edge_sounds :: proc(test: ^testing.T) {
	decoded_map, error := beatmap_decode.decode("osu file format v14\n[HitObjects]\n0,0,0,1,0,0:x")
	defer beatmap_decode.destroy(&decoded_map)
	testing.expect_value(test, error.status, core_types.Status.MALFORMED_MAP)
	testing.expect_value(test, error.line, u32(3))
	testing.expect_value(test, error.column, u32(13))
	testing.expect_value(test, beatmap_decode.edge_sound_value("x"), i32(0))
	testing.expect_value(test, beatmap_decode.edge_sound_value("9999999999999"), i32(0))
	testing.expect_value(test, beatmap_decode.edge_sound_value("8"), i32(8))
	testing.expect_value(test, beatmap_decode.edge_sound_value("-2147483648"), i32(-2147483648))
	_, integer_error := beatmap_decode.integer("-2147483648", 1, 1)
	testing.expect_value(test, integer_error.status, core_types.Status.MALFORMED_MAP)
}

@(test)
checked_decimal_rejects_wraparound_and_non_decimal_syntax :: proc(test: ^testing.T) {
	for text in ([]string{"18446744073709551617", "-18446744073709551617", "9223372036854775808", "-9223372036854775809", "+", "-", "1_0", "0x10", "9999999999999999999999999999999999999999"}) {
		_, valid := beatmap_decode.parse_decimal(text, min(i64), max(i64))
		testing.expect(test, !valid, text)
	}
	for text in ([]string{"2147483648", "-2147483648", "18446744073709551617"}) {
		_, error := beatmap_decode.integer(text, 3, 5)
		testing.expect_value(test, error.status, core_types.Status.MALFORMED_MAP)
		testing.expect_value(test, error.column, u32(5))
	}
	minimum, minimum_valid := beatmap_decode.parse_decimal("-9223372036854775808", min(i64), max(i64))
	maximum, maximum_valid := beatmap_decode.parse_decimal("9223372036854775807", min(i64), max(i64))
	testing.expect(test, minimum_valid && maximum_valid)
	testing.expect_value(test, minimum, min(i64))
	testing.expect_value(test, maximum, max(i64))
	value, error := beatmap_decode.integer(" +2147483647 ", 3, 5)
	testing.expect_value(test, error.status, core_types.Status.OK)
	testing.expect_value(test, value, i32(2147483647))
	testing.expect_value(test, beatmap_decode.edge_sound_value("18446744073709551617"), i32(0))
	decoded_map, header_error := beatmap_decode.decode("osu file format v18446744073709551630")
	defer beatmap_decode.destroy(&decoded_map)
	testing.expect_value(test, header_error.code, core_types.Error_Code.HEADER)
}

@(test)
trace_buffers_preserve_owned_state_on_failure :: proc(test: ^testing.T) {
	buffers: trace_support.Buffers
	defer trace_support.dispose_buffers(&buffers)
	inbox_address := trace_support.reserve_inbox(&buffers, 4, 4)
	testing.expect(test, inbox_address != 0)
	copy(buffers.inbox, "kept")
	output_bytes, _ := mem.alloc_bytes(3)
	copy(output_bytes, "old")
	testing.expect_value(test, trace_support.publish_output(&buffers, output_bytes, true), u32(3))
	output_address := uintptr(raw_data(buffers.output))
	{
		context.allocator = mem.panic_allocator()
		testing.expect_value(test, trace_support.reserve_inbox(&buffers, 5, 4), uintptr(0))
	}
	{
		context.allocator = mem.Allocator{procedure = reject_allocations}
		testing.expect_value(test, trace_support.reserve_inbox(&buffers, 4, 4), uintptr(0))
	}
	testing.expect_value(test, uintptr(raw_data(buffers.inbox)), inbox_address)
	testing.expect_value(test, string(buffers.inbox), "kept")
	failed_bytes, _ := mem.alloc_bytes(7)
	testing.expect_value(test, trace_support.publish_output(&buffers, failed_bytes, false), u32(0))
	testing.expect_value(test, uintptr(raw_data(buffers.output)), output_address)
	testing.expect_value(test, string(buffers.output), "old")
	replacement_bytes, _ := mem.alloc_bytes(3)
	copy(replacement_bytes, "new")
	testing.expect_value(test, trace_support.publish_output(&buffers, replacement_bytes, true), u32(3))
	testing.expect_value(test, string(buffers.output), "new")
	trace_support.dispose_buffers(&buffers)
	trace_support.dispose_buffers(&buffers)
	testing.expect(test, buffers.inbox == nil && buffers.output == nil)
	// Empty inboxes retain an allocation so the exported address signals success.
	testing.expect(test, trace_support.reserve_inbox(&buffers, 0, 0) != 0)
	testing.expect_value(test, len(buffers.inbox), 0)
}

@(test)
voice_budget_tracks_overlap_instead_of_total_map_length :: proc(test: ^testing.T) {
	object_count :: 64
	objects: [object_count]prepared.Object
	events: [2 * object_count]simulation.Event
	inputs: [128]core_types.Input_Snapshot
	samples := [1]prepared.Sample{{name = "sliderslide"}}
	prepared_map := prepared.Map{objects = objects[:]}
	session := simulation.Session{prepared_map = &prepared_map, events = {storage = events[:]}, inputs = {storage = inputs[:]}}
	for &object, object_index in objects {
		object.kind = .SLIDER
		object.time_ms = f64(object_index) * 100
		object.end_time_ms = object.time_ms + 50
		object.auxiliary_samples = samples[:]
	}
	context.allocator = mem.panic_allocator()
	simulation.measure_voice_overlap(&session)
	testing.expect_value(test, session.maximum_voice_overlap, 1)
	sparse_capacity := simulation.voice_command_capacity(&session)
	for &object in objects {
		object.time_ms = 0
		object.end_time_ms = 100
	}
	simulation.measure_voice_overlap(&session)
	testing.expect_value(test, session.maximum_voice_overlap, object_count)
	testing.expect(test, simulation.voice_command_capacity(&session) > sparse_capacity)
}

// The pinned Skin/SampleStore probe order is engine policy: exact name, then
// wav, mp3 and ogg appended in osu-stable order.
@(test)
sample_probe_policy_publishes_pinned_extension_order :: proc(test: ^testing.T) {
	testing.expect_value(test, engine_runtime.abi_start(), core_types.Status.OK)
	engine_handle, created := engine_runtime.engine_create(&engine_runtime.abi_instance)
	testing.expect_value(test, created, core_types.Status.OK)
	if created != .OK {
		return
	}
	defer testing.expect_value(test, engine_runtime.engine_release(&engine_runtime.abi_instance, engine_handle), core_types.Status.OK)
	mailbox := engine_runtime.oe_abi_control()
	status := engine_runtime.oe_sample_probe(engine_handle, mailbox + engine_runtime.ABI_OUTPUT_OFFSET)
	testing.expect_value(test, core_types.Status(status), core_types.Status.OK)
	policy := engine_runtime.abi_storage.bytes[engine_runtime.ABI_SAMPLE_PROBE_OUTPUT:]
	testing.expect_value(test, engine_runtime.get_u32(policy, engine_runtime.ABI_SAMPLE_PROBE_PROBE_VERSION_OFFSET), 1)
	testing.expect_value(test, engine_runtime.get_u32(policy, engine_runtime.ABI_SAMPLE_PROBE_EXTENSION_COUNT_OFFSET), 4)
	testing.expect_value(test, engine_runtime.get_u32(policy, engine_runtime.ABI_SAMPLE_PROBE_EXTENSIONS_OFFSET_OFFSET), engine_runtime.ABI_SAMPLE_PROBE_SIZE)
	testing.expect_value(test, engine_runtime.get_u32(policy, engine_runtime.ABI_SAMPLE_PROBE_EXTENSIONS_STRIDE_OFFSET), 8)
	testing.expect_value(test, engine_runtime.get_u32(policy, engine_runtime.ABI_SAMPLE_PROBE_FLAGS_OFFSET), 0)
	testing.expect_value(test, engine_runtime.get_u64(policy, engine_runtime.ABI_SAMPLE_PROBE_TOTAL_BYTES_OFFSET), 72)
	expected_extension_names := [4]string{"", ".wav", ".mp3", ".ogg"}
	for extension_index in 0 ..< 4 {
		slot := policy[engine_runtime.ABI_SAMPLE_PROBE_SIZE + extension_index * 8:][:8]
		expected_slot: [8]byte
		copy(expected_slot[:], transmute([]byte)expected_extension_names[extension_index])
		for byte_index in 0 ..< 8 {
			testing.expect_value(test, slot[byte_index], expected_slot[byte_index])
		}
	}
	result_span := engine_runtime.abi_storage.bytes[engine_runtime.ABI_OUTPUT_OFFSET:]
	testing.expect_value(test, engine_runtime.get_u64(result_span, engine_runtime.ABI_BYTE_SPAN_ADDRESS_OFFSET),
		u64(mailbox + engine_runtime.ABI_SAMPLE_PROBE_OUTPUT))
	testing.expect_value(test, engine_runtime.get_u32(result_span, engine_runtime.ABI_BYTE_SPAN_COUNT_OFFSET), 72)
}

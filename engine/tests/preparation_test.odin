package tests

import "core:testing"
import "core:mem"
import core_types "../core_types"
import beatmap_decode "../beatmap_decode"
import osu_prepare "../osu_prepare"
import prepared "../prepared"
import engine "../runtime"

PREPARE_MAP :: "osu file format v14\n[TimingPoints]\n0,500,4,1,2,70,1,0\n[HitObjects]\n256,192,1000,2,14,L|456:192,2,280\n256,192,3100,1,0\n256,192,3200,1,0\n"
@(test)
preparation_ownership_digest_and_schedule :: proc(test: ^testing.T) {
	instance, status := engine.instance_create(16)
	testing.expect_value(test, status, core_types.Status.OK)
	defer testing.expect_value(test, engine.instance_destroy(&instance), core_types.Status.OK)
	owner, _ := engine.engine_create(&instance)
	defer engine.engine_release(&instance, owner)
	handle, error := engine.map_prepare(&instance, owner, PREPARE_MAP, true)
	testing.expect_value(test, error.status, core_types.Status.OK)
	if error.status != .OK {
		return
	}
	resource, _ := engine.map_get(&instance, owner, handle)
	testing.expect(test, resource.fully_prepared && len(resource.prepared_map.description.bytes) > 0)
	digest := resource.prepared_map.prepared_digest
	testing.expect_value(test, resource.prepared_map.objects[1].stack_height, i32(-1))
	testing.expect_value(test, resource.prepared_map.objects[2].stack_height, i32(-2))
	previous := f64(-1e100)
	for entry in resource.prepared_map.schedule {
		testing.expect(test, entry.time_ms >= previous)
		previous = entry.time_ms
	}
	session, _ := engine.session_create(&instance, owner, handle)
	testing.expect_value(test, engine.map_release(&instance, owner, handle), core_types.Status.OK)
	testing.expect_value(test, engine.session_reset(&instance, owner, session, -100), core_types.Status.OK)
	retained, _ := engine.session_get(&instance, owner, session)
	testing.expect_value(test, retained.map_storage.prepared_map.prepared_digest, digest)
	candidate, candidate_error := engine.map_prepare(&instance, owner, PREPARE_MAP, true)
	testing.expect_value(test, candidate_error.status, core_types.Status.OK)
	second, _ := engine.map_get(&instance, owner, candidate)
	testing.expect_value(test, second.prepared_map.prepared_digest, digest)
	testing.expect_value(
		test,
		len(second.prepared_map.description.bytes),
		len(retained.map_storage.prepared_map.description.bytes),
	)
	for value, index in second.prepared_map.description.bytes {
		testing.expect_value(test, value, retained.map_storage.prepared_map.description.bytes[index])
	}
	testing.expect_value(test, engine.session_release(&instance, owner, session), core_types.Status.OK)
}

@(test)
preparation_allocation_failures_preserve_published_map :: proc(test: ^testing.T) {
	fault := Fault_State{context.allocator, 100}
	allocator := mem.Allocator{fault_allocator, &fault}
	instance, _ := engine.instance_create(16, allocator)
	defer testing.expect_value(test, engine.instance_destroy(&instance), core_types.Status.OK)
	owner, _ := engine.engine_create(&instance)
	defer engine.engine_release(&instance, owner)
	original, error := engine.map_prepare(&instance, owner, PREPARE_MAP, true)
	testing.expect_value(test, error.status, core_types.Status.OK)
	if error.status != .OK {
		return
	}
	resource, _ := engine.map_get(&instance, owner, original)
	digest := resource.prepared_map.prepared_digest
	succeeded := false
	failures := 0
	for allowed in 0 ..< 16 {
		fault.remaining = allowed
		candidate, candidate_error := engine.map_prepare(&instance, owner, PREPARE_MAP, true)
		if candidate_error.status == .OK {
			engine.map_release(&instance, owner, candidate)
			succeeded = true
			break
		}
		failures += 1
		testing.expect_value(test, candidate_error.status, core_types.Status.OUT_OF_MEMORY)
		testing.expect_value(test, candidate, core_types.Handle(0))
		testing.expect_value(test, resource.prepared_map.prepared_digest, digest)
		testing.expect_value(test, resource.references, u32(1))
	}
	testing.expect(test, succeeded && failures >= 6)
	fault.remaining = 100
}

@(test)
preparation_quota_boundaries_and_duration :: proc(test: ^testing.T) {
	decoded, error := beatmap_decode.decode(PREPARE_MAP)
	testing.expect_value(test, error.status, core_types.Status.OK)
	defer beatmap_decode.destroy(&decoded)
	points, status := osu_prepare.resolve(&decoded)
	testing.expect_value(test, status, core_types.Status.OK)
	defer osu_prepare.destroy(&points)
	scratch, scratch_status := osu_prepare.create_scratch(
		&decoded,
		core_types.DEFAULT_QUOTAS.arena_bytes,
		context.allocator,
	)
	testing.expect_value(test, scratch_status, core_types.Status.OK)
	scratch_bytes := u64(len(scratch.arena.bytes))
	core_types.arena_destroy(&scratch.arena)
	prepared_map, prepare_error := osu_prepare.prepare_map(&decoded, &points)
	testing.expect_value(test, prepare_error.status, core_types.Status.OK)
	defer prepared.destroy_map(&prepared_map)
	boundary := scratch_bytes + u64(len(prepared_map.arena.bytes))
	failed, failure := osu_prepare.prepare_map(&decoded, &points, boundary - 1)
	defer prepared.destroy_map(&failed)
	testing.expect_value(test, failure.status, core_types.Status.QUOTA_EXCEEDED)
	exact, exact_error := osu_prepare.prepare_map(&decoded, &points, boundary)
	defer prepared.destroy_map(&exact)
	testing.expect_value(test, exact_error.status, core_types.Status.OK)
	duration_map, duration_error := osu_prepare.prepare_map(
		&decoded,
		&points,
		core_types.DEFAULT_QUOTAS.arena_bytes,
		context.allocator,
		2000,
	)
	defer prepared.destroy_map(&duration_map)
	testing.expect_value(test, duration_error.code, core_types.Error_Code.DURATION)
	testing.expect_value(
		test,
		prepared.describe(&prepared_map, core_types.DEFAULT_QUOTAS.arena_bytes),
		core_types.Status.OK,
	)
	description_size := u64(len(prepared_map.description.bytes))
	testing.expect_value(
		test,
		prepared.describe(&exact, description_size - 1),
		core_types.Status.QUOTA_EXCEEDED,
	)
	testing.expect_value(test, prepared.describe(&exact, description_size), core_types.Status.OK)
}

@(test)
prepared_records_outlive_decoder_and_control_points :: proc(test: ^testing.T) {
	text :: "osu file format v14\n[General]\nAudioFilename: music\\track.mp3\nAudioLeadIn: 120\nSamplesMatchPlaybackRate: 1\n[Events]\n2,10,20\n[TimingPoints]\n100,500,3,2,4,60,1,8\n200,-50,4,3,5,70,0,1\n[HitObjects]\n256,192,1000,53,2,2: 3: 4: 50:\n"
	decoded_map, decode_error := beatmap_decode.decode(text)
	testing.expect_value(test, decode_error.status, core_types.Status.OK)
	defer beatmap_decode.destroy(&decoded_map)
	control_points, control_status := osu_prepare.resolve(&decoded_map)
	testing.expect_value(test, control_status, core_types.Status.OK)
	defer osu_prepare.destroy(&control_points)
	prepared_map, prepare_error := osu_prepare.prepare_map(&decoded_map, &control_points)
	testing.expect_value(test, prepare_error.status, core_types.Status.OK)
	defer prepared.destroy_map(&prepared_map)
	if prepare_error.status != .OK {
		return
	}
	beatmap_decode.destroy(&decoded_map)
	osu_prepare.destroy(&control_points)
	testing.expect_value(test, prepared_map.playback.audio_filename, "music/track.mp3")
	testing.expect_value(test, prepared_map.playback.audio_lead_in, f64(120))
	testing.expect(test, prepared_map.playback.samples_match_playback_rate)
	testing.expect_value(test, prepared_map.breaks[0].end_ms, f64(20))
	testing.expect_value(test, prepared_map.timing_points[0].meter, i32(3))
	testing.expect(test, prepared_map.timing_points[0].omit_first_bar)
	testing.expect(test, prepared_map.effect_points[0].kiai)
	testing.expect_value(test, prepared_map.objects[0].samples[1].bank, "drum")
	testing.expect_value(test, prepared_map.objects[0].samples[1].suffix, "4")
	testing.expect_value(test, prepared_map.objects[0].samples[1].volume, i32(50))
	testing.expect_value(
		test,
		prepared.describe(&prepared_map, core_types.DEFAULT_QUOTAS.arena_bytes),
		core_types.Status.OK,
	)
}

@(test)
preparation_work_budget_covers_both_passes_and_stacking :: proc(test: ^testing.T) {
	decoded_map, decode_error := beatmap_decode.decode(PREPARE_MAP)
	testing.expect_value(test, decode_error.status, core_types.Status.OK)
	defer beatmap_decode.destroy(&decoded_map)
	control_points, control_status := osu_prepare.resolve(&decoded_map)
	testing.expect_value(test, control_status, core_types.Status.OK)
	defer osu_prepare.destroy(&control_points)
	budget := core_types.Work_Budget {
		remaining = core_types.DEFAULT_PREPARATION_WORK,
	}
	prepared_map, prepare_error := osu_prepare.prepare_map(
		&decoded_map,
		&control_points,
		work_budget = &budget,
	)
	testing.expect_value(test, prepare_error.status, core_types.Status.OK)
	defer prepared.destroy_map(&prepared_map)
	consumed_work := core_types.DEFAULT_PREPARATION_WORK - budget.remaining
	testing.expect(test, consumed_work > u64(len(PREPARE_MAP)))
	budget.remaining = consumed_work - 1
	failed_map, failure := osu_prepare.prepare_map(&decoded_map, &control_points, work_budget = &budget)
	defer prepared.destroy_map(&failed_map)
	testing.expect_value(test, failure.status, core_types.Status.QUOTA_EXCEEDED)
	testing.expect_value(test, failure.code, core_types.Error_Code.PREPARATION_WORK)
	testing.expect(test, failed_map.arena.bytes == nil)
	budget.remaining = consumed_work
	exact_map, exact_error := osu_prepare.prepare_map(&decoded_map, &control_points, work_budget = &budget)
	defer prepared.destroy_map(&exact_map)
	testing.expect_value(test, exact_error.status, core_types.Status.OK)
	testing.expect_value(test, budget.remaining, u64(0))
	testing.expect_value(test, exact_map.prepared_digest, prepared_map.prepared_digest)
	budget.remaining = 0
	failed_points, point_status := osu_prepare.resolve(&decoded_map, work_budget = &budget)
	defer osu_prepare.destroy(&failed_points)
	testing.expect_value(test, point_status, core_types.Status.QUOTA_EXCEEDED)
	testing.expect(test, failed_points.arena.bytes == nil)
}

@(test)
prepared_identity_v2_has_a_fixed_golden :: proc(test: ^testing.T) {
	// Independently encoded from the documented v2 scalar/string/array protocol.
	expected := [32]byte {
		0xf1,
		0x99,
		0x64,
		0xfa,
		0x85,
		0x0b,
		0xa0,
		0xad,
		0x2d,
		0x99,
		0x72,
		0x8a,
		0xfd,
		0xda,
		0xfa,
		0xd0,
		0x24,
		0x74,
		0x95,
		0xd5,
		0x0e,
		0x86,
		0x7e,
		0x8e,
		0x12,
		0x60,
		0xd4,
		0x89,
		0xa7,
		0xfa,
		0x74,
		0xde,
	}
	decoded_map, decode_error := beatmap_decode.decode("osu file format v14\n")
	testing.expect_value(test, decode_error.status, core_types.Status.OK)
	defer beatmap_decode.destroy(&decoded_map)
	control_points, control_status := osu_prepare.resolve(&decoded_map)
	testing.expect_value(test, control_status, core_types.Status.OK)
	defer osu_prepare.destroy(&control_points)
	prepared_map, prepare_error := osu_prepare.prepare_map(&decoded_map, &control_points)
	testing.expect_value(test, prepare_error.status, core_types.Status.OK)
	defer prepared.destroy_map(&prepared_map)
	testing.expect_value(test, prepared_map.prepared_digest, expected)
	prepared_map.playback.audio_lead_in = 1
	prepared.compute_identity(&prepared_map, decoded_map.text)
	testing.expect(test, prepared_map.prepared_digest != expected)
}

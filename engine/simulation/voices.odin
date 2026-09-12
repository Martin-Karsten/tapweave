// Policies derived from pinned DrawableSlider/DrawableSpinner; see ADR-004.
// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
package simulation

import "core:mem"
import "core:math"
import prepared "../prepared"
import rules "../osu_rules"
import audio_protocol "../audio_protocol"
import core_types "../core_types"

LOOP_COMPONENT_ID :: max(u32) - 1
Voice_State :: struct {
	voice_id: u64,
	requested: bool,
	pan, rate: f64,
	previous_angle: f32,
	has_angle: bool,
	rotation_difference, update_ms: f64,
	volume_from, volume_target, volume_begin_ms, volume_end_ms: f64,
	resume_pending: bool,
}
Voice_Journal :: struct {
	// Borrowed runtime reserve storage, enabled only before gameplay starts.
	commands: []audio_protocol.Command,
	states: []Voice_State,
	deadlines: Candidate_Index,
	count, acknowledged: int,
}

loop_sample :: proc(sample: prepared.Sample) -> bool {
	return prepared.is_loop_sample(sample.name)
}

// Input cost scales with maximum simultaneous loops, not total map length.
// Four commands cover a motion/tracking update and its decay deadline. The
// per-object term covers scheduled judgements, start/end and terminal cleanup.
voice_command_capacity :: proc(session: ^Session) -> u64 {
	input_visits, fits := core_types.checked_product(session.maximum_voice_overlap, u64(len(session.inputs.storage) + session.live_input_capacity + 4))
	if !fits {
		return max(u64)
	}
	visits := input_visits
	for object in session.prepared_map.objects {
		loop_count: u64
		for sample in object.auxiliary_samples {
			if loop_sample(sample) {
				loop_count += 1
			}
		}
		object_visits, product_fits := core_types.checked_product(loop_count, u64(2 * len(object.components) + 8))
		if !product_fits {
			return max(u64)
		}
		visits, fits = core_types.checked_add(visits, object_visits)
		if !fits {
			return max(u64)
		}
	}
	loop_commands, product_fits := core_types.checked_product(visits, 4)
	if !product_fits {
		return max(u64)
	}
	command_count, count_fits := core_types.checked_add(sample_count(session.prepared_map), loop_commands)
	return count_fits ? command_count : max(u64)
}

Voice_End :: struct {
	time_ms: f64,
	loop_count: u64,
}

// Creation-only sweep. Calibration has finished with the reserved event arena;
// reset_session reconstructs the actual scheduler after this temporary borrow.
measure_voice_overlap :: proc(session: ^Session) {
	storage := mem.slice_ptr(cast(^Voice_End)raw_data(session.events.storage), len(session.prepared_map.objects))
	end_count := 0
	active_count: u64
	session.maximum_voice_overlap = 0
	for object in session.prepared_map.objects {
		for end_count > 0 && storage[0].time_ms <= object.time_ms {
			active_count -= storage[0].loop_count
			end_count -= 1
			replacement := storage[end_count]
			heap_index := 0
			for heap_index * 2 + 1 < end_count {
				child_index := heap_index * 2 + 1
				if child_index + 1 < end_count && storage[child_index + 1].time_ms < storage[child_index].time_ms {
					child_index += 1
				}
				if replacement.time_ms <= storage[child_index].time_ms {
					break
				}
				storage[heap_index] = storage[child_index]
				heap_index = child_index
			}
			storage[heap_index] = replacement
		}
		loop_count: u64
		for sample in object.auxiliary_samples {
			if loop_sample(sample) && object.end_time_ms > object.time_ms {
				loop_count += 1
			}
		}
		if loop_count == 0 {
			continue
		}
		active_count += loop_count
		session.maximum_voice_overlap = max(session.maximum_voice_overlap, active_count)
		heap_index := end_count
		end_count += 1
		for heap_index > 0 {
			parent_index := (heap_index - 1) / 2
			if storage[parent_index].time_ms <= object.end_time_ms {
				break
			}
			storage[heap_index] = storage[parent_index]
			heap_index = parent_index
		}
		storage[heap_index] = {object.end_time_ms, loop_count}
	}
}

reset_voices :: proc(session: ^Session) {
	session.voices.count = 0
	session.voices.acknowledged = 0
	mem.zero_slice(session.voices.states)
	for &deadline in session.voices.deadlines.minimum_reveal {
		deadline = math.inf_f64(1)
	}
	if len(session.voices.commands) > 0 {
		for object, object_index in session.prepared_map.objects {
			if object.kind == .SLIDER {
				candidate_set(&session.voices.deadlines, object_index, object.time_ms)
			}
		}
	}
}

emit_voice :: proc(session: ^Session, command: audio_protocol.Command) {
	if len(session.voices.commands) == 0 {
		return
	}
	assert(session.voices.count < len(session.voices.commands))
	command := command
	command.sequence = u64(session.voices.count + 1)
	command.epoch = session.epoch
	if command.voice_id == 0 {
		command.voice_id = command.sequence
	}
	assert(audio_protocol.valid_command(command))
	session.voices.commands[session.voices.count] = command
	session.voices.count += 1
}

emit_voice_one_shot :: proc(session: ^Session, event: audio_protocol.Event) {
	command := audio_protocol.one_shot_command(event)
	command.voice_id = 0
	emit_voice(session, command)
}

update_voice_object :: proc(session: ^Session, object_index: int, time_ms: f64, force_stop := false) {
	if len(session.voices.commands) == 0 {
		return
	}
	object := &session.prepared_map.objects[object_index]
	object_state := &session.objects[object_index]
	candidate_remove(&session.voices.deadlines, object_index)
	sample_range := session.sample_ranges[object_index]
	for binding_index := sample_range.start; binding_index < sample_range.end; binding_index += 1 {
		binding := &session.sample_bindings[binding_index]
		if binding.component_id != LOOP_COMPONENT_ID {
			continue
		}
		voice := &session.voices.states[binding_index]
		active := time_ms >= object.time_ms && time_ms < object.end_time_ms && !terminal(session) && !force_stop
		requested := active && object_state.tracking
		pan: f64
		rate := f64(1)
		if object.kind == .SPINNER {
			// Continuous interpolation of the pinned 0.99/ms disc damping. Inputs
			// change the target; an indexed exact threshold deadline ends motion
			// even without another input or a presentation read (ADR-004).
			angle := object_state.last_angle
			rotation_delta := voice.has_angle ? angle - voice.previous_angle : f32(0)
			if rotation_delta > 180 {
				rotation_delta -= 360
			}
			if rotation_delta < -180 {
				rotation_delta += 360
			}
			voice.rotation_difference *= math.pow(0.99, max(0, time_ms - voice.update_ms))
			if active && session.cursor.action_bits & 3 != 0 {
				voice.rotation_difference += f64(rotation_delta)
			}
			voice.previous_angle = angle
			voice.has_angle = object_state.has_angle
			voice.update_ms = time_ms
			requested = active && math.abs(voice.rotation_difference) > 10
			if requested {
				deadline_ms := spinning_decay_deadline(time_ms, object.end_time_ms, voice.rotation_difference)
				candidate_set(&session.voices.deadlines, object_index, deadline_ms)
			}
			progress := object.spins_required == 0 ? f32(1) : clamp(rules.total_rotation(&object_state.spin_history) / 360 / f32(object.spins_required), 0, 1)
			rate = f64(f32(0.5) + progress)
		} else {
			if time_ms < object.time_ms && !force_stop {
				candidate_set(&session.voices.deadlines, object_index, object.time_ms)
			}
			position := rules.slider_position(object, time_ms)
			pan = clamp(round_balance((position[0] / 512 - 0.5) * f64(f32(0.2) * 2) * 100) / 100, -1, 1)
		}
		command := audio_protocol.Command{time_ms = time_ms, voice_id = voice.voice_id,
			asset_id = binding.asset_id, volume = f64(binding.sample.volume) / 100,
			pan = pan, rate = rate, late_policy = .IMMEDIATE, object_id = object.id,
			component_id = LOOP_COMPONENT_ID, flags = binding.asset_id == 0 ? 1 : 0}
		if requested && voice.voice_id == 0 {
			command.command_kind = .LOOP_START
			if object.kind == .SPINNER {
				command.volume = 0
			}
			voice.volume_from = command.volume
			voice.volume_target = command.volume
			voice.volume_begin_ms = time_ms
			voice.volume_end_ms = time_ms
			emit_voice(session, command)
			voice.voice_id = u64(session.voices.count)
			command.voice_id = voice.voice_id
			voice.pan = pan
			voice.rate = rate
		}
		if voice.voice_id != 0 && (voice.pan != pan || voice.rate != rate) {
			command.command_kind = .PARAMETER_RAMP
			command.parameter_mask = 6
			emit_voice(session, command)
			voice.pan = pan
			voice.rate = rate
		}
		if voice.voice_id != 0 && object.kind == .SPINNER && requested != voice.requested {
			command.command_kind = .PARAMETER_RAMP
			command.parameter_mask = 1
			command.volume = requested ? f64(binding.sample.volume) / 100 : 0
			command.duration_ms = requested ? 300 : 240
			voice.volume_from = voice_volume_at(voice, time_ms)
			voice.volume_target = command.volume
			voice.volume_begin_ms = time_ms
			voice.volume_end_ms = time_ms + command.duration_ms
			emit_voice(session, command)
		}
		if voice.voice_id != 0 && (!active || object.kind == .SLIDER && !requested) {
			command.command_kind = .LOOP_STOP
			command.parameter_mask = 0
			command.duration_ms = 0
			if object.kind == .SPINNER {
				command.time_ms += 240
			}
			emit_voice(session, command)
			voice.voice_id = 0
		}
		voice.requested = requested
	}
}

stop_voice_objects :: proc(session: ^Session, time_ms: f64) {
	if len(session.voices.commands) == 0 {
		return
	}
	for _, object_index in session.prepared_map.objects {
		update_voice_object(session, object_index, time_ms, true)
	}
}

// Math.Round's midpoint-to-even rule, restricted to finite balance values.
round_balance :: proc(balance: f64) -> f64 {
	lower := math.floor(balance)
	fraction := balance - lower
	if fraction < 0.5 || fraction == 0.5 && i64(lower) % 2 == 0 {
		return lower
	}
	return lower + 1
}

next_voice_time :: proc(session: ^Session) -> f64 {
	if len(session.voices.deadlines.minimum_reveal) == 0 {
		return math.inf_f64(1)
	}
	return session.voices.deadlines.minimum_reveal[1]
}

advance_voice_deadline :: proc(session: ^Session, time_ms: f64) {
	work: u64
	object_index := candidate_find(&session.voices.deadlines, 0, len(session.objects), time_ms, false, &work)
	assert(object_index >= 0)
	update_voice_object(session, object_index, time_ms)
}

// Bounded inversion using the existing native/WASM pow import. The upper bound
// satisfies the threshold or is the nominal end; return that representable time.
spinning_decay_deadline :: proc(start_ms, end_ms, difference: f64) -> f64 {
	lower_ms, upper_ms := start_ms, end_ms
	for iteration in 0 ..< 64 {
		middle_ms := lower_ms + (upper_ms - lower_ms) / 2
		if middle_ms == lower_ms || middle_ms == upper_ms {
			break
		}
		if math.abs(difference) * math.pow(0.99, middle_ms - start_ms) > 10 {
			lower_ms = middle_ms
		} else {
			upper_ms = middle_ms
		}
	}
	return upper_ms
}

voice_volume_at :: proc(voice: ^Voice_State, time_ms: f64) -> f64 {
	if time_ms >= voice.volume_end_ms || voice.volume_end_ms <= voice.volume_begin_ms {
		return voice.volume_target
	}
	progress := clamp((time_ms - voice.volume_begin_ms) / (voice.volume_end_ms - voice.volume_begin_ms), 0, 1)
	return voice.volume_from + (voice.volume_target - voice.volume_from) * progress
}

// Pause stops browser resources without destroying the spinner's requested
// state or its beatmap-relative transform. Resume creates fresh voice identities.
pause_voices :: proc(session: ^Session, time_ms: f64) {
	for &voice, binding_index in session.voices.states {
		if voice.voice_id == 0 {
			continue
		}
		binding := &session.sample_bindings[binding_index]
		emit_voice(session, {command_kind = .LOOP_STOP, time_ms = time_ms,
			voice_id = voice.voice_id, asset_id = binding.asset_id,
			volume = voice_volume_at(&voice, time_ms), pan = voice.pan, rate = voice.rate,
			late_policy = .IMMEDIATE, object_id = binding.object_id, component_id = LOOP_COMPONENT_ID,
			flags = binding.asset_id == 0 ? 1 : 0})
		voice.voice_id = 0
		voice.resume_pending = true
	}
}

resume_voices :: proc(session: ^Session, time_ms: f64) {
	for &voice, binding_index in session.voices.states {
		if !voice.resume_pending {
			continue
		}
		binding := &session.sample_bindings[binding_index]
		command := audio_protocol.Command{command_kind = .LOOP_START, time_ms = time_ms,
			asset_id = binding.asset_id, volume = voice_volume_at(&voice, time_ms), pan = voice.pan, rate = voice.rate,
			late_policy = .IMMEDIATE, object_id = binding.object_id, component_id = LOOP_COMPONENT_ID,
			flags = binding.asset_id == 0 ? 1 : 0}
		emit_voice(session, command)
		voice.voice_id = u64(session.voices.count)
		voice.resume_pending = false
		if voice.volume_end_ms > time_ms {
			command.command_kind = .PARAMETER_RAMP
			command.voice_id = voice.voice_id
			command.parameter_mask = 1
			command.volume = voice.volume_target
			command.duration_ms = voice.volume_end_ms - time_ms
			emit_voice(session, command)
		}
	}
}

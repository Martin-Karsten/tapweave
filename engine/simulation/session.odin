package simulation

import "core:math"
import "core:mem"
import core_types "../core_types"
import prepared "../prepared"
import rules "../osu_rules"
import scoring "../scoring"
import replay "../replay"
import audio_protocol "../audio_protocol"

Session_Status :: enum u32 {
	READY,
	RUNNING,
	PAUSED,
	PASSED,
	FAILED,
}
Cause :: enum u32 {
	INPUT,
	DEADLINE,
	NOTE_LOCK,
	TRACKING,
	SPINNER,
}
Judgement_Event :: struct {
	sequence: u64,
	time_ms, offset_ms: f64,
	object_id, component_id: u32,
	result, maximum: core_types.Hit_Result,
	cause: Cause,
	combo_before, combo_after: u32,
	health_before, health_after: f64,
	score_after: i64,
}
Component_State :: struct {
	result: core_types.Hit_Result,
	time_ms: f64,
}
// All slices borrow one creation-time arena owned by the runtime. A Session
// must not be copied: queues and prepared_map pointers refer to these borrowed slices.
Sample_Binding :: struct {
	object_id, component_id, sample_index: u32,
	sample: ^prepared.Sample,
	asset_id: u64,
	candidate_assets: []u64,
}
Sample_Range :: struct {
	start, end: int,
}

Work_Counters :: struct {
	input_candidate_visits, predecessor_visits, tracking_visits, sample_binding_visits: u64,
	index_node_visits: u64,
}

Session :: struct {
	prepared_map: ^prepared.Map,
	objects: []rules.Object_State,
	components: []Component_State,
	events: Event_Queue,
	inputs: Input_Queue,
	recording: []core_types.Input_Snapshot,
	recording_count: int,
	journal: []Judgement_Event,
	journal_count, acknowledged_count: int,
	no_drain: []prepared.Break,
	sample_bindings: []Sample_Binding,
	sample_ranges: []Sample_Range,
	work: Work_Counters,
	head_candidates, blocking_candidates, tracking_candidates: Candidate_Index,
	audio: []audio_protocol.Event,
	audio_count, acknowledged_audio_count: int,
	state: Session_Status,
	committed_ms, lead_in_ms, health_time_ms, drain_start_ms, drain_end_ms, drain_rate: f64,
	live_input_capacity, submitted_input_count, pause_count, completed_objects: int,
	epoch: u32,
	cursor: core_types.Input_Snapshot,
	score: scoring.Score,
	health: scoring.Health,
	windows: rules.Hit_Windows,
	terminal_ms: f64,
	replay_mode: bool,
	replay_frames: []core_types.Input_Snapshot,
}

size_add :: proc(total: ^u64, $T: typeid, count: u64) -> bool {
	_, end, fits := core_types.aligned_end(total^, count, size_of(T), align_of(T))
	if fits {
		total^ = end
	}
	return fits
}

counts :: proc(prepared_map: ^prepared.Map) -> (component_count, judgement_count: u64, status: core_types.Status) {
	if len(prepared_map.objects) == 0 {
		return 0, 0, .INVALID_ARGUMENT
	}
	judgement_count = u64(len(prepared_map.objects))
	for &object in prepared_map.objects {
		component_count += u64(len(object.components))
		for component in object.components {
			if component.kind != .LegacyLastTick {
				judgement_count += 1
			}
		}
	}
	if 2 * (component_count + u64(len(prepared_map.objects))) > MAX_EVENTS || judgement_count > scoring.MAX_JUDGEMENTS {
		return 0, 0, .QUOTA_EXCEEDED
	}
	return component_count, judgement_count, .OK
}

// The pinned model stores tail samples on Slider, while DrawableSlider plays
// them on the tail's behalf. Bind those samples to the semantic tail result.
component_samples :: proc(object: ^prepared.Object, component: ^prepared.Component) -> []prepared.Sample {
	if component.kind == .Tail {
		return object.tail_samples
	}
	return component.samples
}

sample_count :: proc(prepared_map: ^prepared.Map) -> u64 {
	count: u64
	for &object in prepared_map.objects {
		if object.kind != .SLIDER {
			count += u64(len(object.samples))
		}
		for &component in object.components {
			if component.kind != .LegacyLastTick {
				count += u64(len(component_samples(&object, &component)))
			}
		}
	}
	return count
}

candidate_count :: proc(prepared_map: ^prepared.Map) -> u64 {
	count: u64
	for &object in prepared_map.objects {
		if object.kind != .SLIDER {
			for sample in object.samples {
				count += u64(len(sample.candidates))
			}
		}
		for &component in object.components {
			if component.kind != .LegacyLastTick {
				for sample in component_samples(&object, &component) {
					count += u64(len(sample.candidates))
				}
			}
		}
	}
	return count
}

recording_capacity :: proc(prepared_map: ^prepared.Map, input_capacity: u64) -> u64 {
	_, judgement_count, _ := counts(prepared_map)
	return 2 * input_capacity + judgement_count + 2
}

required_bytes :: proc(prepared_map: ^prepared.Map, input_capacity: u64) -> (u64, core_types.Status) {
	component_count, judgement_count, status := counts(prepared_map)
	if status != .OK {
		return 0, status
	}
	if input_capacity == 0 || input_capacity > replay.MAX_FRAMES || recording_capacity(prepared_map, input_capacity) > replay.MAX_FRAMES {
		return 0, .QUOTA_EXCEEDED
	}
	total: u64
	if !size_add(&total, rules.Object_State, u64(len(prepared_map.objects))) ||
	   !size_add(&total, Component_State, component_count) ||
	   !size_add(&total, Event, 2 * (component_count + u64(len(prepared_map.objects)))) ||
	   !size_add(&total, core_types.Input_Snapshot, recording_capacity(prepared_map, input_capacity)) ||
	   !size_add(&total, core_types.Input_Snapshot, recording_capacity(prepared_map, input_capacity)) ||
	   !size_add(&total, Judgement_Event, judgement_count) ||
	   !size_add(&total, prepared.Break, u64(len(prepared_map.breaks))) ||
	   !size_add(&total, Sample_Range, u64(len(prepared_map.objects))) ||
	   !size_add(&total, f64, 3 * candidate_slots(len(prepared_map.objects))) ||
	   !size_add(&total, Sample_Binding, sample_count(prepared_map)) ||
	   !size_add(&total, audio_protocol.Event, sample_count(prepared_map)) ||
	   !size_add(&total, u64, candidate_count(prepared_map)) {
		return 0, .QUOTA_EXCEEDED
	}
	return total, .OK
}

initialize :: proc(session: ^Session, prepared_map: ^prepared.Map, arena: ^core_types.Arena, input_capacity: u64, lead_in_ms: f64) -> core_types.Status {
	required, status := required_bytes(prepared_map, input_capacity)
	if status != .OK {
		return status
	}
	if arena.used > u64(len(arena.bytes)) || required > u64(len(arena.bytes)) - arena.used {
		return .QUOTA_EXCEEDED
	}
	component_count, judgement_count, _ := counts(prepared_map)
	session.prepared_map = prepared_map
	session.objects, _ = core_types.arena_take(arena, rules.Object_State, u64(len(prepared_map.objects)))
	session.components, _ = core_types.arena_take(arena, Component_State, component_count)
	session.events.storage, _ = core_types.arena_take(arena, Event, 2 * (component_count + u64(len(prepared_map.objects))))
	session.live_input_capacity = int(input_capacity)
	session.inputs.storage, _ = core_types.arena_take(arena, core_types.Input_Snapshot, recording_capacity(prepared_map, input_capacity))
	session.recording, _ = core_types.arena_take(arena, core_types.Input_Snapshot, recording_capacity(prepared_map, input_capacity))
	session.journal, _ = core_types.arena_take(arena, Judgement_Event, judgement_count)
	session.no_drain, _ = core_types.arena_take(arena, prepared.Break, u64(len(prepared_map.breaks)))
	session.sample_ranges, _ = core_types.arena_take(arena, Sample_Range, u64(len(prepared_map.objects)))
	session.head_candidates.minimum_reveal, _ = core_types.arena_take(arena, f64, candidate_slots(len(prepared_map.objects)))
	session.blocking_candidates.minimum_reveal, _ = core_types.arena_take(arena, f64, candidate_slots(len(prepared_map.objects)))
	session.tracking_candidates.minimum_reveal, _ = core_types.arena_take(arena, f64, candidate_slots(len(prepared_map.objects)))
	session.sample_bindings, _ = core_types.arena_take(arena, Sample_Binding, sample_count(prepared_map))
	session.audio, _ = core_types.arena_take(arena, audio_protocol.Event, sample_count(prepared_map))
	binding_index := 0
	for &object, object_index in prepared_map.objects {
		session.sample_ranges[object_index].start = binding_index
		if object.kind != .SLIDER {
			for &sample, sample_index in object.samples {
				session.sample_bindings[binding_index] = {object.id, max(u32), u32(sample_index), &sample, 0, nil}
				binding_index += 1
			}
		}
		for &component in object.components {
			if component.kind == .LegacyLastTick {
				continue
			}
			for &sample, sample_index in component_samples(&object, &component) {
				session.sample_bindings[binding_index] = {object.id, component.id, u32(sample_index), &sample, 0, nil}
				binding_index += 1
			}
		}
		session.sample_ranges[object_index].end = binding_index
	}
	for &binding in session.sample_bindings {
		binding.candidate_assets, _ = core_types.arena_take(arena, u64, u64(len(binding.sample.candidates)))
	}
	session.windows, status = rules.hit_windows(prepared_map.difficulty.overall_difficulty)
	if status != .OK {
		return status
	}
	// Reuse creation-time event storage as temporary calibration storage, with
	// separately checked lengths. No temporary allocation or owning copy.
	increases := mem.slice_ptr(cast(^scoring.Health_Increase)raw_data(session.events.storage), int(judgement_count))
	increase_count := 0
	maximum_accumulator: scoring.Accumulator
	for &object in prepared_map.objects {
		for component, component_index in object.components {
			maximum := rules.maximum_result(&object, component_index)
			if maximum == .NONE {
				continue
			}
			scoring.accumulate(&maximum_accumulator, {maximum, maximum})
			if !core_types.result_properties(maximum).bonus {
				increases[increase_count] = {component.time_ms, scoring.health_increase(maximum, prepared_map.difficulty.health_drain_rate, component.kind == .Tick)}
				increase_count += 1
			}
		}
		maximum := rules.maximum_result(&object, -1)
		scoring.accumulate(&maximum_accumulator, {maximum, maximum})
		increases[increase_count] = {object.end_time_ms, scoring.health_increase(maximum, prepared_map.difficulty.health_drain_rate)}
		increase_count += 1
	}
	session.score.maxima = {maximum_accumulator.counts, maximum_accumulator.highest_combo, maximum_accumulator.accuracy_count, maximum_accumulator.numerator, maximum_accumulator.combo_portion}
	// Break records are reused as two f64 slots until calibration completes.
	break_ends := mem.slice_ptr(cast(^f64)raw_data(session.no_drain), len(prepared_map.breaks))
	for break_period, break_index in prepared_map.breaks {
		break_ends[break_index] = break_period.end_ms
	}
	session.drain_start_ms = prepared_map.objects[0].time_ms
	session.drain_end_ms = prepared_map.objects[len(prepared_map.objects) - 1].end_time_ms
	session.drain_rate, status = scoring.calibrate_drain(increases[:increase_count], break_ends, prepared_map.difficulty.health_drain_rate, session.drain_start_ms)
	if status != .OK {
		return status
	}
	work_remaining := core_types.DEFAULT_PREPARATION_WORK
	for break_period, break_index in prepared_map.breaks {
		interval := prepared.Break{-1.7976931348623157e308, 1.7976931348623157e308}
		found_end := false
		for object in prepared_map.objects {
			if work_remaining == 0 {
				return .QUOTA_EXCEEDED
			}
			work_remaining -= 1
			if object.end_time_ms <= break_period.start_ms {
				interval.start_ms = object.end_time_ms
			}
			if !found_end && object.time_ms >= break_period.end_ms {
				interval.end_ms = object.time_ms
				found_end = true
			}
		}
		session.no_drain[break_index] = interval
	}
	// Sort and merge intervals so overlapping/malformed breaks never double
	// subtract health time. Sorting cost is bounded by the prepared break quota.
	for break_index in 1 ..< len(session.no_drain) {
		interval := session.no_drain[break_index]
		insertion_index := break_index
		for insertion_index > 0 && session.no_drain[insertion_index - 1].start_ms > interval.start_ms {
			if work_remaining == 0 {
				return .QUOTA_EXCEEDED
			}
			work_remaining -= 1
			session.no_drain[insertion_index] = session.no_drain[insertion_index - 1]
			insertion_index -= 1
		}
		session.no_drain[insertion_index] = interval
	}
	merged_count := 0
	for interval in session.no_drain {
		if merged_count > 0 && interval.start_ms <= session.no_drain[merged_count - 1].end_ms {
			session.no_drain[merged_count - 1].end_ms = max(session.no_drain[merged_count - 1].end_ms, interval.end_ms)
		} else {
			session.no_drain[merged_count] = interval
			merged_count += 1
		}
	}
	session.no_drain = session.no_drain[:merged_count]
	return reset_session(session, lead_in_ms)
}

schedule :: proc(session: ^Session, time_ms: f64, phase: Phase, object_index, component_index: u32) {
	// Creation reserves two events per object/component. Reset reproduces the
	// same bounded schedule; no runtime insertion or capacity failure is possible.
	status := push(&session.events, {key = {time_ms, phase, object_index, component_index, 0}})
	assert(status == .OK)
}

reset_session :: proc(session: ^Session, lead_in_ms: f64) -> core_types.Status {
	if !core_types.finite(lead_in_ms) || lead_in_ms > session.prepared_map.objects[0].time_ms {
		return .INVALID_ARGUMENT
	}
	if session.epoch == max(u32) {
		return .QUOTA_EXCEEDED
	}
	mem.zero_slice(session.objects)
	mem.zero_slice(session.components)
	session.events.count = 0
	session.inputs = Input_Queue{storage = session.inputs.storage}
	session.recording_count = 0
	session.journal_count = 0
	session.acknowledged_count = 0
	session.audio_count = 0
	session.acknowledged_audio_count = 0
	session.state = .READY
	session.epoch += 1
	session.committed_ms = lead_in_ms
	session.lead_in_ms = lead_in_ms
	session.health_time_ms = lead_in_ms
	session.submitted_input_count = 0
	session.pause_count = 0
	session.completed_objects = 0
	session.work = {}
	reset_candidates(session)
	session.cursor = {}
	session.health = {amount = 1}
	session.score = scoring.create(session.score.maxima)
	session.terminal_ms = 0
	session.replay_mode = false
	session.replay_frames = nil
	component_start := 0
	for &object, object_index in session.prepared_map.objects {
		session.objects[object_index].component_start = component_start
		component_start += len(object.components)
		if object.kind == .CIRCLE || object.kind == .SLIDER {
			// Smallest representable time whose offset is strictly outside Meh.
			deadline := object.time_ms + session.windows.meh
			for deadline - object.time_ms <= session.windows.meh {
				deadline = math.nextafter(deadline, 1.7976931348623157e308)
			}
			schedule(session, deadline, .PARENT, u32(object_index), max(u32) - 1)
		}
		if object.kind != .CIRCLE {
			schedule(session, object.end_time_ms, .PARENT, u32(object_index), max(u32))
		}
		if object.kind == .SLIDER {
			last_tick_ms := object.time_ms
			for component, component_index in object.components {
				if component.kind == .Tick || component.kind == .Repeat {
					last_tick_ms = max(last_tick_ms, component.time_ms)
					schedule(session, component.time_ms, .JUDGEMENT, u32(object_index), u32(component_index))
				}
			}
			for component, component_index in object.components {
				if component.kind == .Tail {
					schedule(session, max(last_tick_ms, component.time_ms - 36), .JUDGEMENT, u32(object_index), u32(component_index))
					schedule(session, component.time_ms, .JUDGEMENT, u32(object_index), u32(component_index))
				}
			}
		}
	}
	return .OK
}

sample_health :: proc(session: ^Session, time_ms: f64) -> f64 {
	start_ms := clamp(session.health_time_ms, session.drain_start_ms, session.drain_end_ms)
	end_ms := clamp(time_ms, session.drain_start_ms, session.drain_end_ms)
	duration_ms := max(f64(0), end_ms - start_ms)
	for interval in session.no_drain {
		duration_ms -= max(f64(0), min(end_ms, interval.end_ms) - max(start_ms, interval.start_ms))
	}
	return clamp(session.health.amount - max(f64(0), duration_ms) * session.drain_rate, 0, 1)
}

terminal :: proc(session: ^Session) -> bool {
	return session.state == .PASSED || session.state == .FAILED
}

emit_judgement :: proc(session: ^Session, object_index, component_index: int, result: core_types.Hit_Result, cause: Cause, time_ms: f64) {
	if terminal(session) {
		return
	}
	object := &session.prepared_map.objects[object_index]
	object_state := &session.objects[object_index]
	maximum := rules.maximum_result(object, component_index)
	judgement_time := object.end_time_ms
	slider_tick := false
	combo_object := component_index < 0
	new_combo := object.new_combo
	last_in_combo := object.last_in_combo
	if component_index >= 0 {
		component := &object.components[component_index]
		component_state := &session.components[object_state.component_start + component_index]
		if component_state.result != .NONE {
			return
		}
		component_state.result = result
		component_state.time_ms = time_ms
		judgement_time = component.time_ms
		slider_tick = component.kind == .Tick
		// Nested OsuHitObjects carry their own default combo information.
		combo_object = object.kind == .SLIDER
		new_combo = false
		last_in_combo = false
		if component.kind == .Head {
			object_state.head_result = result
			object_state.head_time_ms = time_ms
			candidate_remove(&session.head_candidates, object_index)
		}
	} else {
		if object_state.result != .NONE {
			return
		}
		session.completed_objects += 1
		object_state.result = result
		object_state.result_time_ms = time_ms
		candidate_remove(&session.tracking_candidates, object_index)
		if object.kind == .CIRCLE {
			object_state.head_result = result
			object_state.head_time_ms = time_ms
			candidate_remove(&session.head_candidates, object_index)
		}
	}
	session.health.amount = sample_health(session, time_ms)
	session.health_time_ms = time_ms
	event := Judgement_Event{
		sequence = u64(session.journal_count + 1), time_ms = time_ms,
		offset_ms = time_ms - judgement_time, object_id = object.id,
		component_id = component_index < 0 ? max(u32) : object.components[component_index].id,
		result = result, maximum = maximum, cause = cause,
		combo_before = session.score.accumulator.combo, health_before = session.health.amount,
	}
	failed := scoring.apply_health(&session.health, result, maximum, session.prepared_map.difficulty.health_drain_rate, combo_object, new_combo, last_in_combo, slider_tick)
	status := scoring.apply(&session.score, {result, maximum})
	assert(status == .OK)
	event.combo_after = session.score.accumulator.combo
	event.health_after = session.health.amount
	event.score_after = session.score.total
	assert(session.journal_count < len(session.journal))
	session.journal[session.journal_count] = event
	session.journal_count += 1
	record_frame(session, time_ms)
	if core_types.result_properties(result).hit {
		sample_range := session.sample_ranges[object_index]
		for binding in session.sample_bindings[sample_range.start:sample_range.end] {
			session.work.sample_binding_visits += 1
			if binding.object_id != object.id || binding.component_id != event.component_id {
				continue
			}
			sample_time_ms := time_ms
			if component_index >= 0 && object.components[component_index].kind == .Tail {
				sample_time_ms = max(time_ms, object.end_time_ms)
			}
			session.audio[session.audio_count] = {
				sequence = u64(session.audio_count + 1), epoch = session.epoch,
				time_ms = sample_time_ms, object_id = object.id, component_id = event.component_id,
				sample_index = binding.sample_index, asset_id = binding.asset_id,
				volume = f64(binding.sample.volume) / 100, missing = binding.asset_id == 0,
			}
			session.audio_count += 1
		}
	}
	if failed {
		session.state = .FAILED
		session.terminal_ms = time_ms
		scoring.fail(&session.score)
	} else if session.completed_objects == len(session.objects) {
		session.state = .PASSED
		session.terminal_ms = time_ms
	}
}

head_component :: proc(object: ^prepared.Object) -> int {
	for component, component_index in object.components {
		if component.kind == .Head {
			return component_index
		}
	}
	return -1
}

judge_head :: proc(session: ^Session, object_index: int, result: core_types.Hit_Result, cause: Cause, time_ms: f64) {
	object := &session.prepared_map.objects[object_index]
	emit_judgement(session, object_index, head_component(object), result, cause, time_ms)
}

judge_slider :: proc(session: ^Session, object_index: int, time_ms: f64, catch_up := false) {
	object := &session.prepared_map.objects[object_index]
	object_state := &session.objects[object_index]
	if object_state.head_result == .NONE || object_state.result != .NONE {
		return
	}
	// SliderInputManager.PostProcessHeadJudgement uses position alone for
	// forced catch-up results; key eligibility is applied to tracking afterwards.
	if catch_up && rules.in_radius(session.cursor, rules.slider_position(object, time_ms), f64(f32(object.radius) * f32(2.4))) {
		all_in_range := true
		for component, component_index in object.components {
			if component.kind == .Head || component.kind == .LegacyLastTick || component.time_ms > time_ms || session.components[object_state.component_start + component_index].result != .NONE {
				continue
			}
			if !rules.in_radius(session.cursor, rules.slider_position(object, component.time_ms), f64(f32(object.radius) * f32(2.4))) {
				all_in_range = false
				break
			}
		}
		for component, component_index in object.components {
			if component.kind == .Head || component.kind == .LegacyLastTick || component.time_ms > time_ms || session.components[object_state.component_start + component_index].result != .NONE {
				continue
			}
			maximum := rules.maximum_result(object, component_index)
			emit_judgement(session, object_index, component_index, all_in_range ? maximum : rules.minimum_result(maximum), .TRACKING, time_ms)
		}
		object_state.tracking = false
		rules.update_tracking(object, object_state, session.cursor, time_ms, all_in_range)
	} else {
		rules.update_tracking(object, object_state, session.cursor, time_ms)
	}
	previous_children_judged := true
	for component, component_index in object.components {
		if component.kind == .Head || component.kind == .LegacyLastTick {
			continue
		}
		if session.components[object_state.component_start + component_index].result != .NONE {
			continue
		}
		eligible := time_ms >= component.time_ms
		if component.kind == .Tail && previous_children_judged && object_state.tracking && time_ms >= component.time_ms - 36 {
			eligible = true
		}
		if eligible && (component.kind != .Tail || previous_children_judged) {
			hit := object_state.tracking
			maximum := rules.maximum_result(object, component_index)
			emit_judgement(session, object_index, component_index, hit ? maximum : rules.minimum_result(maximum), .TRACKING, time_ms)
		} else {
			previous_children_judged = false
		}
	}
	all_judged := true
	any_hit := false
	for component, component_index in object.components {
		if component.kind == .LegacyLastTick {
			continue
		}
		result := session.components[object_state.component_start + component_index].result
		all_judged = all_judged && result != .NONE
		any_hit = any_hit || core_types.result_properties(result).hit
	}
	if all_judged && time_ms >= object.end_time_ms {
		emit_judgement(session, object_index, -1, any_hit ? .IGNORE_HIT : .IGNORE_MISS, .DEADLINE, time_ms)
	}
}

press :: proc(session: ^Session, action, previous_actions: u32, time_ms: f64) {
	object_count := len(session.prepared_map.objects)
	for object_index := candidate_find(&session.head_candidates, 0, object_count, time_ms, false, &session.work.index_node_visits);
	    object_index >= 0;
	    object_index = candidate_find(&session.head_candidates, object_index + 1, object_count, time_ms, false, &session.work.index_node_visits) {
		object := &session.prepared_map.objects[object_index]
		session.work.input_candidate_visits += 1
		object_state := &session.objects[object_index]
		if object.kind == .SPINNER || object_state.head_result != .NONE || time_ms < object.time_ms - object.preempt_ms {
			continue
		}
		if !rules.in_radius(session.cursor, object.position + object.stack_offset, object.radius) {
			continue
		}
		result := rules.result_for(session.windows, time_ms - object.time_ms)
		if result == .NONE {
			return // The hovered receptor consumes the press, even when shaken.
		}
		// StartTimeOrderedHitPolicy checks the last blocking circle, including
		// one already judged, rather than any earlier unjudged circle.
		// Exclude the entire equal-time group using source-time lower_bound.
		lower, upper := 0, object_index
		for lower < upper {
			middle := lower + (upper - lower) / 2
			session.work.predecessor_visits += 1
			if session.prepared_map.objects[middle].time_ms < object.time_ms {
				lower = middle + 1
			} else {
				upper = middle
			}
		}
		blocking_index := candidate_find(&session.blocking_candidates, 0, lower, time_ms, true, &session.work.index_node_visits)
		if blocking_index >= 0 && session.objects[blocking_index].head_result == .NONE && time_ms < session.prepared_map.objects[blocking_index].time_ms {
			return
		}
		// The real drawable publishes the selected head result before HandleHit
		// force-misses its predecessors. This ordering affects combo and health.
		object_state.previous_actions = previous_actions
		object_state.head_action = action
		judge_head(session, object_index, result, .INPUT, time_ms)
		for previous_index := candidate_find(&session.head_candidates, 0, lower, 1.7976931348623157e308, false, &session.work.index_node_visits);
		    previous_index >= 0;
		    previous_index = candidate_find(&session.head_candidates, previous_index + 1, lower, 1.7976931348623157e308, false, &session.work.index_node_visits) {
			previous_object := &session.prepared_map.objects[previous_index]
			session.work.predecessor_visits += 1
			if previous_object.time_ms < object.time_ms && previous_object.kind != .SPINNER && session.objects[previous_index].head_result == .NONE {
				judge_head(session, previous_index, .MISS, .NOTE_LOCK, time_ms)
				if previous_object.kind == .SLIDER {
					judge_slider(session, previous_index, time_ms)
				}
			}
		}
		if object.kind == .SLIDER {
			judge_slider(session, object_index, time_ms, core_types.result_properties(result).hit)
		}
		return
	}
}

apply_input :: proc(session: ^Session, input: core_types.Input_Snapshot) {
	previous_actions := session.cursor.action_bits
	pressed := input.action_bits & ~previous_actions & 3
	session.cursor = input
	record_frame(session, input.effective_time_ms)
	if pressed & core_types.LEFT != 0 {
		press(session, core_types.LEFT, previous_actions, input.effective_time_ms)
	}
	if pressed & core_types.RIGHT != 0 {
		press(session, core_types.RIGHT, previous_actions, input.effective_time_ms)
	}
	object_count := len(session.prepared_map.objects)
	for object_index := candidate_find(&session.tracking_candidates, 0, object_count, input.effective_time_ms, false, &session.work.index_node_visits);
	    object_index >= 0;
	    object_index = candidate_find(&session.tracking_candidates, object_index + 1, object_count, input.effective_time_ms, false, &session.work.index_node_visits) {
		object := &session.prepared_map.objects[object_index]
		session.work.tracking_visits += 1
		object_state := &session.objects[object_index]
		if object_state.result != .NONE || input.effective_time_ms < object.time_ms - object.preempt_ms {
			continue
		}
		if object.kind == .SLIDER {
			rules.update_tracking(object, object_state, input, input.effective_time_ms)
		} else if object.kind == .SPINNER {
			rules.update_spinner(object, object_state, input, input.effective_time_ms)
			for component, component_index in object.components {
				if u32(component_index) >= object_state.spin_history.completed {
					break
				}
				emit_judgement(session, object_index, component_index, rules.maximum_result(object, component_index), .SPINNER, input.effective_time_ms)
			}
		}
	}
}

// The upstream recorder writes at actual gameplay time, including important
// judgement frames (DrawableRuleset.SetRecordTarget). It does not shift time or
// add private interpolation-only frame kinds. Only exactly equivalent frames
// at the same time may be coalesced (OsuReplayFrame.IsEquivalentTo).
record_frame :: proc(session: ^Session, time_ms: f64) {
	if session.replay_mode {
		return
	}
	frame := session.cursor
	frame.raw_time_ms = time_ms
	frame.effective_time_ms = time_ms
	frame.flags = 0
	if session.recording_count > 0 {
		previous := session.recording[session.recording_count - 1]
		if previous.effective_time_ms == time_ms && previous.x == frame.x && previous.y == frame.y && previous.action_bits == frame.action_bits {
			return
		}
	}
	assert(session.recording_count < len(session.recording))
	frame.sequence = u64(session.recording_count + 1)
	session.recording[session.recording_count] = frame
	session.recording_count += 1
}

submit_inputs :: proc(session: ^Session, inputs: []core_types.Input_Snapshot) -> core_types.Status {
	if session.state != .READY && session.state != .RUNNING || session.replay_mode {
		return .INVALID_STATE
	}
	if len(inputs) > session.live_input_capacity - session.submitted_input_count {
		return .QUOTA_EXCEEDED
	}
	for input in inputs {
		if input.raw_time_ms != input.effective_time_ms {
			return .INVALID_ARGUMENT
		}
	}
	status, _ := enqueue_inputs(&session.inputs, inputs, session.committed_ms)
	if status == .OK {
		session.submitted_input_count += len(inputs)
	}
	return status
}

release_actions :: proc(session: ^Session, time_ms: f64) {
	release_frame := session.cursor
	release_frame.raw_time_ms = time_ms
	release_frame.effective_time_ms = time_ms
	release_frame.action_bits = 0
	release_frame.flags = 0
	apply_input(session, release_frame)
}

advance_session :: proc(session: ^Session, target_ms: f64, pause_at_target := false) -> core_types.Status {
	if !core_types.finite(target_ms) {
		return .INVALID_ARGUMENT
	}
	if target_ms < session.committed_ms {
		return .LATE_INPUT
	}
	if session.state == .PAUSED {
		return .INVALID_STATE
	}
	if terminal(session) {
		return .OK
	}
	session.state = .RUNNING
	release_applied := !pause_at_target
	for !terminal(session) {
		event, has_event := peek(&session.events)
		input, has_input := peek_input(&session.inputs)
		if has_input && input.effective_time_ms <= target_ms && (!has_event || input.effective_time_ms <= event.key.time_ms) {
			consume_input(&session.inputs)
			apply_input(session, input)
			// Equal-time snapshots all precede scheduled transitions.
			continue
		}
		if !has_event || event.key.time_ms > target_ms {
			break
		}
		if !release_applied && event.key.time_ms == target_ms {
			release_actions(session, target_ms)
			release_applied = true
		}
		pop(&session.events)
		object_index := int(event.key.object_index)
		object := &session.prepared_map.objects[object_index]
		object_state := &session.objects[object_index]
		time_ms := event.key.time_ms
		if session.replay_mode {
			session.cursor, _ = replay.sample(session.replay_frames, time_ms)
		}
		if event.key.component_index == max(u32) - 1 && object_state.head_result == .NONE {
			judge_head(session, object_index, .MISS, .DEADLINE, time_ms)
		}
		if object.kind == .SLIDER {
			judge_slider(session, object_index, time_ms)
		} else if object.kind == .SPINNER && event.key.component_index == max(u32) {
			for _, component_index in object.components {
				emit_judgement(session, object_index, component_index, .IGNORE_MISS, .DEADLINE, time_ms)
			}
			emit_judgement(session, object_index, -1, rules.spinner_result(object, object_state), .DEADLINE, time_ms)
		}
	}
	if !terminal(session) && !release_applied {
		release_actions(session, target_ms)
	}
	if !terminal(session) {
		if session.completed_objects == len(session.objects) {
			session.state = .PASSED
			session.terminal_ms = session.journal[session.journal_count - 1].time_ms
		}
	}
	session.committed_ms = terminal(session) ? session.terminal_ms : target_ms
	return .OK
}

pause_session :: proc(session: ^Session, time_ms: f64) -> core_types.Status {
	if session.state != .READY && session.state != .RUNNING {
		return .INVALID_STATE
	}
	if session.epoch == max(u32) || session.pause_count >= session.live_input_capacity + 2 {
		return .QUOTA_EXCEEDED
	}
	status := advance_session(session, time_ms, true)
	if status != .OK || terminal(session) {
		return status
	}
	// Pause participates at the requested timestamp, before its scheduled
	// judgement phase. Future timestamped inputs remain queued (ADR-002).
	session.state = .PAUSED
	session.epoch += 1
	session.pause_count += 1
	return .OK
}

resume_session :: proc(session: ^Session, beatmap_ms: f64) -> core_types.Status {
	if !core_types.finite(beatmap_ms) {
		return .INVALID_ARGUMENT
	}
	if session.state != .PAUSED || beatmap_ms != session.committed_ms {
		return .INVALID_STATE
	}
	if session.epoch == max(u32) {
		return .QUOTA_EXCEEDED
	}
	session.state = .RUNNING
	session.epoch += 1
	return .OK
}

// Playback consumes ordinary replay frames and linearly samples their positions.
load_replay :: proc(session: ^Session, frames: []core_types.Input_Snapshot) -> core_types.Status {
	if core_types.buffers_overlap(raw_data(frames), u64(len(frames)) * size_of(core_types.Input_Snapshot), raw_data(session.recording), u64(len(session.recording)) * size_of(core_types.Input_Snapshot)) ||
	   core_types.buffers_overlap(raw_data(frames), u64(len(frames)) * size_of(core_types.Input_Snapshot), raw_data(session.inputs.storage), u64(len(session.inputs.storage)) * size_of(core_types.Input_Snapshot)) {
		return .INVALID_ARGUMENT
	}
	if session.state != .READY || session.inputs.count != 0 || session.recording_count != 0 {
		return .INVALID_STATE
	}
	status, _ := replay.validate_frames(frames)
	if status != .OK {
		return status
	}
	if len(frames) > len(session.recording) {
		return .QUOTA_EXCEEDED
	}
	action_count := 0
	for frame in frames {
		if frame.effective_time_ms < session.lead_in_ms {
			return .LATE_INPUT
		}
		action_count += 1
	}
	if action_count > len(session.inputs.storage) {
		return .QUOTA_EXCEEDED
	}
	status, _ = enqueue_inputs(&session.inputs, frames, session.lead_in_ms)
	if status != .OK {
		return status
	}
	copy(session.recording, frames)
	session.recording_count = len(frames)
	session.replay_frames = session.recording[:len(frames)]
	session.replay_mode = true
	return .OK
}

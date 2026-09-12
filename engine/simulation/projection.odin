package simulation

import core_types "../core_types"
import prepared "../prepared"
import rules "../osu_rules"

// This is a non-owning, read-only facade, valid while the session is alive and
// until its next mutation. Presentation never receives owning simulation state.
Projection :: struct {
	prepared_objects: []prepared.Object,
	outcomes: []rules.Object_State,
	paused: bool,
	components: []Component_State,
	feedback: []Judgement_Event,
	cursor_history: []core_types.Input_Snapshot,
	cursor: core_types.Input_Snapshot,
}

Projected_Object :: struct {
	result, head_result: core_types.Hit_Result,
	result_time_ms, head_time_ms, rotation: f64,
	position: prepared.Position,
	tracking: bool,
}

project :: proc(session: ^Session) -> Projection {
	return {
		prepared_objects = session.prepared_map.objects,
		outcomes = session.objects,
		paused = session.state == .PAUSED,
		components = session.components,
		feedback = session.journal[:session.journal_count],
		cursor_history = session.replay_mode ? session.replay_frames : session.recording[:session.recording_count],
		cursor = session.cursor,
	}
}

project_object :: proc(projection: Projection, object_index: int, time_ms: f64) -> Projected_Object {
	object := &projection.prepared_objects[object_index]
	outcome := &projection.outcomes[object_index]
	position := object.position + object.stack_offset
	if object.kind == .SLIDER {
		position = rules.slider_position(object, time_ms)
	}
	return {
		result = outcome.result,
		head_result = outcome.head_result,
		result_time_ms = outcome.result_time_ms,
		head_time_ms = outcome.head_time_ms,
		rotation = f64(rules.total_rotation(&outcome.spin_history)),
		position = position,
		tracking = outcome.tracking && !projection.paused,
	}
}

// Component state and semantic history are independent of browser journal ack.
// Reset/seek invalidate borrowed views; obtain a fresh projection after mutation.
project_component :: proc(projection: Projection, object_index, component_index: int) -> Component_State {
	return projection.components[projection.outcomes[object_index].component_start + component_index]
}

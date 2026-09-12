package presentation

import simulation "../simulation"

// Derived membership only. Every index borrows an immutable semantic record in
// the current projection. No event is copied into a second gameplay model.
Semantic_History :: struct {
	feedback_indices, cursor_indices: []int,
	miss_durations_by_id: []f64,
	feedback_count, cursor_count, next_feedback, next_cursor: int,
	epoch: u32,
	previous_ms: f64,
	initialized: bool,
	visited_records: u64,
}

refresh_history :: proc(history: ^Semantic_History, projection: simulation.Projection, time_ms: f64, epoch: u32) {
	if !history.initialized || history.epoch != epoch || time_ms < history.previous_ms {
		history.feedback_count, history.cursor_count = 0, 0
		history.next_feedback, history.next_cursor = 0, 0
	}
	history.visited_records = 0
	retained_count := 0
	for record_index in history.feedback_indices[:history.feedback_count] {
		history.visited_records += 1
		event := projection.feedback[record_index]
		duration_ms := event.result == .MISS ? history.miss_durations_by_id[event.object_id] : FEEDBACK_RETENTION_MS
		if time_ms < event.time_ms + duration_ms {
			history.feedback_indices[retained_count] = record_index
			retained_count += 1
		}
	}
	history.feedback_count = retained_count
	for history.next_feedback < len(projection.feedback) && projection.feedback[history.next_feedback].time_ms <= time_ms {
		event := projection.feedback[history.next_feedback]
		history.visited_records += 1
		duration_ms := event.result == .MISS ? history.miss_durations_by_id[event.object_id] : FEEDBACK_RETENTION_MS
		if time_ms < event.time_ms + duration_ms {
			history.feedback_indices[history.feedback_count] = history.next_feedback
			history.feedback_count += 1
		}
		history.next_feedback += 1
	}
	// A bounded one-second semantic cursor window is retained as an input for
	// checkpoint 6. This is storage policy, not a claimed upstream trail duration.
	retained_count = 0
	for record_index in history.cursor_indices[:history.cursor_count] {
		history.visited_records += 1
		if time_ms - projection.cursor_history[record_index].effective_time_ms <= 1000 {
			history.cursor_indices[retained_count] = record_index
			retained_count += 1
		}
	}
	history.cursor_count = retained_count
	for history.next_cursor < len(projection.cursor_history) && projection.cursor_history[history.next_cursor].effective_time_ms <= time_ms {
		history.visited_records += 1
		if time_ms - projection.cursor_history[history.next_cursor].effective_time_ms <= 1000 {
			history.cursor_indices[history.cursor_count] = history.next_cursor
			history.cursor_count += 1
		}
		history.next_cursor += 1
	}
	history.epoch, history.previous_ms, history.initialized = epoch, time_ms, true
}

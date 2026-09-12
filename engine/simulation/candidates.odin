package simulation

import "core:math"

// Source-ordered minimum-reveal trees. Leaves reference existing object state;
// removing a judged candidate changes eligibility, never authoritative outcomes.
Candidate_Index :: struct {
	minimum_reveal: []f64,
}

candidate_slots :: proc(object_count: int) -> u64 {
	leaf_count: u64 = 1
	for leaf_count < u64(object_count) {
		leaf_count *= 2
	}
	return leaf_count * 2
}

candidate_remove :: proc(candidate_index: ^Candidate_Index, object_index: int) {
	if len(candidate_index.minimum_reveal) == 0 {
		return
	}
	node_index := len(candidate_index.minimum_reveal) / 2 + object_index
	candidate_index.minimum_reveal[node_index] = math.inf_f64(1)
	for node_index > 1 {
		node_index /= 2
		candidate_index.minimum_reveal[node_index] = min(candidate_index.minimum_reveal[node_index * 2], candidate_index.minimum_reveal[node_index * 2 + 1])
	}
}

candidate_find :: proc(candidate_index: ^Candidate_Index, first_object, end_object: int, time_ms: f64, reverse: bool, work: ^u64) -> int {
	return candidate_find_node(candidate_index, 1, 0, len(candidate_index.minimum_reveal) / 2, first_object, end_object, time_ms, reverse, work)
}

candidate_find_node :: proc(candidate_index: ^Candidate_Index, node_index, node_start, node_end, first_object, end_object: int,
	time_ms: f64, reverse: bool, work: ^u64) -> int {
	work^ += 1
	if node_start >= end_object || node_end <= first_object || node_start == node_end ||
	   candidate_index.minimum_reveal[node_index] > time_ms {
		return -1
	}
	if node_end - node_start == 1 {
		return node_start
	}
	middle := node_start + (node_end - node_start) / 2
	first_match := reverse ? candidate_find_node(candidate_index, node_index * 2 + 1, middle, node_end, first_object, end_object, time_ms, reverse, work) :
		candidate_find_node(candidate_index, node_index * 2, node_start, middle, first_object, end_object, time_ms, reverse, work)
	if first_match >= 0 {
		return first_match
	}
	return reverse ? candidate_find_node(candidate_index, node_index * 2, node_start, middle, first_object, end_object, time_ms, reverse, work) :
		candidate_find_node(candidate_index, node_index * 2 + 1, middle, node_end, first_object, end_object, time_ms, reverse, work)
}

reset_candidates :: proc(session: ^Session) {
	leaf_count := len(session.head_candidates.minimum_reveal) / 2
	for leaf_index in 0 ..< leaf_count {
		head_reveal, tracking_reveal := math.inf_f64(1), math.inf_f64(1)
		if leaf_index < len(session.prepared_map.objects) {
			object := &session.prepared_map.objects[leaf_index]
			if object.kind != .SPINNER {
				head_reveal = object.time_ms - object.preempt_ms
			}
			if object.kind != .CIRCLE {
				tracking_reveal = object.time_ms - object.preempt_ms
			}
		}
		session.head_candidates.minimum_reveal[leaf_count + leaf_index] = head_reveal
		session.blocking_candidates.minimum_reveal[leaf_count + leaf_index] = head_reveal
		session.tracking_candidates.minimum_reveal[leaf_count + leaf_index] = tracking_reveal
	}
	indices := [3]^Candidate_Index{&session.head_candidates, &session.blocking_candidates, &session.tracking_candidates}
	for node_index := leaf_count - 1; node_index > 0; node_index -= 1 {
		for candidate_index in indices {
			candidate_index.minimum_reveal[node_index] = min(candidate_index.minimum_reveal[node_index * 2], candidate_index.minimum_reveal[node_index * 2 + 1])
		}
	}
}

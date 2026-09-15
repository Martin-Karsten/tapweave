package replay

import core_types "../core_types"

// Internal envelope contract. Production binary ABI/import/export is gated on
// finalized prepared identity and session contracts. No .osr or mod support.
Identity :: struct {
	schema_version, compatibility_version, rules_version, behavior_id: u32,
	raw_digest, prepared_digest: [32]byte,
	coordinate_version: u32,
	rate: f64,
	offsets: [4]f64,
}

SCHEMA_VERSION :: 2
COMPATIBILITY_VERSION :: 1
RULES_VERSION :: 2
BEHAVIOR_ID :: 202608042
COORDINATE_VERSION :: 1
MAX_FRAMES :: 1_000_000
validate_identity :: proc(actual, expected: Identity) -> core_types.Status {
	if actual.schema_version != SCHEMA_VERSION ||
	   actual.compatibility_version != COMPATIBILITY_VERSION ||
	   actual.rules_version != RULES_VERSION ||
	   actual.behavior_id != BEHAVIOR_ID ||
	   actual.coordinate_version != COORDINATE_VERSION ||
	   actual.rate != 1 {
		return .UNSUPPORTED
	}
	for offset in actual.offsets {
		if !core_types.finite(offset) {
			return .INVALID_ARGUMENT
		}
	}
	if actual != expected {
		return .INVALID_ARGUMENT
	}
	return .OK
}

validate_frames :: proc(frames: []core_types.Input_Snapshot) -> (core_types.Status, int) {
	if len(frames) > MAX_FRAMES {
		return .QUOTA_EXCEEDED, 0
	}
	previous_sequence: u64
	previous_time_ms: f64
	for frame, frame_index in frames {
		if !core_types.valid_input(frame) || frame.sequence <= previous_sequence {
			return .INVALID_ARGUMENT, frame_index
		}
		// Stored frames are beatmap-relative; applied offsets live in the identity.
		if frame.raw_time_ms != frame.effective_time_ms {
			return .INVALID_ARGUMENT, frame_index
		}
		if frame_index > 0 && (frame.effective_time_ms < previous_time_ms || !core_types.finite(f64(f32(frame.effective_time_ms - previous_time_ms)))) {
			return .INVALID_ARGUMENT, frame_index
		}
		previous_time_ms = frame.effective_time_ms
		previous_sequence = frame.sequence
	}
	return .OK, 0
}

// Binary search selects the final equal-time snapshot. Before the first frame
// actions are released and position uses that first sample; after the last,
// position/actions hold. The input phase still dispatches each equal-time edge.
sample :: proc(
	frames: []core_types.Input_Snapshot,
	time_ms: f64,
) -> (
	core_types.Input_Snapshot,
	core_types.Status,
) {
	if !core_types.finite(time_ms) {
		return {}, .INVALID_ARGUMENT
	}
	if len(frames) == 0 {
		return {}, .OK
	}
	lower_index := 0
	upper_index := len(frames)
	for lower_index < upper_index {
		middle_index := lower_index + (upper_index - lower_index) / 2
		if frames[middle_index].effective_time_ms <= time_ms {
			lower_index = middle_index + 1
		} else {
			upper_index = middle_index
		}
	}
	if lower_index == 0 {
		sampled_frame := frames[0]
		sampled_frame.x = f64(f32(sampled_frame.x))
		sampled_frame.y = f64(f32(sampled_frame.y))
		sampled_frame.action_bits = 0
		return sampled_frame, .OK
	}
	sampled_frame := frames[lower_index - 1]
	sampled_frame.x = f64(f32(sampled_frame.x))
	sampled_frame.y = f64(f32(sampled_frame.y))
	if lower_index == len(frames) {
		return sampled_frame, .OK
	}
	next_frame := frames[lower_index]
	if time_ms == sampled_frame.effective_time_ms {
		return sampled_frame, .OK
	}
	// Framework Interpolation.ValueAt(Vector2) narrows elapsed time and duration
	// before division, then performs vector subtraction/multiply/add in f32.
	elapsed_ms := f32(time_ms - sampled_frame.effective_time_ms)
	duration_ms := f32(next_frame.effective_time_ms - sampled_frame.effective_time_ms)
	if duration_ms == 0 || elapsed_ms == 0 {
		return sampled_frame, .OK
	}
	if !core_types.finite(f64(duration_ms)) || !core_types.finite(f64(elapsed_ms)) {
		return {}, .INVALID_ARGUMENT
	}
	interpolation_fraction := elapsed_ms / duration_ms
	sampled_frame.x = f64(f32(sampled_frame.x) + interpolation_fraction * (f32(next_frame.x) - f32(sampled_frame.x)))
	sampled_frame.y = f64(f32(sampled_frame.y) + interpolation_fraction * (f32(next_frame.y) - f32(sampled_frame.y)))
	return sampled_frame, .OK
}

package core_types

import "core:math"

LEFT :: u32(1)
RIGHT :: u32(2)
SMOKE :: u32(4)
// Arm the pinned resume overlay blocker without changing held actions.
BLOCK_NEXT_PRESS :: u32(1)
Input_Snapshot :: struct {
	sequence: u64,
	raw_time_ms, effective_time_ms, x, y: f64,
	action_bits: u32,
	source, focus_epoch: u16,
	flags: u32,
}

finite :: proc(value: f64) -> bool {
	return !math.is_nan(value) && !math.is_inf(value)
}

valid_input :: proc(input: Input_Snapshot) -> bool {
	return(
		input.sequence > 0 &&
		finite(input.raw_time_ms) &&
		finite(input.effective_time_ms) &&
		finite(input.x) &&
		finite(input.y) &&
		(input.action_bits & ~(LEFT | RIGHT | SMOKE)) == 0 &&
		(input.flags & ~BLOCK_NEXT_PRESS) == 0 \
	)
}

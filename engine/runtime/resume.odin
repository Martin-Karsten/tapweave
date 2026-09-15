package engine_runtime

import "base:runtime"
import core_types "../core_types"
import simulation "../simulation"

@(export)
oe_session_resume_policy :: proc "c" (engine, session_handle: core_types.Handle, cursor_flags: u32, output: uintptr) -> u32 {
	context = runtime.default_context()
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return abi_status(status)
	}
	if !output_span_valid(output) || cursor_flags & ~u32(3) != 0 {
		return abi_status(.INVALID_ARGUMENT)
	}
	if session.simulation.state != .PAUSED {
		return abi_status(.INVALID_STATE)
	}
	// Borrow the reserved diagnostic buffer; this read-only query does not
	// publish or acknowledge a judgement batch and never allocates.
	bytes := session.output[:ABI_RESUME_POLICY_SIZE]
	put_header(bytes, ABI_RESUME_POLICY_KIND, ABI_RESUME_POLICY_SIZE)
	put_u32(bytes, ABI_RESUME_POLICY_REQUIRED_OFFSET, u32(simulation.resume_requires_cursor(&session.simulation, cursor_flags & 1 != 0, cursor_flags & 2 != 0)))
	put_u32(bytes, ABI_RESUME_POLICY_HELD_ACTION_BITS_OFFSET, session.simulation.cursor.action_bits)
	put_f64(bytes, ABI_RESUME_POLICY_X_OFFSET, session.simulation.cursor.x)
	put_f64(bytes, ABI_RESUME_POLICY_Y_OFFSET, session.simulation.cursor.y)
	// Default OsuCursor.SIZE=28, user size=1, AutoCursorSize=false.
	put_f64(bytes, ABI_RESUME_POLICY_HALF_SIZE_OFFSET, 14)
	put_u32(bytes, ABI_RESUME_POLICY_LEFT_INPUT_FLAGS_OFFSET, session.simulation.cursor.action_bits & core_types.LEFT == 0 ? core_types.BLOCK_NEXT_PRESS : 0)
	put_u32(bytes, ABI_RESUME_POLICY_RIGHT_INPUT_FLAGS_OFFSET, session.simulation.cursor.action_bits & core_types.RIGHT == 0 ? core_types.BLOCK_NEXT_PRESS : 0)
	abi_span(uintptr(raw_data(bytes)), ABI_RESUME_POLICY_SIZE)
	return abi_status(.OK)
}

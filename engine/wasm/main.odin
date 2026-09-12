package main

import "base:runtime"
import trace_support "../trace_support"
import trace_schema "../trace_schema"
import engine_runtime "../runtime"
import core_types "../core_types"

// Test-only exports. Only the owned inbox is accepted, never a caller pointer.
buffers: trace_support.Buffers

main :: proc() {
	_ = engine_runtime.oe_abi_control()
}

@(export)
trace_reserve :: proc "c" (byte_count: u32) -> uintptr {
	context = runtime.default_context()
	return trace_support.reserve_inbox(&buffers, byte_count, core_types.DEFAULT_QUOTAS.raw_bytes)
}

@(export)
trace_decode :: proc "c" () -> u32 {
	context = runtime.default_context()
	candidate_bytes, trace_succeeded := trace_schema.decode_trace(string(buffers.inbox))
	return trace_support.publish_output(&buffers, candidate_bytes, trace_succeeded)
}

@(export)
trace_output :: proc "c" () -> uintptr {
	return uintptr(raw_data(buffers.output))
}

@(export)
trace_dispose :: proc "c" () {
	context = runtime.default_context()
	trace_support.dispose_buffers(&buffers)
}

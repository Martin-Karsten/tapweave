package main

import "base:runtime"
import trace_support "../trace_support"
import geometry_trace "../geometry_trace"

// Test-only exports. Only the owned inbox is accepted, never a caller pointer.
buffers: trace_support.Buffers

main :: proc() {
}

@(export)
geometry_reserve :: proc "c" (byte_count: u32) -> uintptr {
	context = runtime.default_context()
	return trace_support.reserve_inbox(&buffers, byte_count, 8 * 1024 * 1024)
}

@(export)
geometry_run :: proc "c" () -> u32 {
	context = runtime.default_context()
	candidate_bytes, trace_succeeded := geometry_trace.run(buffers.inbox)
	return trace_support.publish_output(&buffers, candidate_bytes, trace_succeeded)
}

@(export)
geometry_output :: proc "c" () -> uintptr {
	return uintptr(raw_data(buffers.output))
}

@(export)
geometry_dispose :: proc "c" () {
	context = runtime.default_context()
	trace_support.dispose_buffers(&buffers)
}

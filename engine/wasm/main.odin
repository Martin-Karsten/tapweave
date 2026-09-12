package main

import engine_runtime "../runtime"
import "base:runtime"
import "core:mem"
import core_types "../core_types"
import trace "../trace_schema"

// Test transport, deliberately distinct from oe_* production ABI v2.
// Only the reserved inbox is accepted. No arbitrary caller pointer is decoded.
inbox, output: []byte
main :: proc() {
	_ = engine_runtime.oe_abi_control()
}

@(export)
trace_reserve :: proc "c" (count: u32) -> uintptr {
	context = runtime.default_context()
	if u64(count) > core_types.DEFAULT_QUOTAS.raw_bytes {
		return 0
	}
	candidate, allocation_error := mem.alloc_bytes(int(max(count, 1)))
	if allocation_error != nil {
		return 0
	}
	delete(inbox)
	inbox = candidate[:int(count)]
	return uintptr(raw_data(inbox))
}

@(export)
trace_decode :: proc "c" () -> u32 {
	context = runtime.default_context()
	candidate, trace_succeeded := trace.decode_trace(string(inbox))
	if !trace_succeeded {
		delete(candidate)
		return 0
	}
	delete(output)
	output = candidate
	return u32(len(output))
}

@(export)
trace_output :: proc "c" () -> uintptr {
	return uintptr(raw_data(output))
}

@(export)
trace_dispose :: proc "c" () {
	context = runtime.default_context()
	delete(inbox)
	delete(output)
	inbox = nil
	output = nil
}

package main

import "base:runtime"
import "core:mem"
import trace "../geometry_trace"
inbox, output: []byte
main :: proc() {
}

@(export)
geometry_reserve :: proc "c" (byte_count: u32) -> uintptr {
	context = runtime.default_context()
	if byte_count > 8 * 1024 * 1024 {
		return 0
	}
	candidate_bytes, allocation_error := mem.alloc_bytes(int(max(byte_count, 1)))
	if allocation_error != nil {
		return 0
	}
	delete(inbox)
	inbox = candidate_bytes[:int(byte_count)]
	return uintptr(raw_data(inbox))
}

@(export)
geometry_run :: proc "c" () -> u32 {
	context = runtime.default_context()
	candidate_bytes, trace_succeeded := trace.run(inbox)
	if !trace_succeeded {
		delete(candidate_bytes)
		return 0
	}
	delete(output)
	output = candidate_bytes
	return u32(len(output))
}

@(export)
geometry_output :: proc "c" () -> uintptr {
	return uintptr(raw_data(output))
}

@(export)
geometry_dispose :: proc "c" () {
	context = runtime.default_context()
	delete(inbox)
	delete(output)
	inbox = nil
	output = nil
}

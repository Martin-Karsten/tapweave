package trace_support

import "core:mem"

// Test transports own these buffers; never copy them after allocation.
// Production oe_* input validation and lifetimes remain in engine_runtime.
Buffers :: struct {
	inbox, output: []byte,
}

reserve_inbox :: proc(buffers: ^Buffers, byte_count: u32, byte_limit: u64) -> uintptr {
	if u64(byte_count) > byte_limit {
		return 0
	}
	candidate_bytes, allocation_error := mem.alloc_bytes(int(max(byte_count, 1)))
	if allocation_error != nil {
		return 0
	}
	delete(buffers.inbox)
	buffers.inbox = candidate_bytes[:int(byte_count)]
	return uintptr(raw_data(buffers.inbox))
}

// Consumes the candidate on both paths, preserving the last output on failure.
publish_output :: proc(buffers: ^Buffers, candidate_bytes: []byte, trace_succeeded: bool) -> u32 {
	if !trace_succeeded {
		delete(candidate_bytes)
		return 0
	}
	delete(buffers.output)
	buffers.output = candidate_bytes
	return u32(len(buffers.output))
}

dispose_buffers :: proc(buffers: ^Buffers) {
	delete(buffers.inbox)
	delete(buffers.output)
	buffers.inbox = nil
	buffers.output = nil
}

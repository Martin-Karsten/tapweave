package engine_runtime

import core_types "../core_types"

// Shared ABI serialization primitives and output-span guards. Every field
// offset still comes from the generated abi_records constants.

get_u32 :: proc(bytes: []byte, byte_offset: int) -> u32 {
	return(
		u32(bytes[byte_offset]) |
		u32(bytes[byte_offset + 1]) << 8 |
		u32(bytes[byte_offset + 2]) << 16 |
		u32(bytes[byte_offset + 3]) << 24 \
	)
}

get_u64 :: proc(bytes: []byte, byte_offset: int) -> u64 {
	return u64(get_u32(bytes, byte_offset)) | u64(get_u32(bytes, byte_offset + 4)) << 32
}

put_u32 :: proc(bytes: []byte, byte_offset: int, value: u32) {
	for byte_index in 0 ..< 4 {
		bytes[byte_offset + byte_index] = byte(value >> u32(byte_index * 8))
	}
}

put_u64 :: proc(bytes: []byte, byte_offset: int, value: u64) {
	put_u32(bytes, byte_offset, u32(value))
	put_u32(bytes, byte_offset + 4, u32(value >> 32))
}

put_header :: proc(bytes: []byte, kind, size: u32) {
	put_u32(bytes, ABI_RECORD_KIND_OFFSET, kind | 1 << 16)
	put_u32(bytes, ABI_RECORD_BYTE_SIZE_OFFSET, size)
}

put_f64 :: proc(bytes: []byte, byte_offset: int, number: f64) {
	canonical := number == 0 ? f64(0) : number
	put_u64(bytes, byte_offset, transmute(u64)canonical)
}

get_f64 :: proc(bytes: []byte, byte_offset: int) -> f64 {
	return transmute(f64)get_u64(bytes, byte_offset)
}

put_relative_span :: proc(bytes: []byte, byte_offset, span_offset, count, stride: int) {
	put_u32(bytes, byte_offset, u32(span_offset))
	put_u32(bytes, byte_offset + 4, u32(count))
	put_u32(bytes, byte_offset + 8, u32(stride))
}

// Production outputs always land in the shared mailbox result slot.
output_span_valid :: proc(span_output: uintptr) -> bool {
	return span_output == abi_base() + ABI_OUTPUT_OFFSET
}

// Combined gameplay-owner lookup and output-span guard for exported readers.
gameplay_output_get :: proc(engine, session_handle: core_types.Handle, span_output: uintptr) -> (^Session, core_types.Status) {
	session, status := gameplay_get(engine, session_handle)
	if status != .OK {
		return nil, status
	}
	if !output_span_valid(span_output) {
		return nil, .INVALID_ARGUMENT
	}
	return session, .OK
}

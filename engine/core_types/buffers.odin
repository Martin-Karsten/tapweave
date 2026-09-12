package core_types

// Compare address differences rather than potentially overflowing end addresses.
// The caller must supply valid borrowed spans; empty spans never overlap.
buffers_overlap :: proc(
	left_pointer: rawptr,
	left_byte_count: u64,
	right_pointer: rawptr,
	right_byte_count: u64,
) -> bool {
	if left_byte_count == 0 || right_byte_count == 0 {
		return false
	}
	left_address := u64(uintptr(left_pointer))
	right_address := u64(uintptr(right_pointer))
	if left_address <= right_address {
		return right_address - left_address < left_byte_count
	}
	return left_address - right_address < right_byte_count
}

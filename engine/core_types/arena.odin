package core_types

import "core:mem"

// Identical safety bound on native and wasm32. Never cast unchecked u64 to int.
MAX_ADDRESSABLE :: u64(0x7fff_ffff)
Arena :: struct {
	bytes: []byte,
	used: u64,
	allocator: mem.Allocator,
}

checked_add :: proc(left, right: u64, limit := MAX_ADDRESSABLE) -> (u64, bool) {
	if left > limit || right > limit - left {
		return 0, false
	}
	return left + right, true
}

checked_product :: proc(left, right: u64, limit := MAX_ADDRESSABLE) -> (u64, bool) {
	if right != 0 && left > limit / right {
		return 0, false
	}
	return left * right, true
}

aligned_end :: proc(used, count, stride, alignment: u64) -> (start, end: u64, ok: bool) {
	if alignment == 0 || alignment & (alignment - 1) != 0 {
		return
	}
	padded, valid := checked_add(used, alignment - 1)
	if !valid {
		return
	}
	start = padded & ~(alignment - 1)
	bytes, fits := checked_product(count, stride)
	if !fits {
		return
	}
	end, ok = checked_add(start, bytes)
	return
}

arena_create :: proc(size: u64, allocator := context.allocator) -> (Arena, Status) {
	if size > MAX_ADDRESSABLE {
		return {}, .QUOTA_EXCEEDED
	}
	bytes, allocation_error := mem.alloc_bytes(int(size), 16, allocator)
	if allocation_error != nil || (size > 0 && len(bytes) != int(size)) {
		return {}, .OUT_OF_MEMORY
	}
	return Arena{bytes = bytes, allocator = allocator}, .OK
}


arena_destroy :: proc(arena: ^Arena) {
	if arena.bytes != nil {
		mem.free(raw_data(arena.bytes), arena.allocator)
	}
	arena^ = {}
}

arena_take :: proc(arena: ^Arena, $T: typeid, count: u64) -> ([]T, bool) {
	start, end, ok := aligned_end(arena.used, count, size_of(T), align_of(T))
	if !ok || end > u64(len(arena.bytes)) {
		return nil, false
	}
	arena.used = end
	if count == 0 {
		return nil, true
	}
	return mem.slice_ptr(cast(^T)&arena.bytes[int(start)], int(count)), true
}

arena_reset :: proc(arena: ^Arena) {
	mem.zero_slice(arena.bytes)
	arena.used = 0
}

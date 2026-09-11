package core_types
import "core:mem"

// Identical safety bound on native and wasm32. Never cast unchecked u64 to int.
MAX_ADDRESSABLE :: u64(0x7fff_ffff)
Arena :: struct { bytes: []byte, used: u64, allocator: mem.Allocator }
checked_add :: proc(a, b: u64, limit := MAX_ADDRESSABLE) -> (u64, bool) {
 if a > limit || b > limit-a { return 0, false }
 return a+b, true
}
checked_product :: proc(a, b: u64, limit := MAX_ADDRESSABLE) -> (u64, bool) {
 if b != 0 && a > limit/b { return 0, false }
 return a*b, true
}
aligned_end :: proc(used, count, stride, alignment: u64) -> (start, end: u64, ok: bool) {
 if alignment == 0 || alignment & (alignment-1) != 0 { return }
 padded, valid := checked_add(used, alignment-1)
 if !valid { return }
 start = padded & ~(alignment-1)
 bytes, fits := checked_product(count, stride)
 if !fits { return }
 end, ok = checked_add(start, bytes)
 return
}
arena_create :: proc(size: u64, allocator := context.allocator) -> (Arena, Status) {
 if size > MAX_ADDRESSABLE { return {}, .QUOTA_EXCEEDED }
 bytes, err := mem.alloc_bytes(int(size), 16, allocator)
 if err != nil || (size > 0 && len(bytes) != int(size)) { return {}, .OUT_OF_MEMORY }
 return Arena{bytes=bytes, allocator=allocator}, .OK
}
arena_destroy :: proc(a: ^Arena) {
 if a.bytes != nil { mem.free(raw_data(a.bytes), a.allocator) }
 a^ = {}
}
arena_take :: proc(a: ^Arena, $T: typeid, count: u64) -> ([]T, bool) {
 start, end, ok := aligned_end(a.used, count, size_of(T), align_of(T))
 if !ok || end > u64(len(a.bytes)) { return nil, false }
 a.used = end
 if count == 0 { return nil, true }
 return mem.slice_ptr(cast(^T)&a.bytes[int(start)], int(count)), true
}
arena_reset :: proc(a: ^Arena) {
 mem.zero_slice(a.bytes)
 a.used = 0
}

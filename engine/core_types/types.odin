package core_types

// Values are stable ABI identifiers. Append; never reorder.
Status :: enum u32 {
 OK, INVALID_ARGUMENT, INVALID_STATE, UNSUPPORTED, QUOTA_EXCEEDED,
 MALFORMED_MAP, MISSING_ASSET, LATE_INPUT, OUTPUT_REQUIRED, STALE_HANDLE,
 OUT_OF_MEMORY, INTERNAL,
}
Error_Code :: enum u32 {
 NONE, HEADER, FORMAT_VERSION, UTF8, NUMBER, SECTION, FIELD_COUNT,
 MODE, OBJECT_TYPE, RAW_BYTES, LINES, OBJECTS, TIMING_POINTS,
 ARENA_BYTES, DURATION, PATH, HANDLE, QUOTAS,
}
Error :: struct {
 status: Status,
 code: Error_Code,
 line, column: u32, // One-based UTF-8 byte location; zero means not applicable.
 requested, limit: u64,
}
Quotas :: struct {
 raw_bytes, lines, objects, timing_points, arena_bytes: u64,
 duration_ms: u64,
}
DEFAULT_QUOTAS :: Quotas{8*1024*1024, 250_000, 10_000, 50_000, 64*1024*1024, 24*60*60*1000}
CEILING_QUOTAS :: DEFAULT_QUOTAS
valid_quotas :: proc(q: Quotas) -> bool {
 return q.raw_bytes <= CEILING_QUOTAS.raw_bytes &&
        q.lines <= CEILING_QUOTAS.lines && q.objects <= CEILING_QUOTAS.objects &&
        q.timing_points <= CEILING_QUOTAS.timing_points &&
        q.arena_bytes <= CEILING_QUOTAS.arena_bytes && q.duration_ms <= CEILING_QUOTAS.duration_ms
}
Record_Header :: struct { kind, version, byte_size: u32 }
Array_Span :: struct { offset, count, stride: u32 }
Handle :: distinct u64

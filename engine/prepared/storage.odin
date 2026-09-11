package prepared
import ct "../core_types"

// Lifetime primitives only. Geometry and public prepared records arrive in M1.
// The runtime owns the Storage value; consumers borrow its immutable bytes.
Storage :: struct { arena: ct.Arena, references: u32 }
create :: proc(bytes: u64) -> (Storage, ct.Status) {
 arena, status := ct.arena_create(bytes)
 if status != .OK { return {}, status }
 return {arena, 1}, .OK
}
retain :: proc(s: ^Storage) -> ct.Status {
 if s.references == 0 { return .INVALID_STATE }
 if s.references == 0xffff_ffff { return .QUOTA_EXCEEDED }
 s.references += 1
 return .OK
}
release :: proc(s: ^Storage) -> ct.Status {
 if s.references == 0 { return .INVALID_STATE }
 s.references -= 1
 if s.references == 0 { ct.arena_destroy(&s.arena) }
 return .OK
}

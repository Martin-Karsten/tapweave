package engine_runtime
import ct "../core_types"
import "core:mem"

Resource_Kind :: enum { ENGINE, MAP, SESSION }
Slot :: struct {
 generation: u32,
 owner: ct.Handle,
 kind: Resource_Kind,
 value: rawptr,
 live, released: bool,
}
// One registry per ABI instance, shared by engines: identical map handles cannot
// alias across owners. A full table fails without allocating or mutating it.
Handle_Table :: struct { slots: []Slot, allocator: mem.Allocator }
table_create :: proc(capacity: u32, allocator := context.allocator) -> (Handle_Table, ct.Status) {
 if capacity == 0 || capacity > 65536 { return {}, .INVALID_ARGUMENT }
 slots, err := make([]Slot, int(capacity), allocator)
 if err != nil { return {}, .OUT_OF_MEMORY }
 return {slots, allocator}, .OK
}
// Resources must be released before destroying the registry.
table_destroy :: proc(t: ^Handle_Table) -> ct.Status {
 for slot in t.slots { if slot.live { return .INVALID_STATE } }
 delete(t.slots, t.allocator)
 t^ = {}
 return .OK
}
insert :: proc(t: ^Handle_Table, owner: ct.Handle, kind: Resource_Kind, value: rawptr) -> (ct.Handle, ct.Status) {
 if value == nil { return 0, .INVALID_ARGUMENT }
 for &slot, index in t.slots {
  if slot.live || slot.generation == 0xffff_ffff { continue } // Retire on wrap.
  slot.generation += 1
  slot.owner = owner; slot.kind = kind; slot.value = value
  slot.live = true; slot.released = false
  return ct.Handle(u64(slot.generation)<<32 | u64(index+1)), .OK
 }
 return 0, .QUOTA_EXCEEDED
}
resolve_slot :: proc(t: ^Handle_Table, handle, owner: ct.Handle, kind: Resource_Kind) -> (^Slot, ct.Status) {
 index := u32(u64(handle) & 0xffff_ffff)
 generation := u32(u64(handle)>>32)
 if index == 0 || index > u32(len(t.slots)) || generation == 0 { return nil, .STALE_HANDLE }
 slot := &t.slots[index-1]
 if slot.generation != generation || slot.owner != owner || slot.kind != kind { return nil, .STALE_HANDLE }
 return slot, .OK
}
lookup :: proc(t: ^Handle_Table, handle, owner: ct.Handle, kind: Resource_Kind) -> (rawptr, ct.Status) {
 slot, status := resolve_slot(t, handle, owner, kind)
 if status != .OK { return nil, status }
 if !slot.live { return nil, .STALE_HANDLE }
 return slot.value, .OK
}
// Returns the resource exactly once. A repeated release before slot reuse is a
// successful no-op; after reuse the previous generation is stale.
release :: proc(t: ^Handle_Table, handle, owner: ct.Handle, kind: Resource_Kind) -> (rawptr, ct.Status) {
 slot, status := resolve_slot(t, handle, owner, kind)
 if status != .OK { return nil, status }
 if slot.released { return nil, .OK }
 if !slot.live { return nil, .STALE_HANDLE }
 value := slot.value
 slot.value = nil; slot.live = false; slot.released = true
 return value, .OK
}

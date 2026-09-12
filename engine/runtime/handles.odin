package engine_runtime

import core_types "../core_types"
import "core:mem"

Resource_Kind :: enum {
	ENGINE,
	MAP,
	SESSION,
}

Slot :: struct {
	generation: u32,
	owner: core_types.Handle,
	kind: Resource_Kind,
	value: rawptr,
	live, released: bool,
}

// One registry per ABI instance, shared by engines: identical map handles cannot
// alias across owners. A full table fails without allocating or mutating it.
Handle_Table :: struct {
	slots: []Slot,
	allocator: mem.Allocator,
}

table_create :: proc(capacity: u32, allocator := context.allocator) -> (Handle_Table, core_types.Status) {
	if capacity == 0 || capacity > 65536 {
		return {}, .INVALID_ARGUMENT
	}
	slots, allocation_error := make([]Slot, int(capacity), allocator)
	if allocation_error != nil {
		return {}, .OUT_OF_MEMORY
	}
	return {slots, allocator}, .OK
}

// Resources must be released before destroying the registry.
table_destroy :: proc(table: ^Handle_Table) -> core_types.Status {
	for slot in table.slots {
		if slot.live {
			return .INVALID_STATE
		}
	}
	delete(table.slots, table.allocator)
	table^ = {}
	return .OK
}

insert :: proc(
	table: ^Handle_Table,
	owner: core_types.Handle,
	kind: Resource_Kind,
	value: rawptr,
) -> (
	core_types.Handle,
	core_types.Status,
) {
	if value == nil {
		return 0, .INVALID_ARGUMENT
	}
	for &slot, index in table.slots {
		if slot.live || slot.generation == 0xffff_ffff {
			continue
		} // Retire on wrap.
		slot.generation += 1
		slot.owner = owner
		slot.kind = kind
		slot.value = value
		slot.live = true
		slot.released = false
		return core_types.Handle(u64(slot.generation) << 32 | u64(index + 1)), .OK
	}
	return 0, .QUOTA_EXCEEDED
}

resolve_slot :: proc(
	table: ^Handle_Table,
	handle, owner: core_types.Handle,
	kind: Resource_Kind,
) -> (
	^Slot,
	core_types.Status,
) {
	index := u32(u64(handle) & 0xffff_ffff)
	generation := u32(u64(handle) >> 32)
	if index == 0 || index > u32(len(table.slots)) || generation == 0 {
		return nil, .STALE_HANDLE
	}
	slot := &table.slots[index - 1]
	if slot.generation != generation || slot.owner != owner || slot.kind != kind {
		return nil, .STALE_HANDLE
	}
	return slot, .OK
}

lookup :: proc(
	table: ^Handle_Table,
	handle, owner: core_types.Handle,
	kind: Resource_Kind,
) -> (
	rawptr,
	core_types.Status,
) {
	slot, status := resolve_slot(table, handle, owner, kind)
	if status != .OK {
		return nil, status
	}
	if !slot.live {
		return nil, .STALE_HANDLE
	}
	return slot.value, .OK
}

// Returns the resource exactly once. A repeated release before slot reuse is a
// successful no-op; after reuse the previous generation is stale.
release :: proc(
	table: ^Handle_Table,
	handle, owner: core_types.Handle,
	kind: Resource_Kind,
) -> (
	rawptr,
	core_types.Status,
) {
	slot, status := resolve_slot(table, handle, owner, kind)
	if status != .OK {
		return nil, status
	}
	if slot.released {
		return nil, .OK
	}
	if !slot.live {
		return nil, .STALE_HANDLE
	}
	value := slot.value
	slot.value = nil
	slot.live = false
	slot.released = true
	return value, .OK
}

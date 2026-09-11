package tests
import "core:testing"
import "core:fmt"
import "core:mem"
import ct "../core_types"
import decode "../beatmap_decode"
import rt "../runtime"
import prepared "../prepared"

@(test)
versions_defaults_and_owned_text :: proc(t: ^testing.T) {
 versions := []int{1,2,3,4,5,6,7,8,9,10,11,12,13,14,128}
 for version in versions {
  text := fmt.aprintf("\xef\xbb\xbfosu file format v%d\n[Difficulty]\nOverallDifficulty: 7\n[HitObjects]\n12.75,-12.75,100,1,0\n", version)
  m, err := decode.decode(text)
  delete(text)
  testing.expect_value(t, err.status, ct.Status.OK)
  if err.status != .OK { continue }
  testing.expect_value(t, m.difficulty.ar, 7)
  testing.expect_value(t, m.difficulty.slider_multiplier, 1.4)
  testing.expect_value(t, m.objects[0].time_ms, version < 5 ? 124.0 : 100.0)
  testing.expect_value(t, m.objects[0].x, version == 128 ? 12.75 : 12.0)
  testing.expect_value(t, m.objects[0].y, version == 128 ? -12.75 : -12.0)
  decode.destroy(&m)
 }
}
@(test)
errors_are_typed_and_transactional :: proc(t: ^testing.T) {
 Case :: struct { text: string, status: ct.Status, code: ct.Error_Code, line: u32 }
 cases := []Case{
  {"", .MALFORMED_MAP, .HEADER, 1},
  {"osu file format v15", .UNSUPPORTED, .FORMAT_VERSION, 1},
  {"osu file format v127", .UNSUPPORTED, .FORMAT_VERSION, 1},
  {"osu file format v129", .UNSUPPORTED, .FORMAT_VERSION, 1},
  {"osu file format v0", .UNSUPPORTED, .FORMAT_VERSION, 1},
  {"osu file format vwat", .MALFORMED_MAP, .HEADER, 1},
  {"\xff", .MALFORMED_MAP, .UTF8, 0},
  {"osu file format v14\n[General]\nMode: 3", .UNSUPPORTED, .MODE, 3},
  {"osu file format v14\n[Difficulty]\nCircleSize: NaN", .MALFORMED_MAP, .NUMBER, 3},
  {"osu file format v14\n[Difficulty]\nCircleSize: 1e999", .MALFORMED_MAP, .NUMBER, 3},
  {"osu file format v14\n[HitObjects]\n0,0,100,128,0", .UNSUPPORTED, .OBJECT_TYPE, 3},
  {"osu file format v14\n[HitObjects]\n0,0,100", .MALFORMED_MAP, .FIELD_COUNT, 3},
  {"osu file format v14\n[HitObjects]\n0,0,100,99999999999999,0", .MALFORMED_MAP, .NUMBER, 3},
  {"osu file format v14\n[TimingPoints]\n0,NaN,4,1,0,100,1,0", .MALFORMED_MAP, .NUMBER, 3},
 }
 for c in cases {
  m, err := decode.decode(c.text)
  testing.expect_value(t, err.status, c.status)
  testing.expect_value(t, err.code, c.code)
  testing.expect_value(t, err.line, c.line)
  testing.expect(t, m.arena.bytes == nil)
 }
}
@(test)
sorting_timing_and_slider_syntax :: proc(t: ^testing.T) {
 text :: "osu file format v128\n[TimingPoints]\n0,500\n0,NaN,4,2,3,80,0,1\n[HitObjects]\n100,100,200,1,0\n0,0,100,2,0,B|10:10|L|20:20,2,30\n0,0,100,8,0,500\n"
 m, err := decode.decode(text)
 testing.expect_value(t, err.status, ct.Status.OK)
 if err.status != .OK { return }
 defer decode.destroy(&m)
 testing.expect_value(t, m.objects[0].id, 1)
 testing.expect_value(t, m.objects[1].id, 2)
 testing.expect_value(t, m.objects[2].id, 0)
 testing.expect_value(t, m.objects[0].path, "B|10:10|L|20:20")
 testing.expect_value(t, m.objects[0].spans, 2)
 testing.expect_value(t, m.objects[1].x, 256)
 testing.expect(t, !m.timing[1].generate_ticks && m.timing[1].beat_length == 0)
}
@(test)
quotas_and_arena_boundaries :: proc(t: ^testing.T) {
 q := ct.DEFAULT_QUOTAS; q.objects = 0
 m, err := decode.decode("osu file format v14\n[HitObjects]\n0,0,0,1,0", q)
 testing.expect_value(t, err.code, ct.Error_Code.OBJECTS)
 testing.expect_value(t, err.requested, 1)
 testing.expect_value(t, err.limit, 0)
 testing.expect(t, m.arena.bytes == nil)
 _, ok := ct.checked_add(0xffff_ffff_ffff_ffff, 1)
 testing.expect(t, !ok)
 _, ok = ct.checked_product(0xffff_ffff_ffff_ffff, 2)
 testing.expect(t, !ok)
 a, status := ct.arena_create(16)
 testing.expect_value(t, status, ct.Status.OK)
 defer ct.arena_destroy(&a)
 _, ok = ct.arena_take(&a, byte, 1); testing.expect(t, ok)
 words, fits := ct.arena_take(&a, u64, 1)
 testing.expect(t, fits && uintptr(raw_data(words))%8 == 0)
 _, ok = ct.arena_take(&a, byte, 1)
 testing.expect(t, !ok && a.used == 16)
 ct.arena_reset(&a)
 testing.expect_value(t, a.used, 0)
}
@(test)
handle_ownership_reuse_and_wrap :: proc(t: ^testing.T) {
 table, status := rt.table_create(1)
 testing.expect_value(t, status, ct.Status.OK)
 value: u32
 first, _ := rt.insert(&table, 7, .MAP, &value)
 _, status = rt.lookup(&table, first, 8, .MAP)
 testing.expect_value(t, status, ct.Status.STALE_HANDLE)
 _, status = rt.lookup(&table, first, 7, .SESSION)
 testing.expect_value(t, status, ct.Status.STALE_HANDLE)
 testing.expect_value(t, rt.table_destroy(&table), ct.Status.INVALID_STATE)
 pointer: rawptr
 pointer, status = rt.release(&table, first, 7, .MAP)
 testing.expect(t, pointer == &value && status == .OK)
 pointer, status = rt.release(&table, first, 7, .MAP)
 testing.expect(t, pointer == nil && status == .OK)
 second, _ := rt.insert(&table, 8, .MAP, &value)
 testing.expect(t, second != first)
 _, status = rt.release(&table, first, 7, .MAP)
 testing.expect_value(t, status, ct.Status.STALE_HANDLE)
 rt.release(&table, second, 8, .MAP)
 table.slots[0].generation = 0xffff_ffff
 _, status = rt.insert(&table, 8, .MAP, &value)
 testing.expect_value(t, status, ct.Status.QUOTA_EXCEEDED)
 testing.expect_value(t, rt.table_destroy(&table), ct.Status.OK)
}
@(test)
lifetime_matrix :: proc(t: ^testing.T) {
 // Odin's test allocator also asserts all owned memory is returned.
 for iteration in 0..<50 {
  storage, status := prepared.create(iteration%2 == 0 ? 64 : 1024*1024)
  testing.expect_value(t, status, ct.Status.OK)
  sessions: [4]ct.Arena
  for &session in sessions {
   testing.expect_value(t, prepared.retain(&storage), ct.Status.OK)
   session, status = ct.arena_create(128)
   testing.expect_value(t, status, ct.Status.OK)
   for _ in 0..<10 { ct.arena_reset(&session) }
  }
  prepared.release(&storage) // caller drops map; sessions keep it alive
  testing.expect_value(t, storage.references, 4)
  for &session in sessions { ct.arena_destroy(&session); prepared.release(&storage) }
  testing.expect(t, storage.arena.bytes == nil && storage.references == 0)
 }
}

reject_allocations :: proc(
 data: rawptr, mode: mem.Allocator_Mode, size, alignment: int,
 old_memory: rawptr, old_size: int, loc := #caller_location,
) -> ([]byte, mem.Allocator_Error) {
 return nil, .Out_Of_Memory
}

@(test)
allocation_failure_and_replacement :: proc(t: ^testing.T) {
 valid :: "osu file format v14\n[Metadata]\nTitle: kept\n[HitObjects]\n0,0,0,1,0"
 original, err := decode.decode(valid)
 testing.expect_value(t, err.status, ct.Status.OK)
 defer decode.destroy(&original)
 failing := mem.Allocator{procedure=reject_allocations}
 candidate, failure := decode.decode(valid, allocator=failing)
 testing.expect_value(t, failure.status, ct.Status.OUT_OF_MEMORY)
 testing.expect(t, candidate.arena.bytes == nil)
 testing.expect_value(t, original.metadata.title, "kept")
 // Invalid input never reaches an allocator, even one that panics on use.
 candidate, failure = decode.decode("bad header", allocator=mem.panic_allocator())
 testing.expect_value(t, failure.code, ct.Error_Code.HEADER)
 q := ct.DEFAULT_QUOTAS
 q.arena_bytes = 1
 candidate, failure = decode.decode(valid, q, mem.panic_allocator())
 testing.expect_value(t, failure.code, ct.Error_Code.ARENA_BYTES)
 q = ct.DEFAULT_QUOTAS
 q.raw_bytes += 1
 candidate, failure = decode.decode(valid, q, mem.panic_allocator())
 testing.expect_value(t, failure.code, ct.Error_Code.QUOTAS)
}

package beatmap_decode
import ct "../core_types"
import "core:strings"
import "core:strconv"
import "core:unicode/utf8"
import "core:slice"

// The scan and fill passes execute the same parser: validation cannot drift.
// Input is borrowed for this call only. Output strings point into its own arena.
decode :: proc(text: string, quotas := ct.DEFAULT_QUOTAS, allocator := context.allocator) -> (result: Map, err: ct.Error) {
 if !ct.valid_quotas(quotas) { return {}, {status=.INVALID_ARGUMENT, code=.QUOTAS} }
 if u64(len(text)) > quotas.raw_bytes { return {}, quota_error(.RAW_BYTES, u64(len(text)), quotas.raw_bytes) }
 if !utf8.valid_string(text) { return {}, malformed(.UTF8, 0, 0) }
 counts: Counts
 candidate: Map
 err = parse(text, quotas, &candidate, &counts, false)
 if err.status != .OK { return {}, err }
 size := u64(len(text))
 ok: bool
 _, size, ok = ct.aligned_end(size, counts.objects, size_of(Raw_Object), align_of(Raw_Object))
 if !ok { return {}, quota_error(.ARENA_BYTES, ct.MAX_ADDRESSABLE+1, quotas.arena_bytes) }
 _, size, ok = ct.aligned_end(size, counts.timing, size_of(Raw_Timing), align_of(Raw_Timing))
 if !ok || size > quotas.arena_bytes { return {}, quota_error(.ARENA_BYTES, size, quotas.arena_bytes) }
 arena, status := ct.arena_create(size, allocator)
 if status != .OK { return {}, {status=status} }
 committed := false
 defer { if !committed { ct.arena_destroy(&arena) } }
 owned, text_ok := ct.arena_take(&arena, byte, u64(len(text)))
 objects, objects_ok := ct.arena_take(&arena, Raw_Object, counts.objects)
 timing, timing_ok := ct.arena_take(&arena, Raw_Timing, counts.timing)
 if !text_ok || !objects_ok || !timing_ok { return {}, {status=.INTERNAL} }
 copy(owned, transmute([]byte)text)
 candidate = Map{arena=arena, text=string(owned), objects=objects, timing=timing}
 filled: Counts
 err = parse(candidate.text, quotas, &candidate, &filled, true)
 if err.status != .OK { return {}, err }
 slice.sort_by(candidate.objects, proc(a, b: Raw_Object) -> bool {
  return a.time_ms < b.time_ms || (a.time_ms == b.time_ms && a.id < b.id)
 })
 committed = true
 return candidate, {}
}
destroy :: proc(m: ^Map) { ct.arena_destroy(&m.arena); m^ = {} }

parse :: proc(text: string, q: ct.Quotas, m: ^Map, counts: ^Counts, fill: bool) -> ct.Error {
 m.difficulty = DEFAULT_DIFFICULTY
 m.stack_leniency = 0.7
 cursor := Cursor{text=text}
 section := ""
 header := false
 has_ar := false
 for {
  raw, exists := next_line(&cursor)
  if !exists { break }
  counts.lines += 1
  if counts.lines > q.lines { return quota_error(.LINES, counts.lines, q.lines, cursor.line) }
  if cursor.line == 1 && strings.has_prefix(raw, "\xef\xbb\xbf") { raw = raw[3:] }
  line := strings.trim_space(raw)
  column := u32(strings.index(raw, line)+1)
  if len(line) == 0 || strings.has_prefix(line, "//") { continue }
  if !header {
   err := parse_header(line, cursor.line, m)
   if err.status != .OK { return err }
   header = true
   continue
  }
  if line[0] == '[' {
   if len(line) < 2 || line[len(line)-1] != ']' { return malformed(.SECTION, cursor.line, column) }
   section = line[1:len(line)-1]
   continue
  }
  switch section {
  case "HitObjects":
   counts.objects += 1
   if counts.objects > q.objects { return quota_error(.OBJECTS, counts.objects, q.objects, cursor.line) }
   object, err := parse_object(line, cursor.line, column, m.format_version, q)
   if err.status != .OK { return err }
   object.id = u32(counts.objects-1)
   if fill { m.objects[int(counts.objects)-1] = object }
  case "TimingPoints":
   counts.timing += 1
   if counts.timing > q.timing_points { return quota_error(.TIMING_POINTS, counts.timing, q.timing_points, cursor.line) }
   point, err := parse_timing(line, cursor.line, column, m.format_version, q)
   if err.status != .OK { return err }
   point.id = u32(counts.timing-1)
   if fill { m.timing[int(counts.timing)-1] = point }
  case "General", "Difficulty", "Metadata":
   err := parse_property(m, section, line, cursor.line, column, &has_ar)
   if err.status != .OK { return err }
  }
 }
 if !header { return malformed(.HEADER, 1, 1) }
 if !has_ar { m.difficulty.ar = m.difficulty.od }
 d := &m.difficulty
 d.hp = clamp(d.hp, 0, 10); d.cs = clamp(d.cs, 0, 10)
 d.od = clamp(d.od, 0, 10); d.ar = clamp(d.ar, 0, 10)
 d.slider_multiplier = clamp(d.slider_multiplier, 0.4, 3.6)
 d.tick_rate = clamp(d.tick_rate, 0.5, 8)
 return {}
}
parse_header :: proc(line: string, line_no: u32, m: ^Map) -> ct.Error {
 prefix :: "osu file format v"
 if !strings.has_prefix(line, prefix) { return malformed(.HEADER, line_no, 1) }
 version, ok := strconv.parse_i64(line[len(prefix):], 10)
 if !ok { return malformed(.HEADER, line_no, u32(len(prefix)+1)) }
 if !(version >= 1 && version <= 14) && version != 128 { return {.UNSUPPORTED, .FORMAT_VERSION, line_no, u32(len(prefix)+1), 0, 0} }
 m.format_version = u32(version)
 return {}
}
parse_property :: proc(m: ^Map, section, line: string, line_no, column: u32, has_ar: ^bool) -> ct.Error {
 index := strings.index_byte(line, ':')
 if index < 0 { return malformed(.SECTION, line_no, column) }
 key := strings.trim_space(line[:index]); value := strings.trim_space(line[index+1:])
 col := column + u32(index+1) + u32(len(line[index+1:])-len(strings.trim_left_space(line[index+1:])))
 if section == "Metadata" {
  switch key {
  case "Title": m.metadata.title = value
  case "Artist": m.metadata.artist = value
  case "Creator": m.metadata.creator = value
  case "Version": m.metadata.version = value
  }
  return {}
 }
 if section == "General" {
  switch key {
  case "AudioFilename": m.metadata.audio = value
  case "Mode":
   mode, err := integer(value, line_no, col)
   if err.status != .OK { return err }
   if mode != 0 { return {.UNSUPPORTED, .MODE, line_no, col, 0, 0} }
  case "StackLeniency":
   n, err := number_f32(value, line_no, col)
   if err.status != .OK { return err }
   m.stack_leniency = n
  }
  return {}
 }
 target: ^f64
 switch key {
 case "HPDrainRate": target = &m.difficulty.hp
 case "CircleSize": target = &m.difficulty.cs
 case "OverallDifficulty": target = &m.difficulty.od
 case "ApproachRate": target = &m.difficulty.ar; has_ar^ = true
 case "SliderMultiplier": target = &m.difficulty.slider_multiplier
 case "SliderTickRate": target = &m.difficulty.tick_rate
 case: return {}
 }
 n: f64
 err: ct.Error
 if key == "SliderMultiplier" || key == "SliderTickRate" {
  n, err = number(value, line_no, col)
 } else {
  n, err = number_f32(value, line_no, col)
 }
 if err.status != .OK { return err }
 target^ = n
 return {}
}

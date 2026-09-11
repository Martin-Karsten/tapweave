package beatmap_decode
import ct "../core_types"
import "core:strings"
import "core:math"

// Sticky first error keeps record parsing linear while preserving the location.
Reader :: struct { fields: Fields, line: u32, error: ct.Error }
read_f64 :: proc(r: ^Reader) -> f64 {
 if r.error.status != .OK { return 0 }
 value, err := read_number(&r.fields, r.line)
 r.error = err
 return value
}
read_i32 :: proc(r: ^Reader) -> i32 {
 if r.error.status != .OK { return 0 }
 value, err := read_integer(&r.fields, r.line)
 r.error = err
 return value
}
optional_text :: proc(r: ^Reader) -> string {
 value, _, _ := next_field(&r.fields)
 return strings.trim_space(value)
}
offset_time :: proc(time: f64, version: u32) -> f64 { return time + (version < 5 ? 24 : 0) }
validate_time :: proc(value: f64, q: ct.Quotas, line: u32) -> ct.Error {
 if math.abs(value) > f64(q.duration_ms) { return quota_error(.DURATION, u64(math.min(math.abs(value), f64(ct.MAX_ADDRESSABLE))), q.duration_ms, line) }
 return {}
}
parse_object :: proc(text: string, line, column, version: u32, q: ct.Quotas) -> (o: Raw_Object, err: ct.Error) {
 r := Reader{fields=Fields{remaining=text, column=column}, line=line}
 o.line = line
 o.x = read_coordinate(&r); o.y = read_coordinate(&r)
 o.time_ms = offset_time(read_f64(&r), version)
 flags := read_i32(&r); sound := read_i32(&r)
 if r.error.status != .OK { return {}, r.error }
 if math.abs(o.x) > 131072 || math.abs(o.y) > 131072 { return {}, malformed(.NUMBER, line, column) }
 o.x = f64(f32(o.x)); o.y = f64(f32(o.y))
 if version < 128 { o.x = math.trunc(o.x); o.y = math.trunc(o.y) }
 kind := flags & 139
 if flags < 0 || flags & ~i32(127) != 0 || (kind != 1 && kind != 2 && kind != 8) {
  return {}, {.UNSUPPORTED, .OBJECT_TYPE, line, column, 0, 0}
 }
 if sound < 0 || sound & ~i32(15) != 0 { return {}, malformed(.NUMBER, line, column) }
 o.flags = u32(flags); o.hit_sound = u32(sound); o.kind = Object_Kind(kind)
 o.end_time_ms = o.time_ms
 switch o.kind {
 case .CIRCLE: o.hit_sample = optional_text(&r)
 case .SPINNER:
  o.end_time_ms = max(o.time_ms, offset_time(read_f64(&r), version))
  o.x = 256; o.y = 192
  o.hit_sample = optional_text(&r)
 case .SLIDER:
  path, path_column, path_err := required(&r.fields, line)
  if path_err.status != .OK { return {}, path_err }
  o.path = path
  err = validate_path(path, line, path_column)
  if err.status != .OK { return {}, err }
  spans := read_i32(&r)
  if spans > 9000 { return {}, malformed(.NUMBER, line, r.fields.column) }
  o.spans = u32(max(1, spans))
  if !r.fields.done { o.length = max(0, read_f64(&r)) }
  if o.length > 131072 { return {}, malformed(.NUMBER, line, r.fields.column) }
  o.edge_sounds = optional_text(&r); o.edge_sets = optional_text(&r)
  o.hit_sample = optional_text(&r)
 }
 if r.error.status != .OK { return {}, r.error }
 err = validate_time(o.time_ms, q, line)
 if err.status != .OK { return {}, err }
 err = validate_time(o.end_time_ms, q, line)
 if err.status != .OK { return {}, err }
 return o, {}
}
// M0 validates and retains segment syntax; M1 resolves geometry and samples.
validate_path :: proc(path: string, line, column: u32) -> ct.Error {
 f := Fields{remaining=path, column=column}
 first := true
 for {
  token, col, ok := next_field(&f, '|')
  if !ok { break }
  if len(token) == 0 { return malformed(.PATH, line, col) }
  marker := token[0] == 'B' || token[0] == 'C' || token[0] == 'L' || token[0] == 'P'
  if marker {
   if len(token) > 1 {
    degree, err := integer(token[1:], line, col+1)
    if err.status != .OK || token[0] != 'B' || degree < 1 { return malformed(.PATH, line, col) }
   }
  } else {
   if first { return malformed(.PATH, line, col) }
   split := strings.index_byte(token, ':')
   if split < 0 { return malformed(.PATH, line, col) }
   x, xe := number_f32(token[:split], line, col, 131072)
   y, ye := number_f32(token[split+1:], line, col+u32(split+1), 131072)
   if xe.status != .OK { return xe }
   if ye.status != .OK { return ye }
   if math.abs(x) > 131072 || math.abs(y) > 131072 { return malformed(.PATH, line, col) }
  }
  first = false
 }
 return {}
}
parse_timing :: proc(text: string, line, column, version: u32, q: ct.Quotas) -> (p: Raw_Timing, err: ct.Error) {
 r := Reader{fields=Fields{remaining=text, column=column}, line=line}
 p = Raw_Timing{line=line, meter=4, volume=100, timing_change=true, generate_ticks=true}
 p.time_ms = offset_time(read_f64(&r), version)
 beat, col, field_err := required(&r.fields, line)
 if r.error.status != .OK { return {}, r.error }
 if field_err.status != .OK { return {}, field_err }
 nan := strings.trim_space(beat) == "NaN"
 if !nan {
  p.beat_length, err = number(beat, line, col)
  if err.status != .OK { return {}, err }
 }
 if !r.fields.done { p.meter = read_i32(&r); if p.meter == 0 { p.meter = 4 } }
 if !r.fields.done { p.sample_set = read_i32(&r) }
 if !r.fields.done { p.sample_index = read_i32(&r) }
 if !r.fields.done { p.volume = read_i32(&r) }
 if !r.fields.done {
  red := read_i32(&r)
  if red != 0 && red != 1 { return {}, malformed(.NUMBER, line, r.fields.column) }
  p.timing_change = red == 1
 }
 if !r.fields.done { p.effects = read_i32(&r) }
 if r.error.status != .OK { return {}, r.error }
 if nan && p.timing_change { return {}, malformed(.NUMBER, line, col) }
 p.generate_ticks = !nan // Canonical finite representation of the NaN sentinel.
 if p.meter < 1 { return {}, malformed(.NUMBER, line, column) }
 err = validate_time(p.time_ms, q, line)
 if err.status != .OK { return {}, err }
 return p, {}
}

read_coordinate :: proc(r: ^Reader) -> f64 {
 if r.error.status != .OK { return 0 }
 text, column, err := required(&r.fields, r.line)
 if err.status != .OK { r.error = err; return 0 }
 value, numeric_error := number_f32(text, r.line, column, 131072)
 r.error = numeric_error
 return value
}

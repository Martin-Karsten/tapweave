package beatmap_decode
import ct "../core_types"
import "core:strings"
import "core:strconv"
import "core:math"

Cursor :: struct { text: string, offset: int, line: u32 }
next_line :: proc(c: ^Cursor) -> (string, bool) {
 if c.offset >= len(c.text) { return "", false }
 start := c.offset
 for c.offset < len(c.text) && c.text[c.offset] != '\n' { c.offset += 1 }
 result := c.text[start:c.offset]
 if c.offset < len(c.text) { c.offset += 1 }
 c.line += 1
 return result, true
}
// A bounded field iterator avoids split allocations and fixed field-count buffers.
Fields :: struct { remaining: string, done: bool, column: u32 }
next_field :: proc(f: ^Fields, separator: byte = ',') -> (string, u32, bool) {
 if f.done { return "", f.column, false }
 start := f.column
 index := strings.index_byte(f.remaining, separator)
 if index < 0 {
  result := f.remaining; f.remaining = ""; f.done = true
  return result, start, true
 }
 result := f.remaining[:index]
 f.remaining = f.remaining[index+1:]
 f.column += u32(index+1)
 return result, start, true
}
malformed :: proc(code: ct.Error_Code, line, column: u32) -> ct.Error {
 return {.MALFORMED_MAP, code, line, column, 0, 0}
}
number :: proc(text: string, line, column: u32) -> (f64, ct.Error) {
 value_column := column + u32(len(text)-len(strings.trim_left_space(text)))
 value, ok := strconv.parse_f64(strings.trim_space(text))
 if !ok || math.is_nan(value) || math.is_inf(value) || math.abs(value) > 2147483647 {
  return 0, malformed(.NUMBER, line, value_column)
 }
 return value, {}
}
integer :: proc(text: string, line, column: u32) -> (i32, ct.Error) {
 value_column := column + u32(len(text)-len(strings.trim_left_space(text)))
 value, ok := strconv.parse_i64(strings.trim_space(text), 10)
 if !ok || value < -2147483648 || value > 2147483647 {
  return 0, malformed(.NUMBER, line, value_column)
 }
 return i32(value), {}
}
required :: proc(f: ^Fields, line: u32) -> (string, u32, ct.Error) {
 value, col, ok := next_field(f)
 if !ok || len(strings.trim_space(value)) == 0 { return "", col, malformed(.FIELD_COUNT, line, col) }
 return value, col, {}
}
read_number :: proc(f: ^Fields, line: u32) -> (f64, ct.Error) {
 value, col, err := required(f, line)
 if err.status != .OK { return 0, err }
 return number(value, line, col)
}
read_integer :: proc(f: ^Fields, line: u32) -> (i32, ct.Error) {
 value, col, err := required(f, line)
 if err.status != .OK { return 0, err }
 return integer(value, line, col)
}
quota_error :: proc(code: ct.Error_Code, requested, limit: u64, line: u32 = 0) -> ct.Error {
 return {.QUOTA_EXCEEDED, code, line, 0, requested, limit}
}

// Upstream difficulty/position fields parse as f32 even though stored as f64.
number_f32 :: proc(text: string, line, column: u32, limit: f32 = 2147483648) -> (f64, ct.Error) {
 value, ok := strconv.parse_f32(strings.trim_space(text))
 if !ok || math.is_nan(value) || math.is_inf(value) || math.abs(value) > limit {
  value_column := column + u32(len(text)-len(strings.trim_left_space(text)))
  return 0, malformed(.NUMBER, line, value_column)
 }
 return f64(value), {}
}

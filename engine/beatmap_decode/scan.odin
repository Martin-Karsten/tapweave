package beatmap_decode

import core_types "../core_types"
import "core:strings"
import "core:strconv"
import "core:math"

Cursor :: struct {
	text: string,
	offset: int,
	line: u32,
}

next_line :: proc(cursor: ^Cursor) -> (string, bool) {
	if cursor.offset >= len(cursor.text) {
		return "", false
	}
	start := cursor.offset
	for cursor.offset < len(cursor.text) && cursor.text[cursor.offset] != '\n' {
		cursor.offset += 1
	}
	result := cursor.text[start:cursor.offset]
	if cursor.offset < len(cursor.text) {
		cursor.offset += 1
	}
	cursor.line += 1
	return result, true
}

// A bounded field iterator avoids split allocations and fixed field-count buffers.
Fields :: struct {
	remaining: string,
	done: bool,
	column: u32,
}

next_field :: proc(fields: ^Fields, separator: byte = ',') -> (string, u32, bool) {
	if fields.done {
		return "", fields.column, false
	}
	start := fields.column
	index := strings.index_byte(fields.remaining, separator)
	if index < 0 {
		result := fields.remaining
		fields.remaining = ""
		fields.done = true
		return result, start, true
	}
	result := fields.remaining[:index]
	fields.remaining = fields.remaining[index + 1:]
	fields.column += u32(index + 1)
	return result, start, true
}

malformed :: proc(code: core_types.Error_Code, line, column: u32) -> core_types.Error {
	return {.MALFORMED_MAP, code, line, column, 0, 0}
}

number :: proc(text: string, line, column: u32) -> (f64, core_types.Error) {
	value_column := column + u32(len(text) - len(strings.trim_left_space(text)))
	value, ok := strconv.parse_f64(strings.trim_space(text))
	if !ok || math.is_nan(value) || math.is_inf(value) || math.abs(value) > 2147483647 {
		return 0, malformed(.NUMBER, line, value_column)
	}
	return value, {}
}

// Parse decimal digits with a pre-multiply bound. The pinned strconv integer
// parser wraps on overflow, so a range check after parsing is insufficient.
parse_decimal :: proc(text: string, minimum, maximum: i64) -> (i64, bool) {
	digits := strings.trim_space(text)
	if len(digits) == 0 {
		return 0, false
	}
	negative := digits[0] == '-'
	if minimum > maximum || (negative && minimum >= 0) || (!negative && maximum < 0) {
		return 0, false
	}
	if negative || digits[0] == '+' {
		digits = digits[1:]
	}
	if len(digits) == 0 {
		return 0, false
	}
	magnitude_limit := negative ? u64(-(minimum + 1)) + 1 : u64(maximum)
	magnitude: u64
	for digit_character in digits {
		if digit_character < '0' || digit_character > '9' {
			return 0, false
		}
		digit := u64(digit_character - '0')
		if digit > magnitude_limit || magnitude > (magnitude_limit - digit) / 10 {
			return 0, false
		}
		magnitude = magnitude * 10 + digit
	}
	if negative {
		if magnitude == u64(max(i64)) + 1 {
			return min(i64), minimum == min(i64)
		}
		value := -i64(magnitude)
		return value, value >= minimum && value <= maximum
	}
	value := i64(magnitude)
	return value, value >= minimum && value <= maximum
}

integer :: proc(text: string, line, column: u32) -> (i32, core_types.Error) {
	value_column := column + u32(len(text) - len(strings.trim_left_space(text)))
	value, valid := parse_decimal(text, -2147483647, 2147483647)
	if !valid {
		return 0, malformed(.NUMBER, line, value_column)
	}
	return i32(value), {}
}

required :: proc(fields: ^Fields, line: u32) -> (string, u32, core_types.Error) {
	value, value_column, ok := next_field(fields)
	if !ok || len(strings.trim_space(value)) == 0 {
		return "", value_column, malformed(.FIELD_COUNT, line, value_column)
	}
	return value, value_column, {}
}

read_number :: proc(fields: ^Fields, line: u32) -> (f64, core_types.Error) {
	value, value_column, error := required(fields, line)
	if error.status != .OK {
		return 0, error
	}
	return number(value, line, value_column)
}

read_integer :: proc(fields: ^Fields, line: u32) -> (i32, core_types.Error) {
	value, value_column, error := required(fields, line)
	if error.status != .OK {
		return 0, error
	}
	return integer(value, line, value_column)
}

quota_error :: proc(code: core_types.Error_Code, requested, limit: u64, line: u32 = 0) -> core_types.Error {
	return {.QUOTA_EXCEEDED, code, line, 0, requested, limit}
}

// Upstream difficulty/position fields parse as f32 even though stored as f64.
number_f32 :: proc(text: string, line, column: u32, limit: f32 = 2147483648) -> (f64, core_types.Error) {
	value, ok := strconv.parse_f32(strings.trim_space(text))
	if !ok || math.is_nan(value) || math.is_inf(value) || math.abs(value) > limit {
		value_column := column + u32(len(text) - len(strings.trim_left_space(text)))
		return 0, malformed(.NUMBER, line, value_column)
	}
	return f64(value), {}
}

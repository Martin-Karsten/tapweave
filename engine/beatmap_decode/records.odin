package beatmap_decode

import core_types "../core_types"
import "core:strings"
import "core:math"

// Sticky first error keeps record parsing linear while preserving the location.
Reader :: struct {
	fields: Fields,
	line: u32,
	error: core_types.Error,
}

read_f64 :: proc(reader: ^Reader) -> f64 {
	if reader.error.status != .OK {
		return 0
	}
	value, error := read_number(&reader.fields, reader.line)
	reader.error = error
	return value
}

read_i32 :: proc(reader: ^Reader) -> i32 {
	if reader.error.status != .OK {
		return 0
	}
	value, error := read_integer(&reader.fields, reader.line)
	reader.error = error
	return value
}

optional_text :: proc(reader: ^Reader) -> (string, u32) {
	value, value_column, _ := next_field(&reader.fields)
	return strings.trim_space(value), value_column + u32(len(value) - len(strings.trim_left_space(value)))
}

offset_time :: proc(time: f64, version: u32) -> f64 {
	return time + (version < 5 ? 24 : 0)
}

validate_time :: proc(value: f64, quotas: core_types.Quotas, line: u32) -> core_types.Error {
	if math.abs(value) > f64(quotas.duration_ms) {
		return quota_error(
			.DURATION,
			u64(math.min(math.abs(value), f64(core_types.MAX_ADDRESSABLE))),
			quotas.duration_ms,
			line,
		)
	}
	return {}
}

parse_object :: proc(
	text: string,
	line, column, version: u32,
	quotas: core_types.Quotas,
) -> (
	raw_object: Raw_Object,
	error: core_types.Error,
) {
	reader := Reader {
		fields = Fields{remaining = text, column = column},
		line = line,
	}
	sample_columns: [3]u32
	raw_object.line = line
	raw_object.x = read_coordinate(&reader)
	raw_object.y = read_coordinate(&reader)
	raw_object.time_ms = offset_time(read_f64(&reader), version)
	flags := read_i32(&reader)
	sound := read_i32(&reader)
	if reader.error.status != .OK {
		return {}, reader.error
	}
	if math.abs(raw_object.x) > 131072 || math.abs(raw_object.y) > 131072 {
		return {}, malformed(.NUMBER, line, column)
	}
	raw_object.x = f64(f32(raw_object.x))
	raw_object.y = f64(f32(raw_object.y))
	if version < 128 {
		raw_object.x = math.trunc(raw_object.x)
		raw_object.y = math.trunc(raw_object.y)
	}
	kind := flags & 139
	if flags < 0 || flags & ~i32(127) != 0 || (kind != 1 && kind != 2 && kind != 8) {
		return {}, {.UNSUPPORTED, .OBJECT_TYPE, line, column, 0, 0}
	}
	if sound < 0 || sound & ~i32(15) != 0 {
		return {}, malformed(.NUMBER, line, column)
	}
	raw_object.flags = u32(flags)
	raw_object.hit_sound = u32(sound)
	raw_object.kind = Object_Kind(kind)
	raw_object.end_time_ms = raw_object.time_ms
	switch raw_object.kind {
	case .CIRCLE:
		raw_object.hit_sample, sample_columns[2] = optional_text(&reader)
	case .SPINNER:
		raw_object.end_time_ms = max(raw_object.time_ms, offset_time(read_f64(&reader), version))
		raw_object.x = 256
		raw_object.y = 192
		raw_object.hit_sample, sample_columns[2] = optional_text(&reader)
	case .SLIDER:
		path, path_column, path_err := required(&reader.fields, line)
		if path_err.status != .OK {
			return {}, path_err
		}
		raw_object.path = path
		error = validate_path(path, line, path_column)
		if error.status != .OK {
			return {}, error
		}
		spans := read_i32(&reader)
		if spans > 9000 {
			return {}, malformed(.NUMBER, line, reader.fields.column)
		}
		raw_object.spans = u32(max(1, spans))
		if !reader.fields.done {
			raw_object.length = max(0, read_f64(&reader))
		}
		if raw_object.length > 131072 {
			return {}, malformed(.NUMBER, line, reader.fields.column)
		}
		raw_object.edge_sounds, sample_columns[0] = optional_text(&reader)
		raw_object.edge_sets, sample_columns[1] = optional_text(&reader)
		raw_object.hit_sample, sample_columns[2] = optional_text(&reader)
	}
	if reader.error.status != .OK {
		return {}, reader.error
	}
	// Locate retained fields in the original record for precise numeric errors.
	for field, index in ([3]string{raw_object.edge_sounds, raw_object.edge_sets, raw_object.hit_sample}) {
		if len(field) == 0 {
			continue
		}
		value_column := sample_columns[index]
		if index == 2 {
			error = validate_sample(field, line, value_column, raw_object.kind == .SLIDER)
		} else {
			fields := Fields {
				remaining = field,
				column = value_column,
			}
			for node := u32(0); node < raw_object.spans + 1; node += 1 {
				token, at, ok := next_field(&fields, '|')
				if !ok {
					break
				}
				if index == 0 {
					_ = edge_sound_value(token)
				} else {
					error = validate_sample(token, line, at, false)
				}
				if error.status != .OK {
					break
				}
			}
		}
		if error.status != .OK {
			return {}, error
		}
	}
	error = validate_time(raw_object.time_ms, quotas, line)
	if error.status != .OK {
		return {}, error
	}
	error = validate_time(raw_object.end_time_ms, quotas, line)
	if error.status != .OK {
		return {}, error
	}
	return raw_object, {}
}

// M0 validates and retains segment syntax; M1 resolves geometry and samples.
validate_path :: proc(path: string, line, column: u32) -> core_types.Error {
	fields := Fields {
		remaining = path,
		column = column,
	}
	first := true
	for {
		token, value_column, ok := next_field(&fields, '|')
		if !ok {
			break
		}
		if len(token) == 0 {
			return malformed(.PATH, line, value_column)
		}
		marker := token[0] == 'B' || token[0] == 'C' || token[0] == 'L' || token[0] == 'P'
		if marker {
			if len(token) > 1 {
				degree, error := integer(token[1:], line, value_column + 1)
				if error.status != .OK || token[0] != 'B' || degree < 1 {
					return malformed(.PATH, line, value_column)
				}
			}
		} else {
			if first {
				return malformed(.PATH, line, value_column)
			}
			split := strings.index_byte(token, ':')
			if split < 0 {
				return malformed(.PATH, line, value_column)
			}
			x, x_error := number_f32(token[:split], line, value_column, 131072)
			y, y_error := number_f32(token[split + 1:], line, value_column + u32(split + 1), 131072)
			if x_error.status != .OK {
				return x_error
			}
			if y_error.status != .OK {
				return y_error
			}
			if math.abs(x) > 131072 || math.abs(y) > 131072 {
				return malformed(.PATH, line, value_column)
			}
		}
		first = false
	}
	return {}
}

parse_timing :: proc(
	text: string,
	line, column, version: u32,
	quotas: core_types.Quotas,
	sample_set: i32 = 0,
	volume: i32 = 100,
) -> (
	timing_point: Raw_Timing,
	error: core_types.Error,
) {
	reader := Reader {
		fields = Fields{remaining = text, column = column},
		line = line,
	}
	timing_point = Raw_Timing {
		line = line,
		meter = 4,
		volume = volume,
		sample_set = sample_set,
		timing_change = true,
		generate_ticks = true,
	}
	timing_point.time_ms = offset_time(read_f64(&reader), version)
	beat, value_column, field_err := required(&reader.fields, line)
	if reader.error.status != .OK {
		return {}, reader.error
	}
	if field_err.status != .OK {
		return {}, field_err
	}
	nan := strings.trim_space(beat) == "NaN"
	if !nan {
		timing_point.beat_length, error = number(beat, line, value_column)
		if error.status != .OK {
			return {}, error
		}
	}
	if !reader.fields.done {
		timing_point.meter = read_i32(&reader)
		if timing_point.meter == 0 {
			timing_point.meter = 4
		}
	}
	if !reader.fields.done {
		timing_point.sample_set = read_i32(&reader)
	}
	if !reader.fields.done {
		timing_point.sample_index = read_i32(&reader)
	}
	if !reader.fields.done {
		timing_point.volume = read_i32(&reader)
	}
	if !reader.fields.done {
		red := read_i32(&reader)
		if red != 0 && red != 1 {
			return {}, malformed(.NUMBER, line, reader.fields.column)
		}
		timing_point.timing_change = red == 1
	}
	if !reader.fields.done {
		timing_point.effects = read_i32(&reader)
	}
	if reader.error.status != .OK {
		return {}, reader.error
	}
	if nan && timing_point.timing_change {
		return {}, malformed(.NUMBER, line, value_column)
	}
	timing_point.generate_ticks = !nan // Canonical finite representation of the NaN sentinel.
	if timing_point.meter < 1 {
		return {}, malformed(.NUMBER, line, column)
	}
	error = validate_time(timing_point.time_ms, quotas, line)
	if error.status != .OK {
		return {}, error
	}
	return timing_point, {}
}

read_coordinate :: proc(reader: ^Reader) -> f64 {
	if reader.error.status != .OK {
		return 0
	}
	text, column, error := required(&reader.fields, reader.line)
	if error.status != .OK {
		reader.error = error
		return 0
	}
	value, numeric_error := number_f32(text, reader.line, column, 131072)
	reader.error = numeric_error
	return value
}

// Mirrors readCustomSampleBanks: slider top-level samples read only the banks;
// edge entries beyond the node count are ignored by the pinned parser.
validate_sample :: proc(text: string, line, column: u32, banks_only: bool) -> core_types.Error {
	if len(text) == 0 {
		return {}
	}
	fields := Fields {
		remaining = text,
		column = column,
	}
	for sample_field_index in 0 ..< 4 {
		if sample_field_index == 2 && banks_only {
			break
		}
		value, value_column, ok := next_field(&fields, ':')
		if !ok {
			if sample_field_index < 2 {
				return malformed(.FIELD_COUNT, line, value_column)
			}
			break
		}
		_, error := integer(value, line, value_column)
		if error.status != .OK {
			return error
		}
	}
	return {}
}

// int.TryParse in the pinned edge-sound parser deliberately defaults invalid
// text/overflow to zero. Preserve syntax for M1 while exposing this exact rule.
edge_sound_value :: proc(text: string) -> i32 {
	value, ok := parse_decimal(text, -2147483648, 2147483647)
	return ok && value >= -2147483648 && value <= 2147483647 ? i32(value) : 0
}

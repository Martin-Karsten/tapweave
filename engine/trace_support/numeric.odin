package trace_support

import "core:encoding/json"
import "core:io"
import "core:strconv"

// Round-trippable f64 decimals for exact local evidence. Widen f32 exactly.
// Callers register this only in single-threaded test transports.
marshal_float :: proc(writer: io.Writer, value: any, options: ^json.Marshal_Options) -> json.Marshal_Error {
	number_value: f64
	switch typed_number in value {
	case f64:

		number_value = typed_number
	case f32:

		number_value = f64(typed_number)
	case:

		return json.Marshal_Data_Error.Unsupported_Type
	}
	buffer: [64]byte
	text := strconv.write_float(buffer[:], number_value, 'g', -1, 64)
	if len(text) > 0 && text[0] == '+' {
		text = text[1:]
	}
	_, error := io.write_string(writer, text)
	return error
}

package main

import "base:runtime"
import presentation_trace "../presentation_trace"

main :: proc() {}

@(export)
trace_presentation_value :: proc "c" (case_index, value_index: u32) -> f64 {
	context = runtime.default_context()
	if value_index >= presentation_trace.VALUE_COUNT {
		return 0
	}
	values := presentation_trace.case_values(case_index)
	return values[value_index]
}

package main

import "core:encoding/json"
import "core:fmt"
import trace_support "../trace_support"
import presentation_trace "../presentation_trace"

main :: proc() {
	marshalers := make(map[typeid]json.User_Marshaler)
	defer delete(marshalers)
	previous_marshalers := json._user_marshalers
	json._user_marshalers = &marshalers
	defer {
		json._user_marshalers = previous_marshalers
	}
	json.register_user_marshaler(f64, trace_support.marshal_float)
	values: [presentation_trace.CASE_COUNT][presentation_trace.VALUE_COUNT]f64
	for &case_values, case_index in values {
		case_values = presentation_trace.case_values(u32(case_index))
	}
	encoded, error := json.marshal(values)
	if error != nil {
		panic("presentation trace serialization failed")
	}
	defer delete(encoded)
	fmt.println(string(encoded))
}

package main

import engine_runtime "../runtime"
import "core:os"
import "core:fmt"
import trace "../trace_schema"
main :: proc() {
	_ = engine_runtime.oe_abi_control()
	if len(os.args) != 2 {
		fmt.eprintln("usage: decode-native map.osu")
		os.exit(2)
	}
	bytes, allocation_error := os.read_entire_file(os.args[1], context.allocator)
	if allocation_error != nil {
		fmt.eprintln(allocation_error)
		os.exit(2)
	}
	defer delete(bytes)
	output, trace_succeeded := trace.decode_trace(string(bytes))
	if !trace_succeeded {
		os.exit(3)
	}
	defer delete(output)
	fmt.println(string(output))
}

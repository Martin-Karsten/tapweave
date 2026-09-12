package main

import "core:os"
import "core:fmt"
import trace "../geometry_trace"
main :: proc() {
	if len(os.args) != 2 {
		fmt.eprintln("usage: geometry-native fixtures.json")
		os.exit(2)
	}
	input, error := os.read_entire_file(os.args[1], context.allocator)
	if error != nil {
		fmt.eprintln(error)
		os.exit(2)
	}
	defer delete(input)
	output, trace_succeeded := trace.run(input)
	if !trace_succeeded {
		os.exit(3)
	}
	defer delete(output)
	fmt.println(string(output))
}

package main

import "core:os"
import "core:fmt"
import "core:encoding/json"
import trace "../prepared_trace"
main :: proc() {
	if len(os.args) < 2 || len(os.args) > 3 {
		fmt.eprintln("usage: prepared-native fixtures.json")
		os.exit(2)
	}
	input, error := os.read_entire_file(os.args[1], context.allocator)
	if error != nil {
		fmt.eprintln(error)
		os.exit(2)
	}
	defer delete(input)
	statistics: trace.Statistics
	output, trace_succeeded := trace.run(input, &statistics)
	if !trace_succeeded {
		os.exit(3)
	}
	defer delete(output)
	if len(os.args) == 3 && os.args[2] == "--stats" {
		stats, _ := json.marshal(statistics)
		defer delete(stats)
		fmt.println(string(stats))
	} else {
		fmt.println(string(output))
	}
}

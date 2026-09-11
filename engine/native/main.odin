package main
import "core:os"
import "core:fmt"
import trace "../trace_schema"
main :: proc() {
 if len(os.args) != 2 { fmt.eprintln("usage: decode-native map.osu"); os.exit(2) }
 bytes, err := os.read_entire_file(os.args[1], context.allocator)
 if err != nil { fmt.eprintln(err); os.exit(2) }
 defer delete(bytes)
 output, ok := trace.decode_trace(string(bytes))
 if !ok { os.exit(3) }
 defer delete(output)
 fmt.println(string(output))
}

package trace_schema
import decode "../beatmap_decode"
import ct "../core_types"
import "core:encoding/json"

Decode_Trace :: struct {
 schema_version: u32,
 kind: string,
 error: ct.Error,
 format_version: u32,
 difficulty: decode.Difficulty,
 metadata: decode.Metadata,
 stack_leniency: f64,
 objects: []decode.Raw_Object,
 timing: []decode.Raw_Timing,
}
// Serialize fields, never native struct bytes/pointers/padding. Arena sizes are
// intentionally diagnostics, not compatibility records (pointer widths differ).
decode_trace :: proc(text: string) -> ([]byte, bool) {
 m, error := decode.decode(text)
 defer decode.destroy(&m)
 trace := Decode_Trace{schema_version=1, kind="decoded-map", error=error,
  format_version=m.format_version, difficulty=m.difficulty, metadata=m.metadata,
  stack_leniency=m.stack_leniency, objects=m.objects, timing=m.timing}
 bytes, err := json.marshal(trace, {use_enum_names=true})
 return bytes, err == nil
}

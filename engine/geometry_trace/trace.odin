package geometry_trace

import "core:encoding/json"
import geometry "../osu_prepare"

Fixture :: struct {
	id: string,
	points: []geometry.Control_Point,
	options: geometry.Geometry_Options,
	progress: []f64,
}

Trace :: struct {
	schema_version: u32,
	id: string,
	status: geometry.Geometry_Status,
	vertices: []geometry.Position_F64,
	cumulative, segment_ends: []f64,
	calculated_length, distance: f64,
	samples: []geometry.Position_F64,
}

// Private test transport. Its allocation limits are not production map quotas.
run :: proc(input: []byte) -> ([]byte, bool) {
	fixtures: []Fixture
	unmarshal_error := json.unmarshal(input, &fixtures)
	defer {
		for fixture in fixtures {
			delete(fixture.id)
			delete(fixture.points)
			delete(fixture.progress)
		}
		delete(fixtures)
	}
	if unmarshal_error != nil || len(fixtures) > 1000 {
		return nil, false
	}
	output: [dynamic]byte
	append(&output, '[')
	for fixture, fixture_index in fixtures {
		if fixture_index > 0 {
			append(&output, ',')
		}
		control_point_count := len(fixture.points)
		if control_point_count > 4096 || len(fixture.progress) > 100 {
			delete(output)
			return nil, false
		}
		workspace := geometry.Geometry_Workspace {
			vertices = make([]geometry.Position_F64, 100_000),
			cumulative = make([]f64, 100_001),
			segment_ends = make([]f64, control_point_count),
			scratch = make([]geometry.Position_F32, 4 * control_point_count),
			stack = make([]geometry.Position_F32, 64 * control_point_count),
		}
		samples := make([]geometry.Position_F64, len(fixture.progress))
		path, status := geometry.build_path(fixture.points, fixture.options, workspace)
		for progress, sample_index in fixture.progress {
			if status != .OK {
				break
			}
			samples[sample_index], status = geometry.position_at(&path, progress)
		}
		trace := Trace {
			1,
			fixture.id,
			status,
			path.vertices,
			path.cumulative,
			path.segment_ends,
			path.calculated_length,
			path.distance,
			samples,
		}
		serialized_trace, marshal_error := json.marshal(trace, {use_enum_names = true})
		if marshal_error == nil {
			append(&output, ..serialized_trace)
		}
		delete(serialized_trace)
		delete(samples)
		delete(workspace.vertices)
		delete(workspace.cumulative)
		delete(workspace.segment_ends)
		delete(workspace.scratch)
		delete(workspace.stack)
		if marshal_error != nil {
			delete(output)
			return nil, false
		}
	}
	append(&output, ']')
	return output[:], true
}

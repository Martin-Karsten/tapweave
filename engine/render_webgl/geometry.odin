package render_webgl

import "core:math"
import presentation "../presentation"

MAX_VERTICES :: 2_000_000
MAX_INDICES :: 6_000_000
MAX_RESOURCE_BYTES :: 128 * 1024 * 1024
CAP_SEGMENTS :: 24
Vertex :: [4]f64

Mesh_Builder :: struct {
	vertices: []Vertex,
	indices: []u32,
	vertex_count, index_count: int,
	valid: bool,
}

vertex :: proc(builder: ^Mesh_Builder, position: Vertex) -> u32 {
	vertex_index := builder.vertex_count
	builder.vertex_count += 1
	for coordinate in position {
		if math.is_nan(coordinate) || math.is_inf(coordinate) || math.is_inf(f32(coordinate)) {
			builder.valid = false
		}
	}
	if vertex_index < len(builder.vertices) {
		// GPU geometry is canonical f32, carried in portable f64 slots. This
		// removes host libm last-bit differences before native/WASM serialization.
		for coordinate, coordinate_index in position {
			builder.vertices[vertex_index][coordinate_index] = f64(f32(coordinate))
		}
	}
	if builder.vertex_count > MAX_VERTICES {
		builder.valid = false
	}
	return u32(vertex_index)
}

triangle :: proc(builder: ^Mesh_Builder, first, second, third: u32) {
	for vertex_index in ([3]u32{first, second, third}) {
		if builder.index_count < len(builder.indices) {
			builder.indices[builder.index_count] = vertex_index
		}
		builder.index_count += 1
	}
	if builder.index_count > MAX_INDICES {
		builder.valid = false
	}
}

quad :: proc(builder: ^Mesh_Builder) {
	for corner in ([4][2]f64{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}}) {
		vertex(builder, {corner[0], corner[1], 0, 0})
	}
	triangle(builder, 0, 1, 2)
	triangle(builder, 0, 2, 3)
}

// Segment strips and round joins form a union. The executor's per-path stencil
// prevents multiple alpha applications at joins, crossings and reversals.
path :: proc(builder: ^Mesh_Builder, object: ^presentation.Geometry_Source) -> presentation.Geometry_Range {
	first_index := builder.index_count
	for point, point_index in object.vertices {
		if !builder.valid {
			break
		}
		progress := object.path_distance > 0 ? clamp(object.cumulative[point_index] / object.path_distance, 0, 1) : 0
		centre_index := vertex(builder, {point[0], point[1], progress, 0})
		for edge_index in 0 ..= CAP_SEGMENTS {
			angle := f64(edge_index) * 2 * math.PI / CAP_SEGMENTS
			vertex(builder, {point[0] + math.cos(angle) * object.radius, point[1] + math.sin(angle) * object.radius, progress, 0})
			if edge_index > 0 {
				triangle(builder, centre_index, centre_index + u32(edge_index), centre_index + u32(edge_index) + 1)
			}
		}
		if point_index == 0 {
			continue
		}
		previous_point := object.vertices[point_index - 1]
		difference := point - previous_point
		length := math.sqrt(difference[0] * difference[0] + difference[1] * difference[1])
		if length <= 0 {
			continue
		}
		normal := [2]f64{-difference[1] / length * object.radius, difference[0] / length * object.radius}
		previous_progress := object.path_distance > 0 ? clamp(object.cumulative[point_index - 1] / object.path_distance, 0, 1) : 0
		base_vertex := u32(builder.vertex_count)
		vertex(builder, {previous_point[0] + normal[0], previous_point[1] + normal[1], previous_progress, 0})
		vertex(builder, {previous_point[0] - normal[0], previous_point[1] - normal[1], previous_progress, 0})
		vertex(builder, {point[0] - normal[0], point[1] - normal[1], progress, 0})
		vertex(builder, {point[0] + normal[0], point[1] + normal[1], progress, 0})
		triangle(builder, base_vertex, base_vertex + 1, base_vertex + 2)
		triangle(builder, base_vertex, base_vertex + 2, base_vertex + 3)
	}
	return {u32(first_index), u32(builder.index_count - first_index)}
}

// Copyright (c) ppy Pty Ltd. MIT; see reference/source-manifest.json.
package osu_prepare

import beatmap_decode "../beatmap_decode"
import "core:strings"
import "core:strconv"
import "core:math"

Path_Marker :: struct {
	kind: Path_Kind,
	degree: u32,
	start_index: int,
}

// Uses caller buffers; syntax has already passed the transactional M0 validator.
parse_path :: proc(
	raw: ^beatmap_decode.Raw_Object,
	version: u32,
	positions: []Position_F64,
	markers: []Path_Marker,
	controls: []Control_Point,
) -> (
	[]Control_Point,
	bool,
) {
	fields := beatmap_decode.Fields {
		remaining = raw.path,
	}
	point_count, marker_count := 0, 0
	for {
		token, _, exists := beatmap_decode.next_field(&fields, '|')
		if !exists {
			break
		}
		if len(token) == 0 {
			return nil, false
		}
		if strings.index_byte(token, ':') < 0 {
			if marker_count >= len(markers) {
				return nil, false
			}
			kind: Path_Kind
			switch token[0] {
			case 'B':
				kind = .Bezier
			case 'C':
				kind = .Catmull
			case 'L':
				kind = .Linear
			case 'P':
				kind = .Perfect
			case:
				return nil, false
			}
			degree: u32
			if len(token) > 1 {
				parsed, ok := beatmap_decode.parse_decimal(token[1:], 1, 2147483647)
				if !ok || parsed > i64(max(u32)) {
					return nil, false
				}
				degree = u32(parsed)
			}
			markers[marker_count] = {kind, degree, point_count}
			marker_count += 1
			if point_count == 0 {
				if len(positions) == 0 {
					return nil, false
				}
				positions[0] = {}
				point_count = 1
			}
		} else {
			if point_count >= len(positions) {
				return nil, false
			}
			split := strings.index_byte(token, ':')
			x, ok_x := strconv.parse_f32(strings.trim_space(token[:split]))
			y, ok_y := strconv.parse_f32(strings.trim_space(token[split + 1:]))
			if !ok_x || !ok_y {
				return nil, false
			}
			if version < 128 {
				x = f32(math.trunc(f64(x)))
				y = f32(math.trunc(f64(y)))
			}
			positions[point_count] = to64(Position_F32{x - f32(raw.x), y - f32(raw.y)})
			point_count += 1
		}
	}
	output_count := 0
	for marker, marker_index in markers[:marker_count] {
		end_index := point_count
		if marker_index + 1 < marker_count {
			end_index = markers[marker_index + 1].start_index
		}
		if end_index <= marker.start_index {
			return nil, false
		}
		segment := positions[marker.start_index:end_index]
		kind := marker.kind
		if kind == .Perfect {
			count := len(segment)
			if end_index < point_count {
				count += 1
			}
			if version < 128 {
				if count != 3 {
					kind = .Bezier
				} else {
					last := positions[min(end_index, point_count - 1)]
					first, middle, tail := to32(segment[0]), to32(segment[1]), to32(last)
					if abs(
						   (middle[1] - first[1]) * (tail[0] - first[0]) -
						   (middle[0] - first[0]) * (tail[1] - first[1]),
					   ) <=
					   f32(1e-3) {
						kind = .Linear
					}
				}
			} else if count > 3 {
				kind = .Bezier
			}
		}
		for position, point_index in segment {
			// Duplicate splitting preserves the previous point as the segment marker.
			if point_index > 0 &&
			   point_index < len(segment) - 1 &&
			   position == segment[point_index - 1] &&
			   !(kind == .Catmull && point_index > 1 && version < 128) {
				if output_count > 0 {
					controls[output_count - 1].kind = kind
					controls[output_count - 1].degree = marker.degree
				}
				continue
			}
			if output_count >= len(controls) {
				return nil, false
			}
			controls[output_count] = {position, point_index == 0 ? kind : .None, marker.degree}
			if point_index != 0 {
				controls[output_count].degree = 0
			}
			output_count += 1
		}
	}
	return controls[:output_count], true
}

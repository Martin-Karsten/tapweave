package render_webgl

import "core:math"

// Original Tapweave glyph font. Every glyph is a set of rounded-cap stroke
// polylines in glyph space (cell centre is the origin, y up, one unit is one
// atlas texel). fill_atlas rasterizes distance coverage with 2x2
// supersampling, so digits stay smooth under bilinear magnification instead
// of magnifying hard bitmap pixels.

GLYPH_CELL :: 32
GLYPH_MARGIN :: 2
STROKE_RADIUS :: 2.6
STROKE_EDGE :: 0.65

// Sub-texel offsets of the four coverage samples inside one texel.
GLYPH_SAMPLE_OFFSETS := [4][2]f64{{-0.25, -0.25}, {0.25, -0.25}, {-0.25, 0.25}, {0.25, 0.25}}

percent_top_circle := [25][2]f64{{-2.7, 8.0}, {-2.79, 8.65}, {-3.03, 9.25}, {-3.43, 9.77}, {-3.95, 10.17}, {-4.55, 10.41}, {-5.2, 10.5}, {-5.85, 10.41}, {-6.45, 10.17}, {-6.97, 9.77}, {-7.37, 9.25}, {-7.61, 8.65}, {-7.7, 8.0}, {-7.61, 7.35}, {-7.37, 6.75}, {-6.97, 6.23}, {-6.45, 5.83}, {-5.85, 5.59}, {-5.2, 5.5}, {-4.55, 5.59}, {-3.95, 5.83}, {-3.43, 6.23}, {-3.03, 6.75}, {-2.79, 7.35}, {-2.7, 8.0}}
percent_bottom_circle := [25][2]f64{{7.7, -8.0}, {7.61, -7.35}, {7.37, -6.75}, {6.97, -6.23}, {6.45, -5.83}, {5.85, -5.59}, {5.2, -5.5}, {4.55, -5.59}, {3.95, -5.83}, {3.43, -6.23}, {3.03, -6.75}, {2.79, -7.35}, {2.7, -8.0}, {2.79, -8.65}, {3.03, -9.25}, {3.43, -9.77}, {3.95, -10.17}, {4.55, -10.41}, {5.2, -10.5}, {5.85, -10.41}, {6.45, -10.17}, {6.97, -9.77}, {7.37, -9.25}, {7.61, -8.65}, {7.7, -8.0}}
percent_slash := [2][2]f64{{-6.2, -10.2}, {6.2, 10.2}}
plus_vertical := [2][2]f64{{0.0, -7.6}, {0.0, 7.6}}
plus_horizontal := [2][2]f64{{-6.0, 0.0}, {6.0, 0.0}}
period_dot := [2][2]f64{{0.0, -10.8}, {0.0, -10.7}}
digit_zero_outline := [25][2]f64{{5.1, 0.0}, {4.93, 2.69}, {4.42, 5.2}, {3.61, 7.35}, {2.55, 9.01}, {1.32, 10.05}, {0.0, 10.4}, {-1.32, 10.05}, {-2.55, 9.01}, {-3.61, 7.35}, {-4.42, 5.2}, {-4.93, 2.69}, {-5.1, 0.0}, {-4.93, -2.69}, {-4.42, -5.2}, {-3.61, -7.35}, {-2.55, -9.01}, {-1.32, -10.05}, {0.0, -10.4}, {1.32, -10.05}, {2.55, -9.01}, {3.61, -7.35}, {4.42, -5.2}, {4.93, -2.69}, {5.1, 0.0}}
digit_one_stem := [3][2]f64{{-4.6, 7.4}, {1.1, 10.4}, {1.1, -10.4}}
digit_two_body := [15][2]f64{{-5.4, 3.7}, {-5.22, 5.43}, {-4.68, 7.05}, {-3.82, 8.44}, {-2.7, 9.5}, {-1.4, 10.17}, {0.0, 10.4}, {1.4, 10.17}, {2.7, 9.5}, {3.82, 8.44}, {4.68, 7.05}, {5.22, 5.43}, {5.4, 3.7}, {-4.9, -10.4}, {5.5, -10.4}}
digit_three_body := [36][2]f64{{-4.53, 7.05}, {-3.86, 8.28}, {-2.95, 9.28}, {-1.85, 9.99}, {-0.64, 10.35}, {0.61, 10.36}, {1.83, 10.0}, {2.93, 9.3}, {3.85, 8.31}, {4.52, 7.08}, {4.91, 5.69}, {4.99, 4.24}, {4.76, 2.81}, {4.22, 1.5}, {3.42, 0.37}, {2.41, -0.48}, {1.24, -1.02}, {0.0, -1.2}, {0.0, 1.0}, {1.34, 0.82}, {2.6, 0.29}, {3.7, -0.55}, {4.56, -1.65}, {5.14, -2.94}, {5.39, -4.35}, {5.3, -5.78}, {4.88, -7.14}, {4.15, -8.34}, {3.17, -9.32}, {1.98, -10.0}, {0.66, -10.36}, {-0.69, -10.35}, {-2.0, -9.99}, {-3.19, -9.3}, {-4.17, -8.32}, {-4.89, -7.11}}
digit_four_diagonal := [3][2]f64{{-4.7, 9.7}, {-5.5, -1.8}, {6.4, -1.8}}
digit_four_stem := [2][2]f64{{3.4, 10.4}, {3.4, -10.4}}
digit_five_body := [20][2]f64{{5.4, 10.4}, {-4.5, 10.4}, {-4.4, 2.2}, {-1.2, 3.0}, {-2.74, 1.61}, {-1.62, 2.55}, {-0.36, 3.08}, {0.96, 3.18}, {2.26, 2.84}, {3.46, 2.08}, {4.46, 0.95}, {5.22, -0.48}, {5.67, -2.11}, {5.8, -3.84}, {5.58, -5.55}, {5.04, -7.14}, {4.21, -8.49}, {3.15, -9.53}, {1.92, -10.18}, {0.6, -10.4}}
digit_six_body := [25][2]f64{{2.8, 10.4}, {0.35, 9.6}, {-1.55, 8.38}, {-2.88, 6.76}, {-3.66, 4.73}, {-3.88, 2.29}, {-3.54, -0.56}, {-3.54, -0.56}, {-4.33, -1.6}, {-4.83, -2.81}, {-5.0, -4.1}, {-4.83, -5.39}, {-4.33, -6.6}, {-3.54, -7.64}, {-2.5, -8.43}, {-1.29, -8.93}, {0.0, -9.1}, {1.29, -8.93}, {2.5, -8.43}, {3.54, -7.64}, {4.33, -6.6}, {4.83, -5.39}, {5.0, -4.1}, {4.83, -2.81}, {4.33, -1.6}}
digit_seven_body := [3][2]f64{{-5.2, 10.4}, {5.4, 10.4}, {-2.4, -10.4}}
digit_eight_upper_loop := [25][2]f64{{4.4, 5.2}, {4.25, 6.55}, {3.81, 7.8}, {3.11, 8.88}, {2.2, 9.7}, {1.14, 10.22}, {0.0, 10.4}, {-1.14, 10.22}, {-2.2, 9.7}, {-3.11, 8.88}, {-3.81, 7.8}, {-4.25, 6.55}, {-4.4, 5.2}, {-4.25, 3.85}, {-3.81, 2.6}, {-3.11, 1.52}, {-2.2, 0.7}, {-1.14, 0.18}, {0.0, 0.0}, {1.14, 0.18}, {2.2, 0.7}, {3.11, 1.52}, {3.81, 2.6}, {4.25, 3.85}, {4.4, 5.2}}
digit_eight_lower_loop := [25][2]f64{{5.0, -5.2}, {4.83, -3.85}, {4.33, -2.6}, {3.54, -1.52}, {2.5, -0.7}, {1.29, -0.18}, {0.0, 0.0}, {-1.29, -0.18}, {-2.5, -0.7}, {-3.54, -1.52}, {-4.33, -2.6}, {-4.83, -3.85}, {-5.0, -5.2}, {-4.83, -6.55}, {-4.33, -7.8}, {-3.54, -8.88}, {-2.5, -9.7}, {-1.29, -10.22}, {0.0, -10.4}, {1.29, -10.22}, {2.5, -9.7}, {3.54, -8.88}, {4.33, -7.8}, {4.83, -6.55}, {5.0, -5.2}}
digit_nine_body := [25][2]f64{{-2.8, -10.4}, {-0.35, -9.6}, {1.55, -8.38}, {2.89, -6.76}, {3.66, -4.73}, {3.88, -2.29}, {3.54, 0.56}, {3.54, 0.56}, {4.33, 1.6}, {4.83, 2.81}, {5.0, 4.1}, {4.83, 5.39}, {4.33, 6.6}, {3.54, 7.64}, {2.5, 8.43}, {1.29, 8.93}, {0.0, 9.1}, {-1.29, 8.93}, {-2.5, 8.43}, {-3.54, 7.64}, {-4.33, 6.6}, {-4.83, 5.39}, {-5.0, 4.1}, {-4.83, 2.81}, {-4.33, 1.6}}
repeat_arrow_head := [3][2]f64{{-4.6, 9.2}, {4.2, 0.0}, {-4.6, -9.2}}
miss_cross_first := [2][2]f64{{-5.8, -10.0}, {5.8, 10.0}}
miss_cross_second := [2][2]f64{{5.8, -10.0}, {-5.8, 10.0}}

// Build borrowed stroke slices at call time; no global slice initializers.
glyph_strokes :: proc(glyph: u32) -> [3][][2]f64 {
	switch glyph {
	case 37:
		return {percent_top_circle[:], percent_bottom_circle[:], percent_slash[:]}
	case 43:
		return {plus_vertical[:], plus_horizontal[:], nil}
	case 46:
		return {period_dot[:], nil, nil}
	case 48:
		return {digit_zero_outline[:], nil, nil}
	case 49:
		return {digit_one_stem[:], nil, nil}
	case 50:
		return {digit_two_body[:], nil, nil}
	case 51:
		return {digit_three_body[:], nil, nil}
	case 52:
		return {digit_four_diagonal[:], digit_four_stem[:], nil}
	case 53:
		return {digit_five_body[:], nil, nil}
	case 54:
		return {digit_six_body[:], nil, nil}
	case 55:
		return {digit_seven_body[:], nil, nil}
	case 56:
		return {digit_eight_upper_loop[:], digit_eight_lower_loop[:], nil}
	case 57:
		return {digit_nine_body[:], nil, nil}
	case 62:
		return {repeat_arrow_head[:], nil, nil}
	case 88:
		return {miss_cross_first[:], miss_cross_second[:], nil}
	}
	return {}
}

segment_distance :: proc(point_x, point_y, start_x, start_y, end_x, end_y: f64) -> f64 {
	segment_x := end_x - start_x
	segment_y := end_y - start_y
	length_squared := segment_x * segment_x + segment_y * segment_y
	projection := f64(0)
	if length_squared > 0 {
		projection = ((point_x - start_x) * segment_x + (point_y - start_y) * segment_y) / length_squared
		projection = clamp(projection, 0, 1)
	}
	nearest_x := start_x + projection * segment_x
	nearest_y := start_y + projection * segment_y
	difference_x := point_x - nearest_x
	difference_y := point_y - nearest_y
	return math.sqrt(difference_x * difference_x + difference_y * difference_y)
}

stroke_distance :: proc(stroke: [][2]f64, glyph_x, glyph_y: f64) -> f64 {
	closest := max(f64)
	for point_index in 0 ..< len(stroke) - 1 {
		start := stroke[point_index]
		end := stroke[point_index + 1]
		distance := segment_distance(glyph_x, glyph_y, start[0], start[1], end[0], end[1])
		closest = min(closest, distance)
	}
	return closest
}

glyph_coverage :: proc(strokes: [3][][2]f64, glyph_x, glyph_y: f64) -> f64 {
	closest := max(f64)
	for stroke in strokes {
		closest = min(closest, stroke_distance(stroke, glyph_x, glyph_y))
	}
	return clamp((STROKE_RADIUS + STROKE_EDGE * 0.5 - closest) / STROKE_EDGE, 0, 1)
}

// Rasterizes every cell completely, including blank cells, so no stale
// attachment bytes can ever reach the sampler.
fill_atlas :: proc(bytes: []byte) {
	for glyph in 0 ..< 128 {
		strokes := glyph_strokes(u32(glyph))
		// Centre digit ink bounds inside its cell (not the asymmetric pen path).
		centre_x, centre_y := f64(0), f64(0)
		if glyph >= 48 && glyph <= 57 {
			minimum_x, minimum_y := max(f64), max(f64)
			maximum_x, maximum_y := -max(f64), -max(f64)
			for stroke in strokes {
				for point in stroke {
					minimum_x = min(minimum_x, point[0])
					maximum_x = max(maximum_x, point[0])
					minimum_y = min(minimum_y, point[1])
					maximum_y = max(maximum_y, point[1])
				}
			}
			centre_x = (minimum_x + maximum_x) / 2
			centre_y = (minimum_y + maximum_y) / 2
		}
		cell_origin_x := glyph % 16 * GLYPH_CELL
		cell_origin_y := glyph / 16 * GLYPH_CELL
		for pixel_y in 0 ..< GLYPH_CELL {
			for pixel_x in 0 ..< GLYPH_CELL {
				coverage := f64(0)
				if len(strokes[0]) > 0 {
					for sample_offset in GLYPH_SAMPLE_OFFSETS {
						glyph_x := f64(pixel_x) + 0.5 + sample_offset[0] - GLYPH_CELL / 2
						glyph_y := GLYPH_CELL / 2 - (f64(pixel_y) + 0.5 + sample_offset[1])
						coverage += glyph_coverage(strokes, glyph_x + centre_x, glyph_y + centre_y)
					}
					coverage /= len(GLYPH_SAMPLE_OFFSETS)
				}
				pixel_offset := ((cell_origin_y + pixel_y) * ATLAS_WIDTH + cell_origin_x + pixel_x) * 4
				bytes[pixel_offset + 0] = 255
				bytes[pixel_offset + 1] = 255
				bytes[pixel_offset + 2] = 255
				bytes[pixel_offset + 3] = u8(clamp(coverage * 255 + 0.5, 0, 255))
			}
		}
	}
}

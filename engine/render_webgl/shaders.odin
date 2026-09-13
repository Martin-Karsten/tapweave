package render_webgl

// Original Tapweave graphics. Instance attributes are packed by the executor;
// all primitive, colour, transform, glyph and clipping policy comes from Odin.
VERTEX_SHADER :: `#version 300 es
precision highp float;
layout(location=0) in vec4 vertex_data;
layout(location=1) in vec4 placement;
layout(location=2) in vec4 appearance;
layout(location=3) in vec4 tint;
layout(location=4) in vec4 detail;
uniform vec4 viewport_transform;
out vec2 local_position;
out float path_progress;
flat out vec4 parameters;
flat out vec4 instance_detail;
flat out vec4 instance_colour;
void main() {
  float sine = sin(appearance.x), cosine = cos(appearance.x);
  vec2 point = vertex_data.xy * placement.zw;
  point = mat2(cosine, sine, -sine, cosine) * point + placement.xy;
  gl_Position = vec4(point * viewport_transform.xy + viewport_transform.zw, 0., 1.);
  local_position = vertex_data.xy;
  path_progress = vertex_data.z;
  parameters = appearance;
  instance_detail = detail;
  instance_colour = tint;
}
`
FRAGMENT_SHADER :: `#version 300 es
precision highp float;
in vec2 local_position;
in float path_progress;
flat in vec4 parameters;
flat in vec4 instance_detail;
flat in vec4 instance_colour;
uniform sampler2D glyph_atlas;
out vec4 output_colour;
void main() {
  int primitive = int(parameters.z + .5);
  float coverage = 1.;
  if (primitive == 1 || primitive == 2) {
    float distance_from_centre = length(local_position);
    float feather = max(fwidth(distance_from_centre), .002);
    coverage = 1. - smoothstep(1. - feather, 1., distance_from_centre);
    if (primitive == 2) {
      coverage *= smoothstep(.84 - feather, .84, distance_from_centre);
      if (parameters.w > 0. && parameters.w < 1.) {
        float angle = mod(atan(local_position.y, local_position.x) + 1.570796327 + 6.283185307, 6.283185307) / 6.283185307;
        if (angle > parameters.w) discard;
      }
    }
  } else if (primitive == 3) {
    float glyph = instance_detail.z;
    vec2 cell = vec2(mod(glyph, 16.), floor(glyph / 16.));
    vec2 uv = (cell * 8. + (local_position * .5 + .5) * 7. + .5) / vec2(128., 64.);
    coverage = texture(glyph_atlas, uv).a;
  } else if (primitive == 4) {
    if (path_progress < instance_detail.x || path_progress > instance_detail.y) discard;
  }
  float alpha = instance_colour.a * parameters.y * coverage;
  if (alpha <= 0.) discard;
  output_colour = vec4(instance_colour.rgb * alpha, alpha);
}
`

ATLAS_WIDTH :: 128
ATLAS_HEIGHT :: 64
// Original hand-authored 5x7 bitmaps, embedded in fixed ASCII cells.
glyph_row :: proc(glyph, row: int) -> u8 {
	digits := [10][7]u8{
		{14, 17, 19, 21, 25, 17, 14}, {4, 12, 4, 4, 4, 4, 14},
		{14, 17, 1, 2, 4, 8, 31}, {30, 1, 1, 14, 1, 1, 30},
		{2, 6, 10, 18, 31, 2, 2}, {31, 16, 16, 30, 1, 1, 30},
		{14, 16, 16, 30, 17, 17, 14}, {31, 1, 2, 4, 8, 8, 8},
		{14, 17, 17, 14, 17, 17, 14}, {14, 17, 17, 15, 1, 1, 14},
	}
	if glyph >= 48 && glyph <= 57 {
		return digits[glyph - 48][row]
	}
	switch glyph {
	case 37:
		rows := [7]u8{17, 2, 4, 4, 8, 16, 17}
		return rows[row]
	case 46:
		return row == 6 ? 4 : 0
	case 62:
		rows := [7]u8{4, 2, 1, 31, 1, 2, 4}
		return rows[row]
	case 88:
		rows := [7]u8{17, 17, 10, 4, 10, 17, 17}
		return rows[row]
	case 43:
		rows := [7]u8{0, 4, 4, 31, 4, 4, 0}
		return rows[row]
	}
	return 0
}

fill_atlas :: proc(bytes: []byte) {
	for glyph in 0 ..< 128 {
		for row in 0 ..< 7 {
			bits := glyph_row(glyph, row)
			for column in 0 ..< 5 {
				if bits & (u8(1) << u8(4 - column)) == 0 {
					continue
				}
				pixel_offset := ((glyph / 16 * 8 + row) * ATLAS_WIDTH + glyph % 16 * 8 + column + 1) * 4
				for channel in 0 ..< 4 {
					bytes[pixel_offset + channel] = 255
				}
			}
		}
	}
}

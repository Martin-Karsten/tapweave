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
  vec3 draw_rgb = instance_colour.rgb;
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
    } else {
      float gloss = 1. - smoothstep(0., 1.05, length(local_position - vec2(-.35, .35)));
      draw_rgb = mix(draw_rgb, vec3(1.), gloss * .2);
    }
  } else if (primitive == 3) {
    float glyph = instance_detail.z;
    vec2 cell = vec2(mod(glyph, 16.), floor(glyph / 16.));
    vec2 inner = (local_position * .5 + .5) * 28. + 2.;
    vec2 uv = (cell * 32. + inner) / vec2(512., 256.);
    vec2 texel = .65 / vec2(512., 256.);
    float ink = texture(glyph_atlas, uv).a;
    float ink_edge = max(fwidth(ink) * .65, 1. / 255.);
    float fill = smoothstep(.5 - ink_edge, .5 + ink_edge, ink);
    float outline = max(
      max(texture(glyph_atlas, uv + vec2(texel.x, 0.)).a, texture(glyph_atlas, uv - vec2(texel.x, 0.)).a),
      max(texture(glyph_atlas, uv + vec2(0., texel.y)).a, texture(glyph_atlas, uv - vec2(0., texel.y)).a));
    float outline_edge = max(fwidth(outline) * .65, 1. / 255.);
    outline = smoothstep(.5 - outline_edge, .5 + outline_edge, outline);
    float shape = max(fill, outline);
    draw_rgb = mix(vec3(.08, .10, .13), instance_colour.rgb, min(fill / max(shape, .001), 1.));
    coverage = shape;
  } else if (primitive == 4) {
    if (path_progress < instance_detail.x || path_progress > instance_detail.y) discard;
  } else if (primitive == 6) {
    float angle = atan(local_position.y, local_position.x) + 1.570796327;
    float sector_offset = mod(angle, 1.256637061) - .628318531;
    float boundary_radius = mix(1., .45, abs(sector_offset) / .628318531);
    float dist_from_centre = length(local_position);
    float feather = max(fwidth(dist_from_centre) * 1.5, .01);
    coverage = 1. - smoothstep(boundary_radius - feather, boundary_radius, dist_from_centre);
  }
  float alpha = instance_colour.a * parameters.y * coverage;
  if (alpha <= 0.) discard;
  output_colour = vec4(draw_rgb * alpha, alpha);
}
`

ATLAS_WIDTH :: 512
ATLAS_HEIGHT :: 256

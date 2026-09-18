package presentation

import core_types "../core_types"

PLAYFIELD_WIDTH :: 512.0
PLAYFIELD_HEIGHT :: 384.0

Viewport :: struct {
	css_left, css_top: f64,
	css_width, css_height: f64,
	device_pixel_ratio: f64,
}

Playfield_Transform :: struct {
	scale: f64,
	client_left, client_top: f64,
	// Affine coefficients in browser DOMMatrix order; DPR is intentionally absent.
	inverse: [6]f64,
}

// Build before publishing a resize. Failure leaves the caller's old transform valid.
make_playfield_transform :: proc(viewport: Viewport) -> (Playfield_Transform, bool) {
	if !core_types.finite(viewport.css_left) || !core_types.finite(viewport.css_top) ||
	   !core_types.finite(viewport.css_width) || !core_types.finite(viewport.css_height) ||
	   !core_types.finite(viewport.device_pixel_ratio) || viewport.css_width <= 0 ||
	   viewport.css_height <= 0 || viewport.device_pixel_ratio <= 0 {
		return {}, false
	}
	scale := min(viewport.css_width / PLAYFIELD_WIDTH, viewport.css_height / PLAYFIELD_HEIGHT)
	client_left := viewport.css_left + (viewport.css_width - PLAYFIELD_WIDTH * scale) / 2
	client_top := viewport.css_top + (viewport.css_height - PLAYFIELD_HEIGHT * scale) / 2
	inverse_scale := 1 / scale
	inverse_left := -client_left * inverse_scale
	inverse_top := -client_top * inverse_scale
	if !core_types.finite(scale) || scale <= 0 || !core_types.finite(inverse_scale) ||
	   !core_types.finite(client_left) || !core_types.finite(client_top) ||
	   !core_types.finite(inverse_left) || !core_types.finite(inverse_top) {
		return {}, false
	}
	return {
		scale = scale,
		client_left = client_left,
		client_top = client_top,
		inverse = {inverse_scale, 0, 0, inverse_scale, inverse_left, inverse_top},
	}, true
}

	to_client :: proc(transform: Playfield_Transform, x, y: f64) -> (f64, f64) {
	return transform.client_left + x * transform.scale, transform.client_top + y * transform.scale
}

to_playfield :: proc(transform: Playfield_Transform, client_x, client_y: f64) -> (f64, f64) {
	return client_x * transform.inverse[0] + transform.inverse[4],
	       client_y * transform.inverse[3] + transform.inverse[5]
}

// Pinned lazer playfield framing (osu 3c1c96f742e7aae2ff67a7361e058fe91ca3b955).
// OsuPlayfieldAdjustmentContainer centres itself in the parent, takes
// Size = 0.8 relative, fits a 4:3 child (FillMode.Fit, FillAspectRatio 4/3)
// and scales content by ChildSize.X / OsuPlayfield.BASE_SIZE.X (512). Composed
// over a parent of width W and height H, the playfield scale in CSS pixels is
// 0.8 * min(W / 512, H / 384); at the upstream 1024x768 game size this
// reproduces the source comment's osu-stable "magic ratio" 1.6 exactly. The
// scale is independent of map contents. OsuPlayfield overrides
// UpdateSubTreeMasking to false ("everything is always on screen"), so content
// may draw beyond the logical 512x384 rectangle unclipped. The
// AlignWithStoryboard downward shift is an upstream positional adjustment this
// framing intentionally does not implement; storyboards are out of scope.
PLAYFIELD_SIZE_ADJUST :: 0.8

// Session gameplay framing: the sessionless fit composed with the pinned 0.8
// playfield size adjustment, centred in the viewport. One uniform scale maps
// object positions, sizes and distances; forward and inverse coefficients
// derive from the same calculation.
make_adjusted_playfield_transform :: proc(viewport: Viewport) -> (Playfield_Transform, bool) {
	if !core_types.finite(viewport.css_left) || !core_types.finite(viewport.css_top) ||
	   !core_types.finite(viewport.css_width) || !core_types.finite(viewport.css_height) ||
	   !core_types.finite(viewport.device_pixel_ratio) || viewport.css_width <= 0 ||
	   viewport.css_height <= 0 || viewport.device_pixel_ratio <= 0 {
		return {}, false
	}
	scale := PLAYFIELD_SIZE_ADJUST * min(viewport.css_width / PLAYFIELD_WIDTH, viewport.css_height / PLAYFIELD_HEIGHT)
	client_left := viewport.css_left + (viewport.css_width - PLAYFIELD_WIDTH * scale) / 2
	client_top := viewport.css_top + (viewport.css_height - PLAYFIELD_HEIGHT * scale) / 2
	inverse_scale := 1 / scale
	inverse_left := -client_left * inverse_scale
	inverse_top := -client_top * inverse_scale
	if !core_types.finite(scale) || scale <= 0 || !core_types.finite(inverse_scale) ||
	   !core_types.finite(client_left) || !core_types.finite(client_top) ||
	   !core_types.finite(inverse_left) || !core_types.finite(inverse_top) {
		return {}, false
	}
	return {
		scale = scale,
		client_left = client_left,
		client_top = client_top,
		inverse = {inverse_scale, 0, 0, inverse_scale, inverse_left, inverse_top},
	}, true
}

// HUD scale: viewport-based, independent of map contents. Shrinks uniformly on
// narrow windows; matches the resume-gate's viewport convention.
hud_scale :: proc(viewport: Viewport) -> f64 {
	return min(viewport.css_width / 1024.0, viewport.css_height / 768.0)
}

// Final GPU NDC uniforms for the scene shader: playfield x/y map to
// [-1,1] over the CSS viewport. Each component is rounded through f32 exactly
// once, at the end, matching the browser executor contract that previously
// computed these from Math.fround of the same operands in this order.
Viewport_Uniforms :: struct {
	scale_x, scale_y, shift_x, shift_y: f64,
}

make_viewport_uniforms :: proc(transform: Playfield_Transform, viewport: Viewport) -> (Viewport_Uniforms, bool) {
	uniforms := Viewport_Uniforms{
		scale_x = f64(f32((2.0 * transform.scale) / viewport.css_width)),
		scale_y = f64(f32((-2.0 * transform.scale) / viewport.css_height)),
		shift_x = f64(f32((2.0 * (transform.client_left - viewport.css_left)) / viewport.css_width - 1.0)),
		shift_y = f64(f32(1.0 - (2.0 * (transform.client_top - viewport.css_top)) / viewport.css_height)),
	}
	if !core_types.finite(uniforms.scale_x) || !core_types.finite(uniforms.scale_y) ||
	   !core_types.finite(uniforms.shift_x) || !core_types.finite(uniforms.shift_y) {
		return {}, false
	}
	return uniforms, true
}

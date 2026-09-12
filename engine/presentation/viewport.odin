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

to_client :: proc(transform: ^Playfield_Transform, x, y: f64) -> (f64, f64) {
	return transform.client_left + x * transform.scale, transform.client_top + y * transform.scale
}

to_playfield :: proc(transform: ^Playfield_Transform, client_x, client_y: f64) -> (f64, f64) {
	return client_x * transform.inverse[0] + transform.inverse[4],
	       client_y * transform.inverse[3] + transform.inverse[5]
}

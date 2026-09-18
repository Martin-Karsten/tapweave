// Complete-map visual fitting. Original Tapweave presentation policy: the map
// is fitted so every supported object stays visible, instead of clipping to the
// 512x384 rectangle. This is an explicit divergence from lazer, which crops
// oversized content to the playfield; no upstream acceptance is implied.
package presentation

import "core:math"
import core_types "../core_types"
import prepared "../prepared"

// Minimum and maximum visible map coordinates. Stored with the immutable scene
// attachment and shared by every session of the same map.
Visual_Bounds :: struct {
	min_x, min_y, max_x, max_y: f64,
}

// The normal playfield rectangle every fit starts from.
NORMAL_BOUNDS :: Visual_Bounds{min_x = 0, min_y = 0, max_x = PLAYFIELD_WIDTH, max_y = PLAYFIELD_HEIGHT}

// Shared presentation constants so bounds and drawing cannot drift apart.
// Circle approach rings start at 4x radius (draw.circle) and hit animations
// expand to 1.5x; the slider follow ring reaches 2.4x radius (scene.slider).
APPROACH_MAX_SCALE :: 4.0
HIT_GROWTH_MAX_SCALE :: 1.5
TRACKING_RING_SCALE :: 2.4
// Follow point discs reach 3 * scale * 1.5 at their largest reveal size.
FOLLOW_POINT_MAX_RADIUS_FACTOR :: 4.5
// Judgement feedback glyphs: hit numbers run up to three digits of size 8 to
// the right of their anchor; miss crosses span 12 in every direction.
FEEDBACK_NUMBER_RIGHT_EXTENT :: 24.0
FEEDBACK_GLYPH_EXTENT :: 12.0
// f32 rounding of mesh vertices and projection coefficients can exceed exact
// mathematical extents by a small epsilon.
NUMERIC_MARGIN :: 1.0

// Spinner discs and the rotating arrow glyph; numbers stay inside the normal
// rectangle at the renderer's full u64 formatting width (20 digits of size 12).
SPINNER_DISC_RADIUS :: 140.0
SPINNER_GLYPH_SCALE :: 70.0
// Conservatively bounded rotated-quad half-diagonal factor (sqrt 2).
ROTATED_QUAD_DIAGONAL_FACTOR :: 1.4142135623730951

// u64 formatting limit of presentation.number.
MAX_NUMBER_DIGITS :: 20

// Bounds outside this magnitude would lose sub-unit precision through the f32
// GPU conversion; fitting them is refused instead of rendering clipped output.
MAX_BOUND_COORDINATE :: 1.0e7

// Conservative decimal digit count for the renderer's u64 number formatting.
digit_count :: proc(value: u64) -> int {
	count := 1
	remaining := value / 10
	for remaining > 0 {
		count += 1
		remaining /= 10
	}
	return count
}

expand :: proc(bounds: ^Visual_Bounds, x, y, left, top, right, bottom: f64) {
	bounds.min_x = min(bounds.min_x, x - left)
	bounds.min_y = min(bounds.min_y, y - top)
	bounds.max_x = max(bounds.max_x, x + right)
	bounds.max_y = max(bounds.max_y, y + bottom)
}

// Maximum extent of one circle's number glyphs to the right of the anchor:
// the digits start one quarter radius left and advance half a radius each.
circle_number_right_extent :: proc(object: ^prepared.Object) -> f64 {
	displayed_number := u64(max(0, object.index_in_combo) + 1)
	digits := digit_count(displayed_number)
	return object.radius / 4 + f64(digits) * object.radius / 2
}

// Extents of the animated circle head shared by circles and slider heads.
circle_extents :: proc(object: ^prepared.Object, left, top, right, bottom: ^f64) {
	number_right := circle_number_right_extent(object)
	left^ = max(left^, object.radius * APPROACH_MAX_SCALE + NUMERIC_MARGIN, FEEDBACK_GLYPH_EXTENT)
	top^ = max(top^, object.radius * APPROACH_MAX_SCALE + NUMERIC_MARGIN, FEEDBACK_GLYPH_EXTENT)
	bottom^ = max(bottom^, object.radius * APPROACH_MAX_SCALE + NUMERIC_MARGIN, FEEDBACK_GLYPH_EXTENT)
	right^ = max(right^, object.radius * APPROACH_MAX_SCALE + NUMERIC_MARGIN,
		object.radius * HIT_GROWTH_MAX_SCALE, number_right, FEEDBACK_NUMBER_RIGHT_EXTENT)
}

// Complete visual extent of every supported object, starting from the normal
// rectangle. Uses final stacked positions and prepared path vertices, never raw
// control points; all possible supported outcomes are covered without
// simulating a run. Excludes the background, HUD, cursor and cursor trail.
compute_visual_bounds :: proc(objects: []prepared.Object) -> (Visual_Bounds, bool) {
	bounds := NORMAL_BOUNDS
	for &object in objects {
		if !core_types.finite(object.position[0]) || !core_types.finite(object.position[1]) ||
		   !core_types.finite(object.stack_offset[0]) || !core_types.finite(object.stack_offset[1]) ||
		   !core_types.finite(object.radius) || object.radius < 0 ||
		   !core_types.finite(object.scale) || object.scale < 0 {
			return {}, false
		}
		stacked := object.position + object.stack_offset
		// Circles and slider heads: stacked position plus circle, approach and
		// hit-animation extents, and the head's full number width.
		head_left, head_top, head_right, head_bottom: f64
		circle_extents(&object, &head_left, &head_top, &head_right, &head_bottom)
		expand(&bounds, stacked[0], stacked[1], head_left, head_top, head_right, head_bottom)
		if object.kind == .SLIDER {
			// Slider bodies, caps and joins: the prepared polyline expanded by
			// the rendered half-thickness; the tracking follow ring reaches
			// 2.4x radius along the path.
			body_extent := object.radius * TRACKING_RING_SCALE + NUMERIC_MARGIN
			if len(object.vertices) == 0 {
				expand(&bounds, stacked[0], stacked[1], body_extent, body_extent, body_extent, body_extent)
			}
			for vertex in object.vertices {
				if !core_types.finite(vertex[0]) || !core_types.finite(vertex[1]) {
					return {}, false
				}
				// Path vertices are relative to the stacked object position,
				// matching path_position and the PATH instance placement.
				point := stacked + vertex
				expand(&bounds, point[0], point[1], body_extent, body_extent, body_extent, body_extent)
			}
			// Feedback at tick, repeat and tail positions: those positions lie
			// on the rendered path, so the feedback glyph run around them stays
			// inside the body extent once it exceeds the glyph width.
			if object.radius * TRACKING_RING_SCALE + NUMERIC_MARGIN >= FEEDBACK_NUMBER_RIGHT_EXTENT {
				continue
			}
			for &component in object.components {
				if !core_types.finite(component.position[0]) || !core_types.finite(component.position[1]) {
					return {}, false
				}
				component_position := component.position + object.stack_offset
				expand(&bounds, component_position[0], component_position[1],
					FEEDBACK_GLYPH_EXTENT, FEEDBACK_GLYPH_EXTENT, FEEDBACK_NUMBER_RIGHT_EXTENT, FEEDBACK_GLYPH_EXTENT)
			}
		}
	}
	// Follow points between consecutive non-spinner objects.
	for object_index in 1 ..< len(objects) {
		previous, object := &objects[object_index - 1], &objects[object_index]
		if previous.kind == .SPINNER || object.kind == .SPINNER || object.new_combo {
			continue
		}
		start := previous.end_position + previous.stack_offset
		finish := object.position + object.stack_offset
		follow_radius := FOLLOW_POINT_MAX_RADIUS_FACTOR * object.scale + NUMERIC_MARGIN
		expand(&bounds, start[0], start[1], follow_radius, follow_radius, follow_radius, follow_radius)
		expand(&bounds, finish[0], finish[1], follow_radius, follow_radius, follow_radius, follow_radius)
	}
	// Spinners render at the fixed playfield centre; the rotated arrow glyph is
	// bounded by its rotated half-diagonal.
	spinner_extent := max(SPINNER_DISC_RADIUS, SPINNER_GLYPH_SCALE * ROTATED_QUAD_DIAGONAL_FACTOR) + NUMERIC_MARGIN
	for &object in objects {
		if object.kind != .SPINNER {
			continue
		}
		expand(&bounds, 256, 192, spinner_extent, spinner_extent, spinner_extent, spinner_extent)
	}
	if !validate_visual_bounds(bounds) {
		return {}, false
	}
	return bounds, true
}

validate_visual_bounds :: proc(bounds: Visual_Bounds) -> bool {
	if !core_types.finite(bounds.min_x) || !core_types.finite(bounds.min_y) ||
	   !core_types.finite(bounds.max_x) || !core_types.finite(bounds.max_y) {
		return false
	}
	if bounds.min_x > bounds.max_x || bounds.min_y > bounds.max_y {
		return false
	}
	if abs(bounds.min_x) > MAX_BOUND_COORDINATE || abs(bounds.max_x) > MAX_BOUND_COORDINATE ||
	   abs(bounds.min_y) > MAX_BOUND_COORDINATE || abs(bounds.max_y) > MAX_BOUND_COORDINATE {
		return false
	}
	return true
}

// CSS pixels reserved around the fitted map; reduced proportionally when the
// surface is too small for a full margin.
FIT_MARGIN_CSS :: 8.0
FIT_MARGIN_MINIMUM_FACTOR :: 0.05

// Fit the complete visual bounds into the viewport: one uniform scale, bounds
// centred in the margin-inset rectangle, shared by the forward origin and the
// inverse coefficients. The map bounds stay constant for the whole attempt.
make_bounds_transform :: proc(viewport: Viewport, bounds: Visual_Bounds) -> (Playfield_Transform, bool) {
	if !validate_visual_bounds(bounds) {
		return {}, false
	}
	bounds_width := bounds.max_x - bounds.min_x
	bounds_height := bounds.max_y - bounds.min_y
	margin := min(FIT_MARGIN_CSS, FIT_MARGIN_MINIMUM_FACTOR * min(viewport.css_width, viewport.css_height))
	available_width := viewport.css_width - 2 * margin
	available_height := viewport.css_height - 2 * margin
	if available_width <= 0 || available_height <= 0 || bounds_width <= 0 || bounds_height <= 0 {
		return {}, false
	}
	scale := min(available_width / bounds_width, available_height / bounds_height)
	// The transform keeps absolute map coordinates: client_left is the client
	// position of map x=0, so the bounds' left edge lands on the margin-inset,
	// centred rectangle offset by min_x * scale.
	client_left := viewport.css_left + margin + (available_width - bounds_width * scale) / 2 - bounds.min_x * scale
	client_top := viewport.css_top + margin + (available_height - bounds_height * scale) / 2 - bounds.min_y * scale
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

// HUD scale: viewport-based, independent of map bounds, shrinking uniformly on
// narrow windows. Matches the resume-gate's viewport convention.
hud_scale :: proc(viewport: Viewport) -> f64 {
	return min(viewport.css_width / 1024.0, viewport.css_height / 768.0)
}

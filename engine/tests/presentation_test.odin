package tests

import "core:testing"
import "core:math"
import presentation "../presentation"

@(test)
presentation_transform_round_trips_and_ignores_dpr :: proc(test: ^testing.T) {
	viewports := []presentation.Viewport{
		{0, 0, 512, 384, 1},
		{13.5, 29.25, 1920, 1080, 2},
		{-15, 10, 390, 844, 3},
		{0, 0, 10000, 1, 1.25},
	}
	for viewport in viewports {
		transform, valid := presentation.make_playfield_transform(viewport)
		testing.expect(test, valid)
		points := [][2]f64{{0, 0}, {256, 192}, {512, 384}, {-100, 500}, {12.125, -9.25}}
		for point in points {
			client_x, client_y := presentation.to_client(&transform, point[0], point[1])
			actual_x, actual_y := presentation.to_playfield(&transform, client_x, client_y)
			testing.expect(test, abs(actual_x - point[0]) <= 1e-6)
			testing.expect(test, abs(actual_y - point[1]) <= 1e-6)
		}
		retina_viewport := viewport
		retina_viewport.device_pixel_ratio *= 2
		retina_transform, retina_valid := presentation.make_playfield_transform(retina_viewport)
		testing.expect(test, retina_valid)
		testing.expect_value(test, transform, retina_transform)
	}
}

@(test)
presentation_transform_rejects_invalid_viewports :: proc(test: ^testing.T) {
	viewports := []presentation.Viewport{
		{0, 0, 0, 384, 1},
		{0, 0, 512, -1, 1},
		{0, 0, 512, 384, 0},
		{math.inf_f64(1), 0, 512, 384, 1},
		{0, 0, math.nan_f64(), 384, 1},
	}
	for viewport in viewports {
		_, valid := presentation.make_playfield_transform(viewport)
		testing.expect(test, !valid)
	}
}

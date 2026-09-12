package presentation_trace

import presentation "../presentation"

CASE_COUNT :: 4
VALUE_COUNT :: 9

// Shared test fixture values. These are local contract cases, not an upstream oracle.
case_values :: proc(case_index: u32) -> [VALUE_COUNT]f64 {
	viewports := [CASE_COUNT]presentation.Viewport{
		{0, 0, 512, 384, 1},
		{13.5, 29.25, 1920, 1080, 2},
		{-15, 10, 390, 844, 3},
		{0, 0, 10000, 1, 1.25},
	}
	if case_index >= CASE_COUNT {
		return {}
	}
	transform, valid := presentation.make_playfield_transform(viewports[case_index])
	if !valid {
		return {}
	}
	return {transform.scale, transform.client_left, transform.client_top,
		transform.inverse[0], transform.inverse[1], transform.inverse[2],
		transform.inverse[3], transform.inverse[4], transform.inverse[5]}
}

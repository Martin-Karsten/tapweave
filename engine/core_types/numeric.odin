// Portions ported from pinned osu! IBeatmapDifficultyInfo.DifficultyRange.
// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See engine/reference/sources/osu__LICENCE and THIRD_PARTY_NOTICES.md.
package core_types

// Keep the pinned arithmetic order: division happens before multiplication.
difficulty_range :: proc(difficulty, minimum, middle, maximum: f64) -> f64 {
	if difficulty > 5 {
		return middle + (maximum - middle) * ((difficulty - 5) / 5)
	}
	if difficulty < 5 {
		return middle + (middle - minimum) * ((difficulty - 5) / 5)
	}
	return middle
}

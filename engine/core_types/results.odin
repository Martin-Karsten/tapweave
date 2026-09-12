// Portions ported from pinned osu! sources.
// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See engine/reference/sources/osu__LICENCE and THIRD_PARTY_NOTICES.md.
package core_types

// Stable result identifiers follow the pinned HitResult enum. Legacy value 99
// is deliberately not a gameplay result. No production ABI capability yet.
Hit_Result :: enum u16 {
	NONE            = 0,
	MISS            = 1,
	MEH             = 2,
	OK              = 3,
	GOOD            = 4,
	GREAT           = 5,
	PERFECT         = 6,
	SMALL_TICK_MISS = 7,
	SMALL_TICK_HIT  = 8,
	LARGE_TICK_MISS = 9,
	LARGE_TICK_HIT  = 10,
	SMALL_BONUS     = 11,
	LARGE_BONUS     = 12,
	IGNORE_MISS     = 13,
	IGNORE_HIT      = 14,
	COMBO_BREAK     = 15,
	SLIDER_TAIL_HIT = 16,
}

Result_Properties :: struct {
	base_score: u32,
	hit, miss, scorable, accuracy, increases_combo, breaks_combo, tick, bonus: bool,
}

RESULT_PROPERTIES :: [Hit_Result]Result_Properties {
	.NONE = {},
	.MISS = {miss = true, scorable = true, accuracy = true, breaks_combo = true},
	.MEH = {base_score = 50, hit = true, scorable = true, accuracy = true, increases_combo = true},
	.OK = {base_score = 100, hit = true, scorable = true, accuracy = true, increases_combo = true},
	.GOOD = {base_score = 200, hit = true, scorable = true, accuracy = true, increases_combo = true},
	.GREAT = {base_score = 300, hit = true, scorable = true, accuracy = true, increases_combo = true},
	.PERFECT = {base_score = 300, hit = true, scorable = true, accuracy = true, increases_combo = true},
	.SMALL_TICK_MISS = {miss = true, scorable = true, accuracy = true, tick = true},
	.SMALL_TICK_HIT = {base_score = 10, hit = true, scorable = true, accuracy = true, tick = true},
	.LARGE_TICK_MISS = {miss = true, scorable = true, accuracy = true, breaks_combo = true, tick = true},
	.LARGE_TICK_HIT = {
		base_score = 30,
		hit = true,
		scorable = true,
		accuracy = true,
		increases_combo = true,
		tick = true,
	},
	.SMALL_BONUS = {base_score = 10, hit = true, scorable = true, bonus = true},
	.LARGE_BONUS = {base_score = 50, hit = true, scorable = true, bonus = true},
	.IGNORE_MISS = {miss = true},
	.IGNORE_HIT = {hit = true},
	.COMBO_BREAK = {miss = true, scorable = true, breaks_combo = true},
	.SLIDER_TAIL_HIT = {
		base_score = 150,
		hit = true,
		scorable = true,
		accuracy = true,
		increases_combo = true,
		tick = true,
	},
}

valid_result :: proc(result: Hit_Result) -> bool {
	return u16(result) <= u16(Hit_Result.SLIDER_TAIL_HIT)
}

result_properties :: proc(result: Hit_Result) -> Result_Properties {
	if !valid_result(result) {
		return {}
	}
	table := RESULT_PROPERTIES
	return table[result]
}

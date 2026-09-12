// Portions ported from pinned osu! sources.
// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See engine/reference/sources/osu__LICENCE and THIRD_PARTY_NOTICES.md.
package scoring

import "core:math"
import core_types "../core_types"

// Explicit judgement streams allow independent H10 tests before M1 integration.
// The producer owns judgement ordering and validates object-specific ranges.
Judgement :: struct {
	result, maximum: core_types.Hit_Result,
}

Rank :: enum {
	X,
	S,
	A,
	B,
	C,
	D,
	F,
}

MAX_JUDGEMENTS :: 1_000_000
Accumulator :: struct {
	counts: [core_types.Hit_Result]u32,
	combo, highest_combo, accuracy_count: u32,
	numerator, denominator, bonus: u64,
	combo_portion: f64,
}

Maxima :: struct {
	counts: [core_types.Hit_Result]u32,
	combo, accuracy_count: u32,
	numerator: u64,
	combo_portion: f64,
}

Score :: struct {
	accumulator: Accumulator,
	maxima: Maxima,
	applied_count: u32,
	accuracy: f64,
	total: i64,
	rank: Rank,
	failed: bool,
}

valid_judgement :: proc(judgement: Judgement) -> bool {
	if !core_types.valid_result(judgement.result) ||
	   !core_types.valid_result(judgement.maximum) ||
	   judgement.result == .NONE {
		return false
	}
	#partial switch judgement.maximum {
	case .MEH, .OK, .GOOD, .GREAT, .PERFECT:
		return(
			judgement.result == .IGNORE_MISS ||
			(judgement.result >= .MISS && judgement.result <= judgement.maximum) \
		)
	case .SMALL_TICK_HIT:
		return(
			judgement.result == .SMALL_TICK_HIT ||
			judgement.result == .SMALL_TICK_MISS ||
			judgement.result == .IGNORE_MISS \
		)
	case .LARGE_TICK_HIT:
		return(
			judgement.result == .LARGE_TICK_HIT ||
			judgement.result == .LARGE_TICK_MISS ||
			judgement.result == .IGNORE_MISS \
		)
	case .SLIDER_TAIL_HIT:
		return(
			judgement.result == .SLIDER_TAIL_HIT ||
			judgement.result == .LARGE_TICK_MISS ||
			judgement.result == .IGNORE_MISS \
		)
	case .SMALL_BONUS, .LARGE_BONUS:
		return judgement.result == judgement.maximum || judgement.result == .IGNORE_MISS
	case .IGNORE_HIT:
		return(
			judgement.result == .IGNORE_HIT ||
			judgement.result == .IGNORE_MISS ||
			judgement.result == .COMBO_BREAK \
		)
	case:
		return false
	}
}

// Contains no owning pointers: candidates can be copied transactionally.
accumulate :: proc(accumulator: ^Accumulator, judgement: Judgement) {
	actual_properties := core_types.result_properties(judgement.result)
	maximum_properties := core_types.result_properties(judgement.maximum)
	accumulator.counts[judgement.result] += 1
	if actual_properties.increases_combo {
		accumulator.combo += 1
	} else if actual_properties.breaks_combo {
		accumulator.combo = 0
	}
	accumulator.highest_combo = max(accumulator.highest_combo, accumulator.combo)
	if maximum_properties.accuracy {
		accumulator.denominator += u64(maximum_properties.base_score)
		accumulator.accuracy_count += 1
	}
	if actual_properties.accuracy {
		accumulator.numerator += u64(actual_properties.base_score)
	}
	if actual_properties.bonus {
		accumulator.bonus += u64(actual_properties.base_score)
	} else if actual_properties.scorable {
		accumulator.combo_portion += f64(maximum_properties.base_score) * math.sqrt(f64(accumulator.combo))
	}
}

prepare_maxima :: proc(maximum_results: []core_types.Hit_Result) -> (Maxima, core_types.Status) {
	if len(maximum_results) > MAX_JUDGEMENTS {
		return {}, .QUOTA_EXCEEDED
	}
	accumulator: Accumulator
	for maximum in maximum_results {
		if !core_types.valid_result(maximum) || !core_types.result_properties(maximum).hit {
			return {}, .INVALID_ARGUMENT
		}
		accumulate(&accumulator, {maximum, maximum})
	}
	return {
			accumulator.counts,
			accumulator.highest_combo,
			accumulator.accuracy_count,
			accumulator.numerator,
			accumulator.combo_portion,
		},
		.OK
}

create :: proc(maxima: Maxima) -> Score {
	return {maxima = maxima, accuracy = 1, rank = .X}

}

rank_for :: proc(accuracy: f64, misses: u32) -> Rank {
	if accuracy >= 0.95 {
		if misses > 0 {
			return .A
		}
		return accuracy == 1 ? .X : .S
	}
	if accuracy >= 0.9 {
		return .A
	}
	if accuracy >= 0.8 {
		return .B
	}
	if accuracy >= 0.7 {
		return .C
	}
	return .D
}

// Scores are non-negative and bounded by MAX_JUDGEMENTS. Explicit midpoint-even
// rounding avoids Odin round()'s different tie policy.
round_score :: proc(raw_score: f64) -> (i64, core_types.Status) {
	if math.is_nan(raw_score) ||
	   math.is_inf(raw_score) ||
	   raw_score < 0 ||
	   raw_score >= 9_223_372_036_854_775_808.0 {
		return 0, .INVALID_ARGUMENT
	}
	floor_score := math.floor(raw_score)
	fractional_score := raw_score - floor_score
	rounded_score := i64(floor_score)
	if fractional_score > 0.5 || (fractional_score == 0.5 && rounded_score % 2 != 0) {
		rounded_score += 1
	}
	return rounded_score, .OK
}

apply :: proc(score: ^Score, judgement: Judgement, failed_before := false) -> core_types.Status {
	if !valid_judgement(judgement) {
		return .INVALID_ARGUMENT
	}
	if score.failed {
		return .INVALID_STATE
	}
	if failed_before {
		return .OK
	} // The failure-triggering result has failed_before=false.
	if score.applied_count >= MAX_JUDGEMENTS {
		return .QUOTA_EXCEEDED
	}
	candidate := score^
	accumulate(&candidate.accumulator, judgement)
	candidate.applied_count += 1
	accumulator := &candidate.accumulator
	candidate.accuracy =
		accumulator.denominator > 0 ? f64(accumulator.numerator) / f64(accumulator.denominator) : 1
	combo_progress :=
		candidate.maxima.combo_portion > 0 ? accumulator.combo_portion / candidate.maxima.combo_portion : 1
	accuracy_progress :=
		candidate.maxima.accuracy_count > 0 ? f64(accumulator.accuracy_count) / f64(candidate.maxima.accuracy_count) : 1
	raw_score :=
		500000 * candidate.accuracy * combo_progress +
		500000 * math.pow(candidate.accuracy, 5) * accuracy_progress +
		f64(accumulator.bonus)
	total, status := round_score(raw_score)
	if status != .OK {
		return status
	}
	candidate.total = total
	candidate.rank = rank_for(candidate.accuracy, accumulator.counts[.MISS])
	score^ = candidate
	return .OK
}

fail :: proc(score: ^Score) {
	score.failed = true
	score.rank = .F
}

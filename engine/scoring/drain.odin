// Portions ported from pinned osu! sources.
// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See engine/reference/sources/osu__LICENCE and THIRD_PARTY_NOTICES.md.
package scoring
import core_types "../core_types"

Health_Increase :: struct {
	time_ms, amount: f64,
}
// Independent projection of DrainingHealthProcessor.ComputeDrainRate. Inputs
// are the upstream-ordered maximum-result increases, NOT assumed time-sorted.
// M1/session integration owns their construction and no-drain interval policy.
calibrate_drain :: proc(
	increases: []Health_Increase,
	break_end_times: []f64,
	difficulty, drain_start_ms: f64,
) -> (
	f64,
	core_types.Status,
) {
	if len(increases) > MAX_JUDGEMENTS || len(break_end_times) > MAX_JUDGEMENTS {
		return 0, .QUOTA_EXCEEDED
	}
	if !core_types.finite(difficulty) ||
	   difficulty < 0 ||
	   difficulty > 10 ||
	   !core_types.finite(drain_start_ms) ||
	   abs(drain_start_ms) > 86_400_000 {
		return 0, .INVALID_ARGUMENT
	}
	for increase in increases {
		if !core_types.finite(increase.time_ms) ||
		   abs(increase.time_ms) > 86_400_000 ||
		   !core_types.finite(increase.amount) ||
		   increase.amount < 0 ||
		   increase.amount > 1 {
			return 0, .INVALID_ARGUMENT
		}
	}
	for end_time in break_end_times {
		if !core_types.finite(end_time) || abs(end_time) > 86_400_000 {
			return 0, .INVALID_ARGUMENT
		}
	}
	if len(increases) <= 1 {
		return 0, .OK
	}
	target_minimum_health := core_types.difficulty_range(difficulty, 0.99, 0.9, 0.4)
	search_divisor: i32 = 1
	drain_rate: f64 = 1
	for search_divisor > 0 {
		current_health: f64 = 1
		lowest_health: f64 = 1
		break_index := 0
		for increase, increase_index in increases {
			previous_time_ms := increase_index > 0 ? increases[increase_index - 1].time_ms : drain_start_ms
			for break_index < len(break_end_times) && break_end_times[break_index] <= increase.time_ms {
				previous_time_ms = increase.time_ms
				break_index += 1
			}
			current_health -= (increase.time_ms - previous_time_ms) * drain_rate
			lowest_health = min(lowest_health, current_health)
			current_health = min(f64(1), current_health + increase.amount)
			if lowest_health < 0 {
				break
			}
		}
		if abs(lowest_health - target_minimum_health) <= 0.01 {
			break
		}
		// Preserve the pinned C# unchecked signed overflow termination.
		search_divisor = transmute(i32)(u32(search_divisor) * 2)
		adjustment_direction: f64 = lowest_health > target_minimum_health ? 1 : -1
		drain_rate += 1.0 / f64(search_divisor) * adjustment_direction
	}
	return drain_rate, .OK
}

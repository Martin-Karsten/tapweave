// Portions ported from pinned osu! OsuHealthProcessor and HealthProcessor.
// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See THIRD_PARTY_NOTICES.md.
package scoring

import core_types "../core_types"

health_increase :: proc(result: core_types.Hit_Result, difficulty: f64, slider_tick := false) -> f64 {
	#partial switch result {
	case .SMALL_TICK_MISS, .LARGE_TICK_MISS:
		return core_types.difficulty_range(difficulty, -0.02, -0.075, -0.14)
	case .MISS:
		return core_types.difficulty_range(difficulty, -0.03, -0.125, -0.2)
	case .SMALL_TICK_HIT:
		return 0.02
	case .SLIDER_TAIL_HIT, .LARGE_TICK_HIT:
		return slider_tick ? 0.015 : 0.02
	case .MEH:
		return 0.002
	case .OK:
		return 0.011
	case .GREAT:
		return 0.03
	case .SMALL_BONUS:
		return 0.0085
	case .LARGE_BONUS:
		return 0.01
	}
	return 0
}

Health :: struct {
	amount: f64,
	combo_quality: u32, // 0 perfect, 1 good, 2 none; worsens within a combo.
}

apply_health :: proc(health: ^Health, result, maximum: core_types.Hit_Result, difficulty: f64, combo_object, new_combo, last_in_combo, slider_tick: bool) -> bool {
	increase := health_increase(result, difficulty, slider_tick)
	if combo_object {
		if new_combo {
			health.combo_quality = 0
		}
		#partial switch result {
		case .LARGE_TICK_MISS, .OK:
			health.combo_quality = max(health.combo_quality, 1)
		case .MEH, .MISS:
			health.combo_quality = 2
		}
		// SliderTailCircle uses IgnoreMiss, which is not covered by the generic
		// result switch. Upstream still lowers the combo quality to Good.
		if maximum == .SLIDER_TAIL_HIT && !core_types.result_properties(result).hit {
			health.combo_quality = max(health.combo_quality, 1)
		}
		if last_in_combo && core_types.result_properties(result).hit {
			bonuses := [3]f64{0.07, 0.05, 0.03}
			increase += bonuses[health.combo_quality]
		}
	}
	health.amount = clamp(health.amount + increase, 0, 1)
	// Precision.AlmostBigger(0, health) uses DOUBLE_EPSILON = 1e-7.
	return !core_types.result_properties(maximum).bonus && result != .IGNORE_HIT && health.amount < 0.0000001
}

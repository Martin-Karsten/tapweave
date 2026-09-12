// Portions ported from pinned osu! sources.
// Copyright (c) ppy Pty Ltd <contact@ppy.sh>. Licensed under the MIT Licence.
// See engine/reference/sources/osu__LICENCE and THIRD_PARTY_NOTICES.md.
package osu_rules

import "core:math"
import core_types "../core_types"

Hit_Windows :: struct {
	great, ok, meh: f64,
}

hit_windows :: proc(difficulty: f64) -> (Hit_Windows, core_types.Status) {
	if !core_types.finite(difficulty) || difficulty < 0 || difficulty > 10 {
		return {}, .INVALID_ARGUMENT
	}
	return {
			math.floor(core_types.difficulty_range(difficulty, 80, 50, 20)) - 0.5,
			math.floor(core_types.difficulty_range(difficulty, 140, 100, 60)) - 0.5,
			math.floor(core_types.difficulty_range(difficulty, 200, 150, 100)) - 0.5,
		},
		.OK
}

// Pinned HitWindows.ResultFor includes Miss through +/-400; this is not the
// automatic miss deadline. DrawableHitCircle uses !CanBeHit for that deadline.
result_for :: proc(windows: Hit_Windows, time_offset_ms: f64) -> core_types.Hit_Result {
	if math.is_nan(time_offset_ms) || math.is_inf(time_offset_ms) {
		return .NONE
	}
	absolute_offset_ms := abs(time_offset_ms)
	if absolute_offset_ms <= windows.great {
		return .GREAT
	}
	if absolute_offset_ms <= windows.ok {
		return .OK
	}
	if absolute_offset_ms <= windows.meh {
		return .MEH
	}
	if absolute_offset_ms <= 400 {
		return .MISS
	}
	return .NONE
}

can_be_hit :: proc(windows: Hit_Windows, time_offset_ms: f64) -> bool {
	return time_offset_ms <= windows.meh
}

// Forward-only projection of pinned SpinnerSpinHistory; checkpoint restore
// replaces the state instead of implementing upstream's approximate inversion.
// Preserve source f32 intermediates (not all-f64 arithmetic).
Spin_History :: struct {
	accumulated, at_last_completion, maximum_partial: f32,
	completed: u32,
	last_time_ms: f64,
	has_report: bool,
}

report_delta :: proc(history: ^Spin_History, time_ms: f64, rotation_delta: f32) -> core_types.Status {
	if math.is_nan(time_ms) ||
	   math.is_inf(time_ms) ||
	   math.is_nan(rotation_delta) ||
	   math.is_inf(rotation_delta) ||
	   abs(rotation_delta) > 180 {
		return .INVALID_ARGUMENT
	}
	if history.has_report && time_ms < history.last_time_ms {
		return .LATE_INPUT
	}
	if rotation_delta == 0 {
		return .OK
	}
	if history.completed >= 1_000_000 {
		return .QUOTA_EXCEEDED
	}
	history.accumulated += rotation_delta
	partial_rotation := history.accumulated - history.at_last_completion
	history.maximum_partial = max(history.maximum_partial, abs(partial_rotation))
	if history.maximum_partial >= 360 {
		rotation_direction: f32 = partial_rotation < 0 ? -1 : 1
		history.completed += 1
		history.at_last_completion += rotation_direction * 360
		history.maximum_partial = abs(history.accumulated - history.at_last_completion)
	}
	history.last_time_ms = time_ms
	history.has_report = true
	return .OK
}

total_rotation :: proc(history: ^Spin_History) -> f32 {
	return 360 * f32(history.completed) + history.maximum_partial
}

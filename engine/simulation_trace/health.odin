package simulation_trace

import core_types "../core_types"
import scoring "../scoring"

Health_Value :: struct {
	health: f64,
	failed: bool,
}

write_health_observation :: proc(output: ^[dynamic]byte, fixture: Fixture) -> bool {
	if len(fixture.actual) == 0 || len(fixture.actual) != len(fixture.health_kinds) ||
	   len(fixture.actual) != len(fixture.combo_flags) || !core_types.finite(fixture.starting_health) ||
	   fixture.starting_health < 0 || fixture.starting_health > 1 {
		return false
	}
	health := scoring.Health{amount = fixture.starting_health}
	values := make([]Health_Value, len(fixture.actual))
	defer delete(values)
	failed := false
	for result, judgement_index in fixture.actual {
		object_kind := fixture.health_kinds[judgement_index]
		maximum: core_types.Hit_Result
		switch object_kind {
		case "HitCircle", "SliderHeadCircle", "Spinner":
			maximum = .GREAT
		case "SliderTick", "SliderRepeat":
			maximum = .LARGE_TICK_HIT
		case "SliderTailCircle":
			maximum = .SLIDER_TAIL_HIT
		case "Slider":
			maximum = .IGNORE_HIT
		case "SpinnerTick":
			maximum = .SMALL_BONUS
		case "SpinnerBonusTick":
			maximum = .LARGE_BONUS
		case:
			return false
		}
		if !scoring.valid_judgement({result, maximum}) {
			return false
		}
		flags := fixture.combo_flags[judgement_index]
		failed = scoring.apply_health(&health, result, maximum, fixture.difficulty, true,
			flags & 1 != 0, flags & 2 != 0, object_kind == "SliderTick") || failed
		values[judgement_index] = {health.amount, failed}
	}
	return write_observation(output, fixture, values)
}

package core_types
// Shared by control-point resolution, both preparation passes and stacking.
DEFAULT_PREPARATION_WORK :: u64(100_000_000)
Work_Budget :: struct {
	remaining: u64,
	exhausted: bool,
}

spend_work :: proc(budget: ^Work_Budget, amount: u64) -> bool {
	if amount > budget.remaining {
		budget.exhausted = true
		return false
	}
	budget.remaining -= amount
	return true
}

package tests

import "core:testing"
import gameplay_trace "../gameplay_trace"

// Allocation tracking covers transport cleanup after partial JSON decoding,
// failed preparation, and failure after a previous fixture produced output.
@(test)
gameplay_trace_rejects_invalid_batches_transactionally :: proc(test: ^testing.T) {
	for invalid_fixture in ([]string{
		`[`,
		`[]`,
		`[{"id":"bad-map","map_text":"not a beatmap","schedule_ms":[2000]}]`,
		`[{"id":"descending","map_text":"osu file format v14\n[HitObjects]\n64,64,1000,1,0\n","schedule_ms":[2000,1000]}]`,
		`[{"id":"first","map_text":"osu file format v14\n[HitObjects]\n64,64,1000,1,0\n","schedule_ms":[2000]},{"id":"bad-second","map_text":"bad","schedule_ms":[2000]}]`,
	}) {
		output, succeeded := gameplay_trace.run(transmute([]byte)invalid_fixture)
		testing.expect(test, !succeeded)
		testing.expect_value(test, len(output), 0)
		delete(output)
	}
}

package audio_protocol

// Host-owned assets; zero is explicit silence with a missing-sample diagnostic.
// Logical one-shots are retained until their enclosing session batch is acked.
Event :: struct {
	sequence: u64,
	epoch: u32,
	time_ms: f64,
	object_id, component_id, sample_index: u32,
	asset_id: u64,
	volume: f64,
	missing: bool,
}

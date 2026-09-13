# Replay

## Recording and playback

**SC.** `OsuReplayRecorder` records gameplay time, mouse position in gamefield space, and the current action set ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/UI/OsuReplayRecorder.cs)). `DrawableRuleset.SetRecordTarget` attaches the recorder and forces important frames on judgements ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/UI/DrawableRuleset.cs#L282-L305)). Playback linearly interpolates position between surrounding frames and applies the current frame’s action state ([`OsuFramedReplayInputHandler`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Replays/OsuFramedReplayInputHandler.cs)). Frames containing actions are marked important.

Replay timestamps are beatmap/gameplay milliseconds. Offsets belong to session clock construction, not the stored frame stream. The Odin replay validator rejects already-offset or non-monotonic frames rather than guessing.

## Rules identity

An Odin replay envelope contains:

- schema version and engine compatibility version;
- canonical SHA-256 of raw beatmap bytes and prepared-map digest;
- ruleset ID `osu`, pinned behavior profile `lazer-2026.804.2`, and rules ABI version;
- complete ordered mod list and settings (empty for this phase);
- clock rate and applied offset vector;
- input-coordinate version and playfield transform mode;
- frames, final discrete result digest, and optional checkpoints.

Map hash alone is insufficient because preparation logic can change. A replay may be inspected with a different engine, but verified playback requires an implemented behavior profile and matching prepared digest.

## Deterministic playback contract

Frames are ordered by `(time, sequence)`. Position is linearly interpolated for replay-only evaluation; actions are step functions. All replay frames are loaded before `start`, so rendering stalls cannot make them late. The simulation advances to the requested presentation time by consuming event boundaries; the full schedule/stall matrix in the [reference harness](../compatibility/reference-harness.md#schedule-and-stall-matrix) must produce identical judgements, score, health, samples, and final digest.

Seeking uses a checkpoint at or before target time containing complete mutable session state, then resimulates. Checkpoints are cache data and excluded from replay identity. Rewind-by-inverting results is not part of the public engine contract.

Spinner input needs more samples than ordinary pointer interpolation can guarantee. The recorder adds a frame on action transitions, judgements, maximum interval, and accumulated angular movement before any single normalized delta could exceed 90°. This resolves the explicit upstream concern in [`SpinnerSpinHistory.ReportDelta`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/SpinnerSpinHistory.cs#L55-L75).

## Legacy `.osr` survey

Lazer reads the binary score header, legacy mod bitmask, LZMA-compressed comma/pipe frame payload, RNG seed sentinel, and optional appended lazer JSON score info ([`LegacyScoreDecoder`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Scoring/Legacy/LegacyScoreDecoder.cs)). It converts `LegacyReplayFrame` into ruleset frames and automatically applies Classic when importing stable scores. Encoding is handled by [`LegacyScoreEncoder`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Scoring/Legacy/LegacyScoreEncoder.cs).

Initial Odin compatibility may import `.osr` through a separate adapter, but `.osr` is not the native persistence format: it cannot identify this engine’s deterministic behavior profile or all lazer mod settings. Imported legacy replays are labeled `UNVERIFIED_LEGACY` until reproduced against the matching Classic profile.

## Worked example

Frames `(1000,(0,0),none)`, `(1100,(100,0),LEFT)`, `(1200,(200,0),LEFT)` yield replay position `(150,0)` at 1150 ms and action `LEFT`. Rendering directly at 1200 ms or visiting 1150 first cannot change a judgement scheduled at 1150 ms.

## Tests and unresolved work

Pinned tests: [`TestSceneReplayRecording`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneReplayRecording.cs), [`TestSceneLegacyReplayPlayback`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneLegacyReplayPlayback.cs), and [`TestSceneReplayStability`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneReplayStability.cs).

**UR-REP-1.** Stable replay mouse sentinel/RNG cases and all historical modes: H12 imports upstream test resources and compares converted osu! frames. Unsupported modes remain rejected, not partially decoded. Acceptance stays with A23; no A23 row closes until the H12 adapter exists.

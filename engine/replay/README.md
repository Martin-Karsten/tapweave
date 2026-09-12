# Independent replay primitives

These internal Odin APIs accept explicit typed inputs; they do not advertise a
production replay capability or implement gameplay recording/checkpoints yet.
M1 prepared identity and the complete M2 session must be integrated first.

`validate_identity` requires supported version/profile/coordinate fields, rate 1,
finite offsets and exact expected identity. Ruleset is fixed to osu and mods are
absent. `validate_frames` requires finite complete snapshots, positive strictly
increasing u64 sequences, nondecreasing time, raw/effective equality and known
actions/flags. Offsets are metadata and never reapplied to stored frames.

`sample` borrows a **previously validated immutable** frame slice. It selects the
last equal-time frame, interpolates position only and holds actions. Before the
first frame position uses that frame with released actions; after the last it
holds position/actions. Dispatch each equal-time edge independently of sampling.

## Internal v2 serialization

All integers and IEEE f64 values are little-endian. Negative zero serializes as
positive zero. Payloads have a 192-byte header, `count` 64-byte frames, then a
SHA-256 checksum over the header and frames. Checkpoints are not serialized.

| Offset | Header field |
|---|---|
| 0 | eight-byte `TWREPLAY` magic |
| 8, 12 | u32 schema 2, header bytes 192 |
| 16, 20, 24, 28 | u32 compatibility, rules, behavior and coordinate versions |
| 32, 36, 40, 44 | u32 flags=0, frame stride=64, count, reserved=0 |
| 48 | f64 rate=1 |
| 56 | four f64 offset components |
| 88, 120, 152 | raw, prepared and supplied final discrete digests (32 bytes each) |
| 184 | eight reserved zero bytes |

Frames store sequence u64 at 0; raw/effective time and x/y f64 at 8/16/24/32;
action bits u32 at 40; source/focus epoch u16 at 44/46; flags u32 at 48; zero
reserved bytes at 52–63. The codec preserves full u64 sequence precision.

`encode` validates/counts before writing, returns required bytes on short output,
and rejects overlapping frame/output buffers. `decode` checks exact size,
versions, reserved bytes, checksum, expected identity and every frame before
writing destination records. Both borrow buffers and allocate nothing. Failed
decode returns an empty view and leaves the destination unchanged. Limits are
1,000,000 frames plus checked WASM32 size arithmetic.

The final digest is supplied metadata until integrated simulation recomputes it;
a checksum protects corruption, not authenticity. No legacy `.osr`, player,
prepared-map adapter, verified gameplay playback, or checkpoint support is claimed.

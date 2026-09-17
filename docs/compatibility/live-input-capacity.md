# Live-input capacity and reusable voice journal

This is a resource-policy change, not upstream gameplay acceptance. The source
revisions and fixture identities are retained in the
[capacity finding index](../../engine/reference/findings/live-input-capacity.json).
ADR-001 owns the memory policy; ADR-004 and interface-v2 own pending voice admission.

## Incident and corrected model

The reported real-map incident rejected input record 8,193 with
`QUOTA_EXCEEDED` after roughly 90 seconds while judgement state was healthy.
That report was supplied with the task; no original beatmap or incident capture
was supplied for independent reproduction. The code confirms the former browser
session default of 8,192 lifetime inputs and the voice reserve's multiplication
of input/replay/pause capacities by maximum loop overlap. A short validation map
could hide both limits.

A fixed lifetime `interactive_input_capacity` without enforcement is unsafe.
Every due input can update voice policy; held cursor movement, tracking changes,
spinner parameter changes and pause/resume can emit commands. The journal's
producer asserts that reserve admission has guaranteed space. Counting button
presses alone or capping the formula alone would invalidate that guarantee.

The revised journal reuses acknowledged slots and retains absolute u64 command
sequences/voice IDs. Default pending input headroom is
`min(replay_queue_capacity + live_input_capacity + 4, 8192)`. The command reserve
is that headroom times four times maximum loop overlap, plus the existing
per-object transition and one-shot terms. Every advance preflights its actual
due input count, not an assumed input classification. The map term is cached at
creation; a binary search counts the queued prefix without scanning map objects
or the full replay suffix on each frame. Already emitted one-shots are removed
from the future bound. Pause includes stop headroom; resume includes restart and
ramp headroom. Sequence exhaustion also rejects before mutation.

Admission is deliberately conservative. An undrained burst, large replay seek
or direct-to-terminal replay advance can return `QUOTA_EXCEEDED`; rejection
preserves state and the current publication. A caller can acknowledge pending
commands or advance the same queued timestamps over smaller intervals. A larger
explicit READY reserve can support a larger burst. Ordinary playback drains and
acknowledges each frame. This is not an audio-event truncation, input coalescing,
voice-stealing or RAF judgement policy.

The browser now reserves **40 MiB / 65,536 lifetime input records** per default
session. Its separate pending input queue remains 8,192 records. The engine's
arena default/ceiling rises to **128 MiB**, while the WASM linker ceiling remains
**256 MiB**. Existing map and per-session quota checks are separate: there is no
single engine-wide aggregate arena accounting. Consequently, “20 MB remaining
for the map” cannot be inferred by subtracting session storage from this quota.
The session allocation is eager; the 128 MiB quota is not an eager allocation.

A synthetic 1,100-repeat slider reports the same **42,717 commands / 9,332,744
voice reserve bytes** at 8,192, 65,536 and 131,072 live input capacities. The first
two measurements explicitly reserve 40 MiB sessions and report 55,312,384 WASM
bytes after map/session/voice creation; the 131,072 probe explicitly reserves
80 MiB and reports 97,255,424 WASM bytes. These exclude browser media/GPU memory
and scene/draw reserves; they are not a real-map peak-memory certification.

65,536 records represent about **9.1–18.2 minutes at 120–60 records/s**, before
button and other input records. Hardware may deliver more than 120 pointer
moves/s. This profile cannot guarantee every ranked map or marathon. The
131,072 probe is local allocation evidence, not a new browser default tier.

## Pinned upstream search

The search used osu! `3c1c96f742e7aae2ff67a7361e058fe91ca3b955` and framework
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`, with recursive source inventories
and commit-pinned raw files. Relevant inspected sources/tests and SHA-256 values
are listed in the finding index.

- `DrawableSlider.Update` requests/stops the sliding sample based on tracking
  and updates its balance from the ball position.
- `DrawableSpinner.updateSpinningSample` and its update path retain loop intent,
  volume ramps and frequency updates. `TestSceneSpinner.TestSpinningSamplePitchShift`
  tests modulation, not lifetime command-storage admission.
- Framework `Sample.DEFAULT_CONCURRENCY` is 2; `SampleStore.PlaybackConcurrency`
  flows through `SampleBassFactory` to `Bass.SampleLoad`. This bounds sample
  playback concurrency, not how many input or parameter updates a session may
  retain. It supplies no lifetime voice-journal bound to substitute here.
- Framework `SampleBassTest` start/stop/disposal cases,
  `TestSceneSampleChannels.TestChannelLifetime` and looping/manual-lifetime cases,
  `TestSceneSampleLooping` frequency/stop cases, and osu! sample-selection tests
  concern playback resource lifetime or sound behavior. None has an equivalent
  caller-acknowledged WASM command ring, transactional pending-capacity admission,
  or a browser lifetime pointer-record quota. Taiko samples are out of scope.

No new upstream executable comparison was run: this change retains intent policy
and adds a local transport/quota policy without an equivalent upstream test.
Existing H11/A20/A21, replay A23 and full resource A24 acceptance remain open;
these regressions do not close them. Native/WASM checks remain local evidence.

## Regression coverage

- Odin overlap/capacity regression proves lifetime capacity growth does not grow
  the pending voice reserve while map overlap still matters.
- Allocation-tracked Odin ring regression covers sequence/voice identity reuse,
  full storage, u64 exhaustion, and advance/pause/resume rejection without
  changing committed time, epoch, recording, state or the queued input.
- Native and production-WASM long-slider regressions each drive 50,000
  held-action tracking changes, exceed the physical journal capacity and check
  every retained command's sequence. WASM verifies acknowledgement retries and
  no memory growth. Deliberately missed final repeats end this synthetic map in
  gameplay failure, distinct from a resource failure during input processing.
- WASM oversized advance and replay-seek regressions retain the current output
  token and committed state. Advancing the originally queued inputs in smaller
  intervals then reaches terminal; no input is resubmitted or retimestamped.
- The actual browser controller handles 65,000 DOM pointer moves through the
  audio clock, frame driver and production WASM, reaches terminal without a
  resource error, and watches its retained replay to the same result.

Validation results are recorded in [status](../status.md#live-input-capacity).

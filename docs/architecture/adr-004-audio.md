# ADR-004: Browser audio and synchronization

Status: accepted.

## Context and evidence

Web Audio nodes and autoplay policies are browser-owned. `AudioContext.currentTime` is the audio timeline and scheduled sources use that coordinate system; an `AudioBufferSourceNode` is one-shot ([W3C Web Audio](https://www.w3.org/TR/webaudio/#AudioBufferSourceNode)). Lazer’s slider/spinner loop intent is emitted by drawables and sample playback is pausable.

## Alternatives

1. Decode/mix audio inside WASM: large codec/mixer scope, browser output still required.
2. HTML media for music plus ad-hoc sound effects: two clocks and weaker precise scheduling.
3. JavaScript Web Audio service, with Odin owning event intent and sample resolution.

## Decision

Use option 3. One `AudioContext` is master. JavaScript decodes music/samples, owns buffer/source/gain/panner nodes and user-gesture resume. Odin emits typed `one_shot`, `loop_start`, `loop_stop`, and `param_ramp` events using beatmap ms and an epoch. JavaScript maps them through the current anchor and reports schedule/actual timing diagnostics.

Music and simulation share:

```text
beatmapMs = beatmapAnchorMs + (audioNow - audioAnchor) × 1000 × rate
```

Offset components are immutable during a running epoch. Ordinary pause invalidates the clock mapping and saves beatmap position. Already-started one-shots may finish; queued or scheduled future one-shots retain their nominal map times for reconstruction under the resumed anchor. Reset, replacement and dispatch failure cancel all playback. Loops require stop/reconstruction when their producer is enabled. Context suspension remains browser lifecycle work. Resume after a gesture recreates music at the saved media offset and establishes a new anchor. A bounded 25 ms default lookahead schedules one-shots; an adaptive policy may change lookahead without changing event timestamps. Late events are logged and either immediate-played or dropped by event policy.

The one-shot service implements this distinction explicitly with
`suspend_after_clock_pause` and `resume_after_clock_bind` on the shared admission
owner. Suspension retains bounded pending and not-yet-started requests; it does
not reset the admitted sequence watermark. Resume remaps retained requests once,
after validating the same engine epoch. Reset/replacement must call cancellation
instead. These operations are service contracts; W07 still integrates them into
the player lifecycle. The implementation rejects loop suspension until W05.

Asset resolution happens in Odin from a JS-provided availability table so fallback order remains testable. JavaScript maps selected asset ID to decoded buffer. Missing music blocks production start; missing hitsounds warn and produce silence. Repeated load releases asset-scope buffers and object URLs.

## Consequences

The JS boundary remains small while using browser-native decoding/output. Audio output cannot be byte-identical across devices, so acceptance targets selected assets, scheduling intent, offsets and measured lateness. Audio context suspension/context changes require lifecycle handling outside WASM.

## Acceptance

Offset vectors, rate changes between sessions, pause/resume, focus loss, missing assets, repeated load, loop loss/recovery, and long-stall late events are integration fixtures. Report p50/p95/p99 scheduling lateness and drift between music position and engine beatmap time.

## Browser foundation failure handling

The independent executor validates each enqueue batch before mutation, counting
only events that survive epoch replacement against queue capacity. If dispatch
fails (including voice quota exhaustion), it cancels queued playback and stops and
disconnects active/retiring voices, then reports the error for explicit caller
recovery. A failed start cannot indefinitely block a subsequent loop stop. This
failure path does not choose substitute samples or silently steal voices.

## Explicit engine/browser mapping and decode admission

The browser clock now binds a session handle and engine epoch to an independently
numbered browser epoch and immutable DOM-receipt/AudioContext pair. Numeric epoch
equality is never assumed. Pause invalidates the mapping; input conversion neither
clamps late timestamps nor applies offsets again. Production M2 still requires
zero offsets; the independent clock's nonzero-offset fixtures do not change that
profile. The [receipt-time conversion](#receipt-time-conversion) separates DOM
receipt diagnostics from ABI beatmap-relative raw/effective timestamps.

Music transport consumes the same anchor and its separate media coordinate.
Negative lead-in schedules media zero in the future; resume recreates the source
at the saved media position. The lifecycle controller must establish/invalidate
the clock and invoke music cancellation; the transport does not judge or advance.
This independent service is not yet wired into production Play.

Each selection controller admits at most two concurrent browser audio decodes
and 128 MiB of their encoded inputs, shared across old and candidate asset scopes.
A busy decoder rejects with QUOTA_EXCEEDED and preserves the active selection;
there is no unbounded waiting queue. Cancellation releases candidate ownership
immediately but does not free a decoder slot before uninterruptible work settles.
Same-source requests share a pending decode by normalized asset name. Internal
browser decoder peak memory remains unbounded by this admission accounting.

## Remaining audio protocol

Append a distinct audio-command record and a separately discoverable capability.
Keep kind-27 serialization and acknowledgement valid for existing consumers.
Commands require sequence, engine epoch, kind, late policy, beatmap timestamp,
voice ID, selected asset ID, volume/pan/rate, ramp duration and ramp parameter mask.
Kinds are one-shot, loop-start, loop-stop and linear parameter ramp. Stops and
ramps reference an explicit voice in the same epoch; voice IDs cannot be reused
within an epoch. Asset zero is diagnostic silence. Stops must execute even late.

Odin emits transitions from semantic input/judgement/tracking events, never RAF.
The H11 observations must determine rapid-toggle/ramp replacement semantics and
late one-shot policy before those are advertised. Reserve maximum journals and
voices at session creation with checked arithmetic; a failed admission cannot
partially change gameplay or lose pending sound. Do not assume a bounded number
of loop toggles from object count: account for accepted input capacity.

The browser must copy/admit a complete unacknowledged batch transactionally, save
its session/epoch/sequence watermark, then acknowledge. An acknowledgement retry
must not re-enqueue sound. New snapshots change tokens, so retry acknowledges the
latest token only after all newly included events are admitted. Dispatch failure
cancels voices/music and enters recovery; it must not replay already-admitted
one-shots. A future nominal-tail timestamp remains unchanged in the queue.

## Receipt-time conversion

An immutable running mapping contains session handle, engine epoch, browser clock
epoch, diagnostic DOM receipt anchor, AudioContext anchor, media anchor and four
offsets. These epochs are different counters. Bind them explicitly after
start/resume and invalidate the mapping on pause, reset, seek, replacement or
context suspension.

One authoritative clock serves both judgement and advancement: a DOM handler
samples `AudioContext.currentTime` first and stores that stamp permanently with
the browser clock epoch; `effective = beatmap_anchor + (audio - audio_anchor) *
1000` at production rate 1. Web Audio does not guarantee synchronization with
other system clocks, so `performance.now()` receipts are never converted into
judgement time; they remain distinct diagnostic fields beside the audio stamp.
Audio time advances in render-quantum blocks, so several inputs and successive
callbacks can observe the same timestamp: equal stamps keep arrival sequence
order, a stamp equal to the committed boundary is admitted, and a stamp below
the mapping bound (impossible while `currentTime` is monotonic) or from a closed
epoch fails visibly rather than being clamped or remapped. Sub-block timing and
audible-output-latency compensation are future enhancements of this shared
clock, applied consistently to inputs and simulation, never an independent
conversion. Offsets enter beatmap_anchor exactly once; media position uses
media_anchor and never adds that offset again. While the M2 profile is
zero-offset only, production start must reject nonzero vectors rather than
export incorrect replay metadata. Input ABI raw/effective fields both receive
the mapped beatmap time for this profile.


## Executable one-shot admission

The browser `Audio_Admission` implements the retained session/engine-epoch/sequence
watermark for authoritative kind-45 voice commands; kind-27 one-shot output
remains a valid engine journal but no longer feeds playback. Reserve always
enables the authoritative journal (capability voice version 2); there is no
legacy per-read projection, so commands keep their emit-time epochs and a
pause/resume frame legitimately mixes epochs. Failed queue admission does not
acknowledge; failed acknowledgement retries skip admitted sequences even after
output-token replacement or dispatch cancellation. Executor sequence validation
resets on browser epoch change, including cancellation before new admission.
The single validation owner is the engine (emit-time asserts); the browser
checks frame protocol only. Tests use actual production WASM output. The
provisional immediate late policy and allocating JS staging are explicitly
diagnostic; H11, bounded voice records, the full executor and integrated
playback remain open.

## W05 opt-in audio execution

Kind-42 flag `1` enables the semantic voice journal in a READY session; flag zero
retains the legacy one-shot projection. Kind-44 flag `1` identifies that journal.
Consumers must use voice admission exclusively for an enabled session: its
sequence includes loops and ramps, unlike the legacy one-shot sequence. Compact
acknowledgement cannot erase unread voice commands; voice acknowledgement cannot
erase unread judgements. Voice IDs are never reused within a journal, including
across pause/resume. Reset clears both journals and changes the engine epoch.

Reserve counts the complete journal before enabling it. A creation-time sweep
measures maximum concurrent auxiliary samples; the input-derived bound uses that
maximum, accepted input/pause capacity and each object's scheduled transitions.
It does not multiply every input by the total map object count. All arithmetic
is checked; the one-million-command and shared arena limits reject oversized
configurations before publication. The runtime owns journal/state/deadline/output
storage; simulation only borrows it. Replacement while an authoritative session
is paused is rejected, preserving retained commands and live ramp state.

Slider slide/whistle samples use auxiliary sample ordinals and component identity
`0xfffffffe`. Tail copies in the auxiliary list are excluded. Odin emits starts,
tracking-loss stops and rounded balance using the default positional level 0.2.
Spinner intent retains a single requested voice while replacing gain ramps
(300 ms toward sample volume, 240 ms toward zero), uses frequency 0.5 plus clamped
progress and retires the voice 240 ms after end. The pinned disc's 0.99/ms damping
and ten-degree motion threshold are projected continuously between semantic
inputs. A bounded inversion and indexed deadline handle decay without further
input or RAF. This is an event-driven interpretation: update-quantised upstream
motion and drawable expiry still require H11 comparisons; differences are not
accepted divergences. No render read produces commands.

Pause retains input state at the exact engine boundary. It then retires remaining
loop resource identities while retaining requested state and beatmap-relative gain
ramps. Resume emits fresh starts with the sampled gain and the remaining ramp
duration. Browser pause discards queued loop commands and cancels loop nodes;
future one-shots retain their original map times. The resumed journal supplies
loop reconstruction. Reset/replacement/dispatch failure cancel everything.

`sample-assets.mjs` loads every prepared candidate independently and binds its
availability before start. It does not select the winning ordinal. Beatmap lookup
uses exact names, then wav/mp3/ogg in pinned SampleStore/Skin order; bank-zero
samples skip beatmap resources. The original Tapweave fallback generator supplies
nine small mono buffers at the final unbanked candidates. Missing individual
samples warn and bind silence. Loading shares selection's two-decode/128 MiB
encoded admission and source decode cache with music. Reads are sequential;
4,096 unique candidate resolutions and 1,000,000 bindings bound staging. Decoded
source quotas also cover hitsounds. Browser decoder internal peak memory remains
outside these accounting limits.

Admission and executor queues reserve reusable command objects. Complete batches
are validated before enqueue; sequence watermarks survive acknowledgement failure
and dispatch cancellation. Node creation/configuration failure disconnects partial
resources as well as active/retiring voices. The existing immediate late policy
remains source-based and provisional; future nominal tails are never retimed.

Per-voice parameter execution uses explicit set/linear automation history rather
than requiring `AudioParam.cancelAndHoldAtTime`. For each gain/pan/rate parameter,
the browser evaluates the value at the scheduled replacement time, cancels later
automation and reconstructs any truncated incoming ramp endpoint before anchoring
the replacement. This also preserves a ramp ending exactly at that time. A zero
duration is a set, and parameter masks leave other channels untouched.

History retains only segments not yet completed at audio `currentTime`, bounded
by `maximum_pending` segments per parameter per voice. This supports replacement
before an already scheduled future start without reading `AudioParam.value` as
though it were the future value. Exhaustion follows ordinary typed dispatch
failure and cancellation; voice release drops its history. These executor details
do not alter engine intent, receipt timestamps, replay identity or late policy.

`Audio_Playback` joins the production session, sample bindings, generated voice
reader, admission, music and one AudioContext anchor. It freezes the same pause
coordinate in music/engine/clock, guards pending gesture resumes with a generation
and exposes explicit recovery after execution failure. It is usable by developer
fixtures; W06/W07 still own DOM/frame/product lifecycle integration and Play.
Chromium offline rendering verifies actual Web Audio output and cleanup. It does
not certify physical audible output or close H11/A21.

## W06 frame and DOM transport

`Gameplay_Frame` reserves the ABI inbox and reusable conversion records before
start. Its single generation-guarded RAF callback drains receipt-stamped input,
then calls `Audio_Playback.pump` with one audio sample, then invokes a synchronous
render consumer with that same beatmap time and borrowed compact output. The
consumer must copy retained data before requesting another engine output.
No RAF timestamp enters gameplay. Late/rejected batches remain in the input
buffer and stop the driver through explicit audio recovery. Terminal output
suppresses further DOM input while audio/render pumping can finish future intent.

`Gameplay_Input` installs abortable keyboard/pointer/focus listeners. Coordinates
use the engine inverse transform for the canvas's current CSS bounds and DPR at
receipt, before buffering. Z/primary mouse and X/secondary mouse aggregate physical
sources; repeats are suppressed. One primary touch maps to cursor/left, as required
by the browser plan. Escape, cancellation, focus loss and hidden-document events
drain input and call engine pause, which retains action state at the exact boundary. Resume
uses the existing playback anchor and an explicit frame restart. Disposal removes
listeners and restores touch-action. Reset/replacement require new driver/input
owners; W07 owns that lifecycle. Browser event/transform allocation remains; the
reused conversion records are not an allocation-free claim.


## W07 lifecycle integration

`Gameplay_Controller` is the sole product transition owner. Input/frame services
report pause requests, terminal state and errors. Input disposal detaches without
invoking engine pause. The frame driver binds browser RAF functions through
wrappers and invalidates its callback generation on every stop.

Pause drains accepted input, samples AudioContext time once and invokes engine
pause directly, before any ordinary advance at that boundary. This preserves
ADR-002 input/deadline ordering and also works when audio is suspended. The returned
state may already be terminal; the controller reads results rather than attempting
resume in that case. Pause leaves newly emitted engine voice intent retained;
resume consumes it under the new anchor while restoring previously admitted
future one-shots. Dispatch/input/invalid-state failures cancel sound, preserve
bounded diagnostics, and require Retry/Back rather than uncertain reconstruction.

Reset retains the voice arena; a replacement Audio_Playback uses its explicit
reuse option only after successful reset of that same session. Re-reserving a
transactional replacement would unnecessarily raise WASM's high-water mark.
New sessions always reserve before start. Reset invalidates old frame/input/audio
owners and mappings while retaining immutable map assets and valid scene resources.

Success shows copied final results immediately and runs only existing sound
intent to completion on the same RAF/AudioContext. The early slider-tail
judgement does not itself make a session terminal before the parent result;
its sound keeps the nominal endpoint time. Active sample tails can outlive the
results transition. Music is cancelled once sound intent drains. Failure,
navigation and visibility loss cancel all terminal playback immediately.

The cursor resume flow now follows the pinned lazer policy described in
[pause/resume](../compatibility/pause-resume.md). Pause cooldown and pause-menu
sound loops remain separate validation UI gaps. Passing the six pause-input
tests does not close the complete pause/UI acceptance matrix.

## MVP essential settings policy

The approved [MVP Plan 2](../mvp-player-experience.md) adds a page-session-owned
`Audio_Mixer` with separate final music/effects gains. Music feeds the music
output; per-voice gain/pan feeds the effects output. Percentages map to amplitude
by division by 100. Saved values apply before playback; changes use a continuous
20 ms linear ramp computed from the mixer's own prior ramp, with
`cancelScheduledValues` and an explicit current value (no dependency on
`cancelAndHoldAtTime`). Retry/map replacement keep this owner; disposal releases
it. Muting changes only output gain, never scheduling, anchors or simulation.

The page reads validated v1 preferences once. On start/resume the controller
installs a fresh input owner with an immutable physical-key/mouse configuration.
A controller-owned observer tracks held physical sources even while menus own
focus. Ordinary pause drains input and retains engine actions. Resume reconciles
physical state before the first advance, preserving held actions and consuming
the cursor-resume press. Inputs used within settings are quarantined until
release; unrelated held gameplay inputs are not blanket-suppressed. The shared modal pauses through the lifecycle owner,
never resumes on close, and excludes the debug modal/background shortcuts.

The earlier release/repress policy is superseded by the lazer behavior. The six
osu!standard methods in `TestScenePauseInputHandling` have been executed through
the pinned upstream host; local implementation checks and remaining acceptance
limits are recorded in [pause/resume](../compatibility/pause-resume.md). Timing offsets remain zero;
any future calibration needs a separate ADR-002/004 and ABI/replay contract.
See [settings evidence and human evaluation protocol](../compatibility/settings-evaluation.md).

The frame coordinator may observe a suspended context before the queued browser
`statechange` event. It reports a pause request to the same controller before
ordinary advancement; the controller drains and freezes the retained action state at the actual audio time.
This closes an observed Chromium suspension race without clamping, offsets or a
second transition owner. A production-WASM regression delays `statechange` until
after the frame and checks the exact committed pause timestamp.

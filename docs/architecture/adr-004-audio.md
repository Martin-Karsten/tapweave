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

Offset components are immutable during a running epoch. Pause/focus loss cancels logical epoch, stops one-shots/loops/music, saves beatmap position, and suspends when appropriate. Resume after a gesture recreates sources at the saved media offset and establishes a new anchor. A bounded 25 ms default lookahead schedules one-shots; an adaptive policy may change lookahead without changing event timestamps. Late events are logged and either immediate-played or dropped by event policy.

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
epoch, DOM receipt anchor, AudioContext anchor, media anchor and four offsets.
These epochs are different counters. Bind them explicitly after start/resume and
invalidate the mapping on pause, reset, seek, replacement or context suspension.

`audio = audio_anchor + (receipt_ms - receipt_anchor_ms) / 1000`.
`effective = beatmap_anchor + (audio - audio_anchor) * 1000` at production rate 1.
Offsets enter beatmap_anchor exactly once; media position uses media_anchor and
never adds that offset again. While the M2 profile is zero-offset only, production
start must reject nonzero vectors rather than export incorrect replay metadata.
DOM receipt time and mapped beatmap time remain distinct diagnostic fields. Input
ABI raw/effective fields both receive the mapped beatmap time for this profile.


## Executable one-shot admission

The browser `Audio_Admission` implements the retained session/engine-epoch/sequence
watermark for compact kind-31 output and legacy kind-27 one-shots. Failed queue
admission does not acknowledge; failed acknowledgement retries skip admitted
sequences even after output-token replacement or dispatch cancellation. Executor
sequence validation resets on browser epoch change, including cancellation before
new admission. Tests use actual production WASM output. The provisional immediate
late policy and allocating JS staging are explicitly diagnostic; H11, bounded
voice records, the full executor and integrated playback remain open.

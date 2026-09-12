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
profile. The [contract audit](../implementation/m3-contract-audit.md) separates DOM
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

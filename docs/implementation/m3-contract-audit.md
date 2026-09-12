# M3 contract audit

Audited against `cf379bc`, including browser fixes `3062eee`, on 2026-09-12.
This is implementation prerequisite evidence, not acceptance of the full M3 plan.
The manifest pins osu `3c1c96f742e7aae2ff67a7361e058fe91ca3b955` and framework
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`.

## Current contract sources

The historical audit established session prerequisites and corrected equal-time
input prose. Current operations, record kinds and output/token lifetimes are
maintained in [ABI v2](../architecture/interface-v2.md#m2-headless-session-transport),
including [compact output and active projection](../architecture/interface-v2.md#compact-gameplay-output-and-active-projection).
The [session report](m2-sessions.md) records implemented behavior and limitations;
[ADR-004](../architecture/adr-004-audio.md#explicit-enginebrowser-mapping-and-decode-admission)
owns the browser clock mapping and decode admission decisions.

Kinds 29/30 now expose coordinate conversion; kinds 31–34 implement compact output
and independent active projection. These additions do not supply animation,
static GPU resources or loop/voice/ramp records. Kind 27 remains one-shot only.
The requirements below constrain remaining W01/W03/W05 work; they are not
advertised capabilities or a replacement for the current ABI.

## Remaining presentation/resource contract

These definitions constrain the next implementation; they are not advertised
wire records or completed capabilities. Assign concrete new kinds when writers,
readers and conformance tests land together, preserving kinds 1–34.

- Runtime passes a borrowed readonly `simulation.Session` projection to
  presentation. Presentation may import simulation, prepared and core types;
  simulation never imports presentation or render_webgl. Borrow only for the call.
  No runtime import or owning session copy is permitted.
- Creation reserves active indices, expiry ordering, feedback history, trail,
  instance output and mesh accounting with checked u64 arithmetic. Normal forward
  presentation uses arrival/expiry cursors plus the active set; arbitrary backward
  requests explicitly rebuild reusable indices without judging. Stable order is
  layer, source object order, component order, then primitive ordinal.
- A static-resource header identifies map identity, resource generation and total
  bytes. Relative spans carry vertex/index buffers, original atlas bytes and
  versioned Odin shader sources. A draw header identifies session epoch, resource
  generation, viewport and HUD; spans carry ordered batches and compact instances.
  Resource IDs are integers, never native pointers or WebGL handles.
- Every span has checked relative offset/count/stride and eight-byte alignment
  for record headers. Validate command opcode, resource reference, index range,
  instance range and finite uniforms before executing any batch. Unknown versions
  reject. Resource candidates publish only after all uploads succeed.
- Static resources belong to a prepared-map render attachment; four sessions may
  share them. GPU objects belong to the browser map/context generation. A lost
  context invalidates all GPU IDs; recreate once from owned immutable bytes.
  Frame spans expire on next render-output call. Output reserve is READY/PAUSED
  only and transactional; overflow reports required capacity without truncation.
- Quotas must bound active objects, instances, commands, mesh vertices/indices,
  texture dimensions/bytes, dynamic uploads and total arena bytes independently.
  Their concrete defaults require count-pass workload measurements; no capability
  can be enabled with an unbounded or unimplemented quota. No static mesh builds,
  shader compilation, allocation or memory growth in advance/render hot paths.

## Remaining durable audio contract

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

## Clock mapping

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

## Required upstream matrix

| Harness | Required scenarios | Existing evidence / remaining entry point |
|---|---|---|
| H05 / A15 | Slider tracking loss/recovery, key restriction, sparse samples and deadlines across schedules/stalls | Drawable adapter absent; local session tests only |
| H06 / A13–A14 | Strict/adjacent window boundaries, circle selection, note lock, equal-time input | `test:simulation:upstream` executes hit-window component subset; selection adapter absent |
| H07 / A14–A16/A20 | Nested/top-level equal-time result order, early nominal tail | Drawable adapter absent |
| H08 / A16/A23 | Spinner reversals, >90-degree segments, input/recorder angular subdivision | Existing spin-history component adapter; full cursor/recorder adapter absent |
| H09 / A19 | HP0/5/10, breaks, drain, failure time/freeze | Existing drain component adapter; player adapter absent |
| H10 / A17–A18 | Complete score/count/health sequences and terminal rank | Existing score component adapter; integrated player projection absent |
| Replay / A23 | Same replay under direct, 30/60/120/144 Hz and 50/100/250 ms stalls | Local bridge/native/WASM evidence; upstream recorder cadence remains open |
| H11 / A20–A21 | Missing candidates, nominal tails, loops, rapid toggles, ramps, pause/resume | Drawable sample adapter absent; mock Web Audio cannot close this |
| Presentation / A22 | Circle preempt/fade/approach/feedback, slider body/ball/follow/repeats, spinner states | Source chapters, local coordinates and active projections; drawable adapter absent |

The pinned component command was executed successfully with the real clean
checkouts and locked restore in this worktree: 104 local primitive fixtures and
72 pinned comparisons. It is not a substitute for the absent adapter entry
points above. Step 1 remains open until those executable fixture entry points
and remaining concrete resource/audio bindings are implemented. No acceptance
row closes on this audit.

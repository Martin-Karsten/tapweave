# M3 contract audit

Audited against `cf379bc`, including browser fixes `3062eee`, on 2026-09-12.
This is implementation prerequisite evidence, not acceptance of the full M3 plan.
The manifest pins osu `3c1c96f742e7aae2ff67a7361e058fe91ca3b955` and framework
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`.

## Existing production operations

| Operation | Actual behavior | Browser integration constraint |
|---|---|---|
| `oe_session_create` | Kind 18, flag 2; transactional arena and map retention | Explicit reserve before play; kinds 1–28 unchanged |
| `oe_session_inputs_from_reserved` | Kind 23, checked engine inbox token; entire batch validated | Reserve before running; retain rejected browser records; status only, no fresh ErrorV1 |
| `oe_session_advance` | Commits to finite monotonic beatmap time; returns kind 19 | Drains input first; serializes all objects, unsuitable as final render transport |
| `oe_session_snapshot` | Samples readonly committed outcomes and slider positions at arbitrary finite time | No judgement/audio production; invalidates prior snapshot token |
| `oe_session_acknowledge` | Acknowledges both journals through current snapshot token; same-token retry is idempotent | Admit all durable output before acknowledgement; save admission watermark separately |
| `oe_session_pause` | Release at boundary, freeze, increment engine epoch; queued future inputs survive | Do not cancel or retime accepted future input |
| `oe_session_resume` | Kind 22, exact paused beatmap time, rate 1; new engine epoch | Audio seconds validated but not stored as a browser clock mapping |
| `oe_session_reset` | Allocation-free; invalidates token, increments epoch; retains sample availability | Clear browser session watermarks only with successful reset |
| `oe_session_result` | Terminal kind 24 and kind 26 counts; profile/digests/zero offsets | Copy before next output; UI must not recalculate score |
| `oe_session_replay_load/export/seek` | Identity/checksum validation; terminal export; initial-checkpoint resimulation | Import may reserve inbox; seek suppresses historical sound and changes epoch |
| `oe_session_bind_sample` | Kind 28, READY only; first available prepared candidate wins | Supply availability, not browser-selected fallback; asset 0 means missing |

Kind 19 has committed time, score/health/combo, result/head times, tracking,
rotation and slider position. It lacks child feedback history after journal
acknowledgement, cursor trail, active-set indices, render transforms, static
resources and GPU generations. Kind 27 is **one-shot only**: it has no voice ID,
loop state, pan, rate, ramp or lateness policy. Its kind field is always 1.
Auxiliary sample preparation does not establish loop voice execution.

The input profile currently requires `raw_time_ms == effective_time_ms`, rate 1,
and zero offsets. `raw_time_ms` here is beatmap-relative; DOM receipt time must
remain a separate browser diagnostic. Equal committed-time input is admitted;
only earlier input is late. This corrects stale prose in the ABI chapter.

## Implemented coordinate extension

Append kinds 29 (viewport) and 30 (playfield transform); expose
`oe_playfield_transform(engine, viewport_mailbox, output_mailbox)`. It calls the
existing independent Odin transform without allocating. It publishes only after
full validation; failures preserve prior output. The returned span uses the
instance mailbox and lasts until another transform call. Consumers copy scalar
coefficients immediately. Export discovery establishes coordinate conversion only;
no presentation, WebGL or playable capability is implied.

The browser session bridge uses existing generated records, explicit inbox
reservation and owned diagnostic output copies. Its full kind-19 scan/copy is
intentionally not a completed allocation-free render path. No JS hit-object
state or judgement logic is introduced.

## Remaining presentation/resource contract

These definitions constrain the next implementation; they are not advertised
wire records or completed capabilities. Assign concrete new kinds when writers,
readers and conformance tests land together, preserving kinds 1–30.

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
| Presentation / A22 | Circle preempt/fade/approach/feedback, slider body/ball/follow/repeats, spinner states | Source chapters and local coordinates only; drawable adapter absent |

The pinned component command was executed successfully with the real clean
checkouts and locked restore in this worktree: 104 local primitive fixtures and
72 pinned comparisons. It is not a substitute for the absent adapter entry
points above. Step 1 remains open until those executable fixture entry points
and remaining concrete resource/audio bindings are implemented. No acceptance
row closes on this audit.

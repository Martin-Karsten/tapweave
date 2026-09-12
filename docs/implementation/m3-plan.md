# M3 — Odin presentation and browser runtime

Status: independent browser foundations are in progress; see [execution report](m3.md).
This plan preserves the approved M2 prerequisite gate. M2's independent primitives
are not complete gameplay support.

## Objective and defaults

Deliver a Tapweave validation player for the pinned unmodded lazer osu!standard
profile: local archive/map loading, difficulty selection, synchronized play,
pause/resume, retry, results and diagnostics. Production rate is 1.

Use Odin for presentation and audio intent, WebGL2 for rendering, one Web Audio
clock, and a thin JavaScript browser executor. Use a separate browser package
with exact fflate/Playwright dependencies, a lockfile, plain modules/HTML/CSS,
local dependency assets and Node 24 tooling. Keep engine tooling dependency-free.

Persistent libraries, accounts, network features, editing, submissions, skins,
storyboards, mods, mobile certification and M4's large corpus/soak work are deferred.

## Maintainability requirements

- Follow the existing acyclic package dependency table and accepted ADRs.
- Generate Odin/C/TypeScript/executable JavaScript ABI bindings from one schema.
  Do not duplicate byte offsets or serialization policy in browser consumers.
- Centralize playfield transforms, clock conversion, lifecycle transitions,
  browser asset ownership, input aggregation and output acknowledgement.
- Odin selects prepared sample candidates; JavaScript reports availability and
  executes selected asset IDs. Rendering cannot judge or emit duplicate audio.
- Reuse prepared paths, immutable meshes, decoded assets and reserved storage.
  Ordinary frame cost scales with active objects, not the entire map or duration.
- Extract abstractions around actual shared responsibilities. Avoid generic
  managers, plugin systems and speculative deferred-ruleset hooks.
- Use expressive names in handwritten Odin, JavaScript, shaders and tests.
  Include units and role-specific loop indices. No abbreviated state/resource
  identifiers; use `presentation_time_ms`, `audio_anchor_seconds`,
  `slider_vertex_index`, `available_output_bytes` and similar explicit names.
- Preserve existing public names and upstream reference identifiers where required.

## Ordered implementation

### 1. Contracts and M2 gates

Verify production start/advance/pause/resume/reset/terminal transitions; readonly
committed object outcomes/timestamps, tracking, spinner and HUD state; durable
sequence/epoch/voice audio output; frozen availability; retained output drain/ack;
immutable final results; and allocation-free snapshot/advance.

Require M2 A13–A20/A23 and H05–H10 acceptance before integrated gameplay claims.
Independent presentation fixtures must supply explicit snapshots, never substitute
simulation. M2 remains responsible for authoritative sample eligibility and
transition timing. Odin derives presentation and loop envelopes independently of
snapshot cadence; repeated snapshots cannot duplicate events.

### 2. Browser package and ABI bridge

Create `platform/browser-js` with narrowly allowlisted root inclusion. Provide
static assembly/loopback serving, pinned dependency installation and automated
browser tests. Ship a production WASM transport without test trace exports.

Centralize capability negotiation, structured errors, tokenized reserve/copy,
lossless u64 identities, generated readers/writers, output lifetime copying and
view reacquisition after every potentially growing call, including failures.

### 3. Pinned evidence

Extend the verified reference host with A22 preempt/fade, approach state, hit/miss
feedback, slider head/body/ball/repeat/follow, spinner and pause observations.
Complete H11 for sample requests, loops/ramps, missing assets, rapid toggles and
future nominal tails. Use the manifest-pinned checkouts and controlled schedules.

Retain source/fixture/lock hashes and acceptance IDs. Preserve frame-dependent
classifications and numeric envelopes. Do not promote a local implementation or
single upstream cadence into an oracle.

### 4. Odin presentation

Build readonly time-derived circle/slider/spinner visuals, approach circles,
feedback, cursor/trail, follow points and HUD. Reuse prepared geometry and committed
transition timestamps, maintain a bounded active set and stable alpha ordering,
and fully reset reusable state. Use original Tapweave graphics with Odin-owned
palette/atlas/shader intent and a fixed HUD glyph atlas. Attribute fallback sounds.

### 5. Meshes and WebGL2

Construct static slider meshes with checked count/fill and work limits during
resource creation. Upload once per map/context generation; frame data contains
compact instances and uniforms. Generate versioned resource and draw batches in
Odin. Validate whole command groups before executing browser resource publication.

Use keyed WebGL resource tables, bounded uploads and adjacent compatible batching
without order changes. No per-hit-object JavaScript state, per-frame static
rebuilds or shader compilation. Context absence reports render-unavailable;
context loss uses shared pause/release/rebuild/resume.

### 6. Archives and assets

Support one local `.osz` or `.osu` plus loose assets. Normalize paths and reject
unsafe/ambiguous entries, unsupported archive features and malformed structure.
Bound compressed/actual extracted bytes, entry count, decoded audio and GPU assets.
Use streaming decompression and validate checksums. Decode only selected assets.

Use stable IDs and frozen Odin availability. Missing music blocks production start;
explicit diagnostic mode may be silent. Missing hitsounds resolve through Odin's
ordered candidates to silence with diagnostics. Resource scopes share decoded
assets across sessions/difficulties, publish transactionally, cancel stale loads
and clean every node, image, GPU resource, buffer and object URL.

### 7. Input and clock/audio execution

Use the ADR-004 audio anchor and immutable offsets once per running epoch. Capture
DOM receipt time/action state/inverse transform, flush before advance, preserve
future timestamps and reject late input without clamping. RAF never judges.

Default controls: Z/primary mouse -> left; X/secondary mouse -> right; Escape ->
pause; primary touch -> cursor/left. Additional touches do not create gameplay
cursors. Aggregate physical sources, suppress key repeats and release on cancel
or focus loss. DPR changes framebuffer resolution, not logical input coordinates.

Execute one-shot, loop-start/stop and ramp intent with an initial 25 ms lookahead,
explicit late policies, voice accounting and epoch cancellation. Schedule only
known events; do not simulate into the future. Recreate music/source nodes on
resume and keep replay timestamps beatmap-relative.

### 8. Lifecycle and validation UI

One controller coordinates loading, ready, running, paused, recovering, terminal
and disposed browser states around engine authority. Pause drains accepted input
to the boundary, releases actions, invalidates audio and saves position. Resume
requires a gesture, running audio, valid graphics and the engine resume gate.

Provide loading/difficulty/error flows, start/resume, canvas/HUD, pause/retry/back,
FinalResultV1-based results and collapsible exportable diagnostics. Use semantic
DOM controls and Tapweave visual identity. Keep internal diagnostics outside play.

## Public contracts and memory

Concretize PresentationBatchV1, versioned static resource batches, viewport/DPR
submission, asset availability/readiness, audio sequence/epoch/voice/policy records
and capability versions. Reuse M2 lifecycle and acknowledgement APIs. Extend ABI
v2 append-only, updating ADRs, schema and generated bindings together.

Validate checked spans, opaque handles, versions and capacities transactionally.
Allocate only in creation/reserve, retain unacknowledged outputs, and never silently
truncate. Keep session/map/frame/browser lifetimes explicit. Report live arenas
separately from WASM pages and decoded/GPU assets.

## Validation and exit gates

- A12: corner/centre/outside coordinates, aspect/DPR and resize-after-receipt;
  round-trip error <=1e-6.
- A22: boundary visual states, degeneracy/reversal, feedback, spinner and ordering.
- A21/H11: offsets, missing assets, future tails, loops/ramps, epochs and suspension.
- ABI: invalid records/spans/versions, stale handles/generations, growth and retries.
- Assets: malformed/oversized archives, decode failure, cancellation/replacement.
- Lifecycle: fifty alternating loads, four shared sessions, repeated reset/dispose,
  context recovery and no leaked live resources.
- Exact gameplay traces under direct advance, 30/60/120/144 Hz and 50/100/250 ms stalls.

Run allocation-tracked Odin tests, native/WASM traces, browser service tests and
Playwright Chromium/Firefox/WebKit checks. Actual desktop Chrome/Firefox/Safari,
audible playback and real applicable input require separate recorded validation.
Screenshots aid visual review; state/command evidence governs compatibility.

Measure cold/warm loading, prepare/decode, simulation, presentation, tessellation,
bridge/upload, JS submission, GPU where available, frame pacing, audio lateness/drift,
arenas/pages/heaps/assets and queues separately. Use tiny, dense, long, 10,000-object
and three-minute replay fixtures. Record hardware/browser/fixture details; approve
an initial numeric baseline before making regression claims.

M3 completes only after M2 prerequisites, A12/A21/A22, H11 resolution/classification,
real browser play, cadence-independent gameplay, lifecycle recovery and approved
performance gates pass. Capabilities and status must reflect executed coverage.

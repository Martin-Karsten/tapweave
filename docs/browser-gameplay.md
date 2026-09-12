# Browser gameplay plan

Play remains disabled. Only partial W01 and the W03 active-projection foundation
are implemented; no unit below is complete. [Current status](status.md) owns
implemented coverage, the [reference harness](compatibility/reference-harness.md#remaining-gameplay-adapters)
owns missing adapters, and the ADRs own resource/audio requirements.

## Target and scope

Deliver a playable Tapweave validation player for pinned, unmodded lazer
osu!standard: local map-set loading, difficulty selection, synchronized play,
pause/resume, retry, results and diagnostics. Production rate is 1. Use the
revisions in `engine/reference/source-manifest.json`, never upstream HEAD.

Odin owns deterministic gameplay, presentation, sample selection and audio intent.
JavaScript owns browser resources and executes generated ABI commands. Use WebGL2,
one Web Audio clock, plain modules and the existing browser package. Preserve
Tapweave naming and third-party attribution. No new framework or npm dependency
without a concrete requirement.

Mods, other rulesets, skins, storyboards, accounts, networking, editing, score
submission, legacy replay containers, difficulty/pp and mobile certification are
out of scope. M4 retains the 10,000-map corpus and eight-hour soak; M3 still needs
its bounded workload, lifecycle and release-browser validation below.

## Completion checkpoints

There are two distinct checkpoints, both inside M3:

- **Integrated gameplay:** circles, sliders and spinners can be played with actual
  input/music, Odin judgement/render/audio authority, pause/retry/results and
  lifecycle recovery. Until integrated capability gates pass, exercise it through
  explicit developer fixtures with production Play disabled. Once they pass,
  expose the validation player with accurate remaining-acceptance status.
- **M3 complete:** integrated gameplay plus all required pinned M2/M3 acceptance,
  real release-browser/input/audio validation, resource tests and approved measured
  performance. Do not mark M3 complete at the first playable scene.

A circle-only demo, mock audio or connecting the existing full-map snapshot to RAF
satisfies neither checkpoint. Missing implementation is work to complete; browser
installation, physical hardware access and baseline approval are separate external
constraints. M4 does not absorb unfinished M3 gameplay or acceptance.

## Reviewable implementation units

Use these units as the implementation checklist. The numbered sections below
specify their acceptance requirements.

| Unit | Depends on | Concrete deliverable | Review/exit evidence |
|---|---|---|---|
| W01: transport contracts | Existing session/output ABI | Append-only render/static-resource/audio schemas, quota/reserve paths, capability flags, readonly projection and efficient advance/output calls; update ADRs and generate all bindings | Native C/WASM layout and malformed-span tests; old kinds 1–34/exports remain valid; exact lifetime/ack contract |
| W02: executable reference adapters | W01 fixture contracts | Pinned whole-session/drawable adapters and named fixture entry points for H05–H11 and A22; compare local and upstream projections with schedule envelopes | Real locked restore and observation hashes; coverage manifest distinguishes executable scenarios from absent ones |
| W03: Odin presentation | W01, relevant W02 observations | Bounded active/feedback sets; circle/slider/spinner states, approach/fade/feedback, cursor/trail, follow points and HUD | Native/WASM traces, readonly/repeated-snapshot tests, stable order, reserve/failure tests; no ordinary full-map frame scan |
| W04: meshes and WebGL2 | W03 | Counted reusable slider geometry, original atlas/shaders, static resource publication and thin bounded JS command executor | Degenerate/reversing/overlapping scenes, invalid-command tests, upload-once counters and context-generation tests |
| W05: authoritative audio | W01, relevant W02 observations | Asset candidate enumeration/availability binding, fallback assets, Odin voices/loops/ramps/late policy, generated queue ingestion and durable acknowledgement | H11 comparisons, missing assets, future tails, duplicate admission/ack retries, quotas and rapid-toggle cleanup |
| W06: gameplay frame/input | W04, W05 | DOM bindings and event-time transforms; immutable audio/session anchor; reusable input/output buffers; one frame driver and integrated music | A12 round trips, release/cancel tests, direct/rate/stall canonical digests matching headless fixtures |
| W07: lifecycle and results | W06 | One lifecycle controller, Play gating, pause/resume/retry/back, terminal results, focus/audio/GPU recovery and async invalidation | Complete circle/slider/spinner pass/fail playthroughs; no stale nodes, resources, callbacks or duplicated sound |
| W08: close compatibility gaps | Start with W02; finish after W07 | Correct any engine/recorder/presentation/audio discrepancies, rerun full scenarios and record accepted classifications | M2 A13–A20/A23, M3 A12/A21/A22, H05–H11 supported by appropriate evidence |
| W09: resource/performance matrix | Instrument W03–W07; execute after W07 | Required load/share/reset/failure workloads and per-stage timing/ownership diagnostics | No retained-resource growth; measured p50/p95/p99 and explicitly approved numeric thresholds |
| W10: release validation and delivery | W08, W09 | Chromium/Firefox/WebKit automation, actual desktop Chrome/Firefox/Safari with applicable physical inputs/audible output; coordinated docs/findings update | All M3 gates pass; remaining limitations explicit; only then mark M3 complete |

W02/W08 acceptance investigation continues while independent implementation
progresses. For behavior still awaiting executable observations, use clearly
labelled fixtures based on pinned source and keep the affected acceptance gate
open. Do not invent constants, silently choose a frame schedule or block unrelated
resource/transport work. This dependency order does not require spawning agents.

## Delivery order

Each numbered step is a reviewable increment with its own tests and status update.
Steps 2–4 may develop against explicit fixtures after step 1 defines their
contracts. Step 5 consumes steps 2–4; step 6 consumes step 5; step 7 closes the
milestone. M2 acceptance work starts in step 1 and continues alongside independent
M3 work, but must finish before an integrated compatibility claim or M3 completion.
No elapsed-time estimate substitutes for an exit gate.

### 1. Specify remaining transport contracts

Primary areas: `engine/runtime/`, `engine/audio_protocol/`, `engine/abi/`,
`docs/architecture/`, and the existing reference hosts.

- Consume the existing [session ABI](architecture/interface-v2.md#m2-headless-session-transport).
  Preserve all existing record layouts, exports,
  prepared identity and foundation behavior. Finish concrete schema/transport
  definitions and executable fixture entry points listed below.
- Consume the implemented compact advance/output and independent projection APIs.
  Keep kind-19 diagnostic snapshots available; use kind 31 for durable events/HUD
  and kinds 32/33 for active projections. Extend these contracts for remaining
  animation/resource output with explicit token, retry and invalidation rules.
- Define separate lifetimes for retained gameplay/audio journals, reusable render
  output and static resources. Presentation reads must not invalidate pending
  audio acknowledgement or erase feedback required after gameplay journal ack.
- Specify versioned presentation batches, static resources, transforms, texture
  availability and explicit audio voice/loop/ramp records. Specify quotas,
  reserve paths, lifetimes, failure behavior, capabilities and acknowledgement.
  Keep old kind-27 readers valid; do not reinterpret one-shot records.
- Reuse the implemented explicit session/browser epoch mapping and media anchor.
  Define its lifecycle binding/invalidation for start, pause, resume, reset, seek
  and replacement. Freeze offset components once and keep DOM receipt diagnostics
  separate from ABI beatmap-relative timestamps. Current M2 requires equal raw/
  effective input times, rate 1 and zero offsets. Resolve A21 offset-vector support
  explicitly: any nonzero production profile needs a compatible clock/creation
  extension and replay/result identity metadata, with the old zero-offset profile
  preserved. Do not silently enable it through the independent JS clock.
- Extend the implemented readonly simulation projection for animation/feedback
  without runtime imports, cycles or owning-state copies. Follow the package
  dependency table and update the relevant ADR for ownership/contract changes.
- Establish the remaining M2 acceptance matrix: H05–H10 with complete
  circle/note-lock, slider tracking, spinner, score/health/failure and replay
  observations; A13–A20/A23 remain open until their full scenarios are verified.
  Include the recorder cadence/angular subdivision gaps in the reference harness.

Exit: reviewed ABI/ADR definitions, generated-binding conformance tests, an
explicit dependency/acceptance matrix and executable reference fixture entry
points. No acceptance row closes on schema work or local parity alone.

### 2. Build pinned presentation and audio evidence

Primary areas: existing reference hosts, `engine/reference/findings/`, reference
chapters and compatibility traceability.

- Execute A22 observations for preempt/fade boundaries, approach circles,
  hit/miss feedback, slider head/body/ball/repeats/follow and spinner states.
- Execute H11 for sample resolution, missing candidates, nominal future tails,
  slider tracking loss/recovery, spinner ramps, rapid toggles and pause/resume.
- Run relevant drawable schedules at 30/60/144 Hz and with stalls. Preserve exact
  discrete expectations and explicit frame-dependent envelopes; never choose one
  cadence as universal behavior. Resolve conflicts at the strongest evidence level.
- Retain source revisions, fixture hashes, lock hashes, observation hashes,
  acceptance IDs, comparison commands and unresolved classifications. Use real
  pinned source/locked restore; do not fabricate oracle output or refresh goldens
  merely to make comparisons pass.

Exit: reproducible evidence for the presentation and audio policies to implement,
with any unresolved cases explicitly blocking the affected acceptance rows.

### 3. Implement Odin presentation and WebGL2 execution

Primary areas: `engine/presentation/`, a new `engine/render_webgl/` package,
runtime/ABI transport and the browser renderer.

- Derive circle, slider and spinner presentation from prepared data and committed
  outcomes at requested presentation times. Implement approach/fade/feedback,
  cursor/trail, follow points and HUD. Snapshot calls cannot judge, advance health
  or duplicate audio intent.
- Extend the existing bounded active projection with animation/feedback lifetimes
  and stable draw order. Ordinary frame work must scale with active objects;
  preserve reusable storage and source IDs.
- Count/validate/reserve slider meshes and static resources before publication.
  Reuse prepared paths; use checked u64 arithmetic and WASM32 bounds. Handle
  degenerate paths, reversals and dense overlapping geometry.
- Generate original Tapweave atlas/palette/shader intent in Odin. Implement a thin
  JS WebGL2 executor with validated commands, resource generations and bounded
  uploads. Upload static meshes once per map/context generation; no per-hit-object
  JS state, hot-path allocation/growth, shader compilation or static rebuilds.

Exit: native/WASM presentation traces, A22 comparisons, allocation-failure and
quota tests, stable draw-order/mesh tests, browser command checks and inspected
rendered scenes. Unsupported WebGL2 returns an explicit unavailable state.

### 4. Complete assets and authoritative audio intent

Primary areas: `engine/audio_protocol/`, Odin intent producers, ABI, browser
assets/audio/clock services and third-party notices.

- Decode selected music/hitsound assets and provide stable availability IDs to
  `oe_session_bind_sample` before start. Odin chooses candidates in prepared
  order. Missing music blocks production start; missing hitsounds warn and resolve
  through Odin to silence. Supply original or properly licensed fallback assets.
- Extend Odin intent with explicit voice identities, loop transitions, parameter
  ramps and late policies following step 2. Derive them from semantic transitions,
  not RAF sampling; preserve ordered retained output and acknowledgement semantics.
- Consume production events through generated readers. Define queue admission and
  acknowledgement so retries cannot double-play audio and failed admission does
  not lose unacknowledged intent. Preserve future nominal-end timestamps.
- Integrate the existing music transport with start/seek/pause/resume on the
  same AudioContext and anchor used by simulation. Apply offsets exactly once; freeze position while paused; recreate
  one-shot nodes on resume. On dispatch failure cancel playback and enter explicit
  recovery, following ADR-004.
- Extend the existing two-decode/128 MiB admission and per-source in-flight reuse
  to music/hitsound loading; bound concurrent reads and all retained resources; keep candidate cancellation independent of
  uninterruptible browser decoding. Document internal decoder peak-memory limits.

Exit: H11 intent comparisons, A21 scheduling/offset/epoch fixtures, missing-asset
behavior, voice/ramp cleanup and queue-retry tests, plus real audible music and
hitsound checks. Mock audio alone cannot close this step's output validation.

### 5. Integrate gameplay input, session bridge and frame scheduling

Primary areas: `platform/browser-js/src/engine-bridge.mjs`, input/clock services,
controller, runtime snapshot/output transport and browser integration tests.

- Reuse existing generated-record session operations; add efficient event/render
  readers, extending W01 for draw commands. Keep the diagnostic full-map copier
  outside the frame path. Reserve/reuse
  input, command and event storage before play. Reacquire WASM views after every
  potentially growing call, including failures; copy only data needing retention
  into bounded owned storage and validate every output span. Test allocation and
  growth in both Odin and the handwritten browser hot path.
- Wire Z/primary mouse to left, X/secondary mouse to right, Escape to pause and
  primary touch to cursor/left. Aggregate physical bindings, suppress repeats,
  prevent relevant browser defaults and release on cancel/focus loss. Additional
  touches do not create gameplay cursors.
- Snapshot Odin's inverse transform and receipt time at each event. Account for
  canvas placement, resize and DPR. Map DOM time into the immutable audio anchor
  explicitly; preserve input sequence and future timestamps without clamping.
- Use one frame driver: drain accepted input before advancing to audio time,
  consume/acknowledge durable outputs exactly once, then request presentation and
  execute rendering/audio. RAF cadence must never determine judgement policy.
- Handle quota, late-input, stale-handle and output failures as explicit states.
  Retain rejected input for recovery; do not silently discard or retime it.

Exit: A12 round-trip error <=1e-6, real input release tests, and identical canonical
judgement/audio-intent/final digests under direct advance, 30/60/120/144 Hz and
50/100/250 ms stalls. Browser results must agree with the same headless fixtures.

### 6. Complete lifecycle, results and playable validation UI

Primary areas: one browser lifecycle controller, main UI and resource owners.

- Coordinate loading, ready, running, paused, recovering, terminal and disposed
  states around engine authority. Preserve a valid selection on failed replacement.
- Pause by draining input to the boundary, releasing actions, invoking engine
  pause, invalidating audio and saving media position. Preserve queued future
  input according to the existing M2 contract. Resume requires a gesture, running
  audio, valid graphics and a valid engine anchor.
- Route focus loss, context suspension/loss, audio execution failure and map
  replacement through consistent cleanup/recovery. Rebuild GPU resources from
  owned immutable data after restoration. Invalidate stale asynchronous callbacks.
- Implement retry/reset, back/difficulty navigation and terminal results directly
  from the engine final-result record. Keep diagnostics separate from gameplay;
  expose actionable missing-resource/recovery messages.
- Enable Play only after required engine/browser capabilities, frozen assets and
  integrated lifecycle are ready. Until integrated gates pass, keep experiments
  in explicit test/diagnostic fixtures and make no compatible-player claim.

Exit: complete circle/slider/spinner playthroughs, pass/fail results, repeated
retry/pause/resume and recoverable context loss with no stale nodes, handles,
inputs or output playback. Keyboard navigation and error flows remain usable.

### 7. Close acceptance, resource and performance gates

- Run full engine checks with Node 24 and checksum-pinned Odin. Run browser service
  and Playwright Chromium/Firefox/WebKit tests in CI and locally where available.
  A missing browser executable or download timeout is an unexecuted gate.
- Validate actual desktop Chrome/Firefox/Safari, audible playback and applicable
  physical mouse/keyboard/touch inputs. Record OS/browser/hardware, commands and
  measured results. Playwright WebKit is not Safari release certification.
- Exercise fifty alternating small/large loads, four sessions sharing a map,
  repeated resets/disposals, cancelled decodes, failed replacement, memory growth,
  output overflow and context/audio recovery. Track live ownership independently
  of committed WASM pages; require no retained-resource growth after release.
- Measure tiny/dense/long maps, a 10,000-object fixture and a three-minute mixed
  replay. Separate prepare/decode, simulation, presentation, tessellation, bridge,
  upload, JS submission, GPU where available, frame pacing, audio lateness/drift,
  arenas/pages/heaps/assets and queue high water. Record p50/p95/p99 where relevant.
- Propose and approve numeric performance thresholds from recorded hardware and
  workload baselines before closing performance gates. The required measurements
  are known; threshold values are not yet established and must not be invented.
- Close M2 A13–A20/A23 and M3 A12/A21/A22 with appropriate pinned evidence and H11
  resolution/classification. Update findings, traceability and current status together. Local parity and screenshots alone never close upstream gates.

Exit: a playable browser milestone with all required acceptance rows supported,
no unresolved resource/lifecycle failures, and approved performance results.
Only then mark M3 complete and advertise its implemented capabilities.

## Validation and delivery

Follow AGENTS.md and the accepted ADRs. Run the full engine suite for engine or
tooling changes and relevant browser service/session/integration checks. Record
executed comparisons in hashed findings and update current status and acceptance
classifications. Commit messages retain implementation history; do not add another
milestone report or progress ledger.

For external validation limits, record the attempted command/environment and
its affected gate. Obtain physical input/audible-output results and performance
approval against a concrete running player and recorded measurements.

## Detailed remaining W01–W03 plan

This section is the execution breakdown for W01–W03, not an additional milestone.
It supersedes stale task descriptions that list compact output or the initial
active set as absent. No W01–W03 unit is complete. Completing these units supplies
contracts, executable reference evidence and Odin presentation for W04–W07;
it does not itself produce the playable MVP.

### Current implementation and gaps

| Responsibility | Reuse | Still required |
|---|---|---|
| Advance/HUD/journals | `oe_session_advance_output`, kind 31; existing result/replay/sample operations | Durable admission integration; avoid kind-19 diagnostics in normal frames |
| Projection | `simulation.project`/`project_object`; kinds 32/33 | Component outcomes/history, cursor history and visual parameters instead of raw projections alone |
| Active membership | Creation-time reveal sort, stable source indices, epoch/backwards rebuild | Proven expiry policies, feedback membership, burst cost bounds and terminal behavior |
| Lifetimes | Presentation buffer separate from gameplay output; kind-34 narrow capabilities | Shared map render attachments, per-context generations, final frame and voice lifetimes |
| Browser readers | Generated `readRecordInto`, reusable `Gameplay_Output`/`Presentation_Output` | Readers/validators for actual draw/resources/voice commands; allocation measurements |
| Reference host | Real pinned decoder/preparation and 72 simulation component comparisons | Actual controlled drawable/session/input/audio observations; component calls cannot substitute |

The current 800 ms retention constant is conservative object membership, not a
verified hit-animation or feedback policy. `Projection` borrows only top-level
outcomes; acknowledging the journal must not prevent future child feedback.
The active set's source-order insertion can become quadratic for adverse reveal
ordering, and backward reads rebuild preceding reveals. Both need explicit work
accounting; the existing sparse 10,000-object test does not establish dense limits.
Simulation still scans objects in `press`/`apply_input` and sample bindings when
emitting hitsounds. The removed completion scan does not resolve those costs.

### W01 — Finish executable transport and ownership contracts

**W01.1 — Define the minimum records and fixture envelope.**
Use `engine/abi/records.json` and the existing generator as the wire authority.
Preserve kinds 1–34, all exports and prepared/replay identity. Assign additional
kind IDs only alongside writers, readers and conformance tests. Do not publish
empty capability declarations as implemented features.

Define these concrete payloads:

| Payload | Required content and purpose |
|---|---|
| Render-resource descriptor | Prepared identity, logical attachment ID/version, total bytes, relative vertex/index/atlas/shader spans; enough metadata for validation and one-time upload |
| Frame header | Session epoch, referenced resource identity, viewport/transform identity, sampled and committed times, HUD, typed batch/instance spans |
| Batches and instances | Explicit primitive/layer order, source/component IDs, bounded resource/geometry ranges, transforms, colour/alpha and texture region; JS executes these values without deriving animation |
| Voice commands | Sequence, epoch, time, voice ID, asset ID, command kind, volume/pan/rate, ramp duration/mask and late policy |
| Capacity/reserve records | Requested and required capacities for each independently bounded resource; typed quota/failure results and a defined publication boundary |
| Reference fixture envelope | Fixture/source hash, profile, map/input stream, lifecycle actions, update schedule and requested observation fields |

Keep logical immutable resource identity distinct from browser GPU context
generation. Do not store WebGL handles in the ABI. Keep kind 27 one-shot semantics
unchanged; specify how legacy and new audio consumers avoid duplicate delivery.
For every record specify units, valid enums/ranges, alignment, reserved fields,
empty-span behavior, unknown-version rejection and lifetime. Header offsets and
field access come from generated bindings.

**W01.2 — Implement count/reserve/publication paths.**
Runtime owns a render attachment retained with its prepared map; four sessions
can borrow it without duplicating immutable geometry. Session storage owns dynamic
instances, feedback/trail buffers and audio journals. Browser scopes own decoded
assets and GPU resources. Reserve or replace dynamic capacity only in the accepted
READY/PAUSED states; preserve the previous usable candidate on failure.

Count with checked u64 arithmetic and WASM32 bounds before allocation. Derive
required capacities from the map, accepted input capacity and actual primitive
expansion. Loop toggles and ramps cannot be bounded by object count alone. Define
finite safety quotas independently of later performance thresholds; justify the
chosen defaults with count-pass workloads rather than inventing p99 targets.
Overflow must report required capacity without truncation or partial publication.
W01 implements and tests the resource container using small real payloads;
W04 remains responsible for full mesh/atlas/shader generation and GPU upload.

**W01.3 — Finish durable output semantics.**
Specify and implement the state transitions for an unacknowledged batch, an
admitted browser batch, acknowledgement retry, dispatch failure and epoch change.
Use a retained session/epoch/sequence watermark so a new snapshot token cannot
re-enqueue previously admitted events. Admit all required events transactionally
before acknowledging them. Rejected admission leaves pending events recoverable;
failed acknowledgement retries without playing them again. Preserve nominal
future tail timestamps exactly. Specify which events survive pause or are
cancelled/reconstructed, using H11 findings before enabling new voice capability.

Keep frame reads independent of audio acknowledgement and component feedback.
Test result/replay/diagnostic reads interleaved with production reads. Preserve
existing acknowledgement behavior for legacy consumers. W01 delivers the wire,
retention and admission protocol with executable transport tests; W05 implements
and validates the complete browser voice executor and asset integration.

**W01.4 — Extend the readonly projection and account for remaining frame costs.**
Expose component outcomes and semantic cursor/feedback history through borrowed
non-owning views or narrow accessors. Do not expose owning session state or allow
presentation to dispatch rules. Give each history its own consumption/expiry
rules rather than reusing the browser journal acknowledgement cursor.

Instrument candidate visits, sample-binding visits, active insertion work and
serialized/uploaded bytes. Where measurements expose full-map hot work, introduce
creation-time indices/ranges over existing state: sample ranges per object or
component, and ordered eligible input candidates. Preserve note-lock predecessors,
equal-time source order and forced misses. Do not replace rules with a culling
approximation or duplicate an independently maintained object model. Verify the
same judgements and audio before accepting any indexing change.

**W01.5 — Bind capabilities and clock identity precisely.**
Advertise compact output, projection, animation, static resources, draw protocol
and voice intent separately, only when their implementations pass contract tests.
Aggregate Play remains unavailable. Reuse the existing immutable session/browser
clock mapping and specify start/pause/resume/reset/seek/replacement invalidation.
Production remains rate 1 with all offsets zero. Record nonzero A21 vectors as
unsupported production profiles until creation/replay/result identity contracts
are extended and verified; independent clock-service tests do not enable them.

**W01 validation and exit.**
Generate Odin/C/JS/TS bindings together. Test malformed/overlapping/truncated spans,
unknown kinds/versions, stale resource IDs/epochs/handles, quota boundaries,
allocation failure at each candidate allocation and unchanged prior publication.
Exercise four sharing sessions, reset/seek/disposal, independent output lifetimes,
future one-shots and duplicate admission/ack retries. Prove no Odin hot-path
allocation or WASM growth; measure browser reader allocations rather than assuming
container reuse eliminates all VM allocations. Update ADR-003/004/005 and the ABI
chapter for actual ownership/contract changes. W01 closes when these transports,
reserve paths and readers are executable, not when schemas alone are written.

### W02 — Build and run actual pinned scenario adapters

**W02.1 — Establish a controlled executable host.**
Extend the existing reference host/runner rather than creating a second competing
oracle framework. Verify both manifest commits and clean checkouts; restore in
locked mode. Load the actual pinned drawable/ruleset/player objects needed for
each observation, with explicit clock, input, configuration and resource setup.
Feed timestamped input through the actual upstream input path and advance its
update clock through declared schedules. Merely invoking private judgement
methods or reproducing their calculations is not a whole-scenario adapter.

First prove one circle fixture traverses input, judgement, score and teardown
through upstream code. Record loaded source/version/profile and all required
configuration. If drawable loading requires a graphics/display backend, implement
that host path and record the real dependency; continue independent W01/W03 work
while unavailable external host resources are resolved. A placeholder command
that reports unsupported does not count as an executable scenario.

**W02.2 — Add observations at the right boundaries.**
Capture actual emitted judgement/result order, score/count/health transitions,
fail/terminal state, recorder frames, sample resolution/play/stop/parameter
requests, and drawable visual properties after each scheduled update. Observe
audio intent before device mixing so traces remain meaningful without claiming
audible-output validation. Preserve actual timestamps, source/component mapping
and ordering. Normalization may remove incidental runtime IDs; it must not sort
away event order, clamp times or calculate substitute upstream results.

**W02.3 — Implement and execute the scenario matrix.**
The IDs below follow the canonical traceability mappings. Expand each family
into named positive, boundary and failure fixtures; retain coverage per fixture,
not a single boolean for the entire harness.

| Family | Minimum scenario groups | Required observations | Acceptance |
|---|---|---|---|
| Circle/head dispatch | Every exact and adjacent IEEE hit-window boundary; overlap, held/repeated edges, note lock, earlier skipped objects and equal-time source ties | Input selection, result order, offset/cause and score transition | H06; A13–A14 |
| Slider/tracking/order | Early/late/missed head, acquisition/loss/recovery, action restrictions, sparse motion, repeats/ticks, early tail with nominal future sample, equal-time nested/parent results | Tracking transitions, child/parent results, ordered samples and score | H05/H07; A14–A15/A20 |
| Spinner/recorder | Thresholds, bonus, centre/dead-zone movement, reversal, 180-degree crossing, >90-degree input segments, sparse/dense samples and recorder subdivision | Rotation/progress, results, emitted recorder frames and replay outcome | H08; A16/A23 |
| Player score/health | HP0/5/10, breaks, combo ends, mixed results, failure crossing/freeze and terminal rank | Every score/count/combo/health transition and final record | H09/H10; A17–A19 |
| Samples/loops | Ordered candidates and missing assets, future tails, tracking toggles, spinner volume/frequency ramps, replacement of in-flight ramps, pause/resume | Selected asset, requested time, voice play/stop and parameter changes | H11; A20–A21 |
| Drawable presentation | Reveal/preempt/fade boundaries, approach circle, hit/miss feedback; slider body/head/ball/repeats/follow; spinner activation/progress/feedback | Visibility, transforms, alpha, progress and child lifetime | A22 |
| Replay/lifecycle | Same recorded stream across schedules, pause release/future input, final results and recorder/replay round trip | Frames, judgement/audio/final traces and identity | A23, with relevant H05–H10 families |

**W02.4 — Compare schedules and retain evidence.**
Run relevant upstream drawables at 30/60/144 Hz and 50/100/250 ms stalls placed
before, at and after critical boundaries. Include the specified higher-density
spinner schedules. Run local native/WASM direct/event stepping plus
30/60/120/144 Hz against the same timestamped fixture inputs. Upstream must have
an explicit update schedule; do not assume direct-final advancement is equivalent
to a drawable run.

Compare discrete fields exactly when the upstream schedule matrix agrees.
For frame-dependent fields retain each schedule and an explicit measured envelope;
do not select one cadence as universal. Apply the existing numeric tolerances,
report signed error and the first difference with surrounding events. Determinism
within Odin and agreement with upstream are separate results. Investigate conflicts
using pinned tests/code before proposing a documented divergence.

Retain fixture, source, dependency-lock and observation hashes; command lines;
profiles/schedules; and classifications: executed-and-matched, executed-different,
source-grounded provisional, or unexecuted. New host dependencies require a real
reviewed restore, never a manufactured lock. Preserve earlier component evidence.

**W02 exit.**
All required families have real executable entry points and recorded schedule
observations, with local/upstream comparisons and exact coverage gaps listed.
Relevant visual/audio uncertainties must be resolved or explicitly block the
corresponding W03/W05 policy. Unrelated full-session corrections can proceed in
W08; do not claim their acceptance rows closed merely because adapters now run.
Physical keyboard/mouse/touch, release Safari and audible-output certification
are later browser gates, not prerequisites for defining these oracle fixtures.

### W03 — Turn projections into complete Odin presentation

**W03.1 — Complete active membership and feedback storage.**
Reuse `engine/presentation/active.odin` and `simulation/projection.odin`.
Add bounded component-level feedback and cursor history that survives gameplay
journal acknowledgement. Consume semantic events once using presentation-owned
watermarks; repeated snapshots must not append duplicate feedback or trails.
Specify pruning by time, terminal state and epoch, including results produced
when advance jumps over several events.

Derive expiry from the relevant W02 findings; do not use the current 800 ms bound
as every animation duration. Account for bursts, reversed reveal/source ordering,
long overlapping sliders/spinners, terminal sessions with unresolved objects,
backward diagnostics and reset/seek. If insertion measurements show quadratic
bursts, use a bounded ordered structure or batch merge over reserved scratch,
keeping source order and avoiding a second authoritative gameplay state.

**W03.2 — Implement circle presentation.**
Emit circle, number/overlay and approach primitives with source identity and
stable layering. Derive reveal, fade-in, approach scale/alpha, start-time fade,
hit and miss transitions from the requested time and committed result times.
Use pinned observations for gameplay-relevant timing; use original Tapweave
styling for appearance. Exercise early hits, late hits, misses and overlapping
circles at exact boundaries and adjacent times. Reading future presentation time
must not create a result or advance health.

**W03.3 — Implement complete slider presentation.**
Emit body/resource reference, head, ball, tick/repeat markers, reverse indicators,
follow circle and end feedback. Reuse prepared path/span data; derive repeated
ball direction, tracking/follow state and head/body disappearance from Odin state.
Handle missed heads, late recovery, repeat boundaries, tick/tail results and
nominal tail time separately. W03 specifies body geometry/progress intent;
W04 tessellates/uploads it. Do not rebuild path geometry per snapshot.

**W03.4 — Implement spinner presentation.**
Emit activation/fade, centre/ring, rotation/progress, completion/bonus and hit/miss
feedback. Separate logical accumulated rotation from visual damping. If damping
requires history, derive it from time and retained semantic samples or a declared
sampling policy; do not make judgement or audio depend on RAF frequency. Compare
W02 schedule envelopes instead of inventing a universal upstream visual trace.

**W03.5 — Implement cursor, trail, follow points and HUD.**
Use committed cursor semantics and the accepted transform. Reconstruct a bounded
trail from timestamped semantic samples, with deterministic expiry and no repeated
snapshot insertion. Emit follow points from prepared ordering with explicit
combo/visibility rules. Emit HUD score, accuracy, health, combo and state from
engine authority; the browser must not calculate scoring or animation. Font/glyph
IDs and palette references are Odin intent; the original atlas is built in W04.

**W03.6 — Build actual ordered draw output.**
Convert presentation into W01's final compact batch/instance records, ordered by
layer, source object, component and primitive ordinal. Keep debug projections
(kinds 32/33) separate from the draw protocol; do not require JS to interpret them
as visual policy. Count/reserve before use, reuse frame storage, validate referenced
resource ranges and publish only complete frames. Keep HUD and feedback consistent
with the same committed state. Introduce no per-hit-object JS state.

**W03.7 — Prove behavior, lifetime and cost.**
Add shared native/WASM traces for every object family and every state transition.
Compare actual visual parameters with W02 observations under the declared matching
policy. Include repeated snapshots, differently ordered presentation requests,
journal acknowledgement before feedback expiry, pause/reset/replay seek, failure,
future tails, missing resources and exact/insufficient capacities. Verify canonical
judgement/audio/final digests are unchanged by all presentation schedules.

Measure tiny, dense, long-overlap, 10,000-object and three-minute mixed fixtures.
Separate simulation visits, active maintenance, feedback/trail work, serialization
and bridge cost. Report visited counts, high-water capacities, bytes and
p50/p95/p99 timings; do not claim W09 approval from these preliminary measurements.
Require no Odin allocation/WASM growth in ordinary advance/presentation calls.
Inspect browser allocation evidence for the generated readers. GPU timing and
rendered-scene inspection become possible in W04 and stay assigned there.

**W03 exit.**
Odin emits complete circle/slider/spinner, cursor/trail/follow-point, feedback and
HUD draw intent with stable ordering, bounded storage and tested readonly behavior.
The W04 executor receives explicit primitives/resources, not animation decisions.
Any unresolved A22 behavior remains visible in the acceptance ledger. W03 alone
neither enables Play nor closes integrated A12/A21, H11 or full M2 acceptance.

### Recommended execution sequence and review checkpoints

| Order | Work | Concrete review checkpoint |
|---|---|---|
| 1 | Reconcile cleanup, then W01.1 and W02.1 | Minimal shared fixture envelope and one actual upstream circle input-to-result run |
| 2 | W01.2–W01.3, while W02 expands observations | Tested reserve/publication/lifetime/admission paths and generated payloads |
| 3 | W02 visual/audio families plus W01.4–W01.5 | Source-backed policy decisions, narrow capabilities, child/history access and measured input/sample costs |
| 4 | W03.1–W03.2 | Circle draw intent and feedback after acknowledgement; readonly/native/WASM regressions |
| 5 | W03.3–W03.4 | Complete slider/spinner draw intent with relevant pinned comparisons |
| 6 | W03.5–W03.7 and remaining W02 families | HUD/cursor/follow points, complete batch output, scenario coverage and bounded workload report |

These are implementation increments, not permission gates. Each checkpoint must
land code, targeted tests and evidence; update the existing report/finding index
rather than creating another audit document. Do not wait for all W02 observations
before independent resource work, but do not advertise unobserved timing policies
as compatible. Update the ABI/ADRs only where actual contracts change.

For engine or tooling changes run `npm --prefix engine test`; for affected browser
paths run browser service tests and `test:session`, then relevant browser scenarios.
Add named reference-host commands with the actual adapters and run locked comparisons.
Keep existing prepared identity, kind/ABI compatibility and source-hash checks.
Review changed handwritten code for expressive names, ownership, duplicated state
and avoidable allocation before accepting each increment.

The final W01–W03 handoff contains usable transports, actual pinned scenario
observations, complete Odin draw intent and precise open findings. W04 graphics,
W05 browser audio, W06 physical input/frame integration and W07 lifecycle/results
still lead to the playable validation MVP; W08–W10 close full M3 acceptance.

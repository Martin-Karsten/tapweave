# M3 completion plan — Odin presentation and browser runtime

Status: planned work after browser foundation review fixes at `3062eee`.
Updated 2026-09-12. M3 is not complete; Play remains disabled.
See [current evidence](m3.md), [implementation status](../status.md), and
[headless M2](m2-sessions.md). This plan supersedes the initial foundation task
list without relaxing its acceptance gates.

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

## Baseline: reuse rather than rebuild

| Area | Implemented | Remaining |
|---|---|---|
| Engine | M0/M1 preparation and explicit headless M2 sessions | Whole-scenario M2 upstream acceptance |
| ABI | Production WASM, kinds 1–28, generated Odin/C/JS/TS, checked bridge | Session bridge, presentation/resources and loop/voice contracts |
| Assets | Local ZIP/loose loading, difficulty replacement, music cache, descriptor validation, immediate candidate cleanup | Hitsounds/default assets, availability binding, GPU ownership, decode concurrency limits |
| Presentation | Odin viewport transform with local native/WASM tests | Object animation, active set, HUD, meshes and draw batches |
| Input/audio | Independent buffers, clock and executor; failure/epoch regressions | DOM listeners, music transport and production session integration |
| Evidence | Full local engine suite, 26 browser service tests, three Chromium checks | H11/A12/A21/A22, full browser matrix, real audio/input and performance |

Do not replace M2 rules/replay/scoring with browser logic. The existing kind-27
record is one-shot intent; the JS executor's fixture objects are not production
loop/ramp records. A headless capability does not establish playable-browser
support or upstream compatibility.

## Delivery order

Each numbered step is a reviewable increment with its own tests and status update.
Steps 2–4 may develop against explicit fixtures after step 1 defines their
contracts. Step 5 consumes steps 2–4; step 6 consumes step 5; step 7 closes the
milestone. M2 acceptance work starts in step 1 and continues alongside independent
M3 work, but must finish before an integrated compatibility claim or M3 completion.
No elapsed-time estimate substitutes for an exit gate.

### 1. Confirm session prerequisites and specify missing contracts

Primary areas: `engine/runtime/`, `engine/audio_protocol/`, `engine/abi/`,
`docs/architecture/`, and the existing reference hosts.

- Audit all existing session calls: create, input, advance, snapshot, acknowledge,
  pause/resume, reset, result, replay and sample binding. Record which fields are
  sufficient for presentation and which need append-only extensions. Preserve all
  existing record layouts, exports, prepared identity and foundation behavior.
- Specify versioned presentation batches, static resources, transforms, texture
  availability and explicit audio voice/loop/ramp records. Specify quotas,
  reserve paths, lifetimes, failure behavior, capabilities and acknowledgement.
  Keep old kind-27 readers valid; do not reinterpret one-shot records.
- Define one mapping between engine output epochs and browser clock anchors.
  Browser pause/start currently increments its own clock epoch; numeric equality
  with session epochs must not be assumed. Freeze offset components once and
  distinguish DOM receipt time, effective beatmap time and media offset.
- Resolve how presentation consumes readonly session data without importing
  runtime and creating a cycle. Follow the package dependency table; update the
  relevant ADR before changing ownership, scheduling or public contracts.
- Establish the remaining M2 acceptance matrix: H05–H10 with complete
  circle/note-lock, slider tracking, spinner, score/health/failure and replay
  observations; A13–A20/A23 remain open until their full scenarios are verified.
  Include recorder cadence/angular subdivision gaps from the M2 session report.

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
- Maintain a bounded active set with stable draw order. Ordinary frame work must
  scale with active objects; avoid serializing or scanning every map object on
  each frame. Reset reusable state and preserve source IDs.
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
- Add music start/seek/pause/resume to the same AudioContext and anchor used by
  simulation. Apply offsets exactly once; freeze position while paused; recreate
  one-shot nodes on resume. On dispatch failure cancel playback and enter explicit
  recovery, following ADR-004.
- Bound concurrent reads/decodes and retained resources. Reuse in-flight decoding
  for the same asset where needed; keep candidate cancellation independent of
  uninterruptible browser decoding. Document internal decoder peak-memory limits.

Exit: H11 intent comparisons, A21 scheduling/offset/epoch fixtures, missing-asset
behavior, voice/ramp cleanup and queue-retry tests, plus real audible music and
hitsound checks. Mock audio alone cannot close this step's output validation.

### 5. Integrate gameplay input, session bridge and frame scheduling

Primary areas: `platform/browser-js/src/engine-bridge.mjs`, input/clock services,
controller, runtime snapshot/output transport and browser integration tests.

- Add generated-record session operations without duplicating ABI offsets.
  Reacquire WASM views after every potentially growing call, including failures;
  copy retained spans before invalidation and validate all output bounds.
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
  resolution/classification. Update findings, traceability, status and the M3
  report together. Local parity and screenshots alone never close upstream gates.

Exit: a playable browser milestone with all required acceptance rows supported,
no unresolved resource/lifecycle failures, and approved performance results.
Only then mark M3 complete and advertise its implemented capabilities.

## Standards and verification for every increment

Follow AGENTS.md and ADR-001 through ADR-005. Keep deterministic packages acyclic
and browser-independent. Use descriptive snake_case names and role-specific loop
indices, Title_Case Odin types and UPPER_SNAKE_CASE constants; preserve serialized
and retained upstream identifiers. Keep procedure/control-flow bodies multiline.
Do not copy owning maps, arenas, storage or handle tables after ownership begins.
Construct candidates transactionally; reserve before hot paths and make cleanup
explicit. Review handwritten fixtures and test transports to the same standard.

Use `npm --prefix engine test` for engine/tooling changes, browser service tests
for each browser change, and browser assembly/integration checks for affected
flows. Add targeted failure, quota, lifecycle, native/WASM and ordering regressions
rather than tests that merely repeat implementation. Use the existing reference
commands and add reproducible new adapter commands with their implementation.
Document the checks actually run and distinguish local, upstream and release-
browser evidence. Do not claim completion from partial fixtures.

The next implementation action is step 1: audit the real M2 exports and specify
missing presentation/audio contracts and reference fixtures. Do not restart the
completed archive/package foundation or begin by enabling Play.

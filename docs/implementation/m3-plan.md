# M3 completion plan — Odin presentation and browser runtime

Status: remaining implementation plan, reconciled with the prerequisite work on 2026-09-12.
The [contract audit](m3-contract-audit.md) and [implementation report](m3.md#m3-prerequisites-implementation-2026-09-12)
record prerequisite code and validation; no numbered step is complete.
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
| ABI | Production WASM, kinds 1–30, generated Odin/C/JS/TS, headless session/replay/sample bridge and coordinate export | Efficient gameplay output, presentation/resources and loop/voice contracts |
| Assets | Local ZIP/loose loading, transactional replacement, music cache, descriptor validation, immediate candidate cleanup, shared decode admission and in-flight reuse | Hitsounds/default assets, integrated availability binding, GPU ownership and bounded concurrent reads |
| Presentation | Production Odin viewport transform, native C/WASM and Chromium coordinate checks | Object animation, active set, HUD, meshes and draw batches |
| Input/audio | Independent buffers/executor, explicit session epoch mapping and music transport; failure/resume regressions | DOM listeners, production audio ingestion, loops/ramps and integrated frame/lifecycle ownership |
| Evidence | Full engine suite, 35 browser service tests, four Chromium checks, 17 local WASM cadence/stall runs and 72 pinned component comparisons | Whole-scenario M2, H11/A12/A21/A22, complete browser/input/audio matrix and measured performance |

Do not replace M2 rules/replay/scoring with browser logic. The existing kind-27
record is one-shot intent; the JS executor's fixture objects are not production
loop/ramp records. A headless capability does not establish playable-browser
support or upstream compatibility.

## Baseline preservation and completion checkpoints

The prerequisite additions above are currently uncommitted in the isolated
worktree based on `cf379bc`; they are not all present in the main checkout.
Before implementation, inspect Git state and preserve/review that work as the
baseline. Do not restore old files over it or replay the pre-merge M2 baseline.
Keep the reconciled merge history containing `88b73ea`, `3062eee` and `cf379bc`.

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

Use these units as the implementation checklist. Each delivers code, targeted
regressions and updated evidence, rather than another audit-only increment. The
numbered sections below retain the full acceptance requirements.

| Unit | Depends on | Concrete deliverable | Review/exit evidence |
|---|---|---|---|
| W01: transport contracts | Preserved prerequisite baseline | Append-only render/static-resource/audio schemas, quota/reserve paths, capability flags, readonly projection and efficient advance/output calls; update ADRs and generate all bindings | Native C/WASM layout and malformed-span tests; old kinds 1–30/exports remain valid; exact lifetime/ack contract |
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

### 1. Confirm session prerequisites and specify missing contracts

Primary areas: `engine/runtime/`, `engine/audio_protocol/`, `engine/abi/`,
`docs/architecture/`, and the existing reference hosts.

- Consume the completed [session export audit](m3-contract-audit.md); do not repeat
  the audit as the deliverable. Preserve all existing record layouts, exports,
  prepared identity and foundation behavior. Finish concrete schema/transport
  definitions and executable fixture entry points listed below.
- Add an efficient gameplay advance/output path. The existing `oe_session_advance`
  invokes full-map `gameplay_snapshot`; the browser then copies/scans kind 19.
  Keeping that call in the RAF path would defeat the active-set design even with
  a new renderer. Preserve the old diagnostic API and append operations that
  advance/read durable events/HUD without serializing every object. Keep output
  token scope, retry behavior and invalidation rules explicit.
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
- Implement the accepted readonly simulation projection consumed by presentation,
  with no runtime import, cycle or owning-state copy. Specify which prepared,
  committed-outcome and feedback data it borrows. Follow the package dependency
  table and update the relevant ADR for further ownership/contract changes.
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
  readers from W01 rather than the diagnostic full-map copier. Reserve/reuse
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

## Start here and track completion

1. Preserve the current prerequisite changes and confirm the current compiler,
   source pins and baseline checks. Existing commands are `npm --prefix engine test`,
   `npm --prefix platform/browser-js test`,
   `npm --prefix platform/browser-js run test:session`, browser build/integration
   and the pinned reference scripts.
2. Implement W01 in `engine/abi/records.json`, `engine/runtime/`,
   `engine/audio_protocol/` and ADR/interface documents. Deliver actual bindings,
   reserve/validation code and tests, including the efficient advance/output path.
   Coordinate conversion and the session audit already exist.
3. Deliver W02's executable fixture adapters and start comparison runs. Record
   exact missing observations per acceptance ID; then proceed through W03–W10.

After every unit update a short ledger in the M3 report: implemented files,
commands and results, fixture/source/lock hashes where applicable, open defects,
remaining acceptance IDs and the next unit. Keep local parity, pinned upstream
observations and physical release-browser evidence separate. Do not reset the
implementation sequence after another successful prerequisite increment.

For external blockers, record the attempted command/environment and affected
gate. Continue independent implementation. Obtain physical input/audible-output
results and performance approval only against a concrete running player and
recorded measurements; never substitute mock tests or invented thresholds.

Planning validation for this revision is Markdown link/path and diff checks.
No new engine or browser test execution is implied by editing this plan.

## Implementation ledger link

The [compact-output increment](m3.md#w01-implementation-ledger--compact-output-and-active-projection)
implements part of W01 and the W03 active-projection substrate. W01 is still open
for static render/audio resource contracts; no numbered unit is complete. Continue
from these implemented exports rather than repeating the prerequisite import.

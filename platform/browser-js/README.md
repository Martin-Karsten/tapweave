# Tapweave browser services

This is an independent M3 increment. The package owns the browser service
layer: archive/assets, the ABI bridge, clock/audio/input, the WebGL2 renderer
and the gameplay lifecycle controller. The vanilla `main.ts` player UI is
retired; the product shell that drives these services lives in
`platform/product-ui` (see [ADR-006](../../docs/architecture/adr-006-product-shell.md)).
Full M2/M3 upstream acceptance and release-browser certification remain open.

## Run

Use Node.js 24 and the engine's checksum-pinned Odin compiler/linker:

```sh
npm --prefix engine run setup
npm --prefix engine run build
npm --prefix platform/browser-js ci
npm --prefix platform/browser-js run build
npm --prefix platform/browser-js run serve
```

Open `http://127.0.0.1:4173`. The server binds to loopback and serves only the
assembled artifact directory: the service harness page, the renderer developer
fixture, the compiled services and the production WASM. No assets are uploaded.
`TAPWEAVE_PORT` changes the development port. Dependencies are pinned in this
package; the engine keeps its dependency-free tooling. `src/` is TypeScript
compiled by the pinned Go-native `typescript` devDependency; `npm run
compile`/`test`/`build` emit `build/` first, and the site is assembled from
that emit. `typecheck` runs the compiler without emitting. Builds copy the same
generated ABI JavaScript used by Node consumers and serve fflate locally with
its licence.

## Checks

```sh
npm --prefix engine test
npm --prefix platform/browser-js test
npm --prefix platform/browser-js run build
npm exec --prefix platform/browser-js -- playwright install chromium firefox webkit
npm --prefix platform/browser-js run test:browser
```

Browser tests run the real production WASM engine. Unit tests exercise archive
corruption/quotas, asynchronous replacement/disposal, WASM growth, generated
bindings and independent input/audio services. Playwright WebKit is not actual
Safari release certification. Audio service tests currently use a fake context;
they do not certify audible output or H11 compatibility.

## Ownership and current boundaries

- `engine-bridge.ts` is the only production ABI consumer. Views are reacquired
  after calls; descriptions retained by the UI are owned copies. No object-by-
  object JavaScript gameplay state is created.
- `selection.ts` transactionally replaces the selected map and its asset scope.
  Superseded loads release candidate maps immediately, including during pending
  audio decoding, and cannot publish. Failures preserve the previous selection.
- `archive.ts` owns the asset index, extracted bytes and cached decoded music.
  fflate performs DEFLATE decoding; a bounded ZIP envelope reader validates
  local/central consistency, data descriptors, names, ranges and CRC before
  returning bytes.
- `clock.ts`, `audio.ts` and `input.ts` are tested services integrated by the
  lifecycle controller. Their JavaScript test event objects are **not** production ABI
  records. Dispatch failure cancels queued and active playback before reporting
  the error; callers must recover explicitly. No gameplay, sample fallback, or
  animation policy is implemented in JS.
- The Odin `presentation` package owns coordinate conversion and active projection.
  The bridge reads compact gameplay output and independent projections through
  reusable borrowed readers; diagnostic snapshots/results retain owned copies.
  The scene renderer and lifecycle controller consume these production transports.

Archive defaults: 128 MiB input, 4,096 entries, 64 MiB per extracted entry,
256 MiB total extraction, and 256 MiB cached decoded audio per source. The engine
applies its separate 8 MiB raw map limit. ZIP64, encryption, multi-disk archives,
unsupported compression and non-UTF8 non-ASCII filenames reject explicitly.
Filenames use slash normalization, Unicode NFC and case-insensitive lookup;
ambiguous names reject. Music references resolve relative to the selected map.
Browser media decoding is not cancellable; encoded inputs are bounded, and
actual decoded size is checked before caching. This does not bound the browser's
internal decoder peak memory.

No H11 oracle, WebGL2 executor, object animation, gameplay input listener,
integrated music playback, gameplay pause/resume, results, or performance baseline is
claimed. These remain tracked in the [browser gameplay plan](../../docs/browser-gameplay.md).

## Session prerequisites

The bridge now exposes headless M2 sessions, copied output/replay/result records,
sample availability and production Odin coordinate conversion (kinds 29/30).
These services now participate in the integrated W07 player below.
`music.ts` consumes the shared clock's media anchor; its tests use mock sources.
`clock.ts` explicitly maps session and browser epochs and receipt timestamps.

`audio-decoder.ts` limits each selection controller to two concurrent decodes
and 128 MiB of encoded input. Busy admission rejects with QUOTA_EXCEEDED so the
previous selection stays valid. Same-source in-flight decodes are reused.
Cancelled work retains its admission charge until the browser promise settles;
its internal peak allocation cannot be certified by these limits.

Run `npm --prefix platform/browser-js run test:session` for the local three-minute
production-WASM cadence/stall matrix. Hashed artifacts are written to
`artifacts/session/`; they are not pinned upstream observations. See the
[reference harness](../../docs/compatibility/reference-harness.md#remaining-gameplay-adapters) for remaining gates.

## Independent WebGL2 resources

`webgl-resources.ts` provides bounded kind-35 resource publication, reuse,
transactional replacement, explicit context restoration and disposal. It owns a
dedicated context and one retained attachment; the player uses it through `Renderer`.
`publish(resources)` runs during preparation/resource replacement. After context
restoration, `restore()` rebuilds the retained bytes; it does not resume gameplay.
`bind(generation, resource_id)` rejects stale identities and only binds resources.
The legacy `bind` operation does not execute draw records. See the [rendering ADR](../../docs/architecture/adr-003-rendering.md#bounded-w04-resource-service)
for quotas and peak ownership. The Playwright resource test renders a diagnostic
quad using the unchanged Odin shader payload; full W04 graphics remain open.

### Input/frame integration

For a developer-owned ready `Audio_Playback`, construct `Gameplay_Frame(playback,
render)` before start to reserve its input inbox, then attach
`Gameplay_Input(canvas, frame)`. Await `playback.start()` and call `frame.start()`.
The render callback receives beatmap time and borrowed compact output; consume it
synchronously before requesting draw output. Pause drains input through
`frame.pause()`; resume with `playback.start()` and `frame.start()`. Dispose the DOM
binding, stop the frame driver and dispose playback before releasing the session.
Do not share this driver across session reset/replacement. The renderer service
below supplies the synchronous callback in W07. The controller supplies product
lifecycle and Play gates; independent fixtures remain available.


### Mixed-scene renderer

`Renderer(engine, session_handle, map_handle, canvas, epoch, on_context_lost)`
reserves scene output and GPU staging during preparation. Call
`render(time_ms, viewport, epoch)` synchronously from the owner's frame callback;
consume any other borrowed engine output first. It introduces no clock or RAF.
The viewport contains CSS bounds and DPR; rendering applies resize automatically.
The map and session must belong to the same engine and map attachment.

On context loss, the callback must pause the lifecycle owner and release input
and audio. `ready` becomes false. After the browser restores the context, call
`restore()` explicitly and check readiness before allowing the owner to resume.
Restoration rebuilds resources but does not resume gameplay. Call `dispose()`
before releasing the engine/session. Dedicated contexts are required.

Build and serve, then visit `/renderer-debug.html` to scrub the scripted production
WASM circle/slider/spinner fixture. It includes explicit graphics restoration and
keeps product Play disabled. `tests/browser/scene.spec.mjs` exercises this fixture
and the command executor, including malformed-frame rejection and DPR changes.

The default `scene-workloads.spec.mjs` run is a **smoke profile**: each workload at
60 Hz with a 100 ms stall. Set `TAPWEAVE_RENDERER_MATRIX=1` to run all
30/60/120/144 Hz and 0/50/100/250 ms cases. Use one worker for measurements:

```sh
TAPWEAVE_RENDERER_MATRIX=1 npm --prefix platform/browser-js run test:browser -- --project=chromium --workers=1 scene-workloads.spec.mjs
```

Each workload/cadence saves its own JSON report, so later failures retain completed
measurements. Reports include sampled stage percentiles, optional asynchronous GPU
timing, retained WASM pages and peak instance/command counts. Idle RAF intervals
are not loaded frame-pacing evidence, and the 10,000-object workload measures a
three-second prefix. These reports do not constitute approved performance limits;
full memory profiling, loaded pacing and baseline approval remain required.

Capture completed local renderer reports and their hashes with
`node engine/scripts/record-renderer-findings.mjs` after the documented runs.
It records missing acceptance separately and does not approve the baseline.


## W07 player lifecycle

Load local files and select a difficulty, then Play. Use Z/X, primary/secondary
mouse, or primary touch. Escape/Pause freezes the run while retaining engine action state. Resume
requests the frozen cursor target when required; press a hit key or mouse button
over that target to continue, or Escape to return to pause. Intro/break and
hidden/outside-cursor cases bypass the target under engine policy. Resume first
synchronizes releases, then delivers the actual resume event before advancing.
Newly held paused sources stay inactive until a fresh press; retained sources
can stay held. See [pause/resume behavior and evidence](../../docs/compatibility/pause-resume.md). Retry resets the attempt without reloading assets. Back returns
to the retained difficulty selection. Pass/fail results come directly from the
engine. Diagnostics include sample warnings, final identity/counts and bounded
rejected-input recovery context. The profile uses rate 1 and zero offsets.

`Gameplay_Controller` owns one attempt and publishes a readonly view. Consumers
use `play`, `pause`, `resume`, `retry`, `back`, `load_files`, `select_map` and
`dispose`; selection changes must pass through this owner. Readiness is published
only after transactional session/audio/scene preparation. Retry reuses reserved
voice storage and immutable GPU resources; Back ends the attempt and prepares a
new ready session for the same selection. There is no browser-history routing.

Input disposal only detaches listeners/releases captures; lifecycle callbacks
request pause and report errors. Focus/hidden-page, suspended audio and graphics
loss use a clean engine pause where possible. Restoration rebuilds graphics in a
generation-guarded deferred task, after resource event handlers complete. It never
auto-resumes. Rejected input, dispatch errors or invalid session state require
Retry/Back. A start interrupted while awaiting audio is invalidated immediately.
Persisted pagehide pauses; other page exits dispose the engine and AudioContext.

Successful results finish already-emitted audio and sample tails with the sole
frame driver; music duration does not delay teardown. Failure, Back, Retry and
hidden-page events cancel terminal playback. Results retain their copied engine
record across subsequent output calls. No per-object JS state or JS scoring is
introduced. Current input/session and voice quotas still apply; quota exhaustion
is an actionable recovery, never hidden growth or dropped input.

## Debug suite

Two connected tools share one typed diagnostics service. **Player diagnostics**
(`src/diagnostics.ts`) records bounded lifecycle transitions, engine failures,
input-batch summaries, clock observations, audio interruptions, graphics events
and resource counters during every run; **detailed capture** (opt-in per
attempt) additionally retains individual inputs and per-frame CPU stage
timings. Recording uses preallocated rings (2,048 events, 8,192 detailed
inputs, 2,048 frame samples) that overwrite their oldest entries and expose
drop counts. No JSON serialization, DOM updates or per-input object allocation
happenss on the always-on paths, and the service never calls into the engine.

Every engine operation carries an explicit diagnostic name. The first failure
of an attempt is preserved verbatim before recovery mutates state; secondary
failures append separately (bounded at eight). Input rejections retain receipt
time, mapped input time, sampled audio time, clock anchors, input sequence,
batch position, advance target and lateness, with observation timestamps kept
distinct from the authoritative engine `committed_ms`. `begin_attempt`
isolates failures between attempts while ring history is retained.

- The **player interface** (`src/debug-ui.ts`) targeted the now-retired
  vanilla player page; with the product shell as the player (ADR-006), its
  panel/HUD wiring is pending re-homing into `platform/product-ui`, which will
  subscribe to the same diagnostics service. The service, report store and
  developer workspace below are unaffected. It adds a Debug button on the selection, pause and
  recovery screens (and a floating control during play whose use requests the
  normal pause path). The panel provides Logs/Timing/Audio/Resources tabs with
  severity and category filters, text search and display freezing while
  recording continues; a non-interactive live HUD shows frame intervals, CPU
  stage timings, clock discrepancy, input queue depth, audio queues/voices,
  WASM memory, draw counts and the existing asynchronous GPU measurement,
  marking unavailable or disjoint results honestly. Diagnostic UI refresh rides
  the existing frame driver at most four times per second; no scheduler is
  added. Ctrl+F10 (logs) and Ctrl+F11 (HUD) work when the browser delivers
  them; visible controls remain the required path.
- **Reports** use the versioned `tapweave-debug-report` JSON format with typed
  categories, bigint identifiers as decimal strings, capture mode, truncation
  and timing provenance. Reports are bounded to 2 MiB, preserving failure
  context and metadata first and then the newest history that fits. The latest
  five reports persist in IndexedDB with list/view/copy/download/delete
  controls; storage failures leave the in-memory report usable and surface a
  warning. Exports can be re-imported for inspection with size/schema
  validation and text-only rendering; reports never execute code or inject
  scenarios, are never uploaded automatically, and exclude beatmap/audio
  contents, screenshots, absolute paths and unrelated keyboard input.
- The **developer workspace** at `/debug.html` lists the checked-in scenario
  corpus with search, parameters, Run/Step/Reset/Run All, declared assertions
  and report export. Scenarios cover aligned clocks and deliberate ±2/±10 ms
  discrepancies plus a rejection case; 30/60/120/144 Hz delivery with
  0/50/100/250 ms stalls; keyboard/mouse aggregation, repeats, explicit release-all buffering and
  rejected batches; pause/resume, audio suspension, rejected audio start and
  retry; GPU loss/restoration, dispatch failure and capacity exhaustion.
  Synthetic scenarios use explicit injected clocks and production WASM through
  `src/debug-scenarios.ts`, which the Node suite also executes. Real audio
  scenarios require an individual user gesture; Run All reports them as
  skipped. Fault injection is confined to this workspace. The mixed-scene
  scrubber remains at `/renderer-debug.html`.
- Recorded player reports are evidence for diagnosis, not guaranteed
  executable reproductions; replay-driven debugging and object picking stay
  deferred. The suite diagnoses clock mismatches; it does not clamp input or
  change judgement timing.

Structural inspiration comes from the pinned osu!framework `LogOverlay`,
`PerformanceOverlay`, `GlobalStatisticsDisplay` and `TestBrowser` (retained
under MIT in `engine/reference/sources/`, see the
[source manifest](../../engine/reference/source-manifest.json)); the
implementation is original Tapweave work for the Odin/browser ownership model.
Run `npm test` for ring/bound/serialization/isolation/storage/import
regressions, production-WASM clock-mismatch timestamps and capture-mode
parity, and `npm run test:browser` with `tests/browser/debug.spec.mjs` for the
browser flows. These are local regression and usability checks; no upstream
acceptance gate closes from this suite.

Run `tests/gameplay-controller.test.mjs` through `npm test` for the W07
lifecycle regressions. The retired vanilla player's Playwright intent
(selection, difficulty switching, full attempt lifecycle, GPU restoration and
input aggregation) now runs against the product shell in
`platform/product-ui/tests/browser/`. Chromium checks are local browser
evidence, not physical-device or full upstream acceptance. See the
[status](../../docs/status.md#product-shell-adr-006-s0b-promotion).

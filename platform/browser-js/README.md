# Tapweave browser foundation

This is an independent M3 increment. The validation shell loads local `.osz`
archives or `.osu` files with loose assets, prepares maps through the production
Odin ABI, selects difficulties, decodes music and exports diagnostics. Gameplay
is disabled while browser integration with the headless M2 session API remains open.

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
assembled artifact directory. No assets are uploaded. `TAPWEAVE_PORT` changes
the development port. Dependencies are pinned in this package; the engine keeps
its dependency-free tooling. `src/` is TypeScript compiled by the pinned
Go-native `typescript` devDependency; `npm run compile`/`test`/`build` emit
`build/` first, and the site is assembled from that emit. `typecheck` runs the
compiler without emitting. Builds copy the same generated ABI JavaScript used
by Node consumers and serve fflate locally with its licence.

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
- `clock.ts`, `audio.ts` and `input.ts` are independent, tested services awaiting
  M2 integration. Their JavaScript test event objects are **not** production ABI
  records. Dispatch failure cancels queued and active playback before reporting
  the error; callers must recover explicitly. No gameplay, sample fallback, or
  animation policy is implemented in JS.
- The Odin `presentation` package owns coordinate conversion and active projection.
  The bridge reads compact gameplay output and independent projections through
  reusable borrowed readers; diagnostic snapshots/results retain owned copies.
  These are tested transports, not animation commands or integrated gameplay.

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
These are testable services; Play still awaits the integrated renderer/lifecycle.
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
dedicated context and one retained attachment; it is not wired into the player.
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
below can supply the synchronous callback. Product lifecycle and Play gates remain
unfinished; see the implementation status.


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

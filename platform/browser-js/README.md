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
its dependency-free tooling. Builds copy the same generated ABI JavaScript used
by Node/TypeScript consumers and serve fflate locally with its licence.

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

- `engine-bridge.mjs` is the only production ABI consumer. Views are reacquired
  after calls; descriptions retained by the UI are owned copies. No object-by-
  object JavaScript gameplay state is created.
- `selection.mjs` transactionally replaces the selected map and its asset scope.
  Superseded loads release candidate maps immediately, including during pending
  audio decoding, and cannot publish. Failures preserve the previous selection.
- `archive.mjs` owns the asset index, extracted bytes and cached decoded music.
  fflate performs DEFLATE decoding; a bounded ZIP envelope reader validates
  local/central consistency, data descriptors, names, ranges and CRC before
  returning bytes.
- `clock.mjs`, `audio.mjs` and `input.mjs` are independent, tested services awaiting
  M2 integration. Their JavaScript test event objects are **not** production ABI
  records. Dispatch failure cancels queued and active playback before reporting
  the error; callers must recover explicitly. No gameplay, sample fallback, or
  animation policy is implemented in JS.
- The Odin `presentation` package owns the initial playfield transform. It has
  native/WASM test evidence, but is not yet exposed to browser gameplay.

Archive defaults: 128 MiB input, 4,096 entries, 64 MiB per extracted entry,
256 MiB total extraction, and 256 MiB cached decoded audio per source. The engine
applies its separate 8 MiB raw map limit. ZIP64, encryption, multi-disk archives,
unsupported compression and non-UTF8 non-ASCII filenames reject explicitly.
Filenames use slash normalization, Unicode NFC and case-insensitive lookup;
ambiguous names reject. Music references resolve relative to the selected map.
Browser media decoding is not cancellable; encoded inputs are bounded, and
actual decoded size is checked before caching. This does not bound the browser's
internal decoder peak memory.

No H11 oracle, WebGL2 executor, object presentation, gameplay input listener,
integrated music playback, gameplay pause/resume, results, or performance baseline is
claimed. These remain tracked in the M3 plan and implementation report.

## Session prerequisites

The bridge now exposes headless M2 sessions, copied output/replay/result records,
sample availability and production Odin coordinate conversion (kinds 29/30).
These are testable services; Play still awaits the integrated renderer/lifecycle.
`music.mjs` consumes the shared clock's media anchor; its tests use mock sources.
`clock.mjs` explicitly maps session and browser epochs and receipt timestamps.

`audio-decoder.mjs` limits each selection controller to two concurrent decodes
and 128 MiB of encoded input. Busy admission rejects with QUOTA_EXCEEDED so the
previous selection stays valid. Same-source in-flight decodes are reused.
Cancelled work retains its admission charge until the browser promise settles;
its internal peak allocation cannot be certified by these limits.

Run `npm --prefix platform/browser-js run test:session` for the local three-minute
production-WASM cadence/stall matrix. Hashed artifacts are written to
`artifacts/session/`; they are not pinned upstream observations. See the
[contract audit](../../docs/implementation/m3-contract-audit.md) for remaining gates.

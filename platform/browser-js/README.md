# Tapweave browser foundation

This is an independent M3 increment. The validation shell loads local `.osz`
archives or `.osu` files with loose assets, prepares maps through the production
Odin ABI, selects difficulties, decodes music and exports diagnostics. Gameplay
is disabled because the M2 production session API remains unsupported.

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
  Stale loads cannot publish. Failures preserve the previous selection.
- `archive.mjs` owns the asset index, extracted bytes and cached decoded music.
  fflate performs DEFLATE decoding; a bounded ZIP envelope reader validates
  local/central consistency, names, ranges and CRC before returning bytes.
- `clock.mjs`, `audio.mjs` and `input.mjs` are independent, tested services awaiting
  M2 integration. Their JavaScript test event objects are **not** production ABI
  records. No gameplay, sample fallback, or animation policy is implemented in JS.
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
music transport, gameplay pause/resume, results, or performance baseline is
claimed. These remain tracked in the M3 plan and implementation report.

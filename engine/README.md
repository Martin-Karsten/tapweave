# Tapweave engine

The Odin engine implements decoding, control points, immutable beatmap preparation
and ABI v2 map/session ownership. See [status and evidence](../docs/status.md).
Gameplay, rendering and audio playback remain unsupported.

## Build and test

From the repository root, with Node 24, a native C compiler/linker and `wasm-ld`:

```sh
npm --prefix engine run setup
npm --prefix engine test
npm --prefix engine run build
engine/artifacts/decode-native path/to/map.osu
engine/artifacts/prepared-native path/to/map.osu
engine/artifacts/prepared-native path/to/map.osu --stats
```

Setup downloads the checksum-pinned compiler into ignored `.toolchain/`. `ODIN_BIN`
may select a matching compiler; `ODIN_WASM_LD_DIR` adds the linker directory to
PATH. There are no npm dependencies. See [platform setup](../README.md#development).

The default suite verifies source hashes and generated ABI files, runs
allocation-tracked Odin tests, a native C consumer, WASM lifecycle/failure tests,
and byte-identical decoder, geometry and complete-preparation traces.

Real upstream validation requires the [reference setup](reference-host/README.md):

```sh
npm --prefix engine run test:reference
npm --prefix engine run test:geometry:upstream
npm --prefix engine run test:prepared:upstream
```

The last command also runs the foundation/ownership suite. Reports, full traces
and measurements are generated in ignored `artifacts/`. Checked-in
[`reference/findings/`](reference/findings/) retains hashed acceptance evidence.
Local parity is not upstream acceptance.

## Packages

| Package | Responsibility |
|---|---|
| `core_types` | Stable errors/quotas, checked arithmetic and arenas |
| `beatmap_decode` | Owned raw records, defaults and syntax validation |
| `osu_prepare` | Control points, path conversion/geometry, samples, objects, combo and stacking |
| `prepared` | Immutable records, schedules, identity and portable binary descriptions |
| `runtime` (`engine_runtime`) | Registry, engine/map/session ownership and `oe_*` facade |
| `abi` | Layout schema and generated C/TypeScript bindings |
| `trace_schema`, `geometry_trace`, `prepared_trace` | Versioned test-only trace formats |
| `native`, `wasm`, `abi_native`, `geometry_*`, `prepared_*` | Thin test transports |
| `reference-host`, `geometry-reference-host` | Pinned upstream observations |

## Ownership and API

`decode.decode` owns raw records and text. `osu_prepare.resolve` owns resolved
control points. `osu_prepare.prepare_map` constructs owned immutable records with
a count/fill arena and reusable scratch. `prepared.describe` creates the portable
binary description. The runtime applies a combined quota, publishes only successful
candidates and destroys all parts on failure.

Owning maps and arenas must not be copied. External map references and internal
session references are counted separately. Releasing the public map handle leaves
existing sessions valid; releasing the engine drops its children. Session reset
zeroes reusable storage without allocation. Calls are confined to one thread.

Create engines/sessions with foundation flag `1`. Map flag `1` requests M0 raw
storage; map flag `2` requests M1 preparation. `oe_preparation_capabilities`
advertises preparation separately. `oe_map_describe` returns kind `5` for foundation
maps or kind `8` for complete prepared descriptions. All later gameplay operations
return `UNSUPPORTED`. Read the [ABI contract](../docs/architecture/interface-v2.md)
and [preparation API](osu_prepare/README.md).

Reacquire WASM views after operations that can allocate, including failed
candidates. Production WASM requires the Odin host imports `sin`, `cos`,
`rand_bytes` and `write`; test timing additionally uses `tick_now`. Test JSON is not
the production ABI. Preparation version 2 appends breaks/control points/playback
records to the description and uses explicit canonical binary identity (`prepared-v2`).
The shared preparation work budget rejects excessive work without reducing accuracy. Native ABI conformance links the generated C consumer into an
Odin executable; dynamic-library packaging is not offered by this increment.

## Provenance

The [source manifest](reference/source-manifest.json) and
[geometry manifest](reference/geometry/manifest.json) pin retained source and test
fixtures. Copyright/licence notices are preserved. Reference hosts execute real
upstream code and locked packages. See [third-party notices](../THIRD_PARTY_NOTICES.md).

## Odin readability

Use expressive variable and index names, explicit ownership transfers, multiline
control flow and one statement per line. `odinfmt.json` records the formatting
preferences; an optional external `odinfmt` can format individual source packages.
Do not format retained upstream sources or generated ABI files. Generate ABI
constants/bindings from `abi/records.json`; writers use its named field offsets.

## Independent M2 primitives

The [M2 increment](../docs/implementation/m2.md) adds result/scoring, hit-window,
forward spinner-history and drain-calibration primitives, bounded [event/input
queues](simulation/README.md), and [replay validation/serialization](replay/README.md). These consume
explicit inputs and do not expose production gameplay or replay capabilities.

`npm test` includes allocation-tracked primitive tests and native/WASM traces.
`npm --prefix engine run test:simulation:upstream` uses the same clean pinned
checkouts and .NET setup as the reference host for component comparisons.
Integration with the completed M1 interfaces, complete sessions and whole-scenario
M2 acceptance remain open.

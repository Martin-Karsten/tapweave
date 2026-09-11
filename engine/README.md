# Tapweave engine foundation

This is the first M0 implementation increment from [`docs/roadmap.md`](../docs/roadmap.md). Historical spikes are kept outside the public repository. This package has no gameplay, renderer, audio, or browser framework dependency.

## Run

From the repository root:

```sh
npm --prefix engine test
npm --prefix engine run setup
npm --prefix engine run build
engine/artifacts/decode-native path/to/map.osu
```

The engine has no npm dependencies. Node 24, the pinned Odin compiler, a native linker, and `wasm-ld` are required. Run `setup` before testing or building; it downloads a verified compiler into the ignored `engine/.toolchain/` directory. Set `ODIN_BIN` and `ODIN_WASM_LD_DIR` to use existing tools. See the [root setup instructions](../README.md#development).

`npm test` verifies the pinned source hashes, compiles native/WASM, runs allocation-tracked Odin tests, and compares 31 generated decoder fixtures byte-for-byte. Reports and generated fixtures are in `artifacts/`; each result includes source revision, fixture SHA-256, acceptance IDs, and oracle classification. These are local regression results, not upstream acceptance results.

## Package boundaries

| Package | Responsibility |
|---|---|
| `core_types` | Stable status/error IDs, quotas, checked arithmetic, lifetime arena primitives |
| `beatmap_decode` | Allocation-free validation/count pass, owned fill pass, raw typed records |
| `prepared` | Reference-counted storage lifetime primitive for subsequent prepared maps |
| `runtime` | Generation/index registry with engine-owner and resource-kind validation |
| `trace_schema` | Versioned decoder JSON records and published JSON Schema |
| `native`, `wasm` | Test transports over the same decoder/serializer |
| `reference-host` | Pinned .NET project skeleton; H01/H02 adapters remain to be implemented |

Odin reserves the package name `runtime`, so that directory declares `engine_runtime`. Dependency direction remains as specified by the architecture docs. Deterministic packages do not import either transport, the spike, or the .NET host.

## Ownership and failure

`decode()` borrows input only during the call. It validates/counts before allocating, checks the complete arena size, copies text and typed records into one allocation, and returns a candidate only after successful fill. Strings borrow the owned copy. An error returns an empty map; replacing an existing map is a caller commit after successful decoding. `destroy()` releases the allocation.

Owning `Map`, `Arena`, `Storage`, and `Handle_Table` values must not be copied after ownership is established. Borrow them by pointer. Treat published decoded records as immutable. `Storage` is a reference-count primitive, not a completed prepared beatmap. Session arena tests exercise lifetime/reset primitives, not gameplay sessions.

The registry is shared by engines inside one future ABI instance. It validates ownership and kind, retires slots before generation wrap, and never allocates during lookup/insert/release. Full tables fail transactionally. Releasing an already released handle before slot reuse succeeds without returning the resource again; reuse makes the old generation stale. Destroying a table with live resources fails.

The WASM exports are explicitly `trace_*` test APIs, not the production `oe_*` interface. They accept only their reserved inbox. JavaScript reacquires views after allocations. Trace JSON contains values, never pointers or struct padding. Native/WASM arena byte sizes may differ with pointer width and are excluded from compatibility records.

## Decoder coverage and remaining work

Implemented: required format versions 1–14/128, unsupported-version rejection, BOM/whitespace/comments, UTF-8 validation, core metadata/difficulty, AR fallback/clamping, f32 coordinate/difficulty parsing, pre-v5 timing offset, stable object ordering, circle/slider/spinner raw records, slider segment syntax, raw timing entries and canonical inherited-NaN tick marker, typed numeric/location errors, raw/line/object/timing/duration/arena quotas.

Not yet implemented: full General/Events/sample metadata semantics, numeric validation within retained sample/edge syntax, resolved control-point defaults/precedence/queries, combo/break postprocessing, prepared paths/children/stacking, and the full ABI v2 facade. Unhandled section/property text is retained in the owned source; the current decoded records must not yet be used as a fully prepared gameplay map. Raw slider `end_time_ms` remains its start time until M1 geometry determines duration. The legacy stacking branch is preserved through `format_version`, not executed here.

See [`docs/implementation/m0.md`](../docs/implementation/m0.md) for the remaining M0 exit gates. No compatibility claim is made for H01/H02 or A01–A07/A24–A25 as complete scenarios.

## Provenance

`reference/source-manifest.json` pins SHA-256 and upstream commits for the source evidence and both MIT licences. These are fresh upstream files, not exports from the C# spike. Source-informed Odin parsing follows the pinned legacy decoder/parser; retain the upstream copyright notices and licences when redistributing the corresponding source material. The verifier never refreshes hashes automatically. Changes require a reviewed source update and matching fixture/profile findings.

The reference host requires clean pinned checkouts; see its README.

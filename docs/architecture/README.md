# Odin architecture decisions

## Dependency direction

```text
platform/browser-js                         test/reference-host
        |                                           |
        v                                           v
runtime ----> render_webgl / audio_protocol    trace_schema
   |                ^             ^                 ^
   v                |             |                 |
presentation -------+             |                 |
   |                              |                 |
   v                              |                 |
simulation -> osu_rules -> scoring/replay ----------+
   |            |
   v            v
prepared <---- osu_prepare <---- beatmap_decode
   ^                                  |
   +------------- core_types <--------+
```

No arrow points from deterministic packages toward the browser, renderer, audio implementation, or local spike. Package imports must remain acyclic. `audio_protocol` and `render_webgl` above are engine-side intent/command packages (event records, backend-neutral command generation); the browser Web Audio/WebGL2 implementations live in `platform/browser-js` and are reached only through the versioned ABI. `thin` below means ABI transport plus buffer ownership only: no gameplay, presentation-policy, or judgement logic.

This is the target dependency design, not a list of completed packages. The
`render_webgl` package now supplies original scene geometry/shaders and the mixed
scene transport; integrated player and full presentation acceptance remain open. See [status](../status.md). Test transports
share buffer ownership and numeric serialization in `trace_support`; production
runtime and browser exports do not import that test-only package.

| Package | Responsibility | May depend on |
|---|---|---|
| `core_types` | IDs, time/coordinate/result primitives, errors, hashes | Odin core only |
| `beatmap_decode` | syntax, legacy defaults, raw records, diagnostics | `core_types` |
| `prepared` | immutable objects, breaks, control points, playback records and storage views | `core_types` |
| `osu_prepare` | osu! objects, control points, paths, stacking, children, samples | above |
| `osu_rules` | hit policy, circle/slider/spinner transitions | `prepared`, `core_types` |
| `scoring` | result tables, normalized score, health/failure | prepared/rule interfaces |
| `simulation` | event queue, session state, input, checkpoints | rules/scoring/replay types, `audio_protocol` |
| `replay` | envelopes, frame validation/interpolation, digests | `core_types` |
| `presentation` | time-derived visual/audio intent and draw list | prepared + readonly session snapshots |
| `render_webgl` | shader/mesh batching and backend-neutral command generation | presentation only; runtime owns attachment lifetimes, see interface-v2 |
| `audio_protocol` | sample/loop event records | `core_types` |
| `runtime` | handles, quotas, lifecycle, ABI facade | all required engine packages |
| `platform/browser-js` | DOM, archive/assets, RAF, WebGL2 calls, Web Audio | engine only through the versioned ABI; platform browser APIs otherwise |

## ADR index

- [ADR-001: Data ownership and memory](adr-001-data-memory.md)
- [ADR-002: Deterministic scheduling and replay](adr-002-scheduling.md)
- [ADR-003: Rendering and browser bridge](adr-003-rendering.md)
- [ADR-004: Browser audio and synchronization](adr-004-audio.md)
- [ADR-005: ABI, capabilities, and extensions](adr-005-interface-extensions.md)

The production successor is specified in [interface v2](interface-v2.md). ABI v1 and its demo remain local research material outside this repository.

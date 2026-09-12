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

No arrow points from deterministic packages toward the browser, renderer, audio implementation, or local spike. Package imports must remain acyclic.

| Package | Responsibility | May depend on |
|---|---|---|
| `core_types` | IDs, time/coordinate/result primitives, errors, hashes | Odin core only |
| `beatmap_decode` | syntax, legacy defaults, raw records, diagnostics | `core_types` |
| `prepared` | immutable objects, breaks, control points, playback records and storage views | `core_types` |
| `osu_prepare` | osu! objects, control points, paths, stacking, children, samples | above |
| `osu_rules` | hit policy, circle/slider/spinner transitions | `prepared`, `core_types` |
| `scoring` | result tables, normalized score, health/failure | prepared/rule interfaces |
| `simulation` | event queue, session state, input, checkpoints | rules/scoring/replay types |
| `replay` | envelopes, frame validation/interpolation, digests | `core_types` |
| `presentation` | time-derived visual/audio intent and draw list | prepared + readonly session snapshots |
| `render_webgl` | shader/mesh batching and backend-neutral command generation | presentation only |
| `audio_protocol` | sample/loop event records | `core_types` |
| `runtime` | handles, quotas, lifecycle, ABI facade | all required engine packages |
| `platform/browser-js` | DOM, archive/assets, RAF, WebGL2 calls, Web Audio | ABI only |

## ADR index

- [ADR-001: Data ownership and memory](adr-001-data-memory.md)
- [ADR-002: Deterministic scheduling and replay](adr-002-scheduling.md)
- [ADR-003: Rendering and browser bridge](adr-003-rendering.md)
- [ADR-004: Browser audio and synchronization](adr-004-audio.md)
- [ADR-005: ABI, capabilities, and extensions](adr-005-interface-extensions.md)

The production successor is specified in [interface v2](interface-v2.md). ABI v1 and its demo remain local research material outside this repository.

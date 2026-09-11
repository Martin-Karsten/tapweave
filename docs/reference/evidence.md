# Evidence, terminology, and units

## Finding labels

- **SC — source-confirmed:** directly established by the pinned source or its tests.
- **EV — experimentally verified:** observed by a named local or future reference-harness experiment.
- **UR — unresolved:** evidence is insufficient; the text must name an investigation and cannot be treated as compatibility law.
- **OD — Odin decision:** desired deterministic behavior or architecture, which may intentionally differ from frame-dependent lazer behavior.

The local C# and Odin spikes can produce EV findings about themselves. They are never an oracle for lazer.

## Coordinate and time vocabulary

| Term | Definition |
|---|---|
| beatmap time | milliseconds on the decoded beatmap timeline, after legacy format offset handling |
| gameplay time | milliseconds exposed to ruleset components after rate and configured offsets |
| audio time | `AudioContext.currentTime`, seconds, monotonic while the context is running |
| wall time | browser/OS monotonic timestamp; never a judgement clock |
| osu! pixel | a unit in the 512×384 osu!standard playfield |
| screen pixel | CSS or device pixel after fit, scale, translation, and device-pixel-ratio transforms |
| effective input time | the beatmap-time timestamp actually consumed by the simulator |

Unless specified otherwise, time formulas use milliseconds, positions use osu! pixels, angles use degrees, accuracy is in `[0,1]`, and health is clamped to `[0,1]`.

## Source map

The most important upstream roots are:

- [osu! source at the pinned revision](https://github.com/ppy/osu/tree/3c1c96f742e7aae2ff67a7361e058fe91ca3b955)
- [osu!framework source at the matching revision](https://github.com/ppy/osu-framework/tree/f02756c5aa5032e6d04729922702b8d56c4bc2eb)
- [osu!stable reference](https://github.com/peppy/osu-stable-reference/tree/08e3dafd525934cf48880b08e91c24ce4ad8b761), used only where lazer itself cites it for legacy compatibility
- local pinned excerpts and hashes in [`engine/reference/source-manifest.json`](../../engine/reference/source-manifest.json)

## Reproduction rules

Reference-harness records must include the osu! commit, framework commit, .NET SDK, operating system, test name, beatmap SHA-256, ruleset API identity, full mod settings, clock schedule, input stream, and output-schema version. A claim without those fields is diagnostic evidence, not a compatibility fixture.

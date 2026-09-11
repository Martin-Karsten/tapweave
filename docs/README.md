# Odin gameplay engine reference and design

This documentation is the implementation specification for an osu!standard engine written primarily in Odin and delivered first to desktop browsers through WebAssembly. It is not an implementation and does not claim that the existing spike is compatible.

Implementation has started separately in [`engine/`](../engine/README.md). See [M0 implementation status](implementation/m0.md) for tested coverage and remaining exit gates.

## Pinned baseline

| Component | Version | Revision |
|---|---|---|
| osu! | `2026.804.2-lazer` | [`3c1c96f742e7aae2ff67a7361e058fe91ca3b955`](https://github.com/ppy/osu/tree/3c1c96f742e7aae2ff67a7361e058fe91ca3b955) |
| osu!framework | `2026.731.0` (from `osu.Game.csproj`) | [`f02756c5aa5032e6d04729922702b8d56c4bc2eb`](https://github.com/ppy/osu-framework/tree/f02756c5aa5032e6d04729922702b8d56c4bc2eb) |

The framework version is source-confirmed by the pinned [`ppy.osu.Framework` package reference](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/osu.Game.csproj#L42). The tag-to-commit mapping was verified with the upstream Git repository. All GitHub source links in this set are commit-pinned.

## Reading order

1. [Evidence and terminology](reference/evidence.md)
2. [Execution model](reference/execution-model.md)
3. [Beatmap preparation](reference/beatmap-preparation.md)
4. [Input and judgement](reference/input-and-judgement.md)
5. [Scoring, health, failure, and results](reference/scoring-health-results.md)
6. [Presentation and audio](reference/presentation-and-audio.md)
7. [Replay](reference/replay.md)
8. [Compatibility survey](reference/compatibility-survey.md)
9. [Spike audit](compatibility/spike-audit.md)
10. [Traceability matrix](compatibility/traceability.md)
11. [Reference harness](compatibility/reference-harness.md)
12. [Architecture decisions](architecture/README.md)
13. [Versioned engine interface](architecture/interface-v2.md)
14. [Validation and roadmap](roadmap.md)
15. [Sources](SOURCES.md)

## Scope boundary

The normative target is unmodded lazer osu!standard. “Classic” always means the `OsuModClassic` compatibility mod, not default lazer. Skins, storyboards, mods, difficulty calculation, performance points, legacy replay containers, and other rulesets are surveyed only far enough to keep today’s design extensible. Product screens, accounts, networking, editing, and score submission are out of scope.

## Normative priority

When documents conflict, use this order:

1. pinned executable upstream tests;
2. pinned upstream code;
3. reference-harness observations;
4. this design’s explicitly documented deterministic divergence;
5. local spike observations.

Every unresolved item has an experiment in the harness plan. Architecture-critical decisions are resolved in the ADRs; unresolved items may refine constants or tolerances but may not redefine ownership or public interfaces without a new ADR.

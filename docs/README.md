# Odin gameplay engine reference and design

These documents specify the Odin/WASM osu!standard engine. They distinguish implemented preparation from planned gameplay and browser behavior.

Implementation lives in [`engine/`](../engine/README.md). See [Implementation status](status.md) for tested coverage and remaining exit gates.

## Pinned baseline

| Component | Version | Revision |
|---|---|---|
| osu! | `2026.804.2-lazer` | [`3c1c96f742e7aae2ff67a7361e058fe91ca3b955`](https://github.com/ppy/osu/tree/3c1c96f742e7aae2ff67a7361e058fe91ca3b955) |
| osu!framework | `2026.731.0` (from `osu.Game.csproj`) | [`f02756c5aa5032e6d04729922702b8d56c4bc2eb`](https://github.com/ppy/osu-framework/tree/f02756c5aa5032e6d04729922702b8d56c4bc2eb) |

The framework version is source-confirmed by the pinned [`ppy.osu.Framework` package reference](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/osu.Game.csproj#L42). The tag-to-commit mapping was verified with the upstream Git repository. All GitHub source links in this set are commit-pinned.

## Document ownership

`status.md` owns current coverage and limitations. The ABI chapter and ADRs own
contracts; reference chapters own pinned behavior; traceability and the reference
harness own acceptance evidence and missing experiments. The roadmap and
[browser gameplay plan](browser-gameplay.md) describe remaining work. Hashed
findings retain reproducible evidence; Git history retains the implementation
journey. Separate milestone reports and progress ledgers are unnecessary.

## Reading order

- [Current implementation and evidence](status.md)
- [Build and package guide](../engine/README.md)
- [Architecture decisions](architecture/README.md) and [ABI contract](architecture/interface-v2.md)
- [Beatmap preparation](reference/beatmap-preparation.md)
- [Execution model](reference/execution-model.md), [input and judgement](reference/input-and-judgement.md), [scoring and health](reference/scoring-health-results.md), and [replay](reference/replay.md)
- [Presentation and audio](reference/presentation-and-audio.md)
- [Acceptance matrix](compatibility/traceability.md), [reference harness](compatibility/reference-harness.md), and [roadmap](roadmap.md)

Source revisions, retained files, licences and hashes are catalogued in
[`source-manifest.json`](../engine/reference/source-manifest.json) and the
[geometry manifest](../engine/reference/geometry/manifest.json). The reference
chapters link directly to pinned upstream symbols.

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

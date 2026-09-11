# Compatibility survey

This chapter records dependencies that must shape the engine but are not fully specified in the unmodded phase.

## Mods

The pinned `OsuRuleset.GetModsFor()` inventory is authoritative ([source](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/OsuRuleset.cs#L154-L240)).

| Category | Mods | Engine dependency |
|---|---|---|
| difficulty reduction | Easy, No Fail, Half Time, Daycore | difficulty transforms, fail policy, clock/rate, audio |
| difficulty increase | Hard Rock, Sudden Death, Perfect, Double Time, Nightcore, Hidden, Traceable, Flashlight, Blinds, Strict Tracking, Accuracy Challenge | prepared-map transforms, clock/audio, presentation, tracking, health/fail |
| conversion | Target Practice, Difficulty Adjust, Classic, Random, Mirror, Alternate, Single Tap | object preparation, settings serialization, hit policy/input |
| automation | Autoplay, Cinema, Relax, Autopilot, Spun Out | replay/input providers and presentation |
| fun | Transform, Wiggle, Spin In, Grow, Deflate, Wind Up/Down, Barrel Roll, Approach Different, Muted, No Scope, Magnetised, Repel, Adaptive Speed, Freeze Frame, Bubbles, Synesthesia, Depth, Bloom | mostly presentation, but several modify coordinates/time and therefore replay identity |
| system | Touch Device, Score V2 | input semantics/difficulty and scoring profile |

Do not model mods as arbitrary plugins. A versioned `RulesTransform` sequence has four narrow hooks: decode options, prepared-map transform, session policy, and presentation/audio policy. Each mod declares settings schema, incompatibilities, and whether it changes prepared digest, replay verification, score multiplier, or ranked status. Unknown mods make a replay unverified.

Classic is especially important: it changes note lock, slider-head accuracy, tail sample policy, circle fading, and optionally health ([`OsuModClassic`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Mods/OsuModClassic.cs)). Stable replays must not be evaluated under default lazer rules.

## Replay formats

- Native Odin replay: versioned deterministic envelope described in [replay](replay.md).
- Lazer local score/replay: Realm score metadata plus typed replay frames; import needs ruleset/mod JSON and beatmap identity.
- Legacy `.osr`: binary header plus LZMA frame stream and optional lazer extension; imported with Classic semantics.
- Server/API score data: may omit full frame data and cannot be “verified” locally.

Compatibility implication: parsing containers is separate from validating rules identity. Preserve unknown extension data for round-trip tools, but never pass it into simulation.

## Skins and samples

Lazer supports built-in Argon/Triangles and legacy skins via ruleset-specific transformers ([`CreateSkinTransformer`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/OsuRuleset.cs#L257-L271)). Skins affect textures, animation frames, colours, fonts, cursor, slider/spinner pieces, and sample fallback. Beatmap skins/colours/hitsounds are independent player settings in `Player`.

Initial engine uses a built-in visual skin but implements the full ordered sample descriptor now. Future visual skin support belongs above presentation state: it cannot alter prepared gameplay geometry. Classic skin animation quirks are presentation profiles, not simulator branches.

## Storyboards and beatmap events

Legacy events include background, video, breaks, and storyboard commands ([decoder event handling](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/Formats/LegacyBeatmapDecoder.cs#L438-L481)). Breaks affect drain/pause overlays and therefore must be decoded during compatibility foundation. Background/video/storyboard visuals are optional assets; malformed cosmetic events warn without dropping gameplay objects. Storyboard completion participates in lazer’s results-screen timing but not score completion; Odin results are available when simulation completes and UI may wait for presentation separately.

## Difficulty calculation and performance points

[`OsuDifficultyCalculator`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Difficulty/OsuDifficultyCalculator.cs) preprocesses hit objects and evaluates aim, speed, flashlight, and reading skills. [`OsuPerformanceCalculator`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Difficulty/OsuPerformanceCalculator.cs) derives pp from difficulty attributes and score statistics. Both are version-sensitive and mod-sensitive but are not used to judge a play.

Package them later as `difficulty/osu/<version>` and `performance/osu/<version>` consuming the same prepared map and immutable result summary. Never put pp into the real-time simulation loop or ABI v2’s required capabilities. Golden attributes from [`OsuDifficultyCalculatorTest`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/OsuDifficultyCalculatorTest.cs) will define a separate milestone.

## Other rulesets

Prepared beatmaps expose common metadata/control points plus a ruleset-owned object payload. The public engine can report an unsupported ruleset capability. No cross-ruleset base object with dozens of optional fields and no runtime-loaded ruleset binaries are introduced. A future ruleset implements compile-time interfaces for preparation, simulation, presentation, and result schemas.

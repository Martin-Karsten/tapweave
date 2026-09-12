# Third-party notices

Tapweave includes pinned source excerpts from osu! and osu!framework as compatibility references. Retained synthetic upstream test beatmaps provide preparation fixtures. Source-informed decoder work follows the pinned legacy decoder and parser; preparation work ports SliderPath, PathApproximator, CircularArcProperties, slider/spinner defaults and events, sample resolution, combo and stacking behavior. The source manifests record the origin, revision, licence, and SHA-256 of each retained file.

- osu!: Copyright (c) ppy Pty Ltd. MIT licence; see [retained licence](engine/reference/sources/osu__LICENCE).
- osu!framework: Copyright (c) ppy Pty Ltd. MIT licence; see [retained licence](engine/reference/sources/osu-framework__LICENCE).
- [Source manifest](engine/reference/source-manifest.json).
- [Independent geometry source manifest](engine/reference/geometry/manifest.json).

Original copyright headers remain intact. The reference-host project uses upstream code as a development dependency and is not the C# experimental implementation.

Odin compiler downloads are development tools, not committed source or distributed game assets. Their original notices remain in the downloaded release. osu! names and branding are not licensed by Tapweave's MIT licence. Music, community beatmap packs, skins and game art are not included. The source manifest identifies the included synthetic upstream `.osu` test fixtures under the upstream repository MIT licence.

M2 result properties, scoring, hit-window, drain-calibration and forward spinner-history primitives also follow the pinned upstream components listed in the source manifest. Their original copyright and licence notices are retained.

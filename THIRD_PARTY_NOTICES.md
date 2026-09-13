# Third-party notices

Tapweave includes pinned source excerpts from osu! and osu!framework as compatibility references. Retained synthetic upstream test beatmaps provide preparation fixtures. Source-informed decoder work follows the pinned legacy decoder and parser; preparation work ports SliderPath, PathApproximator, CircularArcProperties, slider/spinner defaults and events, sample resolution, combo and stacking behavior. The source manifests record the origin, revision, licence, and SHA-256 of each retained file.

- osu!: Copyright (c) ppy Pty Ltd. MIT licence; see [retained licence](engine/reference/sources/osu__LICENCE).
- osu!framework: Copyright (c) ppy Pty Ltd. MIT licence; see [retained licence](engine/reference/sources/osu-framework__LICENCE).
- [Source manifest](engine/reference/source-manifest.json).
- [Independent geometry source manifest](engine/reference/geometry/manifest.json).

Original copyright headers remain intact. The reference-host project uses upstream code as a development dependency and is not the C# experimental implementation.

Odin compiler downloads are development tools, not committed source or distributed game assets. Their original notices remain in the downloaded release. osu! names and branding are not licensed by Tapweave's MIT licence. Music, community beatmap packs, skins and game art are not included. The source manifest identifies the included synthetic upstream `.osu` test fixtures under the upstream repository MIT licence.

M2 result properties, scoring, hit-window, drain-calibration and forward spinner-history primitives also follow the pinned upstream components listed in the source manifest. Their original copyright and licence notices are retained.

## Browser package dependencies

The separate `platform/browser-js` package pins **fflate 0.8.3** (MIT,
Copyright (c) 2026 Arjun Barrett), from <https://github.com/101arrowz/fflate>.
Browser assembly copies its installed licence beside the locally served module.

**Playwright Test 1.63.0** and its Playwright dependencies are development-only
browser automation tooling, licensed under Apache-2.0; see
<https://github.com/microsoft/playwright>. Exact packages and integrity hashes are
recorded in the browser package lockfile. These dependencies do not grant rights
to beatmap music, osu! branding, or other game assets.

## Product shell dependencies

The `platform/product-ui` package (ADR-006) is the one package allowed npm
dependencies, all exact-pinned with integrity hashes recorded in its lockfile.
Its runtime bundle ships **Solid 1.9.15** (MIT, Copyright (c) 2019-2026 Ryan
Carniato), **@solidjs/router 1.0.0** (MIT), **@tanstack/solid-virtual
3.13.39** with **@tanstack/virtual-core 3.17.10** (both MIT) and **fflate
0.8.3** at the same pinned version as the browser package. Development-only
tooling (Vite, vite-plugin-solid, Vitest, happy-dom, @solidjs/testing-library,
Playwright and the pinned Go-native `typescript` compiler) is not distributed
with the game. See <https://github.com/solidjs/solid> and
<https://github.com/TanStack/virtual>.

Presentation timing ports and the snaking assertion port follow pinned osu!
`SnakingSliderBody`, slider child drawables, follow-point transforms and framework
`DefaultEasingFunction`. Copyright (c) ppy Pty Ltd, MIT; the retained licences above
apply. The renderer atlas, palette, shaders and mesh coverage design are original
Tapweave work. Scene findings record the pinned test paths and adaptations.

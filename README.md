# Tapweave

A browser rhythm game written in Odin, targeting osu!standard beatmap compatibility.

Tapweave is an independent project, not affiliated with or endorsed by osu! or ppy.

## Status

M0 (decoder, control points and lifecycle) and M1 (complete beatmap preparation) are implemented and tested against pinned upstream behavior. The engine prepares paths, object schedules, samples, combo and stacking, and exposes immutable maps through ABI v2. Gameplay, rendering and audio playback are next; the app is not yet playable.

See [implementation status and evidence](docs/status.md), the [roadmap](docs/roadmap.md), and [architecture](docs/architecture/README.md).

## Development

Requirements: Node.js 24, a native C/C++ linker, and `wasm-ld` on `PATH`. LLD 20 is tested locally; set `ODIN_WASM_LD_DIR` if it is not on `PATH`.

On macOS, install Xcode command-line tools and LLD (for example `brew install lld@20`), then export `ODIN_WASM_LD_DIR="$(brew --prefix lld@20)/bin"`. On Ubuntu, install `clang` and `lld` using the package manager.

```sh
npm --prefix engine run setup
npm --prefix engine test
npm --prefix engine run build
engine/artifacts/decode-native path/to/map.osu
```

Setup downloads a checksum-verified Odin compiler into the ignored `engine/.toolchain/` directory. The version, commit, and supported Linux/macOS archives are pinned in [toolchain.json](engine/toolchain.json). Alternatively, set `ODIN_BIN` to an existing matching compiler. The new engine has no npm dependencies.

Tests verify upstream source hashes, run allocation-tracked Odin and native C ABI checks, and compare generated native/WASM traces byte-for-byte. The `test:reference`, `test:geometry:upstream` and `test:prepared:upstream` scripts execute pinned upstream comparisons; see the [reference-host setup](engine/reference-host/README.md).

## Repository layout

- `engine/`: engine implementation, tests, schemas, and tooling.
- `docs/`: implementation specification, decisions, and roadmap.
- `.github/workflows/`: automated validation.

The [browser foundation](platform/browser-js/README.md) can load and prepare local
beatmap sets. Gameplay remains unavailable pending M2 integration.

Exploratory spikes, downloaded toolchains, caches, generated binaries, and game assets are not distributed in this repository.

## Licence

Tapweave's original code is licensed under [MIT](LICENSE). Retained upstream sources keep their original notices and licences; see [third-party notices](THIRD_PARTY_NOTICES.md). No rights to osu! branding, beatmap music, or other third-party assets are granted by this project's licence.

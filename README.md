# Tapweave

A browser rhythm game written in Odin, targeting osu!standard beatmap compatibility.

Tapweave is an independent project, not affiliated with or endorsed by osu! or ppy.

## Status

The compatibility foundation (M0) is under development. The repository currently contains the native/WebAssembly decoder, memory and handle primitives, and test tooling. It is **not yet a playable game**, and upstream compatibility has not been certified.

See the [roadmap](docs/roadmap.md), [architecture](docs/architecture/README.md), and [implementation status](docs/implementation/m0.md).

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

Tests verify upstream source hashes, run allocation-tracked Odin tests, and compare generated native/WASM decoder traces byte-for-byte. This verifies local consistency; the pinned upstream reference-host experiments remain pending.

## Repository layout

- `engine/`: production foundation, tests, schemas, and tooling.
- `docs/`: implementation specification, decisions, and roadmap.
- `.github/workflows/`: automated validation.

Exploratory spikes, downloaded toolchains, caches, generated binaries, and game assets are not distributed in this repository.

## Licence

Tapweave's original code is licensed under [MIT](LICENSE). Retained upstream sources keep their original notices and licences; see [third-party notices](THIRD_PARTY_NOTICES.md). No rights to osu! branding, beatmap music, or other third-party assets are granted by this project's licence.

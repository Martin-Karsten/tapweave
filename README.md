# Tapweave

A browser rhythm game written in Odin, targeting pinned osu!lazer osu!standard behavior.

Tapweave is an independent project, not affiliated with or endorsed by osu! or ppy.

## Status

M0 (compatibility foundation) and M1 (beatmap preparation) are implemented and
validated against pinned upstream behavior. Headless M2 sessions integrate rules,
scoring/health, replay and snapshots. The browser exposes a playable validation
player through the product shell: rendering, audio, input, pause/retry/recovery,
settings and results. Full upstream M2/M3 acceptance and release-browser
certification remain open.

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

Setup downloads a checksum-verified Odin compiler into the ignored `engine/.toolchain/` directory, pinned in [toolchain.json](engine/toolchain.json); set `ODIN_BIN` to use an existing matching compiler.

Tests verify upstream source hashes, run allocation-tracked Odin and native C ABI checks, and compare native/WASM traces byte-for-byte. The `test:*:upstream` scripts execute pinned upstream comparisons; see the [reference-host setup](engine/reference-host/README.md).

## Repository layout

- `engine/`: Odin engine implementation, tests, schemas, and tooling.
- `platform/browser-js/`: browser service layer (WASM runtime, input/audio/renderer services) with developer fixtures.
- `platform/product-ui/`: Solid product shell hosting the playable player ([ADR-006](docs/architecture/adr-006-product-shell.md)); holds the repo's exact-pinned npm dependencies.
- `docs/`: implementation specification, decisions, and roadmap.
- `.github/workflows/`: automated validation.
- `engines/`, `plans/`, `comparison/`, `shared/`: retained historical spike and benchmark material, not part of the current implementation.

## Licence

Tapweave's original code is licensed under [MIT](LICENSE). Retained upstream sources keep their original notices and licences; see [third-party notices](THIRD_PARTY_NOTICES.md). No rights to osu! branding, beatmap music, or other third-party assets are granted by this project's licence.

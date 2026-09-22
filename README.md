# Tapweave

**Tapweave** is a free browser rhythm game that recreates osu!standard gameplay —
tap circles, hold sliders, spin spinners — with mechanics pinned to a specific
osu!lazer build instead of approximated. The entire game is an Odin program
compiled to WebAssembly: no installs, no accounts, and no uploads. Your beatmaps
never leave your device.

**Play it:** [tapweave.tapweave-game.workers.dev](https://tapweave.tapweave-game.workers.dev)
— drop an `.osz` onto the song select (or try the bundled demo beatmap) and press Play.

Tapweave is an independent project, not affiliated with or endorsed by osu! or ppy.

## Features

- **Faithful osu!standard gameplay.** Judgement, scoring, health, combo and
  slider behavior are matched against the pinned osu!lazer sources and its test
  suites — the goal is that a map plays the same here as it does in lazer.
- **Fully client-side.** Odin compiled to WASM, WebGL2 rendering, Web Audio
  playback driven by the audio clock. Import `.osz` archives or loose beatmap
  files; imported sets stay available for the whole session.
- **Private multiplayer rooms.** Play with 2–8 friends: the host picks a
  difficulty, everyone starts on a synchronized beat, and a live scoreboard
  follows the round. Every player imports the same files themselves — the room
  server only relays metadata and scores, never map or audio data.
- **Replays.** Save any finished run and watch it back.
- **Comfortable song select.** Session library of imported sets, per-difficulty
  stats, music preview, keyboard navigation.

## Status

The engine core — beatmap decoding, preparation, rules, scoring, health and
replay — is implemented and continuously validated against pinned upstream
behavior, and the browser player is playable end to end. Remaining work is
honest and tracked: full upstream acceptance for the later milestones and
certification across release browsers are still open, so expect rough edges.

Progress, evidence and open gates: [implementation status](docs/status.md) ·
[roadmap](docs/roadmap.md) · [architecture decisions](docs/architecture/README.md).

## Building from source

Requirements: Node.js 24, a native C/C++ linker, and `wasm-ld` on `PATH`
(LLD 20 is tested; point `ODIN_WASM_LD_DIR` at it if it lives elsewhere).

- macOS: install Xcode command-line tools and LLD, e.g.
  `brew install lld@20`, then `export ODIN_WASM_LD_DIR="$(brew --prefix lld@20)/bin"`.
- Ubuntu: install `clang` and `lld` from the package manager.

```sh
npm --prefix engine run setup                     # fetch the checksum-pinned Odin compiler
npm --prefix platform/browser-js ci
npm --prefix engine test                          # source hash checks, Odin/native/WASM tests
npm --prefix engine run build
engine/artifacts/decode-native path/to/map.osu    # decode a beatmap from the command line
```

The Odin compiler is pinned in [toolchain.json](engine/toolchain.json) and
verified by checksum on setup; set `ODIN_BIN` to use a local compiler that
matches. The test suite also compares generated traces between native and WASM
builds byte-for-byte, and can run pinned upstream comparisons — see the
[reference-host setup](engine/reference-host/README.md).

## Hosting

The product shell deploys to Cloudflare Workers Static Assets on a free
`workers.dev` subdomain; pushes to `main` publish automatically once account
credentials are configured. The [hosting guide](docs/hosting.md) covers setup,
local preview and rollback, and [docs/ci.md](docs/ci.md) documents the CI
runners.

## Repository layout

- `engine/` — the Odin engine: decoding, preparation, rules, scoring, replay, tests and tooling.
- `platform/browser-js/` — the browser service layer around the WASM engine (input, audio, renderer, selection).
- `platform/product-ui/` — the Solid app shell hosting the playable player ([ADR-006](docs/architecture/adr-006-product-shell.md)); the only package with npm dependencies.
- `docs/` — specifications, architecture decisions and progress records.
- `.github/workflows/` — CI that validates every push.
- `engines/`, `plans/`, `comparison/`, `shared/` — archived experiments; not part of the current implementation.

## Licence

Tapweave's original code is licensed under [MIT](LICENSE). Retained upstream
sources keep their original notices and licences; see
[third-party notices](THIRD_PARTY_NOTICES.md). No rights to osu! branding,
beatmap music, or other third-party assets are granted by this project's
licence.

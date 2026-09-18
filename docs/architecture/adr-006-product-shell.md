# ADR-006: Product shell

Status: accepted and implemented. The shell lives in `platform/product-ui`,
the W07 validation player runs in it, and the vanilla `browser-js` player UI
is retired; the `@browser` services remain the product engine integration
surface.

## Context

The W07 validation player UI in `platform/browser-js` is hand-written DOM
mutation inside `src/main.ts`. It is adequate for validation, but difficulty
selection, results and diagnostics keep growing hand-rolled view code, and the
song-select scale target (bounded DOM for very large lists) is not something
the vanilla layer should re-invent.

Two local spikes evaluated candidates against the same gate suite (S0a/S0b
evidence, 2026-09-13, Node 24, Chromium pinned via Playwright 1.63.0, against
the production `tapweave.wasm` of the committed engine revision):

- `platform/product-ui-spike/` (Vue 3.6.0-rc.8 + vue-tsc 3.3.11)
- `platform/product-ui-spike-solid/` (Solid 1.9.15 + tsgo `typescript` 7.0.2)

## Alternatives

1. Keep extending the vanilla DOM layer: no new dependency, but every screen
   re-implements list virtualization, routing and structured view updates.
2. Vue with vue-tsc: blocked locally — see the counter-evidence below.
3. Solid with compiled JSX and the existing pinned Go-native `typescript`
   compiler already used by `platform/browser-js`.

## Decision

Promote the Solid spike into a first-class in-monorepo package
`platform/product-ui/`, and re-platform the W07 validation player into it.
Gameplay remains a host element only: the shell contributes a canvas host and
reads service state; it never enters the engine frame path.

### Ownership rules

- Shell components reach the engine only through `@browser` services
  (`platform/browser-js/src` via the `@browser` alias). Components never call
  `oe_*` exports, never own WASM views, and never construct engine handles.
- No reactivity inside services. Services (`Player_Session_Service`,
  engine boot, diagnostics) are plain classes/modules; Solid signals exist only
  in the view layer, fed by subscription. A service must remain usable from
  tests and from a non-Solid host without any reactive runtime.
- Judgement timestamps stay audio-clock-owned per
  [ADR-004](adr-004-audio.md). The frame driver pumps
  input/advance/presentation, but RAF cadence never determines judgement.
- Shell updates never enter the engine frame path (the B3 rule): per-frame
  gameplay work is owned by `Gameplay_Frame`/`Renderer` services, and shell
  reactivity is restricted to lifecycle/state changes and explicitly refreshed
  diagnostics.

### Play route layout

Gameplay fills the browser content area instead of a bordered 4:3 panel. On
`/play` the app frame drops its width constraint and padding (`immersive`
variant), the frame footer is not rendered (its Settings entry point moves to
the play screen's floating controls, available while idle or paused exactly as
the footer offered it), and the player host sizes to the content area — the
engine's complete-map fit handles aspect and letterboxing inside the surface it
is given. The layout avoids percentage-height chains below the min-height-only
frame; the player grows by flex and the host is absolutely positioned. A
Fullscreen button toggles the Fullscreen API on the player wrapper (not the
bare canvas host) so overlays stay reachable in the top layer; the browser's
fullscreen-exit Escape is left to the browser by both gameplay input paths and
the resume gate, and viewport changes repaint without advancing gameplay per
[ADR-003](adr-003-rendering.md#complete-map-visual-fit). Leaving the route ends
fullscreen implicitly because the element leaves the document.

### Pin policy

- `platform/product-ui` is the one package allowed npm dependencies, and every
  dependency is exact-pinned (no ranges). `fflate` stays pinned at the same
  version as `platform/browser-js` so the alias shares one implementation.
- Any dependency bump re-runs the full gate suite
  (`npm --prefix platform/product-ui run test:gates`), including the HMR/B1/B2/B3
  probes, before the bump lands.
- Solid 2.0 is a watched migration, blocked on `@solidjs/router` and
  `@solidjs/testing-library` rebasing; it is not a drop-in bump.

### Recorded caveats

- Solid HMR replaces component state when a hot update crosses a non-leaf
  boundary; accept state reset during development and never rely on HMR for
  correctness evidence.
- `platform/browser-js` sources use node16-style `.js` specifiers for `.ts`
  modules. The shell therefore carries the browser-source resolver plugin in
  its Vite config (about 30 lines) and `@browser/*` path mappings in
  `tsconfig.json`; TypeScript performs the extension substitution, esbuild/Vite
  does not.

## Evidence appendix (spike gates, 2026-09-13)

Promoted from the S0a/S0b spike records; local-machine evidence, not upstream
acceptance.

| Gate | Result |
|---|---|
| A1′ (Solid diagnostics) | tsgo reports precise JSX diagnostics on the gate fixtures: TS2322 (type mismatch on `items` props), TS2769 (no overload matches the `For`/`Show` control-flow misuse), TS1484 (verbatimModuleSyntax value-imported type). The expected-errors tsconfig deliberately re-includes `src/expected_errors/**` with `exclude: []` so these stay asserted. |
| A2/A3 (counter + tests) | Vitest + `@solidjs/testing-library` render and drive the counter component; the HMR probe applies an edit without a page reload, keeps the parent mounted and leaves reactivity alive. Component-local state may reset across a hot update (recorded caveat below), so state preservation is reported but not gated. |
| B1 (engine bridge) | The shell boots the production WASM through `@browser/engine-bridge.js`: build 1, behavior 202608042, ABI 2.0; capability fields and live WASM page counts readable from components; no console errors. |
| B2 (virtualized list) | The `@tanstack/solid-virtual` list renders 18 DOM rows for 10,000 entries with working keyboard selection, End/Home jumps and bounded DOM at both scroll extremes. |
| B3 (frame-path isolation) | 60-second per-frame reactive probe: 60.05 fps effective, 0 long tasks, 0 heap growth, reactive and direct-DOM writes coexist; measured on a shell page with no engine frame path. |
| Vue A1 (counter-evidence) | `vue-tsc` crashed under the pinned Go-native `typescript` 7.0.2 with `ERR_PACKAGE_PATH_NOT_EXPORTED`; overriding vue-tsc to TypeScript 5.9.3 failed to produce a working dual-compiler setup. The Vue spike was abandoned on tooling grounds, not on runtime behavior. |

WebKit probe runs executed only after binary install; local WebKit binaries
were unavailable (CDN gateway failure) and remain a CI-side check.

## Consequences

- The repository gains exactly one npm-dependent package with exact pins and a
  mandatory gate re-run on bump; `platform/browser-js` keeps its no-dependency
  build (`fflate` vendored at assembly).
- The vanilla player UI in `platform/browser-js/src/main.ts` is retired once
  shell parity is proven; the services it drove remain the product engine
  integration surface.
- Shell code follows the repository TypeScript conventions (descriptive
  `snake_case` identifiers, `Title_Case` types, no abbreviations).
- Interface changes to scheduling, ownership or the ABI still require their own
  ADR; this decision adds no engine-side surface.

## Acceptance

- `npm --prefix platform/product-ui run test:gates` is green: typecheck,
  expected-errors, build, Vitest, Playwright browser suite, and the HMR/B1/B2/B3
  probes with JSON output under `platform/product-ui/artifacts/gates/`.
- Player parity: the ported Playwright intent (selection, archive difficulty
  switching, lifecycle play/pause/resume/retry/results/back, graphics
  restoration, input aggregation) passes against the shell in every installed
  browser engine.
- No binaries are committed: the WASM asset is copied from
  `engine/artifacts/` by `scripts/prepare_assets.mjs` into an ignored directory.

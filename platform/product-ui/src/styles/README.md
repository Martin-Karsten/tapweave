# Shell styling conventions

The product shell uses plain global CSS, split by feature under `src/styles/`.
There is no CSS framework or preprocessor; `index.css` is the only entry and is
imported once from `src/main.tsx`.

## Layout

- `tokens.css` — every color, radius, z-index, duration, font size and spacing
  step, including the lazer-pinned primitives (`--wedge-shear`,
  `--panel-radius`, `--footer-bar-height`, the `--duration-*` constants).
- `base.css` — reset, frame, screen shell, shared wordmark, generic controls
  (`button`, `dl`, `pre`, `.panel`), the chrome app footer and the
  reduced-motion override.
- `screens/` and `components/` — one file per screen or component, named after
  the owning `.tsx` file (`select_screen.css` ↔ `select_screen.tsx`).

`index.css` lists the imports in cascade order; keep it ordered base-first so
screen rules can override the generic ones (`.play-screen` must override
`.screen`'s `display`, for example).

## Rules enforced by the css-lint gate

`scripts/gates/css_lint.mjs` runs in `test:gates` and fails the suite when a
stylesheet (or a `.tsx` file) uses a raw value that belongs in `tokens.css`:
color literals, `rgb()`/`rgba()`, `z-index` numbers, px font sizes, and px
spacing in the 2–32 range. A declaration that must keep a raw value (a
one-off radius, an element size) carries an inline `/* css-lint: reason */`
marker explaining why. The gate also caps file sizes and fails on any
`@media` breakpoint other than the narrow-viewport `760px`, whose value custom
properties cannot express — it is repeated at each media rule on purpose.

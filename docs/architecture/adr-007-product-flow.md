# ADR-007: Product flow chrome

Status: accepted and implemented for the shell chrome (intro, menu, song
select). Local browser evidence only: this decision records structure
references and deliberate MVP divergences, not upstream acceptance.

## Context

ADR-006 re-platformed the W07 validation player into the Solid shell but left
the product flow as the retired vanilla player had it: the selection route was
the first screen and carried hand-rolled panels. The MVP player experience
([mvp-player-experience.md](../mvp-player-experience.md)) expects a
self-explanatory first session, and the shell needs a flow a beginner can walk
without instructions: boot, menu, song select, play, results.

Upstream lazer owns a well-tested screen grammar for this flow. We want its
*structure* — region positions, control roles, and shear/radius language —
without copying code or assets and without claiming compatibility we did not
verify.

## Structural references (pinned osu! 2026.804.2, commit `3c1c96f7`)

No song-select sources are vendored in
[`source-manifest.json`](../../engine/reference/source-manifest.json); the
following paths were read at the pinned commit as structure references only.
No upstream code, assets, or exact metrics beyond the quoted constants are
copied.

- `osu.Game/Screens/Select/SongSelect.cs` — two-column layout: the left
  column is sheared (`Shear = OsuGame.SHEAR`) and stacks the
  `BeatmapTitleWedge`; the right column holds the carousel with `FilterControl`
  on top; content is padded by `ScreenFooter.HEIGHT`.
  `ENTER_DURATION = 600`, `WEDGE_CONTENT_MARGIN = 32`.
- `osu.Game/Screens/Select/FilterControl.cs` — the top control bar:
  `corner_radius = 10`, `Shear = OsuGame.SHEAR`, a search text box plus
  group/sort/collection controls, and a `StatusText` passthrough.
- `osu.Game/Screens/Select/BeatmapTitleWedge.cs` — the sheared info panel
  (`corner_radius = 10`) with title, artist, status pill, statistics (play
  count, favourite, length, BPM) and a `DifficultyDisplay`, entering from
  `X = -150` over `SongSelect.ENTER_DURATION`.
- `osu.Game/Screens/Select/PanelBeatmapSet.cs` — the carousel set panel:
  background, title, artist, status pill, a difficulty-spread display, and a
  chevron expanding the set's difficulty rows (`PanelBeatmap` items in the
  `osu.Game/Graphics/Carousel` carousel). Pinned carousel panels are *not*
  sheared; the shear lives in the filter bar, wedge and footer buttons.
- `osu.Game/Screens/Footer/ScreenFooter.cs` — `HEIGHT = 50`, back button
  bottom-left, action buttons bottom-right; `ScreenFooterButton` chrome is
  sheared with `OsuGame.SHEAR` around `CORNER_RADIUS = 10`.
- `osu.Game/Screens/Menu/MainMenu.cs` — centered pulsing logo with the live
  action column beside it (already cited by the menu increment).

## Decision

The product shell implements the flow `intro → menu → song select → play →
results` as structure-reference chrome in `platform/product-ui`:

- The song select screen arranges lazer's regions with CSS grid: a
  FilterControl-position top bar (back to menu, screen title, a working
  difficulty text filter, and the import control), the set panel plus
  virtualized difficulty rows as the carousel region, a
  BeatmapTitleWedge-position sheared info panel, and a ScreenFooter-position
  action bar (Back, Play, Debug).
- The shear/radius language reuses the tokens from the prior theme increment
  (`--wedge-shear`, `--panel-radius`, `--footer-bar-height` in
  `src/style.css`). Sheared boxes use top-left transform origins and the
  wedge leans through a band clipped inside its masked, rounded box, so the
  lean never extends the scrollable area on narrow viewports.
- Import works through the file input and by dropping files onto the screen;
  both feed the existing transactional `load_files` path. The difficulty
  filter is a plain substring match over the loaded set's filenames.
- The wedge shows decoder-owned title, artist, creator and difficulty name
  from the prepared descriptor's kind-54 metadata record (filename fallback
  only for explicitly empty fields), music status, object count and
  CS/AR/OD/HP from the descriptor summary (ABI record 8), plus the play gate
  message.
- Established a11y/test anchors are preserved (`#files`, `#status`,
  `#error`, `#objects`, `#circle-size`, `#approach-rate`, `#play-gate`,
  `#debug-open`, `data-virtual-list="difficulties"`, `data-map-filename`),
  and the Play gating/focus behavior is unchanged.

## Documented MVP divergences

These are product-policy divergences, not compatibility claims. Visual
similarity to lazer is not upstream acceptance, and nothing here counts
toward upstream acceptance scenarios.

1. **Purple palette.** The shell keeps its dark purple product palette
   instead of lazer's `OverlayColourProvider` blues and pinks.
2. **Enter-only transitions.** Route changes play a CSS enter animation; the
   shell does not reproduce lazer's symmetrical enter/exit choreography
   (`SongSelect.ENTER_DURATION` both ways, filter/wedge sliding out to
   ±150 px). A transform on an ancestor of the gameplay canvas is also
   excluded by the rect-capture rule for the play route.
3. **Single-set session.** The carousel holds only the imported set. There is
   no beatmap database, grouping, sorting, collections or star-rating filter;
   the FilterControl-position bar filters the active set's difficulties, and
   the set panel is sheared for wedge-language consistency although pinned
   carousel panels are not. The former filename-derived divergence is
   resolved with fallback: title, artist, creator and difficulty name come
   from the decoder-owned kind-54 metadata record of the prepared active
   difficulty, while unprepared rows keep filename labels and the difficulty
   filter searches those displayed labels. Only explicitly empty fields
   count as absent and fall back to filename-derived strings; the decoder's
   pinned lazer defaults ("Unknown" and friends) are ordinary values and
   display as-is, as in lazer's own song select.
4. **HTML-shell substitutions.** The screen title ("Song select") exists
   where pinned `SongSelect` has no header title; drag-and-drop import and
   the in-document footer are browser idioms standing in for lazer's global
   import flow and footer overlay.

## Consequences

- The flow chrome is honest structure reference: positions, roles and shear
  language cite the pinned commit, and every divergence above is deliberate
  and reviewable. Menu and song-select styling remain excluded from upstream
  compatibility claims (see the
  [reference harness note](../compatibility/reference-harness.md)).
- No engine, ABI, or service behavior changes; the screen still reaches the
  engine only through `@browser` services under ADR-006 ownership rules.
- Plan 1 owns replacing filename-derived strings with decoder-owned metadata
  and the onboarding copy revisions on these screens; this ADR's structure
  must not block that work.

## Acceptance

- `npm --prefix platform/product-ui run test:gates` stays green
  (typecheck, expected-errors, build, Vitest, Playwright browser suite and
  the HMR/B1/B2/B3 probes).
- The ported parity intent (selection, difficulty switching, lifecycle,
  settings, debug flows) keeps passing on every installed browser engine,
  and `tests/browser/select.spec.mjs` covers the new chrome: back navigation
  to the menu, the set panel and difficulty filter, drag-and-drop import,
  and the CS/AR/OD/HP wedge stats.
- Upstream acceptance for song-select behavior remains open and unclaimed.

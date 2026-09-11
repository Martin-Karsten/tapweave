# Odin spike audit

## Conclusion

The spike is a valuable historical regression target, not a production compatibility foundation. Its native/WASM equivalence, exact local replay stability, small payload, and lifecycle tests support the choice of Odin. Its parser restrictions, independent geometry, incomplete scoring, absent spinner, fixed scheduler, and fixed allocation prevent any lazer-compatibility claim.

These findings summarize historical local experiments. The spike implementations and raw reports are intentionally excluded from the public repository. Their measurements are not independently reproducible from this checkout and are not upstream compatibility evidence.

## Required findings

| Area | Actual spike | Upstream/design assessment | Action |
|---|---|---|---|
| format | v14 osu!standard only; rejects spinners/mixed curve markers; cosmetic CSV limitation | lazer decodes historical stable versions and all standard object types | replace parser; keep rejection fixtures |
| geometry | independent Bézier approximation; hand examples mostly within 0.1 px | framework algorithm and float behavior are the baseline | direct port; vertex/cumulative-length harness |
| timing precedence | partial red/inherited handling; gaps before first point/coincident points | decoder has explicit pending-point precedence and type fallbacks | generated permutation fixtures |
| slider judgement | head/children metrics and deterministic tracking approximation | default lazer head accuracy, nested result semantics, aggregate parent, frame-driven tracking | rewrite against result table; classify cadence differences |
| scheduler | exact inputs/events plus 1 ms tracking boundaries | 1 ms is neither an upstream rule nor necessary | event-driven child-time evaluation; no millisecond scan |
| scoring | experimental head accuracy/combo; not production score | full generic lazer score/health processors required | implement result table, autoplay maxima, drain search |
| spinner | rejected | required unmodded object | implement angular history/ticks/bonus/loops |
| memory | ~39.84 MiB fixed engine allocation; ~153 KiB populated in reported map | bounded but wasteful; prevents cheap parallel sessions | lifetime arenas sized after count pass, quotas, shared prepared map |
| presentation/audio | Canvas circle demo; no integrated music/hitsounds/loops | presentation timing/audio intent required | keep demo unchanged; build new runtime beside it |
| replay | validates spike contract identity and schedule independence | good direction; identity needs behavior/prepared digests and complete results | versioned replay v2, checkpoints |

## Evidence worth preserving

- Native, Node WASM, and Chrome traces match on the three spike fixtures.
- 30/60/144 Hz virtual schedules with 100 ms stalls matched for the spike’s 800-event trace.
- Replacement/reset/dispose tests and allocation-tracked native checks passed.
- The playable demo is approximately 95 KB uncompressed and 33 KB Brotli in the historical local report.
- Same-map local comparisons found the delivered Odin spike fast, but they do not measure a complete game or prove a language advantage.

Spikes may remain available locally for research, but public CI runs only the production foundation suite. New production packages live in `engine/` and must be buildable without the experiments.

## Known deviations to turn into tests

1. custom sample index zero and inherited NaN markers;
2. `AudioLeadIn` ignored by Odin;
3. quoted event filename with comma parsed incorrectly;
4. coincident control-point precedence and before-first fallback;
5. mixed slider path-type segments rejected;
6. skipped-head forced-miss ordering not compared to reference;
7. draw snapshot omits some nested markers;
8. no spinner, health, failure, real results, continuous loops, or archive host;
9. input timing metric excludes validation and device→host delivery;
10. hard caps reject otherwise valid maps and allocate them for every small map.

Each appears in the traceability matrix and roadmap. None may be waived because an existing local fixture passes.

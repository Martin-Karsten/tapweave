# Pinned reference hosts

This host executes the real upstream decoder and control-point queries. It references the osu! checkout directly and the framework package pinned by upstream; the separately verified framework checkout supplies source evidence. It does not reference a local reimplementation.

Set `OSU_REFERENCE_CHECKOUT` and `OSU_FRAMEWORK_CHECKOUT` to clean checkouts at the revisions in `../reference/source-manifest.json`. Install a .NET SDK capable of building the net10.0 host and upstream net8.0 projects. The validated host SDK was 10.0.401. Node 24, the pinned Odin compiler, and the native/WASM linkers are also required.

```sh
npm --prefix engine run setup
npm --prefix engine run test:reference
```

`DOTNET_BIN` may name a local SDK executable. The runner verifies all tracked and untracked checkout changes, runs native/WASM foundation tests, executes `dotnet restore --locked-mode`, builds, and runs H01/H02. `packages.lock.json` was produced by a real restore and reviewed for the pinned framework package and transitive versions/content hashes. Do not fabricate or silently refresh it.

The adapter subclasses `LegacyBeatmapDecoder` only to record exceptions from `base.ParseLine`, then rethrows into the original upstream catch-and-continue loop. A reflected protected version field preserves the actual `Decoder.GetDecoder` selection, including missing-header fallback. Reflection also reads the internal legacy sample-index field; it does not calculate control-point behavior.

Observations include defaults, metadata, difficulty, ordered object positions/combo flags, breaks, resolved control points, and before/at/±5/±6 ms queries. Geometry, duration, samples and stacking are covered by the separate M1 projection below; simulation remains outside both. Source ordinals in Odin control points are local provenance; comparisons use ordered point values/time, not invented upstream IDs.

Every fixture and observation has a digest. The runner writes full observations and a classified report to ignored `engine/artifacts/reference/`. The reviewed M0 finding index is retained in `../reference/findings/m0.json`. A field mismatch fails the runner. Version/header/object-scope and transactional-error policies are explicitly classified, never reported as exact compatibility.

## Reproducing pinned checkouts

Use separate, unmodified checkouts; build output remains ignored upstream. For example, in an ignored local directory:

```sh
git clone --filter=blob:none https://github.com/ppy/osu.git osu
git -C osu checkout --detach 3c1c96f742e7aae2ff67a7361e058fe91ca3b955
git clone --filter=blob:none https://github.com/ppy/osu-framework.git framework
git -C framework checkout --detach f02756c5aa5032e6d04729922702b8d56c4bc2eb
```

Export the absolute checkout paths before running the command above. The initial real restore is already represented by the committed lock; subsequent runs must stay locked.

## Complete preparation: H03/H04

```sh
npm --prefix engine run test:prepared:upstream
```

`PreparedObservation.cs` executes `OsuBeatmapConverter`, preprocessing,
`ApplyDefaults`, postprocessing and `SliderEventGenerator`. It observes final
geometry, difficulty-derived fields, timing, samples, combo, stacking and children.
Reflection reads the pinned cumulative-length list and legacy layered-sample flag.
It does not implement those algorithms. The runner also executes the local
ownership suite and writes `artifacts/prepared/` plus the retained M1 finding index.

Zero-duration legacy-marker progress is canonicalised to `0` and classified in the
report; the marker is excluded from scoring-child comparisons. Complete observations
are compared using the existing numeric tolerances and exact discrete state.

## Independent geometry host

`npm --prefix engine run test:geometry:upstream` builds the smaller
`geometry-reference-host` against retained, unmodified `SliderPath` source and the
locked framework package. It needs .NET 10 and a locked NuGet restore, but no full
checkout. Its 74 fixtures isolate path math/workspace behavior from decoding and
complete object preparation. Geometry provenance lives in
`reference/geometry/manifest.json`; full observations go to `artifacts/geometry/`.

## Independent M2 observations

`npm --prefix engine run test:simulation:upstream` executes actual result
properties, `OsuScoreProcessor`, `OsuHitWindows`, `SpinnerSpinHistory` and
`DrainingHealthProcessor` against explicit synthetic inputs. `--simulation` is
a separate adapter mode; H01/H02 and the preparation projection retain their
existing behavior. The real dependency lock remains unchanged.

The H06/H08/H09/H10 subsets do not exercise drawable input selection, slider
tracking, spinner cursor sampling, player failure, or full replay sessions.
M2's local event/replay fixtures are never submitted as upstream observations.
See [M2 status](../../docs/implementation/m2.md).

# Known scene differences: correction and bounded disposition

This investigation covers the spinner progress and post-stall slider tracking
differences retained in `m3-scene-presentation.json`. The original finding index
is retained unchanged. The correction runner writes a separate
[`m3-scene-corrections.json`](../../engine/reference/findings/m3-scene-corrections.json)
with its hash, fixture/observation/comparison hashes and pinned source hashes.

## Causes and decisions

| Finding | Independent evidence | Resolution |
|---|---|---|
| Small spinner progress errors without stalls | `Playfield` defaults to relative sizing. The adapter assigned `Size=(512,384)` without clearing `RelativeSizeAxes`; observed tracker centres were 147456 instead of 192. Screen/local round trips lost f32 precision. | Correction fixtures request an absolute 512×384 playfield and assert its observed dimensions. Original fixture layout remains reproducible. No tolerance increase or engine math change. |
| Large spinner progress errors after stalls | `SpinnerRotationTracker.OnMouseMove` stores a position; `Update` consumes only the latest position. Several delivered movements can therefore become one angular segment. | A separate Odin session receives the actual position sampled by each upstream update. Progress **and unclamped rotation** must match. Raw all-input differences remain recorded under the narrowly scoped ADR-002 disposition. Production retains every input segment. |
| Slider tracking indicator on the first update after a 250 ms stall | `DrawableSlider.Update` copies its input manager's previous tracking value before the child manager updates. Observed child tracking already agrees with Odin. | Compare current child tracking independently. Classify the visible difference only at that first post-stall update, with exact agreement between the displayed flag and the prior child state. Tapweave displays current committed tracking. |

The two dispositions are `accepted-spinner-update-sampling` and
`accepted-slider-feedback-update-lag`. They are not aliases for the previous
result/score/combo input-delivery disposition. Any discrepancy without its
eliminating diagnostic fails the correction runner. Unstalled spinner differences
are never classified as stall sampling.

## Reproduction and scope

Use Node 24, the pinned Odin compiler and clean osu!/framework checkouts specified
by [the reference-host guide](../../engine/reference-host/README.md):

```sh
npm --prefix engine run build
npm --prefix engine run compare:scene:corrections
npm --prefix engine run test:presentation
```

The correction matrix contains the original eight object scenarios at
30/60/**120**/144 Hz with 0/50/100/250 ms stalls (128 runs). It compares the original
fields and adds independent sampled rotation/progress and child tracking. The
original `compare:scene:upstream` command retains the historical fixture layout
and raw failing comparisons; it is a legacy diagnostic, not the correction gate.

The executed matrix records **81,528 comparisons and zero unexplained
differences**. It retains 1,150 raw spinner progress/rotation sampling differences
and 12 first-update slider-feedback differences with the required diagnostic
matches. Without stalls, the corrected layout matches spinner progress and
rotation at the existing tolerance. This count includes unclamped rotation
checks and the additional 120 Hz cases, so it is not directly comparable to the
historical 180 progress/indicator discrepancies.

Seven source-derived native/WASM projection regressions cover both spinner
directions, initial/pre-held input, same-time segments, exclusive end time,
read-only presentation and acquisition/pause projection for one/two/three-span
sliders. They assert concrete values, not just agreement between local transports.

The pinned search inspected `TestSceneSpinnerRotation.TestRotationDirection`,
`TestSceneSliderInput.TestMidSliderTrackingAcquired` and the surrounding rotation,
rewind, tracking and spinner-judgement cases. Their autoplay/seek, replay and tail
assertions are different from the first-post-stall observation tested here.
These seven cases are **source-derived regressions**, not exact test-body ports.
Existing slider-input and spinner-judgement ports remain in the gameplay suite.
The correction oracle executes actual pinned drawables without replacing their
update methods or fabricating rotation/tracking values.

This closes the bounded investigation, not full A22, H11 or M2/M3 acceptance.
Nested animation, HUD/follow/cursor appearance, device audio and release
performance certification remain separately tracked.

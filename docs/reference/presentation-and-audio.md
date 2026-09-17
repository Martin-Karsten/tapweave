# Presentation and audio

## Presentation is derived, not authoritative

Gameplay state produces a time-indexed presentation snapshot; rendering never judges objects. Presentation owns approach circles, circle/slider/spinner visual states, judgement bursts, cursor/trail, follow points, playfield dim, and HUD values. Visual identity may differ, but visibility and feedback timing that affects playability must follow lazer.

**SC.** A hit circle becomes alive at start minus preempt. Circle piece fades in over `TimeFadeIn`; approach circle fades to 0.9 over `min(2×fadeIn, preempt)` and scales to 1 over preempt ([`DrawableHitCircle.UpdateInitialTransforms`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableHitCircle.cs#L190-L199)). Hit/miss transforms extend drawable lifetime; pooled objects must reset all transforms when reused.

**SC.** Slider ball progress is clamped `(now-start)/duration`, path direction reverses each span, and body progress follows only after the head is hit ([`DrawableSlider.UpdateAfterChildren`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSlider.cs#L257-L284)). Default slider fade-out is 240 ms. Presentation interpolation can run at RAF rate without altering simulation.

## Sample resolution

Prepared hit samples retain bank (normal/soft/drum), sample name (normal/whistle/finish/clap/slidertick/spinnerspin/bonus), custom index, volume, and explicit filename. Resolution yields an ordered list of beatmap candidates followed by skin/default fallback where allowed. Custom sample index zero has special legacy meaning and is not interchangeable with one; M1 verifies these distinctions through pinned upstream sample-candidate observations.

Control point selection and the 5 ms compatibility leniency are specified in [beatmap preparation](beatmap-preparation.md). [`SampleControlPoint.ApplyTo`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Beatmaps/ControlPoints/SampleControlPoint.cs) and [`ConvertHitObjectParser`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Objects/Legacy/ConvertHitObjectParser.cs) are the primary source.

Discrete hitsounds are emitted only when their associated result/sample policy allows. Default slider tail samples play only on a hit; Classic can force them to play. Slider ticks use a derived `slidertick` sample; the parent temporarily owns tail samples at nominal end ([`Slider.UpdateNestedSamples`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Slider.cs#L258-L289)).

Missed objects stay silent at the object level: [`DrawableHitObject.UpdateState`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Rulesets/Objects/Drawables/DrawableHitObject.cs) plays an object's samples only for `ArmedState.Hit`. The audible miss feedback in lazer is instead the skin-provided combo-break sample: [`ComboEffects`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Screens/Play/ComboEffects.cs) plays `Gameplay/combobreak` when the combo rolls back to zero with a previous combo above 20 or on the first break of a run, unless rewinding or sample playback is disabled; `AlwaysPlayFirstComboBreak` defaults to true ([`OsuConfigManager`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game/Configuration/OsuConfigManager.cs)). That sample is skin-level rather than a beatmap candidate, so it stays outside current sample resolution until a global/skin sample slot is specified.

## Continuous loops

Tracking a started slider starts/maintains `sliderslide`, updates stereo balance from ball position, and stops on tracking loss/end ([`DrawableSlider.Update`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSlider.cs#L235-L254)). Spinner tracking runs `spinnerspin`, fades volume over 300 ms on start and 240 ms on stop, and modulates frequency from 0.5 toward 1.5 with progress ([`DrawableSpinner`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSpinner.cs#L142-L171)). Odin emits loop state transitions and parameter ramps; JavaScript owns browser audio nodes.

## Music synchronization and browser clock

The browser audio timeline is the master while playing. `AudioContext.currentTime` is the context’s time coordinate and scheduled source start times use it ([W3C Web Audio](https://www.w3.org/TR/webaudio/#dom-baseaudiocontext-currenttime)). Define:

```text
beatmapMs = anchorBeatmapMs + (audioCurrentSeconds - anchorAudioSeconds) × 1000 × rate
```

Global, device, beatmap, and user offsets are converted once into the anchor; replay timestamps remain beatmap-relative and are never rewritten. JavaScript reports the exact applied offset vector and clock epoch in diagnostics.

On pause, stop/suspend scheduled music and loops, record beatmap position, retain engine action state, and invalidate the scheduling epoch. On Resume, keep simulation and music paused while the required cursor gate is open. Once the gate is accepted, or bypassed under engine policy, establish a new anchor after the context runs, reconcile physical input with resume-press blocking, seek music to the recorded offset and reconstruct retained future sounds before advancing simulation. Focus loss follows the pause path. Missing music is a recoverable asset error if diagnostics mode permits silent play; production play refuses to begin without the main track. Missing individual hitsounds fall through candidates and finally silence with a warning.

`AudioBufferSourceNode.start(when, offset)` provides audio-timeline scheduling and each node is one-shot ([W3C Web Audio](https://www.w3.org/TR/webaudio/#dom-audioscheduledsourcenode-start)). Schedule discrete events with a short lookahead, cancel them logically with epoch IDs, and drop rather than replay events whose scheduled time is older than the configured lateness threshold. Record requested time, actual dispatch time, context time, and lateness.

## Odin/JavaScript boundary

Odin owns presentation state, visibility, animation curves, draw-list construction, sample selection, and audio event intent. JavaScript owns DOM events, archive/file APIs, image/audio decode, `AudioContext`, WebGL calls, RAF, resize/fullscreen, and capability discovery. No per-object JavaScript callback is allowed: snapshots use typed spans and event queues.

## Edge cases and tests

- An early slider-tail judgement may emit a future nominal-end sample; audio queues it by timestamp and epoch.
- Pause invalidates already-scheduled sources; resume does not duplicate old discrete sounds.
- A repeated map load releases decoded image/audio assets and GPU handles from the old asset scope.
- Storyboard alignment can shift visuals but never input coordinates without applying the same inverse transform.

Pinned tests include [`TestSceneOsuHitObjectSamples`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneOsuHitObjectSamples.cs), [`TestSceneSliderApplication`](https://github.com/ppy/osu/blob/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests/TestSceneSliderApplication.cs), and spinner application tests ([directory](https://github.com/ppy/osu/tree/3c1c96f742e7aae2ff67a7361e058fe91ca3b955/osu.Game.Rulesets.Osu.Tests)).

**UR-AUD-1.** Exact lazer loop ramp restart semantics after rapid tracking toggles: H11 captures drawable-requested play/stop/parameter events. Voice loop/ramp command records exist (kinds 41–45, W01/W05), but H11 comparison and A20/A21 acceptance remain open; no row closes until H11 is executed.

**UR-AUD-2.** Combo-break sample delivery: the upstream trigger is pinned from `ComboEffects` (combo reaches zero with previous combo above 20 or on the first break, `AlwaysPlayFirstComboBreak` default true, skipped while rewinding and while sample playback is disabled), but Tapweave emits no combo-break one-shot and has no global/skin sample binding — kind-28 bindings are per-object. Open until the ABI gains a global sample slot, the engine emits the one-shot under the pinned condition, and a synthesized browser fallback exists; no acceptance is claimed.

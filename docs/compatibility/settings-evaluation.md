# Essential settings: evidence and timing evaluation

Scope: Plan 2 of [the MVP handoff](../mvp-player-experience.md). This is
Tapweave product policy and local browser evidence, not full M2/M3 acceptance.
Onboarding/demo integration belongs to the separate Plan 1 integration gate.

## Ownership and reproduction

The page's `Player_Session_Service` reads preferences once before constructing
its mixer/controller, owns the mixer and settings subscriptions, and releases
them on disposal. Retry and selection replacement retain the same mixer.
`Music_Transport` and `Audio_Service` accept optional output destinations;
existing callers still default to the context destination. The immutable input
configuration is captured on each start/resume. Labels describe that effective
configuration during play. Settings themselves do not change clocks or engine
audio commands. The subsequent [resume compatibility change](pause-resume.md)
updates replay rules identity to version 2.

Storage is `tapweave.player-settings.v1`, version 1, containing only music/effects
volume, left/right physical key codes and the mouse-hit boolean. Missing/corrupt
fields default independently; an invalid binding pair defaults together. Unknown
versions are retained until explicit edit/reset. Failed storage remains usable
in memory. There is no storage-event listener or offset preference.

Run browser `typecheck`, `test`, `build`; product `test:gates` and `test:browser`.
The gate script does not itself run Playwright journeys, so execute both. In
parallel worktrees, use distinct preview/dev ports: default 5180/5181 can serve
another worktree silently because existing tooling reuses a listening server.
The settings validation used temporary copies of the unchanged gate assertions
on 5280 and a temporary Playwright configuration on 5281 (runtime harness 5283).
No pins or checked-in gate assertions were changed.

## Pinned evidence search and classification

Source checkouts were inspected at osu!
`3c1c96f742e7aae2ff67a7361e058fe91ca3b955` and framework
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`, matching the source manifest.
Search included osu!standard input/sample tests, gameplay pause/key-binding tests,
settings binding/volume UI tests, and framework input/key-binding/audio-mixer
and sample/track tests. Existing native/WASM gameplay fixtures remain the
engine-level regression evidence for normalized input.

| Pinned test / scope | Disposition and local mapping |
|---|---|
| `osu.Game.Tests/Visual/Gameplay/TestScenePauseInputHandling.cs`: `TestOsuInputNotReceivedWhilePaused`, `TestOsuPreviouslyHeldInputReleaseOnResume` | Mirrored pause input: all six osu!standard pause-input test bodies now execute against pinned upstream. Engine pause retains actions; resume reconciles physical state and consumes the resume press. See [current behavior and validation](pause-resume.md). |
| Same file: `TestOsuHeldInputRemainHeldAfterResume` and all three `TestOsuHitCircleNotReceivingInputOnResume*` cases | Mirrored pause input: all six osu!standard pause-input test bodies now execute against pinned upstream. Engine pause retains actions; resume reconciles physical state and consumes the resume press. See [current behavior and validation](pause-resume.md). |
| `osu.Game.Tests/Visual/Gameplay/TestSceneKeyBindings.cs`: `TestDefaultsWhenNotDatabased`; `Visual/Settings/TestSceneKeyBindingRow.cs`: `TestChangesAfterConstruction` | Database-backed binding-row/custom test-ruleset contracts do not map to this localStorage service. Defaults, immutable updates, remapping and labels are original product tests in `player_settings.test.ts`, `settings-input.test.mjs` and `settings.spec.mjs`. |
| `osu.Framework.Tests/Visual/Input/TestSceneKeyBindingContainer.cs`: `TestSingleKeyRepeatEvents`, `TestHeldNonModifierKeyDoesNotRetriggerAfterModifierRelease`, `TestPressKeyBeforeKeyBindingContainerAdded*` | Framework repeat/container propagation is broader than two gameplay actions. Local tests retain repeated-edge suppression, reject modifier chords and quarantine settings-capture sources and suppress already-held sources only on a fresh attempt, while ordinary resume reconciles held actions. No full framework-container port or independent oracle run is claimed. |
| `osu.Framework.Tests/Visual/Audio/TestSceneAudioMixer.cs`, sample/track adjustments; osu! volume overlay/audio-ducking UI | BASS routing, ducking and visual controls are outside this two-output Web Audio preference contract. `audio-mixer.test.mjs` tests interruptible 20 ms ramps; `settings-audio.spec.mjs` renders actual independent output amplitudes. Engine-selected per-voice volume/pan/timing remain untouched. |
| Mania/taiko/catch inputs, touch-specific gameplay, modifier combinations and offsets | Outside the approved desktop two-key settings work. Existing touch behavior is retained; no new touch or offset compatibility claim. |

A12/A21/A22 and H11 stay open. No new executable upstream adapter was created
or run for this product policy. Full upstream pause UI and audio evidence are
separate outstanding work, not implied by local ports or native/WASM parity.

## Timing calibration protocol (human evaluation pending)

Keep every offset zero. Recruit at least five people: at least two newcomers,
at least two experienced rhythm-game players, and one additional participant.
Record anonymous participant IDs and experience; never invent missing reports.
Use the original demo after Plan 1 integration plus at least two representative,
licensed/local maps (record map hashes, difficulty and input patterns). Have each
participant do one familiarization run and three measured repeats per selected
map/browser/device configuration. Counterbalance browser/map order to reduce
learning and fatigue effects; allow breaks.

Cover current desktop Chrome and Firefox, and Safari where available. Record
browser/OS versions, display refresh rate, physical keyboard/pointer, selected
bindings, music/effects gains, device connection and playback device. Use wired
or built-in output as baseline. Record wireless sessions separately, including
connection type and device model; never pool them with the baseline. Verify
that main music and effects are audible before measured runs and use an explicit
Play gesture. Do not change settings within a measured run.

For each run retain:

- Build/WASM hash, map/source hash, participant ID, browser/device configuration,
  run order, UTC date, gains/bindings and interruption/retry history.
- Participant's perceived early/late/consistent/uncertain report, confidence,
  and whether a repeated pattern occurred. Record the words before showing any
  engine metrics. Do not convert these reports into milliseconds.
- Actual exposed `baseLatency`, `outputLatency` and `sampleRate` (mark missing
  values unavailable); these are browser estimates, not measured end-to-end lag.
- Exported diagnostics: frame interval/stall observations, input receipt/audio
  stamps, mapped versus committed time, audio scheduling/lateness/drops, clock
  epochs and interruptions. Retain capture mode and report hash.
- Judgement offset distributions only if actual per-judgement offsets are
  captured by an identified engine output. If unavailable, leave the distribution
  absent. Never infer offsets or milliseconds from grades, accuracy or score.

Analyze repeatability within each participant/configuration before aggregating.
Separate reports coinciding with frame/audio interruptions from consistent
perceived timing. Compare device/browser conditions without pretending five
participants establish population-level certainty.

Decision record must choose one of:

1. **Retain zero**: no reproducible baseline problem in the completed trials;
   report uncertainty and remaining coverage.
2. **Fix transport**: clock/scheduling/drop evidence explains the problem; repair
   the transport and repeat the same trial matrix before considering an offset.
3. **Propose a separate calibration contract**: reproducible perception persists
   without an identified transport defect. Specify sign, anchor application,
   device/map scope, pause/seek behavior, frozen session settings, ABI and replay
   identity under ADR-002/004 before any implementation.

Current decision: retain zero operationally; human calibration evaluation is
**pending**, not a completed retain-zero finding. No human testers, perceived
reports, acoustic loopback measurements or demo trials were available in this
isolated task. Automated output/rendering and exposed latency observations do
not substitute for that evaluation.

## Local evidence, 2026-09-14

Node 24.13.0, checksum-pinned Odin `dev-2026-09-nightly:a2fb372`, documented
LLD 20 path, exact package lockfiles and Playwright 1.63.0. The production WASM
was rebuilt in this worktree. The inherited diagnostics/evidence changes were
retained; they are not part of the settings implementation claim.

Browser service suite: 134 passed. Product unit suite: 23 passed. The controller
regression uses the same normalized inputs with default settings and custom
Space/Right-arrow, disabled mouse and zero output gains across 30/60/120/144 Hz
and 0/50/100/250 ms stalls. All 32 combinations retain the same SHA-256 of final
result bytes plus admitted audio intent. The prior direct/headless comparison
also passes. Ten retries keep one session and one RAF callback. These are local
production-WASM consistency checks; native/WASM full-engine parity remains
separately tested by `npm --prefix engine test` (116 gameplay fixtures across
17 schedules, plus workloads, foundation, geometry, preparation, simulation and
presentation checks). No upstream executable was run by this task.

The four settings Playwright journeys pass in all three installed engines:
Chromium 153.0.8010.12, Firefox 155.0, Playwright WebKit 26.6. They cover reload,
volume extremes/reset, rejected bindings/chords, capture focus loss, Escape
ordering, focus wrapping/restoration, storage failure, paused remapping, held
keys, muted running simulation, retry mixer identity and failed-boot cleanup.
This is automation against bundled engines, not Safari/release certification.

`settings-audio.spec.mjs` renders through real `OfflineAudioContext` and the
production music/effects/mixer classes in all three engines. At 100/100 both
channels produce nonzero output; muting either leaves the other unchanged;
50/25 produces amplitude ratios 0.5/0.25 to the full-volume reference. Silence
and dispatch counts remain equal. The existing input browser journey also
passes in all three engines. The broader existing voice-loop audio journey
passes Chromium/WebKit but fails Firefox because the existing per-voice ramp
executor calls unsupported `AudioParam.cancelAndHoldAtTime`. That executor is
not changed to approximate engine ramps here; the new output mixer has no such
dependency. H11 and Firefox full audio acceptance stay open.

Automated exposed latency sample (seconds, 48,000 Hz in each engine):

| Engine | baseLatency | outputLatency |
|---|---:|---:|
| Headless Chromium 153 | 0.005333333333333333 | 0.032 |
| Firefox 155 | 0 | 0.02270833333333333 |
| Playwright WebKit 26.6 | 0.0026666666666666666 | 0.015833333333333335 |

These are one local API observation per engine, not hardware latency
measurements. The automation used synthetic silent music for lifecycle tests;
there is no perceived-timing or human judgement-offset evidence. Raw reports,
attachments and gate output are ignored artifacts, not fabricated oracle files.

Pre-mirror reproduction identity (SHA-256; test files identify the precise setup/assertions,
not independent upstream fixture hashes):

| Input | SHA-256 |
|---|---|
| Controller inline `mixed_map` UTF-8 payload | `07fc9bf00647a82d88b1d8d9d02603d19ec1901319e09e41843ad582ebcb8d51` |
| `platform/browser-js/tests/gameplay-controller.test.mjs` | `4cb3de8ccd4b2b3973165ada2ea4e48ddb0c1ce393fe4ee9efd6a5c3dac1e004` |
| `platform/browser-js/tests/settings-input.test.mjs` | `3eeb78b923e997ded5a6dd1660f41c9bae5d56b454f1820b2433daee85faa308` |
| `platform/browser-js/tests/browser/settings-audio.spec.mjs` | `644f53fe0bf54201f2d134957eae198e0752a9147170d50555ffdf2ff0020d2f` |
| `platform/product-ui/tests/browser/settings.spec.mjs` | `0f1fcc79e96c06cb9dd6cc59d4c30cecfba9efabdd92e5ab26c2936b2a4e5a28` |
| `platform/product-ui/tests/player_settings.test.ts` | `3835509f106154d75709bf6ade79030a91de1ea854e8cd4da6bd2d44652fce8d` |

Pre-mirror sequential product browser run: **68 passed, 1 skipped** across Chromium,
Firefox and WebKit. The existing WebKit Ctrl+F10 case skips when the browser
reserves the chord; visible Debug/Settings actions are tested. The inherited
selection-debug test now filters actual startup audio events and focuses its
Close control before the Escape keyboard assertion (WebKit tab clicks need not
move keyboard focus). No diagnostics re-homing is claimed by this delta.

Pre-mirror isolated product `test:gates` assertions passed: typecheck, expected errors,
build, 23 unit tests, HMR/B1/B2 and 60-second B3 (60.05 fps, no reported long tasks
or heap growth). A 390 px-wide dialog screenshot was inspected: no horizontal
overflow and vertical overflow scrolls. The final preview journeys ran after
build/gate mutation finished; intermediate port-collision and rebuild-overlap
runs are not acceptance evidence. The frame suspension regression also passes
with the browser `statechange` deliberately delayed, checking an exact 350 ms
engine pause boundary and no recovery error.

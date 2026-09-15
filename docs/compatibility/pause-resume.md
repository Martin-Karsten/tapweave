# Pause and resume behavior

This change supersedes the initial Plan 2 policy of releasing every action at
pause and suppressing every held source until release. The target remains
unmodded osu!standard at osu! revision
`3c1c96f742e7aae2ff67a7361e058fe91ca3b955`, with framework revision
`f02756c5aa5032e6d04729922702b8d56c4bc2eb`.

## Contract

Ordinary pause drains timestamped input, commits the pause boundary and freezes
the engine's current action state. Input received while paused does not judge
objects. Resume first synchronizes releases against the retained physical sources
and updates cursor position, then forwards the actual resume key/button event,
before the first resumed advance. Previously held sources can remain held even
if released and pressed again during pause. Unrelated sources first pressed
while paused stay inactive until a fresh press after release. This follows
`PassThroughInputManager.syncWithParent`, which synchronizes releases, not presses. A held action is distinct from a dispatched press.

Resume requests the cursor gate when the gameplay cursor was visible and inside
the gameplay area. The target stays at the paused cursor position and the clock
stays frozen. A new left/right gameplay action while hovering that target accepts
the gate. Escape returns to pause. Intro time before the first object minus
2000 ms, effective breaks, and hidden/outside cursors bypass the gate. Effective
breaks last at least 650 ms and end their gate bypass 325 ms before their end,
with inclusive interval boundaries, following `BreakTracker` and `BreakPeriod`.

When the resume action was not held in the paused gameplay state, the engine
arms a one-shot press blocker. The first dispatched press is consumed, while its
held state remains available to tracking. If the same physical source remains held,
reconciliation does not manufacture a new press. Switching from a released
keyboard source to a mouse source can dispatch a new press even when both bind
the same action; the blocker condition still uses the action state at pause,
exactly as the pinned overlay does. Releasing and pressing again
can hit an object normally. The fixed default cursor target uses the pinned
28-unit cursor size; display scaling does not change during animation.

Settings retain their narrower safety rule: keys/buttons used within the modal
are quarantined until release. Closing settings never resumes automatically.
Fresh attempts suppress sources already held at installation. Neither rule
replaces ordinary resume reconciliation. On browser focus loss, unobservable
physical state is cleared; retained engine state is reconciled on explicit resume.

## ABI and replay

Simulation version remains 1; rules version is now 2. Input flag bit 0 arms the
one-shot blocker. Unknown bits reject transactionally. The recorder retains this
marker once and clears it from subsequent ordinary frames. Replay reset/seek
reconstructs the blocker through the same input path. Old rules-version-1
recordings reject as unsupported rather than silently changing their meaning.

The read-only `oe_session_resume_policy` query returns kind 53/version 1 with the
gate decision, retained actions, frozen cursor, target half-size and per-action
resume input flags. Odin owns
the decision; the browser supplies cursor visibility/containment and executes
the gate. The resumed AudioContext anchor is bound before reconciled input is
submitted, and that input is submitted before the first resumed advance.

## Evidence and remaining work

`engine/reference-host/PinnedPauseInputScene.cs` retains the six osu!standard
test bodies from `osu.Game.Tests/Visual/Gameplay/TestScenePauseInputHandling.cs`,
including their setup, input sequences and assertions. The class is renamed;
Mania methods and their import are omitted as out of scope. The original MIT
notice is retained. `PauseObservation` executes these bodies in the real pinned
headless host. All six passed:

- `TestOsuInputNotReceivedWhilePaused`
- `TestOsuPreviouslyHeldInputReleaseOnResume`
- `TestOsuHeldInputRemainHeldAfterResume`
- `TestOsuHitCircleNotReceivingInputOnResume`
- `TestOsuHitCircleNotReceivingInputOnResume_PauseWhileHoldingSameKey`
- `TestOsuHitCircleNotReceivingInputOnResume_PauseWhileHoldingOtherKey`

Two additional source-derived probes execute the real upstream Player and
confirm that a newly held paused key stays inactive, and that changing from a
released keyboard source to a mouse source dispatches a fresh action. They are
in `PauseAdditionalScene.cs`, distinct from the six retained original methods.
The original tests use inherited test-only NoFail; local HP0 maps isolate the
unmodded input assertions without claiming failure equivalence.

The local native port is `engine/tests/resume_test.odin`. Production-WASM
`platform/browser-js/tests/resume.test.mjs` verifies held/press separation,
replay export/import and repeated seek, exact intro/break boundaries, invalid
flags and gate cleanup. All 138 browser service tests and the complete engine
suite pass. Nine real-browser resume journeys pass across Chromium, Firefox
and WebKit, including keyboard/mouse source changes, off-target input, repeated
Escape cancellation, focus loss and observer disposal. The final complete
product matrix passes **77 tests with one existing WebKit Ctrl+F10 shortcut
skip**. Product gates pass, including 23 unit tests and the 60-second B3 probe
at 60.05 fps with no reported long tasks or heap growth. Previous Plan 2 test
counts describe the pre-mirror baseline.

Reproduce upstream execution with `npm --prefix engine run test:pause:upstream`
using the checkout/.NET environment documented in the reference-host README.
The script checks that all retained standard test bodies are unchanged, runs a
locked restore/build and records methods, revisions, fixture/adapter hashes and
observation digest in [the finding index](../../engine/reference/findings/pause-resume.json).
Raw observations and logs are under ignored `engine/artifacts/pause/`.

Acceptance IDs: A21 (pause/resume), A23 (replay), A24 (lifecycle/resources).
These six tests do not close the complete rows. Pause cooldown, pause-menu sound
loops, the full inactive-player matrix, physical-device certification and H11
remain separate open gates. No human calibration results are claimed.

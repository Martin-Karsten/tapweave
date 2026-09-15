# MVP player experience: parallel implementation contract

This is the implementation handoff for the approved public desktop MVP work.
It specifies future work; `status.md` remains the authority for implemented
coverage. Full M2/M3 acceptance does not follow from shipping these features.

## Shared foundation

The shared code is deliberately additive and not mounted in the player yet:

- `platform/browser-js/src/player-settings.ts` owns `Player_Settings`,
  `Gameplay_Input_Settings`, defaults, validation, labels, storage key/version,
  and the `Player_Settings_Source` subscription/command interface.
- `platform/product-ui/src/services/player_settings.ts` implements the validated,
  immutable in-memory `Player_Settings_Service`. Persistence is `not-loaded`
  until Plan 2 implements storage. Invalid updates preserve the prior snapshot
  and do not notify subscribers. Subscription does not immediately invoke its
  listener: consumers first read `snapshot`.
- `platform/product-ui/src/state/settings_state.ts` owns Solid subscriptions and
  `bind_player_settings`, `player_settings`, `settings_snapshot`,
  `settings_dialog_open`, `open_settings_dialog`, and `close_settings_dialog`.
  Opening requires a bound settings service and a player session. It requests
  the ordinary pause path if running, then opens only in ready/paused/terminal.
  Closing never resumes. Plan 2 mounts the dialog and binds the service at boot.
- Shared regression tests cover atomic updates, immutable snapshots, labels,
  subscription cleanup, lifecycle guards, and pause-before-open.

Defaults: music 70%, effects 80%, physical KeyZ/KeyX, mouse buttons enabled.
Valid volumes are integer 0–100. Hit keys are letters, digits, arrows, or Space;
the two actions must use distinct codes. Escape, Tab, Enter, function/modifier
keys and chords cannot be bound. Store only preferences, never clock offsets.

No production remapping, output gain, persistence, or settings dialog is claimed
by this foundation. Plan 1 may consume defaults and the public entry points;
Plan 2 owns making those settings effective. Until then, the existing Z/X and
mouse behavior remains accurate. Do not expose an empty settings dialog.

## Ownership and integration

Both tasks must begin from the same working-tree snapshot containing this file,
the shared foundation, and the existing in-progress diagnostics changes. Treat
inherited modifications as baseline: do not revert or claim authorship for them.
Use separate worktrees, and do not merge, deploy, or overwrite the other task.

Plan 1 owns selection/results/lifecycle screen UX, selection loading stages,
metadata engine/ABI transport, demo assets/generator, and its tests/docs.

Plan 2 owns the settings service and state, new settings dialog, session boot
binding, browser input/audio/controller configuration, and its tests/docs.
It owns changes to `services/player_session.ts` and `state/session_state.ts`.

Shared-file edits are intentionally small: Plan 2 mounts the dialog in `app.tsx`
and exposes one global Settings action usable on selection and while paused.
Plan 1 adds the contextual Settings action to its pause UI using
`open_settings_dialog`. Plan 2 must not redesign selection/results/lifecycle
screens; Plan 1 must not edit the input/audio settings integration. Both append
their evidence to the existing status/ADR owners and reconcile those append-only
changes during integration. No new dependencies or shell framework changes.

Final integration combines the two task deltas, then verifies custom controls
in onboarding labels, settings from pause, held-input reconciliation and resume-press blocking,
demo playback, results/retry, and browser Back. Run the combined gate suite;
passing isolated tasks does not establish combined acceptance.

## Plan 1: self-explanatory first session

### Selection and instructions

Offer Try the demo and Open beatmap files on the initial screen. Explain .osz
versus an .osu with its music/assets and that files stay on the device. Keep
import available after demo selection. Show pre-play guidance: aim with the
pointer, tap the configured keys/enabled mouse buttons as the approach circle
reaches the object, hold/follow sliders, hold/rotate for spinners, Escape pauses.
Use `settings_snapshot().settings` and shared key-label helpers; never hardcode
Z/X in new hints. Guidance remains accessible from pause. No autoplay, timed
popups, new tutorial engine, or in-play tutorial overlays.

### Metadata

Expose decoder-owned title, artist, creator and difficulty name through a narrow
versioned read-only ABI query. Do not parse .osu metadata independently in JS.
Use generated layouts and validated UTF-8 relative spans, map-owned bounded
output allocated transactionally under map quotas, and browser-owned copies of
strings. Advertise the extension explicitly and update ADR-005/interface-v2.
Do not change existing prepared identity or replay behavior for display metadata.

Show selected artist/title/difficulty/mapper, object count, playable duration,
CS/AR/OD/HP with brief explanations. Playable duration is first object start to
last object end, derived once from prepared data, not music duration. Handle
empty maps explicitly. No star rating or inferred ranking. Keep virtualized
difficulty selection, filenames for unprepared rows, and cache metadata only
for successfully selected difficulties in the current asset scope. Do not fully
prepare every difficulty for list display.

### Loading and errors

Publish real stages: reading files/downloading demo, preparing difficulty,
decoding music, loading effects, preparing gameplay resources. Use indeterminate
progress, no invented percentages. Publish stage transitions outside the frame
path. Preserve transactional replacement and generation-based stale cancellation.

Map failures to actionable text: missing map (what files to select), unsupported
ruleset/version (supported standard scope), missing music (include matching
file/full archive), audio decode (browser cannot decode), malformed files (try
another import), quota (smaller archive), demo fetch (Retry/import), engine boot
(Reload/details). Retain original error codes/details in expandable technical
information and diagnostics. Summarize missing effect warnings with expansion.

### Navigation and results

Consistent Play/Resume/Retry/Back to selection. Pause exposes controls and the
shared settings entry point. Closing settings returns to pause without resuming.
Retry uses the existing lifecycle reset; Back retains the selection and restores
focus to Play. Results distinguish completion/failure and read engine-owned
score, accuracy, rank, combo and counts. Use normal layout for standalone results
and an overlay only for pause/recovery. Browser Back/route changes must use the
lifecycle service. Retain diagnostics UI. Visible focus, accessible names,
focus restoration and stage announcements are required; no frame-level announcements.

### Original demo

One approximately 75-second original demo: 100 BPM, >=4 seconds before first
object, CS4/AR4/OD3/HP2, spacious circles followed by simple sliders and one
generous spinner. No dense streams, difficult overlaps, hidden no-fail or custom
rules. Produce original synthesized music; use no downloaded songs/samples/art.

Keep editable map/music source and deterministic generation code tracked;
generate the archive/audio into ignored build output through asset preparation.
Do not check generated assets in. Include provenance, explicit redistribution
terms, asset manifest and hashes. Fetch the same-origin archive via the existing
archive pipeline; show an explicit Play button after loading for a fresh audio
gesture. Handle stale fetch/replacement and retry without losing a valid selection.

### Validation

Test first visit/demo/controls/play/results/retry, keyboard navigation, archive
and loose import, failed replacement, missing/undecodable music, failed demo
download, Unicode/empty/long/HTML-like metadata rendered as text. Test ABI
malformed spans, ownership/lifetime, quota failures, stale handles, native/WASM
parity and source metadata comparisons. Human beginner readability and audible
playtesting remain separately reported if not executable in the task.

Run full engine suite for metadata/fixtures, browser typecheck/test/build,
product test:gates and applicable Playwright journeys. Search pinned upstream
tests before behavior changes, port applicable scenarios, record revisions,
fixtures/acceptance IDs, and distinguish local from independent evidence.

## Plan 2: persistent essential settings

### Service and persistence

Extend the shared service instead of creating another settings model. Persist
under `tapweave.player-settings.v1` with version 1 and the agreed flat fields.
Inject storage for tests; no reactivity in the service. Read once at page boot,
before applying audio or input. Validate data; invalid fields default individually,
invalid binding pairs default together, unknown schema versions use defaults
without guessing migrations. Preserve unknown-version stored data until an
explicit user change/reset. No cross-tab live application; new tabs/reloads read
storage. No offset field.

Save committed edits and reset, not frames. Storage failure keeps preferences
usable in memory, sets persistence to unavailable and shows “Settings apply for
this visit but could not be saved.” Mark successful loading/writing saved. Reset
restores all shared defaults. Bind through `bind_player_settings` and clean up
subscriptions with the session owner. Boot failure must not leak owned resources.

### Dialog

Mount one shared settings dialog, with Audio and Controls sections. Selection
and pause can open it. Volumes show percent and zero/mute. Bind buttons capture
one physical key, reject unsupported/duplicate assignments without changing the
valid settings. Escape cancels capture first and then closes the dialog. Mouse
toggle explains aiming remains active. Apply on commit with no Save button;
Reset announces defaults. Trap modal focus and restore the opener on close.
Do not stack settings and debug dialogs or let background shortcuts act during
key capture. Opening from play pauses first; close never resumes automatically.

### Audio

Add a page/session-service-owned Audio_Mixer with music/effects GainNodes.
Music goes through music gain; existing per-voice volume/pan goes through effects
gain. Inject output destinations into Music_Transport and Audio_Service, keeping
context.destination defaults for existing callers. Use percentage/100 amplitude,
apply saved gain before start, smooth updates over 20 ms without requiring
cancelAndHoldAtTime. Mixer survives retry/map changes and disposes with its owner.
Muting does not suspend/advance differently. Do not change engine commands,
sample selection, event timing, replay/score or clock anchors.

### Input

Pass immutable Gameplay_Input_Settings into Gameplay_Input on start/resume.
Replace hardcoded mappings and hints; use shared label helpers for accessible
canvas text and controller messages. Capture remains physical event.code,
letters/digits/arrows/Space only, two distinct codes, no chords. Keep Escape pause.
Preserve keyboard/mouse aggregation and repeated-key suppression. Disabling
mouse hits retains pointer aiming. Do not move timestamps off AudioContext.

Paused changes apply through a fresh input instance on resume. Keep the engine
action state frozen during pause, then reconcile current physical sources before
advancing. Use the lazer cursor resume gate and consume its press without losing
the resulting held action. Only sources used inside settings remain quarantined
until release; binding capture must not become a phantom hit. This supersedes
the earlier blanket suppression plan; see [pause/resume](compatibility/pause-resume.md). Test captures involving the existing
bindings, modifier chords, focus loss and pointer cancellation. No silent timestamp
clamping or changes to deterministic judgement.

### Calibration evaluation only

Keep zero offsets. Define/run structured trials with demo and representative
maps: >=5 testers including newcomers/experienced players, Chrome/Firefox and
Safari when available, wired/built-in baseline with wireless recorded separately.
Record repeated perceived early/late reports, actual exposed latency values,
frame stalls and scheduling evidence. Use judgement offset distributions only
where actual offsets are available, never infer milliseconds from grades.
Report retain-zero, fix-transport, or propose a separate calibration contract.
If human testers are unavailable, deliver protocol and record evaluation pending;
never invent results. Any future offset needs ADR-002/004 and ABI/replay identity
semantics for sign, application, pause/seek and frozen session settings.

### Validation

Test reload/persistence, corrupt/unsupported storage, blocked writes, boundary
volumes, reset, independent channels, muted running simulation, remap while paused,
held input at resume, retry, disabled mouse aiming/hits, source aggregation,
same-time inputs, focus loss and dialog capture/focus. Equivalent normalized
inputs must retain outcome/audio-intent digests across existing cadence/stall
tests. No retained mixer/source/subscription growth through retries.

Run browser typecheck/test/build and product test:gates/Playwright. Run engine
suite for tooling/engine changes. Search pinned input/audio tests for applicable
ports; treat persistence/UI/final output volume as original product policy.
Record actual test limitations and leave full upstream/audio acceptance open.

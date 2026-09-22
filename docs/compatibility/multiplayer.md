# Private multiplayer with local maps validation

This feature implements the product contract in [ADR-008](../architecture/adr-008-private-demo-rooms.md).
Scores are client-reported and unverified. It does not implement osu! multiplayer
wire compatibility, server replay verification or new gameplay rules.

| Acceptance | Local evidence |
|---|---|
| MP-01 room isolation, credentials, origin, capacity, readiness, host permissions | `platform/product-ui/worker-tests/rooms.test.ts` in workerd with real SQLite and sockets |
| MP-02 countdown cancellation, sequence rejection, immutable terminal results, ranking | Workers tests and `platform/product-ui/tests/multiplayer.test.ts` |
| MP-03 hibernation/eviction recovery, reconnection, refresh, host transfer | `evictDurableObject` with hibernated sockets and subsequent result submission; socket reconnect tests |
| MP-04 alarms, reconnect grace, round deadline, inactivity and absolute expiry | Real alarm handler, with persisted timestamps advanced in test storage; expiry deletes data |
| MP-05 scheduled audio and cancellation without early simulation | `platform/browser-js/tests/audio-playback.test.mjs`; existing solo pause/replay regressions retained |
| MP-06 independent browser contexts, scoreboard, shared results, rematch, interruptions | `platform/product-ui/tests/multiplayer/rooms.spec.mjs`, dedicated Workers-hosted Playwright config |
| MP-07 deployment artifact and routing | `scripts/package_deployment.mjs`, artifact hashes and hosting smoke |
| MP-08 public two-device completion and measured start skew | **Open:** separate physical devices and audio output have not been certified |
| MP-12 multiplayer fail policy: mark-and-continue at zero health | `engine/scripts/test-gameplay.mjs` fixtures `multiplayer-failure-continue-hp{0,5,10}` (native/WASM parity), `engine/tests/gameplay_test.odin`, `platform/browser-js/tests/engine.test.mjs`, multiplayer browser suites |

The browser synchronization assertion compares audio-anchor estimates on a common
wall-clock epoch, targeting less than 100 ms in controlled local conditions. It
does not measure speakers, Bluetooth latency or inter-device clock calibration.
The unattended browser round uses actual Odin failure results; complete-score
ranking is separately tested with explicitly client-reported terminal fixtures.
Quota failure UI is exercised through a 503 response, not by exhausting an account.

## Pinned upstream search and classification

Searched the recursive test tree at osu! revision
`3c1c96f742e7aae2ff67a7361e058fe91ca3b955`, including
`osu.Game.Tests/Visual/Multiplayer`, `NonVisual/Multiplayer`,
`NonVisual/GameplayClockContainerTest.cs` and
`Gameplay/TestSceneMasterGameplayClockContainer.cs`.
Inspected `TestSceneMatchStartControl` (`TestStartWithCountdown`,
`TestCancelCountdown`, `TestReadyAndUnReadyDuringCountdown`,
`TestToggleStateWhenHost`, `TestToggleStateWhenNotHost`),
`TestSceneMultiplayerPlayer.TestGameplay/TestFail`, and the master gameplay clock
start/reset/seek/stop cases. These are useful scenario references, but the upstream
rooms include accounts, server-specific readiness/autostart, spectators, mods and
playlist behavior which this explicitly scoped product does not adopt. They are
not ported oracle fixtures and their expected policies are not silently relabeled
as Tapweave compatibility. Five-second all-ready starts, disconnect cancellation,
private cookie membership and unverified result ranking are original product
policy. No equivalent upstream test executes Web Audio scheduled-start admission
or Cloudflare hibernation.

No Odin rules changed. Existing native/WASM gameplay and pause/replay regressions
remain the applicable gameplay evidence. No new upstream executable comparison is
claimed. Full A20/A21/A22 and M2/M3 acceptance remain open, as before this feature.
The pinned upstream sources are inspected only; no source code was copied.

Inspected source SHA-256 (pinned revision above):

- `TestSceneMultiplayerPlayer.cs`: `1845eaae3c062a35cd13dc17946b89a3dcd9d585bfe50e3142e23d39a8f04920`
- `TestSceneMatchStartControl.cs`: `4d5d8171a2157f25aea4f78452de31bd8c39c6d3cd51a88485f261d5bcce9c32`
- `GameplayClockContainerTest.cs`: `fffbc6f9cf0117e5bb8ae5a5ec88da7b04355cf9ea551105947d531dcc7987b2`
- `TestSceneMasterGameplayClockContainer.cs`: `8817affd1d9fdb8eee2f79aac6c64fec197ebbc3639b0af21eff1dfc341f87bb`

Also searched the pinned framework tree at
`f02756c5aa5032e6d04729922702b8d56c4bc2eb` for audio/clock tests. Its
`osu.Framework.Tests/Audio` (BASS/virtual tracks/device loss) and
`osu.Framework.Tests/Clocks` suites do not contain Web Audio deadline admission
or browser room orchestration. These backend-specific scenarios are not claimed
as newly ported upstream evidence. In particular, upstream multiplayer's
`TestFail` continues score accounting after failure using Autopilot; that mod and
multiplayer-specific fail policy are outside this task's existing local-engine
scoring contract. **Superseded 2026-09-21:** rounds now implement the pinned
upstream fail policy through an explicit session fail policy (see
"Multiplayer fail policy" below); solo play retains terminal failure.

## Multiplayer fail policy

Rounds create their gameplay session with `fail_policy=1` (kind-18 record,
ABI 2.1): reaching zero health latches an F rank and freezes health at zero
while play, scoring and audio continue to the map's end, where the session
finishes `PASSED` with rank F and the client reports terminal status `failed`
with the full end-of-run score. This mirrors the pinned upstream mechanism at
osu! `3c1c96f742e7aae2ff67a7361e058fe91ca3b955`: `MultiplayerPlayer.PerformFail()`
(which only calls `ScoreProcessor.FailScore` and suppresses the fail sequence),
`ScoreProcessor.ApplyNewJudgementsWhenFailed` and the `HealthProcessor`
post-`HasFailed` health freeze. Solo play keeps `fail_policy=0` terminal
failure. Results ranking is unchanged: failed runs stay separate and unranked,
now carrying their complete end-of-run scores.

Evidence: the `multiplayer-failure-continue-hp{0,5,10}` fixtures in
`engine/scripts/gameplay-fixtures.mjs` port the
`TestSceneMultiplayerPlayer.TestFail` scenario (no fail sequence, score keeps
counting after failure, health frozen at zero) with native/WASM parity and
cadence invariants; `engine/tests/gameplay_test.odin`
(`gameplay_multiplayer_failure_marks_and_continues`) covers failure latching,
rank freeze, replay round-trip and reset; `platform/browser-js/tests/engine.test.mjs`
checks the create record and both policies; the multiplayer browser suites
exercise the complete round. The upstream visual scene test itself is not
executable through the H01–H04 reference hosts, so this remains a local port
with recorded provenance, not an upstream oracle comparison, and closes no
lazer gameplay acceptance row.

## Prior demo-only validation on 2026-09-21 (protocol v1)

Node 24.21.0; pinned Odin and Wrangler toolchains retained. The full engine suite
passed (native/WASM local parity, no new upstream run). Browser runtime typecheck,
193 service tests and build passed. Product gates passed, including the 60-second
B3 probe, and all 44 unit tests passed. The existing 180-case product browser run
had 169 passes, three existing capability skips and eight menu expectations that
still assumed two actions. After updating those expectations for the new live
Multiplayer action, the entire menu file passed on all three browsers (23 passes,
one existing WebKit native-Tab skip). No gameplay/pause/replay regression failed.

The dedicated Workers suite passed 12 tests, including actual hibernation
eviction and both running/countdown half-open socket replacement. The dedicated
multiplayer browser suite passed all 12 cases across Chromium, Firefox and WebKit.
One completed controlled run measured estimated anchor skew of 5.1 ms, 8.7 ms and
1 ms respectively. Source reports and browser artifacts are generated under
`platform/product-ui/artifacts/`; they are not committed gameplay oracle evidence.
Local artifact hash, static-asset integrity and hosting smoke checks passed.

Public deployment version `f3ceaf0f-4a07-4197-8dc2-22beab46aafb` passed the
hosting smoke and an independent-context Chromium room round through rematch.
The public run measured 0.4 ms estimated audio-anchor skew.
MP-08 remains open by user request: both automated contexts ran on one machine,
and no physical-device or audible-output timing measurement is claimed.

## Protocol v2 local-map coverage

- MP-09: `tests/multiplayer_map.test.mjs` executes the real WASM preparation
  pipeline with loose and repackaged fixtures. It checks matching difficulty,
  changed map/music bytes, missing audio, incompatible engine identity and
  transactional rollback. Compression levels 0/9, relative directories and
  unrelated backgrounds do not affect identity. The fake audio decoder in this
  unit fixture isolates byte matching; real decoding is exercised in browsers.
- MP-10: `worker-tests/rooms.test.ts` exercises host-only revisioned selection,
  stale readiness/start rejection, all-ready enforcement, frozen descriptors,
  rematches retaining selection, short/long deadlines, active-round inactivity
  exemption, four-hour start admission, and v1 retirement through real workerd.
- MP-11: `tests/multiplayer/rooms.spec.mjs` independently imports loose host files
  and a differently packaged guest archive, checks automatic difficulty choice,
  failed imports/rapid map changes, short/80-second-map final-result agreement and outgoing
  HTTP/WebSocket metadata allowlists. Existing synchronized audio, withdrawal,
  refresh, reconnect and delayed-start cases remain. `selection_race.spec.mjs`
  holds an earlier selection acknowledgement across a newer host choice;
  `demo.spec.mjs` verifies no automatic demo fetch and explicit matching/readiness.
- `platform/browser-js/tests/selection.test.mjs` checks prepublication admission
  failure and cancellation against real WASM handles, retaining the old map and
  releasing candidate ownership.

The delayed unit fixture starts at 8,000 ms and ends at 95,000 ms; its round
length is 95,000 ms, not the 87,000 ms object span. Short-map browser results
compare the room report to Odin's actual final score. Server lifetime tests
advance persisted deadlines rather than waiting four hours.

Additional pinned search: `osu.Game.Tests/Online/TestSceneMultiplayerBeatmapAvailabilityTracker.cs`
at osu! `3c1c96f742e7aae2ff67a7361e058fe91ca3b955`, SHA-256
`b520cf3886131d3a44226b45f1e74046f3523316bd4afa8536f17ca16690096a`.
Inspected `TestEnterRoomWithNotDownloadedBeatmap`,
`TestEnterRoomWithLocallyAvailableBeatmap`, `TestAvailabilityUpdatesOnItemEdit`
and `TestAvailabilityUpdatesOnSettingsChange`, plus
`TestSceneMatchStartControl.TestDeletedBeatmapDisableReady`. The pinned recursive
osu! tree was searched for multiplayer, availability and import tests; the
framework tree at `f02756c5aa5032e6d04729922702b8d56c4bc2eb` has no multiplayer
availability tests. These scenarios inform MP-09–MP-11 but use account/API-backed
beatmap IDs and persistent database availability, outside the local-byte matching
contract. They are not Odin rule scenarios or new upstream oracle ports.
No equivalent upstream test covers this SHA-256 triple, browser transaction
fence or Cloudflare revision protocol. Local product regression evidence does
not close A20/A21/A22; no new upstream executable comparison is claimed.

The browser fixture is generated from the original bundled demo with a changed
local title (not a server-provided room asset). Its selected `.osu` SHA-256 is
`77a649c733391f85a90b6e5fc6001bc2e33e0f732969ca3ac552c22162a79f3f`;
referenced WAV SHA-256 is
`331e1abc4d5b92d2e9ab494abcaddaddd0ce2f78aa4c2d83790614aea7aee98d`.
Archive bytes intentionally vary; they are not matching identity.

## Protocol v2 validation on 2026-09-21

Using Node 24.21.0 and the repository's pinned toolchains:

- Full `npm --prefix engine test` passed: source verification, allocation-tracked
  tests, native/WASM local parity and existing gameplay regressions. No new
  upstream executable comparison was run or acceptance row closed.
- Browser runtime typecheck, all 194 tests and build passed.
- Product typecheck, all 47 unit tests, build and `test:gates` passed, including
  the 60-second B3 probe (60.08 fps, no long tasks, zero measured heap growth).
- Worker generated types/typecheck, dry-run bundle and all 16 workerd tests passed.
- All 30 multiplayer browser cases passed across Chromium, Firefox and WebKit:
  27 lobby/lifecycle/demo/race cases and three actual 80-second delayed-map
  rounds. Each long round stayed playing beyond 75 seconds, reported progress
  below 100% before the final object, then produced agreed completed results.
  The delayed-acknowledgement and superseded-read checks also passed separately
  on all three browsers. API traffic assertions found only bounded metadata and
  score reports, with no map/music payloads.
- Packaged artifact hashes, static-asset integrity, documentation paths and
  `git diff --check` passed. No npm dependency or compiler version changed.

Local browser logs are retained in ignored
`platform/product-ui/artifacts/multiplayer-v2-validation/`. These are product
regression results, not upstream oracle evidence. Protocol v2 was not deployed.
MP-08 physical-device and audible-output validation remain open.


## Room chat

| Acceptance | Local regression mapping |
|---|---|
| MP-13 authenticated delivery, isolation, validation, rate limits | `worker-tests/rooms.test.ts`, `tests/room_chat.test.ts` |
| MP-14 bounded history, eviction, lazy v2 initialization, delivery reconciliation | same Worker and service suites |
| MP-15 pinned focus/break interaction | `tests/room_chat_component.test.tsx`, `tests/multiplayer/chat.spec.mjs`, `engine/tests/activity_test.odin`, browser `tests/engine.test.mjs` |
| MP-16 typing cannot hit/pause/withdraw; canvas geometry remains stable | browser `tests/settings-input.test.mjs`, multiplayer chat browser scenario |

Paths without a prefix are relative to `platform/product-ui`. These rows describe
local regression coverage, not executed upstream acceptance or release certification.

Source hashes at osu! `3c1c96f742e7aae2ff67a7361e058fe91ca3b955` are in
[`room-chat-sources.json`](../../engine/reference/findings/room-chat-sources.json).
Inspected `GameplayChatDisplay`, `MultiplayerPlayer`, `Player`, `BreakTracker`,
`BreakPeriod`, `PeriodTracker`, and the pinned test trees for Chat/Online and
Visual/Multiplayer/Gameplay. The five `TestSceneGameplayChatDisplay` methods
(`TestCantClickWhenPlaying`, `TestFocusDroppedWhenPlaying`,
`TestFocusOnEnterKeyWhenExpanded`, `TestFocusLostOnBackKey`,
`TestFocusOnEnterKeyWhenNotExpanded`) map to the component and real browser tests.
`TestSceneBreakTracker.TestNoEffectsBreak`, `TestMultipleBreaks`, `TestRewindBreaks`,
`TestSkipBreaks` and both `TestBeforeGameplayStart` parameter cases inform the
native/WASM boundary tests. The real-time `TestShowBreaks` is a visual overlay
exercise; Tapweave does not implement that break overlay. No upstream test covers
Cloudflare cookie authentication, hibernation or this private room protocol.

The implementation run attempted `verify-sources.mjs --require-checkouts` and
failed because `OSU_REFERENCE_CHECKOUT` is not configured; there is also no
`dotnet` executable on PATH. No upstream visual tests or adapter ran. Their
executable acceptance remains open, and local ports are not relabelled as oracle
results. Restore clean pinned osu/framework checkouts and the reference-host SDK
before executing these scenes through the headless upstream runner. Account-backed
channel management, commands, rich formatting and moderation remain out of scope.

The chat browser fixture is an original three-circle HP0 map with an 11–16 second
break, exercising automatic focus release at 15,675 ms and a terminal at the map's
end. It uses the existing demo audio locally; neither map nor music travels through
chat. The fixture is retained directly in `tests/multiplayer/chat.spec.mjs`.

The chat browser scenario also generates messages every 2.1 seconds through the
other member's composer while gameplay continues. It records frame/publication
counts and long tasks, asserts bounded message DOM and no per-frame player-service
publications, and checks that expanding chat does not resize the canvas.

The pinned framework test tree at `f02756c5aa5032e6d04729922702b8d56c4bc2eb`
was also searched for focus, text-box and keyboard cases. Inspected
`TestSceneTextBoxKeyEvents` (consumed keydown, repeat, Escape and same-frame
release/press) and `TestSceneFocus` (disabled/hidden focus and propagation).
Their drawable/native-text-input infrastructure is not used by the browser;
DOM focus, IME and audio-clock input suppression have focused platform tests.
These framework visual tests were not executed; their inspected hashes are
recorded alongside the osu! sources.

### Local implementation validation (2026-09-22)

The pinned Node 24 and Odin toolchains passed the engine test/build commands,
browser-runtime typecheck/test/build (207 tests), product gates (60 unit tests),
Worker typecheck and all 19 Worker tests. All 33 multiplayer browser regressions
passed across Chromium, Firefox and WebKit; the final packaged chat scenario was
also run separately on all three after styling and countdown coverage changes.

The general browser suite completed 174 passes and three existing WebKit skips
(Ctrl+F10 delivery, native Tab traversal and file-drop support). Its three
diagnostics failures were the old ABI 2.0 expectation; after updating it to 2.2,
all 12 shell checks passed across the three browsers. No gameplay regression
failed. Deployment packaging, hash verification, hosting-asset integrity, local
hosting smoke and `git diff --check` passed. The artifact was not rebuilt between
its final multiplayer test and hosting smoke test.

During that final chat workload, Chromium measured 55.51 fps and one 75 ms long
task, Firefox 118.13 fps, and WebKit 59.91 fps. Each browser published only seven
player-service updates over approximately 16 seconds. These local observations
are not physical-device performance certification. History/DOM bounds and stable
canvas geometry were asserted in the scenario.

The combined Worker, shell and WASM artifact is in the ignored
`platform/product-ui/artifacts/deployment/` directory. Validation logs are retained
in ignored `platform/product-ui/artifacts/room-chat-validation/`. No deployment
was performed.

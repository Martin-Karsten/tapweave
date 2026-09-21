# Private demo multiplayer validation

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
scoring contract. Tapweave retains ordinary local terminal failure semantics.

## Local validation on 2026-09-21

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

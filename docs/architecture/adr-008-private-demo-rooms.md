# ADR-008: Private rooms with local maps

Status: accepted for implementation; physical two-device release acceptance open.
Amended 2026-09-21: rounds run the pinned multiplayer fail policy through the
kind-18 `fail_policy` field (ABI 2.1), the feature's first production ABI
addition; see "Fail policy" below.

## Decision

Extend the existing Tapweave Worker with one SQLite-backed `Multiplayer_Room`
Durable Object per unguessable private room. The Solid shell subscribes to a plain
browser service. Odin retains all preparation, judgement, scoring, replay and
presentation policy. This is an original social coordination feature, not an
implementation of osu!'s multiplayer protocol or competitive verification.
No production ABI changes. Persistent map libraries, downloads, file sharing, teams, mods, ready subsets,
accounts, chat, uploads, spectating, matchmaking,
public listings and persistent leaderboards remain out of scope.

The Worker creates server-issued random credentials in Secure, HttpOnly,
SameSite=Strict cookies scoped to the room API. Only credential hashes are stored.
The same-origin API admits at most eight members with 24-code-point nicknames;
each member has one authenticated hibernating socket. HTTP bodies and socket
messages are bounded at 4 KiB. Control traffic is limited to 32 messages per
second per member (enough for rapid selection/check cycles); live scores retain
the separate twice-per-second limit. Protocol v2 validates message types, sequences,
finite bounded score values, round identity and host permissions. Invite links
contain room identity only. Request and lifecycle counters never log credentials.

## Scheduling and ownership

The lobby starts without an automatic demo selection. The host selects a difficulty
from the current session's set or imports an `.osz` or loose files in the room.
Other members import their own copies; the client searches that set by selected
`.osu` SHA-256 before preparation. The demo is an explicit optional import through
the same flow. Imports and difficulty changes are limited to the lobby.

Matching requires SHA-256 of the exact selected `.osu` bytes, the music bytes
resolved from the engine's audio filename relative to that map, and the exact
WASM build hash. ZIP compression, directory packaging and unrelated backgrounds
do not contribute to identity. The prepared final object end time is also checked;
it is measured from playback zero, not from the first object. Empty/nonpositive
or four-hour timelines cannot be selected. Music must decode before availability.
No map or audio bytes cross the multiplayer API; imports remain session-only.

The bounded descriptor carries those three 64-character hashes, title, artist,
creator and difficulty (each at most 128 UTF-16 code units without control
characters), and finite positive `end_ms`. It stays inside the 4 KiB message
limit. The server owns a monotonically increasing selection revision. Host-only
selection, availability, readiness and starts reference the current revision.
Every map selection clears every member's readiness and availability; clients
check the new revision. Availability distinguishes missing, checking,
incompatible files, preparation failure and available; ready is separate.
Possession and preparation remain client-reported, not competitive verification.

The existing selection transaction accepts an optional filename resolver and
candidate validator, both before publication. Failed checks preserve the old map
and source. Cancellation invalidates the selection generation and releases the
candidate. The room service additionally fences async hashing, preparation and
Ready clock sampling by generation/revision. Superseded work cannot publish
availability or readiness. A newer host choice waits for any earlier selection
acknowledgement, then submits against the acknowledged revision; an old
acknowledgement cannot overwrite the newer local intent. Ready unlocks the shared AudioContext in the gesture.
Five clock request/response samples estimate server offset using the lowest RTT.
The host may start only when at least two members are connected and everyone is
ready. The server freezes participants, the descriptor and its selection
revision into the round and persists a start five seconds ahead.
Clients sample clocks again, translate that deadline onto AudioContext time and
schedule music immediately. Input and simulation become active only after that
same audio timeline reaches the anchor. Timer and network receipt times never
become judgement timestamps; RAF retains its existing input/advance/render role.

A client requires at least 200 ms to map the deadline and at least 100 ms to arm
music. A sample RTT over 200 ms or launch callback more than 100 ms past the audio
anchor fails visibly and withdraws. These are conservative operational guards,
not claims of sample-accurate synchronization or physical-output calibration.
A countdown disconnect/unready cancels the round and all scheduled sources.
Pause, suspension, refresh and leaving withdraw; other runs continue. Reconnect
within 30 seconds retains only the already-running local session. A page reload
cannot reconstruct or resume that session. Multiplayer exposes no skip/retry or
resume action within a round; solo behavior remains unchanged.

## Fail policy

Rounds create their gameplay session with the pinned upstream multiplayer fail
policy (`fail_policy=1` in the kind-18 gameplay-create record, ABI 2.1, matching
osu!lazer `MultiplayerPlayer`): reaching zero health latches the F rank and
freezes health at zero while play and score accounting continue to the map's
end. The run then finishes `PASSED` with rank F and reports terminal status
`failed` with its complete score. Solo navigation keeps ordinary terminal
failure (`fail_policy=0`); entering a room arms the continue policy and leaving
restores terminal failure before the next solo attempt.

## Persistence and lifetime

A single bounded JSON room record in SQLite stores membership, host, creation and
activity times, round participants/identity/deadlines and first terminal results.
Synchronous SQLite mutation occurs before publishing acceptance, with storage
output gates providing durability. Socket attachments restore sequence/rate
watermarks after hibernation. An in-memory browser connection identity permits
replacement of its own half-open running socket; a new page identity withdraws
the previous run. Retired socket callbacks cannot mutate the replacement lease.
An active round also has a 30-second last-message deadline, evaluated from socket
attachments by the alarm; this detects silent half-open connections without
writing each score update. Transient live scores are sent no more than twice
per second and are not written to SQLite; clients refresh them after eviction.
Snapshots redact credential hashes. Completed runs use the existing final score;
equal scores share competition placement. Failed runs — including
mark-and-continue runs that finish the map at rank F with their full score —
are separate, withdrawals unranked. Terminal submissions are immutable for that round.

One alarm covers countdown, disconnected-member grace, round deadline (scheduled
start plus prepared `end_ms` plus 30 seconds), 30-minute lobby/results inactivity
and four-hour absolute expiry. Countdown/playing rooms are exempt from inactivity
expiry. Starts are rejected unless the entire timeline and completion grace fit
strictly before absolute expiry. Finishing a round resets the inactivity clock.
Elapsed deadlines are also applied at command admission. Expiry closes sockets and deletes
stored data. There is no server interval or always-running tick. Ownership moves
to the longest-present connected member when the host departs/disconnects.
Return to lobby resets readiness and retains the selected map, permitting another
host selection. Client progress divides committed or terminal beatmap time by the
frozen `end_ms` and clamps it to [0,1].

Stored v1/demo-only rooms are retired on access: existing sockets close with
4000 (also understood by v1 clients) and a reload/recreate explanation. Joins
return 410 `PROTOCOL_UPGRADE` with a recreate-room message. Their existing expiry alarm removes the old data.
Old-version wire clients are closed with the same explanation. No v1 readiness,
selection or active round is migrated into v2.

## Deployment

SQLite Durable Objects use the Workers Free plan; this work never changes billing
or adds paid resources. Exceeding Free quotas fails operations. The server-side
`MULTIPLAYER_ENABLED` flag gates room creation independently of solo assets and
existing rooms. Explicit SPA rewrites preserve missing-asset 404 responses;
`run_worker_first` covers only `/api/multiplayer/*`.

CI packages the exact Worker JavaScript, SQLite migration, bindings, rollout flag
and static assets together, checks their hashes, and deploys without bundling or
rebuilding after all existing gates. Workers-runtime tests use a separate pinned
Vitest 4 package because Cloudflare's plugin does not support the product's Vitest
5 peer version. The current product test configuration remains unchanged.

## Evidence

See [multiplayer validation](../compatibility/multiplayer.md). Native/WASM parity
remains local consistency; this feature closes no lazer gameplay acceptance rows.

Cloudflare references retrieved 2026-09-21:
[Free pricing and quota failures](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[hibernating WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[Workers test integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/),
[asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

Product inspiration: [osu! multiplayer room flow](https://osu.ppy.sh/wiki/en/Client/Interface/Multiplayer)
(host selection, map availability, ready and start). Tapweave requires everyone
ready and ports the pinned upstream multiplayer fail marking for rounds; solo
play retains its ordinary local Odin failure/judgement rules. This is not
osu! multiplayer wire or scoring compatibility. Deployment is separate from local
validation; physical-device acceptance remains open.

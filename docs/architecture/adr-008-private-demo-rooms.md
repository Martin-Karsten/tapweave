# ADR-008: Private demo rooms

Status: accepted for implementation; physical two-device release acceptance open.

## Decision

Extend the existing Tapweave Worker with one SQLite-backed `Multiplayer_Room`
Durable Object per unguessable private room. The Solid shell subscribes to a plain
browser service. Odin retains all preparation, judgement, scoring, replay and
presentation policy. This is an original social coordination feature, not an
implementation of osu!'s multiplayer protocol or competitive verification.
No production ABI changes. Accounts, chat, uploads, spectating, matchmaking,
public listings and persistent leaderboards remain out of scope.

The Worker creates server-issued random credentials in Secure, HttpOnly,
SameSite=Strict cookies scoped to the room API. Only credential hashes are stored.
The same-origin API admits at most eight members with 24-code-point nicknames;
each member has one authenticated hibernating socket. HTTP bodies and socket
messages are bounded at 4 KiB. Protocol v1 validates message types, sequences,
finite bounded score values, round identity and host permissions. Invite links
contain room identity only. Request and lifecycle counters never log credentials.

## Scheduling and ownership

Ready prepares and hashes the original demo, compares the release's exact WASM
and archive hashes, and unlocks the shared AudioContext directly in the gesture.
Five clock request/response samples estimate server offset using the lowest RTT.
The host may start only when at least two members are connected and everyone is
ready. The server freezes participants and persists a start five seconds ahead.
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
equal scores share competition placement. Failed runs are separate, withdrawals
unranked. Terminal submissions are immutable for that round.

One alarm covers countdown, disconnected-member grace, round deadline (75-second
demo plus 30 seconds), 30-minute inactivity and four-hour absolute expiry. Elapsed
deadlines are also applied at command admission. Expiry closes sockets and deletes
stored data. There is no server interval or always-running tick. Ownership moves
to the longest-present connected member when the host departs/disconnects.
Rematch returns to the same lobby and resets readiness.

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

# Shell lazer-parity plan (MVP round)

Status: phase C implemented (decoder-owned song select metadata; see the
song-select decoder metadata section in `docs/status.md`); phases B and A
planned, not started. This document scopes the next product-shell
increment: three missing osu!lazer behaviors that the engine or browser
platform already supports (or can expose with a narrow ABI append), written as
implementable phases with steps. It complements `docs/mvp-player-experience.md`
(Plan 1/Plan 2) and `docs/status.md`; nothing here is claimed as implemented
until `docs/status.md` says so.

## Scope summary

| ID | Feature | Layer | Engine/ABI change |
|----|---------|-------|-------------------|
| A  | Replay: watch from results + save download | Browser + shell | None |
| B  | Skip button during lead-in/breaks | Browser + shell | None |
| C  | Decoder-owned song select metadata | Engine + ABI + shell | Yes (append-only) |

Recommended execution order: **C → B → A**. C carries the only engine/ABI churn
and its one-time trace fixture regeneration; A reuses B's skip affordance
inside watch mode.

Explicitly out of scope for this round (per `docs/README.md`,
`docs/roadmap.md`, ADR-002/004): mods, leaderboards/accounts/score submission,
skins/storyboards, other rulesets, legacy `.osr` replay containers, rate and
offset settings (hard profile: rate 1, offsets 0), onboarding/demo map,
loading-stage progress, pause-menu sound loops (tracked separately in
`docs/compatibility/reference-harness.md` W07 backfill).

Per `AGENTS.md`, each phase that changes behavior must first record the pinned
upstream test search (osu!lazer / framework at the revisions in
`engine/reference/source-manifest.json`), port equivalent scenarios where they
exist, and attach acceptance IDs and fixture hashes to the compatibility
findings. Local ports alone do not establish upstream acceptance.

---

## Phase C — Decoder-owned song select metadata

Goal: song select shows real `[Metadata]` values (title, artist, creator,
version/difficulty name) instead of filename-derived strings. This completes
the "Plan 1 metadata" item from `docs/mvp-player-experience.md`.

Current state (verified):

- The parser captures `Metadata{title, artist, creator, version, audio}` at
  `engine/beatmap_decode/types.odin:14` and fills it at
  `engine/beatmap_decode/decode.odin:304-314` (defaults at 133-138). Source
  and Tags are not parsed; do not add them this round.
- `prepared.Map` (`engine/prepared/records.odin:105-117`) has no metadata
  fields; `engine/osu_prepare/map_storage.odin` copies only
  `audio_filename = decoded.metadata.audio` (line 101) and discards the rest.
- The kind-8 `prepared_descriptor` ABI record
  (`engine/abi/records.json`, size 248) carries no metadata.
- The browser `Prepared_Description` (`platform/browser-js/src/engine-bridge.ts:759-775`)
  reads summary + playback + `audio_filename` generically.
- `Active_Selection` already carries `descriptor: Prepared_Description`
  (`platform/browser-js/src/selection.ts:9`), so once the descriptor carries
  metadata it flows to the shell without plumbing changes.

### C1 — Retain metadata on `prepared.Map`

1. Add `Metadata :: struct { title, artist, creator, version: string }` to
   `engine/prepared/records.odin` and a `metadata: Metadata` field on `Map`.
   Strings must be arena-owned like `Playback.audio_filename`.
2. In `engine/osu_prepare/map_storage.odin` `prepare_shared_records`, copy the
   four strings via `map_string(builder, decoded.metadata.<field>)` next to
   the existing `audio_filename` copy (line 101). The two-pass map builder
   (`map_take` measure/fill) handles sizing; no new quota mechanics needed.
3. No digest changes: identity hashes raw text
   (`engine/prepared/identity.odin:143-188`), so `raw_digest` /
   `prepared_digest` are unaffected by this retention.

### C2 — ABI: `prepared_metadata` record + kind-8 span append

1. Edit `engine/abi/records.json` (the source of truth; generated files carry
   "edit abi/records.json" banners):
   - Append three fields to `prepared_descriptor` (kind 8):
     `metadata_offset` [248, u32], `metadata_count` [252, u32],
     `metadata_stride` [256, u32], growing size 248 → 260. Appending fields
     within ABI major 2 is the sanctioned evolution mechanism; readers honor
     `byte_size` (`docs/architecture/interface-v2.md` "Capabilities and
     versioning", preparation v2 append precedent at lines 205-209).
   - Add record `prepared_metadata`, kind **54** (kinds ≤ 53 are in use),
     version 1, size 56, strings-only:
     - `title_offset` [8], `title_count` [12], `title_stride` [16]
     - `artist_offset` [20], `artist_count` [24], `artist_stride` [28]
     - `creator_offset` [32], `creator_count` [36], `creator_stride` [40]
     - `version_offset` [44], `version_count` [48], `version_stride` [52]
     (mirrors the `prepared_playback` `audio_filename` offset/count/stride
     triple pattern; 56 is an eight-byte multiple).
2. Regenerate all ABI outputs: `node engine/scripts/generate-abi.mjs` →
   `engine/runtime/abi_records.odin`, `engine/prepared/abi_records.odin`,
   `engine/abi/records.ts/.mjs/.d.mts`, `engine/abi/engine.h`. Do not hand-edit
   generated files.
3. Decide and document the versioning stance in `interface-v2.md` (C6): a new
   kind plus a kind-8 append; note that readers of the extended descriptor
   must accept the grown `byte_size`.

### C3 — Descriptor writer + trace

1. `engine/prepared/description.odin`: add `write_metadata` (same shape as
   `write_playback` at line 429: reserve one `ABI_PREPARED_METADATA_SIZE`
   record, write its header with `ABI_PREPARED_METADATA_KIND`, write four
   strings with `write_string`), call it from `write_description`, and write
   the `metadata_offset/count/stride` span into the kind-8 record. The
   existing two-pass `describe()` (measure pass then commit pass) handles the
   quota and transactional publication; no new allocation logic.
2. `engine/prepared_trace/trace.odin`: add `metadata: prepared.Metadata` to
   the `Trace` struct and its marshal list.
3. `engine/prepared_trace/prepared.schema.json`: add the `metadata` object
   (required exact key set, `additionalProperties: false`, four string
   properties) and add `metadata` to top-level required/properties. The
   validator in `engine/scripts/test-prepared.mjs:32` requires exact key-set
   equality, so trace and schema must land together.
4. Trace comparison impact:
   - Native vs WASM traces must remain byte-identical (both regenerate).
   - The upstream comparison projects only `objects`
     (`test-prepared.mjs:80-84`), so pinned upstream trace JSONs do not change.
   - Trace hashes recorded in `reference/findings/m1.json` and
     `artifacts/prepared/acceptance.json` will change; regenerate them
     deliberately via `npm --prefix engine test` and note the reason
     (descriptor/trace schema append) in the delivery report. Do not touch
     vendored source hashes.
   - `description_digest` values change (descriptor bytes grow); any stored
     expectations referencing them must be regenerated in the same change.

### C4 — browser-js reader

1. `platform/browser-js/src/abi-records.ts`: add `prepared_metadata: 54` to
   `RECORD`.
2. `platform/browser-js/src/engine-bridge.ts`: extend `Prepared_Description`
   with a `metadata` field read like `audio_filename`
   (`text()` helper over the record's span triple; reference
   engine-bridge.ts:769-775). Reading the metadata record requires walking to
   `summary.metadata_offset` (count 1, stride `ABI_PREPARED_METADATA_SIZE`).
3. No `selection.ts` change required (`Active_Selection.descriptor` already
   exposes it); optionally add a convenience accessor.

### C5 — Shell: select screen

1. `platform/product-ui/src/screens/select_screen.tsx`: replace
   filename-derived title/difficulty strings with descriptor metadata when
   present; keep the filename as fallback for missing/empty fields (the
   decoder defaults can be empty strings). Keep the sheared wedge layout and
   all existing test anchors (`#map-name` etc.) stable.
2. Update Playwright select specs to assert real metadata appears for a
   fixture with known `[Metadata]` and filename fallback for a stripped
   fixture.

### C6 — Docs

1. `docs/architecture/interface-v2.md`: document kind 54 and the kind-8
   append in the descriptor section (and the record-kind index if one exists).
2. `docs/status.md`: move the metadata item from planned to implemented only
   after the full suite passes.
3. `docs/mvp-player-experience.md`: mark the metadata part of Plan 1 done.
4. ADR-007 (`docs/architecture/adr-007-product-flow.md`): update the
   documented divergence "filename-derived strings" to resolved-with-fallback.

### C7 — Tests and evidence

1. `engine/tests/foundation_test.odin` (or `preparation_test.odin` where the
   neighboring coverage lives): metadata round-trip — decode → prepare →
   describe returns the four strings; missing-`[Metadata]`-key fixtures
   produce decoder defaults; quota-exceeded description still fails
   transactionally.
2. Regenerate trace fixtures/acceptance via `npm --prefix engine test`
   (includes the `--check` stale-ABI gate through `generate-abi.mjs`).
3. `platform/browser-js` node test: `describe_map` metadata reader returns
   expected strings for a prepared fixture.
4. Upstream intent mapping (record in findings): pinned lazer
   `BeatmapDecoder` metadata parsing tests cover field extraction; port the
   expectation "metadata values match the .osu `[Metadata]` section" against
   our fixtures. Display-side has no upstream executable equivalent — record
   the search scope instead.

---

## Phase B — Skip button during lead-in and breaks

Goal: a lazer-style Skip affordance while the session is inside the intro
(before the first object) or a break; pressing it jumps gameplay time to just
before the next object. No engine change: `advance_session(target_ms)`
(`engine/simulation/session.odin:785-848`) accepts any finite
`target ≥ committed_ms` and drains deadlines in one call, and the live seek
export (`oe_session_replay_seek`) stays unused for live sessions.

Current state (verified):

- Breaks (start_ms/end_ms) are in the descriptor as kind-15 `prepared_break`
  records behind `summary.breaks_offset/count/stride`
  (`engine/prepared/description.odin:558-581`,
  `platform/browser-js/src/abi-records.ts:121`); nothing in `platform/browser-js`
  consumes them yet.
- Health drain already excludes breaks via merged no-drain intervals
  (`engine/simulation/session.odin:288-342`), so a forward jump cannot drain.
- No scheduled events exist between lead-in/break start and the next object;
  events are scheduled around objects only (`session.odin:389-417`).
- The browser advances tick-by-tick to the audio-clock sample each frame
  (`platform/browser-js/src/audio-playback.ts:133-136`); there is no
  break-aware jumping anywhere yet.
- Pause/resume cannot move time (`resume_session` requires
  `beatmap_ms == committed_ms`), so skip must be a clock re-anchor, not a
  pause/resume cycle.

### B1 — Descriptor exposure

1. `platform/browser-js/src/abi-records.ts`: nothing new (kind 15 exists).
2. `platform/browser-js/src/engine-bridge.ts`: extend `Prepared_Description`
   with a `breaks()` walker over `summary.breaks_offset/count/stride`
   (records of `RECORD.prepared_break` with `start_ms`/`end_ms` f64) and a
   `first_object_ms` convenience (from the schedule span or first object).

### B2 — `Audio_Playback.skip_forward(target_ms)`

New method mirroring the pause/resume mechanics *without* pausing the engine:

1. Preconditions: playback `running`, engine still running; `target_ms` finite
   and `≥ last_committed_ms + margin` (guard against zero/negative jumps);
   the caller guarantees the target lands in a no-object window.
2. Sequence (single synchronous section, no awaits):
   - Stop the frame driver, then `drain()` so all received inputs are
     submitted at the pre-skip committed time.
   - Discard residual buffered input records and bump `focus_epoch` (mirror
     `pause()` behavior in `Gameplay_Controller.pause`). Policy: inputs that
     arrive during the skip window are dropped, not replayed — consistent
     with lazer ignoring input during breaks; record this as an explicit
     policy note, not a hidden clamp.
   - `music.cancel()`.
   - `clock.pause(context.currentTime)` then
     `clock.start(context.currentTime, target_media_ms)` — same audio
     instant, new beatmap anchor; this clears `session_mapping` and bumps the
     clock epoch (the epoch check then rejects any stale-epoch record, which
     is the desired fail-loud behavior).
   - `engine.voice_output(...)` + `clock.bind_session(...)` to re-establish
     the session mapping (same flow as `Audio_Playback.start` lines 93-101).
   - `music.start()` — the transport derives the buffer offset from
     `anchor.media_beatmap_ms` (`platform/browser-js/src/music.ts:24-40`), so
     it resumes at the correct media position without a negative seek.
3. Return to the caller; the frame driver resumes and the next `pump()` issues
   one `advance_output(session, new_time_ms)` — a single forward jump. No
   events fire in the gap, and voices scheduled after the gap dispatch
   normally through `Audio_Admission`.

### B3 — `Gameplay_Controller.skip()` + view

1. Add `can_skip` to `Gameplay_View`: true while `running` (and also in watch
   mode, A2) and the current beatmap time lies inside the lead-in window
   (`0 ≤ t < first_object_ms − lead`) or inside a break with enough remaining
   room. Compute from `descriptor.breaks()` + `first_object_ms`.
2. `skip()` computes the lazer-style target: `next boundary − lead` with
   lead = 1000 ms (matching lazer's "skip to shortly before the next object"
   behavior; clamp to `≥ committed + margin`). Call `skip_forward`.
3. `Player_Session_Service` exposes `skip()` and the `can_skip` flag; the
   frame-path must remain untouched (skip is a user-command path, allowed to
   allocate/sync).

### B4 — Shell: Skip button

1. `platform/product-ui/src/screens/play_screen.tsx`: floating Skip button
   (bottom-right, lazer position), visible while `view.can_skip`; stable test
   anchor `id="skip"`. Click → `player_session()?.skip()`. Also rendered in
   watch mode.
2. Ensure the button is outside the canvas input surface so its click is not
   captured as gameplay input.
3. Pause/resume interplay: hide the button on pause; after resume the view
   recomputes `can_skip` from the current time.

### B5 — Tests and evidence

1. Playwright (reusing the player spec's synthetic map pattern): a long
   lead-in fixture — button appears after start, disappears after skip,
   `committed_ms` jumps past the lead-in (observable via the debug HUD or
   diagnostics), result unchanged with no input in the gap. A break fixture —
   same assertions mid-map.
2. Guard tests: `skip()` is a no-op/refusal outside windows; input submitted
   during the window is dropped without recovery.
3. Upstream intent mapping: lazer `SkipOverlay` test scenes (osu.Game.Tests
   Visual.Gameplay) cover appears-during-intro/break, skip target, and
   not-applicable cases; port those three assertions. Record the pinned test
   paths and the divergence notes (ours is a DOM button; lazer overlays the
   playfield).

---

## Phase A — Replay: watch from results + save download

Goal: after a run, the player can watch their replay (spectate) or download
it. Engine support is complete and proven; only shell surface is missing.

Current state (verified):

- `oe_session_replay_export` requires terminal state and writes a
  self-contained TWREPLAY v2 container (192-byte header with
  identity/digests, 64-byte frames, judgement digest, whole-file SHA-256)
  (`engine/replay/codec.odin`, `docs/architecture/interface-v2.md` replay
  section). `Engine_Bridge.export_replay` already returns the owned bytes
  (`platform/browser-js/src/engine-bridge.ts:485-488`) — unused by the UI.
- `load_replay` requires READY state, validates the replay's embedded
  `raw_digest`/`prepared_digest` against the session's map identity, enqueues
  frames, and sets `replay_mode`; live input and sample binding are rejected
  in that mode (`engine/runtime/gameplay.odin:319-345,407`,
  `engine/simulation/session.odin:757-760,888-922`). Judgement is identical
  to the live run; export → reset → load → seek(2000) already reproduces a
  byte-identical final result (`platform/browser-js/tests/engine.test.mjs:106-110`).
- `seek_replay` is resimulation (reset → load → advance → acknowledge →
  snapshot) and requires `time_ms ≥ lead_in_ms`.

### A1 — Controller: export + watch mode

1. `Gameplay_Controller.export_replay()`: passthrough to
   `engine.export_replay(session_handle)`; valid only in `terminal` (mirror
   the engine gate; return a typed error otherwise).
2. `Gameplay_Controller.watch_replay()`: terminal-only.
   - Capture `result` (already an owned copy) into a retained field so the
     results screen survives the session reset.
   - Export replay bytes *before* `reset_session` (terminal requirement).
   - `engine.reset_session(session_handle)` → READY;
     `engine.load_replay(session_handle, bytes)`; optionally
     `seek_replay(max(0, first_object_ms − 2000))` later — start at 0 for
     MVP.
   - Restart playback (`create_playback` reuse path like `retry()`), then
     start **without** attaching `Gameplay_Input`; canvas input stays
     quarantined. Expose `watching_replay: boolean` on `Gameplay_View`.
   - In watch mode: `play`/`resume`/`pause` are refused (typed errors);
     `retry()` re-runs `watch_replay()` from the retained bytes; run end
     reaches `terminal()` normally (identical result — assert in tests).
3. Exit watch: a `stop_watch()` that releases the replay session, re-prepares
   a fresh live session (`prepare()`), restores the retained `result`, and
   returns the view to `terminal` so the shell can navigate back to results.
   `back()`/new selection clears the retained result.

### A2 — Service surface

1. `Player_Session_Service`: expose `export_replay`, `watch_replay`,
   `stop_watch`, and pass `watching_replay` through the subscribed view.

### A3 — Shell: results screen

1. `results_screen.tsx` / `lifecycle_panel.tsx`: two new actions when a
   result exists —
   - **Watch replay** → `player_session()?.watch_replay()` then navigate to
     `/play`.
   - **Save replay** → download the export bytes as a Blob with
     `{selection filename base}-{score}.twreplay` naming (our own container
     format; legacy `.osr` stays out of scope). Use the existing download
     helper pattern (`platform/browser-js/src/debug-workspace.ts:13`).
   - Hide both when the engine export refuses (non-terminal edge).
2. Keep existing anchors (`#retry`, `#back`) stable; add `#watch-replay`,
   `#save-replay`.

### A4 — Shell: play screen watch banner

1. `play_screen.tsx`: while `view.watching_replay`, hide pause/settings
   affordances and show a "Watching replay — Escape to exit" banner
   (lazer parity: spectate sessions are non-interactive). Escape →
   `stop_watch()` + navigate back to `/results`.
2. The Skip button (B4) remains functional in watch mode.

### A5 — Tests and evidence

1. `platform/browser-js` node test: extend the existing round-trip
   (`tests/engine.test.mjs:106`) to a controller-level flow: run → terminal →
   export → watch → terminal → results byte-identical; foreign-map replay
   load rejection is already covered engine-side (regression case at
   `engine/simulation_tests/review_regressions_test.odin:186`).
2. Playwright: save button triggers a download with the expected filename;
   watch mode runs to terminal with zero injected input; Escape returns to
   results with the original score visible.
3. Upstream intent mapping: lazer spectate/replay-player test scenes
   (osu.Game.Tests.Visual.Gameplay `ReplayPlayer` / player-loader scenes)
   cover "replay runs to completion without user input" and "results match";
   port those assertions. Record pinned test paths; legacy `.osr` export
   stays M5 and must not leak into this UI.

---

## Cross-cutting validation

Run from the repository root, in this order, after each phase and at the end:

```sh
npm --prefix engine test                                   # hashes, native+WASM builds, Odin tests, trace comparison
npm --prefix platform/browser-js run typecheck
npm --prefix platform/browser-js test
npm --prefix platform/browser-js run build
npm --prefix platform/product-ui run typecheck
npm --prefix platform/product-ui run test:gates
```

Plus the browser package's Playwright suites for player/lifecycle/select
screens (follow existing spec conventions: stable anchors, live regions,
keyboard paths).

Delivery report must state (per `AGENTS.md`): what changed, checks actually
run, unresolved limitations, and — for C — the deliberate regeneration of
descriptor/trace hashes with the reason attached.

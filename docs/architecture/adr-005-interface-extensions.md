# ADR-005: ABI, capabilities, and extensions

Status: accepted.

## Context

Spike ABI v1 uses raw f64 descriptor layouts and fixed capacities. It is compact but field indices are easy to mis-maintain, untrusted pointers are not comprehensively validated, and judgements/results are experimental. Future rulesets/mods need an extension point without a general plugin runtime.

## Alternatives

1. Extend descriptor indices indefinitely: smallest change, brittle evolution.
2. JSON across the boundary: readable, allocation/parse overhead and weak buffer ownership.
3. Versioned binary records with size/version headers and typed generated bindings.

## Decision

Use option 3. The C ABI exposes opaque generation-checked `u64` handles and byte spans; records are little-endian, explicitly aligned, begin with `{type:u16, version:u16, byte_size:u32}`, and evolve append-only within a major ABI. A checked schema file generates Odin constants and TypeScript readers. Calls return a status plus an error record; no sentinel pointer encodes an error.

Capabilities are negotiated at engine creation and per prepared map/session. Required v2 capabilities are osu!standard format v1–v14 and v128 preparation, circles/sliders/spinners, normalized lazer score/health, replay v2, presentation v1, audio-intent v1 and WebGL2 command protocol v1. They phase in across milestones: M0 exposes the foundation subset (the legacy kind-4 full-set field stays 0 until the complete capability set ships); optional capabilities include legacy replay import, Classic, skins, storyboard and difficulty/pp.

A compile-time `RulesetDescriptor` registers ruleset ID, behavior profiles, preparation function table, session function table, presentation function table and result schemas. A `RulesTransform` registry provides known mods. No dynamic native code, WASM modules, arbitrary callbacks, or user plugin ABI exists.

## Consequences

Bindings are inspectable and forward-compatible, but code generation and schema tests become required. Handles add lookup cost that is negligible at frame-level batch boundaries. Extension breadth is intentionally limited; adding a new hook requires an ABI/ADR change.

## Acceptance

Fuzz every function with stale handles, truncated/oversized records, overflowed spans, unknown versions/types, repeated dispose and memory growth. TypeScript and native readers decode golden records identically. See [interface v2](interface-v2.md).


## M0 foundation refinement

The M0 transport concretizes the previously unspecified creation/descriptor/error record bodies in a checked schema. A bounded instance-owned bootstrap mailbox avoids dereferencing arbitrary native/WASM pointers before validation. Large input remains tokenized. Span arguments use pointers, including `oe_session_inputs`, avoiding platform-dependent by-value aggregate lowering; the lifecycle interface now makes this explicit. This changes the design signature before input support is advertised, not an existing gameplay implementation.

Foundation mode is explicit and cannot be mistaken for the full required gameplay capability set above. Capability records report all later capabilities unavailable. The generated C consumer and TypeScript reader verify layout, and the native/WASM matrix verifies ownership, typed rejection and memory growth. C and Odin are linked into a native conformance executable with normal Odin startup; the pinned compiler has a Darwin shared-library initializer quoting defect, so shared-library packaging is not claimed by this increment. The compiler pin and verification remain unchanged.

## M1 refinement

Preparation is negotiated separately using `oe_preparation_capabilities` and map
flag `2`, preserving the M0 foundation mode. Published maps expose a typed binary
description with relative spans and canonical behavior identity. Immutable Odin
records and their portable description share map/session ownership and one quota.
The additional representation is an explicit memory cost for a stable, pointer-free
ABI. Candidate allocation and encoding finish before registry publication. Existing
record kinds remain unchanged; preparation adds kinds 8–14. See the
[M1 transport](interface-v2.md#m1-prepared-map-transport).

## Preparation v2 hardening

The first M1 binary writer omitted the existing `combo_offset` field. Writers now
use generated field offsets and the native/WASM tests compare declared scalar
fields, including nonzero combo offsets. Kind 8 grows append-only to expose
map-owned breaks, resolved control points and playback settings through kinds
15–17. Preparation capability version 2 advertises this extension; ABI major and
existing record versions stay unchanged.

Prepared identity v2 hashes explicit canonical binary fields instead of reflected
JSON. A dedicated protocol writer and fixed golden protect identity from private
Odin field names/order and serializer implementation changes. This deliberately
changes the preparation profile; it does not claim new gameplay compatibility.
See the [binary contract](interface-v2.md#m1-prepared-map-transport).

## M2 headless session transport

Gameplay uses a separate `GameplayCreateV1` (kind 18, flag 2) passed to
`oe_session_create`, requiring a fully prepared map. Kind 3/flag 1 retains its
foundation behavior. `oe_simulation_capabilities` advertises headless session
version 1 and recording/rules version 2 separately; the old aggregate gameplay
field stays zero because the complete browser capability set is not available.
Kinds 19–28 concretize snapshots, judgements, anchors, inputs, final results,
capabilities, counts, one-shot audio intent and sample availability. Kind 53
adds the read-only resume policy query: Odin supplies gate geometry and
per-action input flags. Rules version 2 admits the recorded one-shot blocker
marker in input flag bit 0 and rejects old rules-version-1 recordings. See
[pause/resume](../compatibility/pause-resume.md).

Creation reserves the entire bounded judgement journal, component/object state,
schedule, input ring, recording, sample availability, audio journal and output
storage. `arena_bytes` is a caller-selected budget subject to the engine quota;
insufficient space fails creation transactionally. Since each scoring component
can produce at most one result, reserving the whole journal avoids partial
transition/output overflow. Acknowledgement advances read cursors, not simulation.
Snapshots return all unacknowledged events with a session-scoped batch token;
repeated snapshots do not generate new events. Reset invalidates batch tokens.

JavaScript reports candidate asset availability by prepared object/component/sample
and candidate ordinal. Odin chooses the first available candidate in the prepared
ordering. Availability is frozen on first advance/replay load. Zero selected asset
means an explicit missing-sample diagnostic and silence. Browser playback, loops,
voice rendering and WebGL command generation remain M3.

See [the concrete M2 contract](interface-v2.md#m2-headless-session-transport).

## M3 browser foundation refinement

The schema now also names the existing bootstrap mailbox and auxiliary ByteSpan
transport offsets. These values do not change the ABI. The generator emits one
executable JavaScript implementation, a TypeScript re-export with declarations,
and existing Odin/C bindings. Browser and Node consumers share checked record
reads/writes; unsupported values reject before writes begin. Retained descriptions
are copied by the browser bridge, and all WASM views are reacquired after calls.

A thin production browser entrypoint links only `oe_*` engine exports; test trace
transports remain separate. This increment adds no gameplay, audio or presentation
capability bits. Its independent browser service objects are not ABI records.

## M3 coordinate-only extension

Kinds 29/30 and `oe_playfield_transform` append coordinate conversion without
changing kind-27 one-shot semantics or any prior record/export. Generated native
bindings now name bootstrap mailbox offsets as well as record layouts. Native C
and browser WASM consumers test valid conversion and failure preservation. No
aggregate gameplay, render or audio-loop capability is enabled by this extension.

## Compact output and active projection extension

Kinds 31–34 add compact gameplay output, active projection records and narrowly
scoped output capabilities. Kind 31 deliberately preserves the diagnostic summary
layout but emits no objects. Both paths share simulation and event serialization.
Projection output is reserved separately at session creation; it has no gameplay
batch token and does not invalidate one. Existing creation records and prepared
identity are unchanged; the additional reserved storage counts against the existing
session arena quota. The [ABI lifetime contract](interface-v2.md#compact-gameplay-output-and-active-projection)
also specifies rebuild costs and the distinction between projections and render
commands. Aggregate gameplay capability remains zero.


## Minimal render-resource extension

Kind 35 and the map/session resource exports add a validated immutable attachment
without changing kinds 1–34 or prepared/replay identity. Odin/C/JS/TS bindings are
generated together. Native and WASM consumers validate the container; existing
capability fields remain unchanged while final resource/draw/reserve contracts
are incomplete. See the [ABI](interface-v2.md#minimal-immutable-render-attachment).

## Reserved circle draw extension

Kinds 36–40 define reserve requests, required capacity, frame headers, instances
and batches with generated native/WASM layouts. They add explicit exports without
changing kinds 1–35, existing acknowledgement semantics or identity. The current
producer supports circles only; broad animation/draw/Play capabilities remain zero.
The native C probe and WASM reader compare serialized circle instances exactly.

## Voice transport and narrow capabilities

Kinds 41–45 add independent resource/circle/draw/voice protocol versions, voice
reserve/capacity, voice frames and typed commands. Existing kinds 1–40 retain
their layouts. The authoritative voice journal is the only producer: reserve
requires kind-42 flags 1 (capability voice version 2), commands carry their
emit-time epochs, and loop/ramp record support does not by itself enable those
gameplay producers. Voice output borrows a
separate reserved arena, shares the existing audio journal and latest-token
acknowledgement, and cannot consume unseen judgement records. A single admission
owner holds the epoch/sequence watermark for all voice readers.
Draw and voice arenas count together against the session resource quota.

The `prepared_sample` record's former reserved u32 at offset 68 is now `flags`:
bit 0 marks upstream sustained-loop samples (slider slide/whistle, spinner
spin), so loop classification crosses the ABI once instead of being re-derived
from names on the browser side. Remaining bits stay zero.

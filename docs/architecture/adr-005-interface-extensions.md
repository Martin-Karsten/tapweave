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

Capabilities are negotiated at engine creation and per prepared map/session. Required v2 capabilities are osu!standard format v1–v14 and v128 preparation, circles/sliders/spinners, normalized lazer score/health, replay v2, presentation v1, audio-intent v1 and WebGL2 command protocol v1. Optional capabilities include legacy replay import, Classic, skins, storyboard and difficulty/pp.

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

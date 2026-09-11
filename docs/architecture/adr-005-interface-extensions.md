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

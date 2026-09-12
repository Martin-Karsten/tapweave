# Agent instructions

## Project and scope

Tapweave is an independent browser rhythm game written primarily in Odin and
compiled to WebAssembly, targeting the pinned osu!lazer osu!standard behavior.
It is not affiliated with osu! or ppy. Keep the Tapweave name in product-facing
material and preserve third-party attribution.

The normative target is **unmodded lazer osu!standard**. Classic means the
`OsuModClassic` mod, not default lazer. Do not silently substitute osu!stable
behavior. Other rulesets, mods, skins, storyboards, difficulty/pp, legacy replay
containers, accounts, networking, editing, and score submission are outside the
current implementation scope unless the task explicitly expands it.

The repository implements M0 foundation, M1 preparation and headless M2 session
integration; browser gameplay and full upstream M2 acceptance remain open. Read `docs/status.md` for actual coverage
and remaining gates; do not treat planned packages or interfaces as implemented.

## Read before changing behavior

- `README.md` and `engine/README.md`: setup, existing packages, ownership, limitations.
- `docs/README.md`: scope, pinned baseline, and evidence priority.
- `docs/architecture/README.md` and the relevant ADR: dependency and design rules.
- `docs/architecture/interface-v2.md`: production ABI contract.
- Relevant `docs/reference/` chapters: upstream behavior and known uncertainties.
- `docs/compatibility/traceability.md`, `docs/compatibility/reference-harness.md`,
  and `docs/roadmap.md`: acceptance scenarios, experiments, and milestone gates.

Use the revisions in `engine/reference/source-manifest.json`; do not develop
against upstream HEAD by accident. Evidence priority is pinned executable
upstream tests, pinned upstream code, reference-harness observations, explicitly
documented deterministic divergences, then local spike observations. Investigate
conflicts at the strongest available evidence level. Do not infer compatibility
from visual similarity or from agreement between two local implementations.

## Implementation boundaries

- Keep deterministic parsing, preparation, rules, scoring, replay, and simulation
  in Odin. Their imports must remain acyclic and must not depend on browser APIs,
  rendering/audio implementations, transports, or historical spikes.
- Follow the package dependency table in `docs/architecture/README.md`. Keep
  native and WASM entry points thin transports over shared engine logic.
- Match nearby Odin conventions. The `engine/runtime/` directory declares
  `package engine_runtime` because Odin reserves `runtime`.
- JavaScript owns browser resources and executes engine intent. Odin owns
  gameplay and presentation policy. The accepted browser design uses WebGL2 and
  Web Audio with one audio clock; do not introduce per-hit-object JS objects or
  move judgement into RAF callbacks.
- Follow accepted ADRs. Changes to ownership, scheduling, or public interface
  contracts require a corresponding ADR change, not an undocumented shortcut.
- Keep changes focused. Do not add frameworks, npm dependencies, or broad
  abstractions without a concrete requirement; current engine tooling has no
  npm dependencies.

## Odin naming

- Use descriptive `snake_case` names for variables, parameters, fields, and
  procedures. Follow existing `Title_Case` type and `UPPER_SNAKE_CASE` constant
  conventions.
- Name values for their role: `builder`, `workspace`, `control_point_count`,
  `previous_vertex`, `expected_length`, and `remaining_work`. Avoid abbreviations
  such as `b`, `w`, `n`, `opts`, or `st` for engine state and resource management.
- Always use expressive variable names, including loop indices and tests. Use
  `object_index`, `sample_index`, or another role-specific index instead of `i`/`j`. Use `x` and `y` for coordinates
  where their meaning is immediate. Mathematical code still needs descriptive
  point, distance, angle, and weight names when several values interact.
- Expand procedure bodies and control-flow blocks across lines; keep one statement
  per line. Use generated ABI field offsets instead of handwritten byte offsets.
- Apply the same readability standard to tests and test transports. Prefer
  descriptive package aliases, such as `geometry`, over single-letter aliases.
- Review names in every changed file before delivery, including fixture runners
  and reference adapters. Use role-specific names such as `frame_index`,
  `raw_score`, and `byte_count` instead of generic `index` or `value` when the
  role is known. Keep serialized field names and retained upstream names stable.
- When renaming compatibility math, preserve operation order, casts, constants,
  and behavior. Do not rename identifiers in retained upstream reference sources.

## Memory, determinism, and WASM

- Validate/count before allocating, use checked `u64` size/offset arithmetic,
  enforce quotas, and verify WASM32 addressability. Treat map and ABI input as
  untrusted; return typed errors instead of traps or partial state changes.
- Construct candidates transactionally and publish only after success. Failure
  must release candidate resources and preserve the previous valid state.
- Owning `Map`, `Arena`, `Storage`, and `Handle_Table` values must not be copied
  after ownership is established. Borrow by pointer and make cleanup explicit.
  Published map records are immutable; honor map/session/frame lifetimes.
- Preserve generation, engine-owner, and resource-kind handle validation,
  including stale handles, repeated release, and generation retirement.
- Do not allocate or grow memory in future `advance`/`render_snapshot` hot paths.
  Use creation/reserve phases and reusable arenas. JavaScript must reacquire
  typed views after calls that can grow WASM memory; freed allocations do not
  imply that linear memory shrinks.
- Serialize canonical values, never pointers, struct padding, or native-width
  allocation sizes. Respect source-specific numeric precision and stable ordering.
- Follow ADR-002's event-driven scheduler, finite monotonic f64 beatmap time,
  equal-time phase order, and explicit live/replay cursor semantics. Reject late
  input without hidden clamping. Rendering cadence must not determine results.
- Current `trace_*` exports are test APIs, not the production `oe_*` ABI. Implement
  ABI v2 using its versioned records, validated spans, and opaque handles rather
  than promoting test-only layouts into the public contract.

## Build and validate

Run commands from the repository root:

```sh
npm --prefix engine run setup
npm --prefix engine test
npm --prefix engine run build
engine/artifacts/decode-native path/to/map.osu
```

Use Node.js 24 and the checksum-pinned compiler in `engine/toolchain.json`.
Setup installs it into ignored `engine/.toolchain/`. A native linker and
`wasm-ld` are required; `ODIN_BIN` and `ODIN_WASM_LD_DIR` support matching local
tools. See the README for platform setup. Do not silently upgrade the compiler
or bypass its verification to make a build pass.

For engine or tooling changes, run `npm --prefix engine test`: it verifies
source hashes, builds native/WASM, runs allocation-tracked Odin tests, and
compares generated decoder traces byte-for-byte. Add targeted regression cases
in `engine/tests/foundation_test.odin` and/or `engine/scripts/fixtures.mjs` for
changed behavior, including relevant malformed input, quota, failure, ownership,
and native/WASM edge cases. Keep trace serializers, schemas, and validators in
sync. Documentation-only changes need link/path and diff checks, not a build.

When adding a feature or changing behavior, search the pinned osu!lazer test
projects (and pinned framework tests where relevant) for equivalent scenarios
before implementing it. If equivalent in-scope tests exist, port their setup,
input sequences, parameter cases and assertions into this codebase and ensure
they pass against the Odin implementation in both native and WASM runs. Adapt
the test infrastructure, not the expected behavior to fit our implementation.
Run the corresponding pinned upstream tests or an adapter executing the real
upstream behavior to establish independent comparison evidence; local ports
alone do not prove compatibility.

Record upstream test paths/methods, source revision, fixture hashes, acceptance
IDs and local test mappings with the compatibility findings. Preserve licences
and attribution for copied/adapted material. If no equivalent test exists,
record the search scope and add focused tests from pinned source evidence.
Explicitly classify out-of-scope cases and documented deterministic divergences;
do not silently omit cases or weaken assertions. If an equivalent test cannot
yet be ported or executed, report the blocker and leave the feature's upstream
acceptance open rather than declaring validation complete. Follow the test
backfill plan in `docs/compatibility/reference-harness.md` for existing gaps.

## Compatibility evidence and delivery

- Native/WASM parity is local consistency, not upstream acceptance. Preserve
  honest oracle classifications and attach source revisions, fixture hashes,
  and acceptance IDs to compatibility findings.
- The .NET reference hosts execute pinned H01–H04 adapters.
  Follow `engine/reference-host/README.md` for clean pinned checkouts and restore;
  never fabricate a dependency lock file or oracle output.
- Do not refresh vendored source hashes merely to silence verification. Source
  updates require reviewed provenance and matching fixture/profile findings.
  Retain upstream copyright/licence notices and `THIRD_PARTY_NOTICES.md`.
- Keep toolchains, artifacts, caches, credentials, historical spikes, and game
  assets out of commits. The root `.gitignore` is an allowlist: explicitly allow
  intended new root files without broadly exposing ignored local material.
- Update implementation status and relevant specifications when coverage or
  contracts change. Do not mark an acceptance scenario complete from partial
  fixture coverage.
- Report what changed, the checks actually run, and unresolved limitations.
  Distinguish implemented behavior, local regression evidence, and verified
  upstream compatibility.

# M2 — Remaining acceptance work

Independent primitives and [headless sessions](m2-sessions.md) implement prepared
map integration, circle/slider/spinner rules, scoring/health, one-shot intent,
recording, replay and production ABI operations. The former implementation
sequence is superseded by that report and the
[ABI contract](../architecture/interface-v2.md#m2-headless-session-transport).
M1 is complete. Full M2 A13–A20/A23 acceptance remains open.

## Executable upstream coverage

Extend the existing pinned reference hosts using clean manifest revisions and
locked restore. The [adapter gap matrix](m3-contract-audit.md#required-upstream-matrix)
identifies component coverage versus missing whole-drawable/player entry points.
The [harness](../compatibility/reference-harness.md) owns experiment definitions;
[traceability](../compatibility/traceability.md) owns acceptance IDs and tolerances.

- H05/H06/H07: full circle selection/note lock, slider acquisition/loss/recovery,
  key restriction, catch-up and nested/top-level equal-time result ordering.
  Hit-window predicates alone cannot establish drawable automatic deadlines.
- H08/A23: full spinner cursor segments, reversals, thresholds/bonuses and recorder
  cadence/angular subdivision. Preserve actual input/judgement timestamps; do not
  rewrite recordings or add interpolation anchors to hide disagreement.
- H09/H10: complete map-derived maxima, score/count/health sequences, breaks,
  HP0/5/10 and actual player failure timing/freeze. Calibration components do not
  establish every zero-health transition as a failure event.
- A20/H11 subset: sample eligibility, ordered availability fallback, silence and
  early-tail requested timestamps. Loop/voice/browser execution remains M3.

Compare direct-final and event stepping, 30/60/120/144 Hz, and 50/100/250 ms stalls
before/at/after critical events. Keep native/WASM discrete traces exact and
classify upstream frame dependence with schedule envelopes, not a selected cadence.
Retain source/fixture/observation/lock hashes, acceptance IDs, first differences
and reproduction commands. Existing component evidence cannot close whole rows.

## Implementation and resource follow-through

Correct discrepancies established by those observations without changing the
accepted ownership, event phases, live/replay semantics or profile silently.
Keep malformed/late input rejection, batch retention, output retries, replay
identity and failed create/import regressions. Hot paths and reset must remain
allocation-free; retain shared-map, stale-handle and WASM growth checks.

Seeking currently resets to the initial checkpoint and resimulates preceding
events. More frequent bounded checkpoint caching remains unimplemented. Any cache
must retain complete mutable state, suppress historical audio after seeking and
stay outside replay identity; no inverse judgement or unbounded storage.

Measure dense/long/10,000-object workloads: creation/calibration/advance time,
event work, live/peak arena bytes, recording/output/checkpoint high water and WASM
pages. Integrate these results with [M3 W02/W08/W09](m3-plan.md), which consumes
headless sessions and carries their acceptance gates forward. Do not introduce an
elapsed-millisecond simulation loop or move gameplay into browser callbacks.

## Completion

Run the full engine suite and required pinned whole-scenario comparisons. Resolve
or explicitly classify H05–H10 and required A20 observations, complete A13–A20/A23,
and retain no unexplained discrete differences. Publish results in the session
report, findings and traceability. Local parity and the existing 72 pinned
component comparisons remain useful evidence, but do not complete M2.

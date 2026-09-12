# Repository cleanup audit — 2026-09-12

Baseline: reviewed `1b4b8f3`, merged without conflicts into the isolated cleanup
branch from ancestor `cf379bc`. The merge retains `061f19a`, `3062eee` and
`88b73ea`; compact kinds 31–34, active projection and the partial W01/W03 ledger
are present. Source/main worktrees were not modified.

The inventory follows tracked files, package imports, exported entry points,
script/CI consumers, test registrations and Markdown references. A repository-wide
Odin procedure-reference scan found only registered tests without textual callers;
that is not evidence of dead code. No production export is removed.

| Location | Evidence and authoritative replacement | Disposition |
|---|---|---|
| `engine/{wasm,geometry_wasm,prepared_wasm,simulation_wasm}/main.odin` | Four copies of candidate allocation, failed-output cleanup and disposal; all exercised by `test*.mjs` native/WASM comparisons | Consolidate ownership in test-only `trace_support/buffers.odin`; keep all entry points and trace formats |
| Browser `Prepared_Description` | Playback stride literal 72 duplicates kind 17 in `engine/abi/records.json` | Use the generated schema size |
| `docs/implementation/m2-plan.md`, `m2.md` | Pending integration/state-machine/ABI lists contradict implemented `m2-sessions.md` and production callers/tests | Replace superseded implementation sequence with remaining acceptance work; retain primitive provenance and correction findings |
| `docs/implementation/m3-plan.md` | Uncommitted-baseline instructions and kinds 1–30/35-test/17-schedule baseline predate `061f19a`/`1b4b8f3`; efficient output and projection are already implemented | Reconcile baseline and next work; remove repeated start/import instructions; preserve W01–W10 and detailed exit gates |
| `docs/implementation/m3-contract-audit.md` | Existing-operation/coordinate descriptions duplicate ABI v2 and predate compact output | Link current ABI/ADRs; retain dated provenance, unique remaining resource/audio requirements and missing-adapter matrix |
| Status, roadmap, package/reference guides | Future-tense M2 scheduling, unsupported coordinates and claimed public loop types contradict code/schema | Correct status and scope; identify authoritative documents and planned packages |
| Diagnostic kind 19, final kind 24 and browser readers | Used by pause, seek, results, malformed-output tests and cadence evidence; owned copies have a different lifetime from borrowed kinds 31/32 | Retain; compact output is no replacement for supported diagnostics/results |
| Generated ABI files; production/test transports; trace/reference hosts | Generator enforces layouts; browser tests prohibit trace exports; native/WASM and pinned component comparisons test different boundaries | Retain generated duplication, separate exports and independent evidence; share only buffer ownership |
| Input/audio/music/decode services, event/replay primitives and active projection | Service tests, simulation imports, schema exports and retained findings establish implemented prerequisites | Retain despite disabled Play; absent integration or browser binaries is not obsolescence |
| Retained sources, findings, licences, CI, lockfiles and ignored-spike exclusions | Source verifiers, locked reference hosts, attribution and allowlist depend on them | Retain; no source hashes, oracle output, identity or acceptance classification changes |

## Validation and limits

Executed in the isolated cleanup worktree on macOS arm64, Node 24.13.0,
checksum-pinned Odin `a2fb372`, with the supplied LLD 20 directory:

- `npm --prefix engine test`: passed source/hash and generated-binding checks,
  30 allocation-tracked foundation/session/presentation groups, native C ABI and
  lifecycle checks, 88 decoder traces, 74 geometry plus four local failure cases,
  101 preparation traces/digests, 14 primitive test groups, 104 primitive traces
  and four viewport fixtures. Native/WASM comparisons remain exact. The new test
  covers allocation/quota rejection, failed-output ownership, replacement,
  repeated disposal and empty-inbox reuse.
- Browser `npm ci`, `test`, `test:session`, `build`, and
  `test:browser -- --project=chromium`: passed, with 38 service tests, 34
  diagnostic/compact cadence-stall schedules and four Chromium scenarios.
- All 148 local Markdown file/directory/anchor links passed; `git diff --check`
  passed. Changed handwritten files were reviewed for naming, ownership and scope.
- Relative-import graph check found no cycles across 32 Odin packages; all 47
  exported Odin symbols match the reviewed baseline.
- Source worktree remains clean at `1b4b8f3`; the main checkout remains clean.

Firefox-1543 and WebKit-2359 executable paths are still absent. No installation
retry, Firefox/WebKit execution, physical input/audio validation or new upstream
reference run was performed for this cleanup. The retained 72 pinned component
comparisons are prior evidence; no finding hashes or oracle outputs were changed.
Whole-scenario M2/M3 acceptance remains open and Play stays disabled.


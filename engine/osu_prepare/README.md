# Beatmap preparation

`resolve` builds M0 control points. `prepare_map` consumes a decoded map and those
points to produce an owned immutable `prepared.Map`, including independent breaks,
control points and playback settings; `prepared.destroy_map` releases
it. Runtime integration applies the combined arena quota and publishes only complete
candidates. See [engine ownership](../README.md#ownership-and-api) and
[implementation evidence](../../docs/status.md).

## Geometry API

`build_path(points, options, workspace)` computes linear, Bézier/B-spline,
Catmull, perfect-curve, and explicitly marked mixed paths, their cumulative
lengths, original segment-end distances, and declared-length adjustments.
`position_at(&path, progress)` clamps finite progress to `[0,1]` and queries the
adjusted path. Empty and single-point geometry are valid independently of
whether a future map validator accepts the corresponding beatmap.

Inputs explicitly select Catmull optimisation and optional expected distance.
No map-version, timing, repeat, or sample policy is inferred. A `None` marker
continues the current segment; an explicit marker ends the preceding segment
and starts the next at the same point. `parse_path` translates raw `.osu` syntax and repeated-point marker rules.
Complete preparation chooses the raw/final Catmull modes used by upstream.

## Workspace contract

- Caller supplies disjoint vertex, cumulative-length, segment-end, scratch, and
  stack buffers. They must not overlap inputs or another live path's buffers.
- For N input control points, scratch requires at least `4*N` `V32` elements;
  each subdivision stack frame occupies N elements. Insufficient stack or
  output space returns `Buffer_Too_Small`; no path is published.
- Cumulative storage requires vertex capacity plus one; upstream's duplicated
  tail case intentionally has one extra length entry. Segment-end capacity must
  be at least N. Caller allocation arithmetic must be checked before allocation.
- An explicit work limit bounds approximation work. An optional shared remaining-work
  pointer additionally bounds multiple builds without resetting their aggregate cost. Exhaustion returns
  `Work_Limit`; it never substitutes a coarser curve. The standalone geometry API uses caller budgets; complete map preparation
  applies the production limits documented in the status report.
- These geometry procedures make no allocations. A successful `Path` borrows workspace spans
  until reuse. Failure returns an empty `Path` and may leave scratch/output bytes
  modified. Use separate candidate storage to preserve a previous live path.
- `position_at` accepts paths returned by a successful build, with their backing
  buffers intact. It is not an arbitrary public-span validation API.

Upstream `Vector2` operations use f32 intermediates. The port reproduces those
rounding points and exposes the resulting coordinates in f64 records; cumulative
distance is f64. Do not replace source operations with algebraically equivalent
f64 math or enable fast-math without rerunning upstream comparisons.

Source revisions and hashes live in
[`reference/geometry/manifest.json`](../reference/geometry/manifest.json).
Ported algorithms retain the ppy copyright notice and MIT licence references.

## Validation

From the repository root, after the normal pinned compiler setup:

```sh
npm --prefix engine run test:geometry
npm --prefix engine run test:geometry:upstream
```

The first command runs allocation-tracked geometry tests and generated
native/WASM fixtures. The second also requires a .NET 10 SDK (`dotnet` on PATH or
`DOTNET_BIN`) and compares against pinned upstream geometry. See the
[reference setup](../reference-host/README.md#independent-geometry-host). `npm --prefix engine test`
includes local geometry checks alongside the existing M0 foundation suite.

Generated traces and acceptance reports live in ignored `engine/artifacts/geometry/`.
`test:prepared:upstream` additionally covers integrated H03/H04 preparation.

The runtime shares one `core_types.Work_Budget` across control-point resolution
and M1 count/fill passes. Standalone callers may pass their own budget to `resolve`
and `prepare_map`; omitted budgets use the production default. Reinitialise the
budget to begin a new independent candidate. Failure leaves published maps intact;
work already spent is not refunded. Exhaustion is a deterministic safety policy,
not evidence that upstream rejects the same input.

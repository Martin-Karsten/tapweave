# ADR-003: Rendering and browser bridge

Status: accepted for the first production browser target.

## Context and evidence

The engine should own presentation/render logic in Odin while browser APIs require JavaScript integration. The spike Canvas demo is useful but does not implement slider/spinner batching. WebGPU is modern but its rollout has differed by platform—Chrome documents staged platform support and later Firefox/Safari availability ([Chrome platform overview](https://developer.chrome.com/docs/web-platform/webgpu/overview)); WebKit records Safari 26 as its first general WebGPU release ([WebKit](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/)). WebGL2 is the mature Khronos web standard derived from OpenGL ES 3.0 and includes instancing/VAOs in core ([Khronos specification](https://registry.khronos.org/webgl/specs/2.0/)).

## Alternatives

1. Canvas 2D: minimal bridge, weak batching/control for dense slider meshes.
2. WebGPU: strongest modern API, narrower availability and more device/loss complexity now.
3. WebGL2: sufficient 2D batching and broad desktop-browser availability.
4. Compile/link a native graphics abstraction: larger payload/toolchain and still needs browser glue.

## Decision

Use WebGL2. Odin owns animation curves, culling, z/order, path tessellation, instance data, atlas regions, shader sources, blend/scissor intent and batches. JavaScript is a thin executor that creates the canvas/context/resources, compiles supplied versioned shaders, uploads typed spans, issues a bounded command stream, handles context loss, and reports capabilities/errors.

No JavaScript object exists per hit object. Static path/body meshes are uploaded once per prepared map; frame buffers contain compact instances and dynamic uniforms. A backend-neutral render protocol permits a later WebGPU executor without moving presentation policy out of Odin. Canvas 2D is retained only as a diagnostic fallback, not a compatible production capability.

Context capabilities are queried at startup. WebGL2 absence returns `CAP_RENDER_UNAVAILABLE`. Context loss pauses gameplay, releases actions and audio, invalidates GPU generation, then rebuilds resources from prepared/asset data before resume.

## Consequences

This maximizes Odin ownership without binding deterministic packages to DOM calls. JavaScript still necessarily owns opaque WebGL handles. A later WebGPU backend may improve throughput but must pass the same rendered-scene command fixtures. Shader compiler differences mean pixel-perfect cross-browser output is not a gameplay acceptance criterion; command buffers and sampled geometry are.

## Acceptance

Test dense circles/sliders/spinners, resize/DPR changes, context loss/recovery, missing texture fallback, alpha ordering, and static-mesh reuse. Measure separately: presentation, tessellation, WASM→JS upload, JS submission, GPU time where timer queries are available, and RAF frame pacing.

## M3 coordinate transport and readonly dependency

The independent viewport transform is exposed as kinds 29/30 through
`oe_playfield_transform`. It validates a mailbox viewport before publishing into
a separate readonly mailbox span; it allocates nothing and advertises no object
rendering capability. Existing records/exports are unchanged.

Presentation consumes a borrowed readonly simulation projection; it may import
simulation but not runtime. Simulation cannot import presentation. Runtime owns
composition and resource lifetimes. The current kind-19 full-map diagnostic
snapshot is not the production active-set render protocol. Remaining resource
and batching requirements are specified [below](#remaining-resource-protocol).

## Active projection transport implementation

Simulation now supplies a borrowed `Projection` facade and object accessor.
Presentation maintains arena-backed reveal/active indices; runtime serializes
kind-32/33 projections into a separate session buffer. It cannot acknowledge or
advance gameplay, and rendering reads cannot invalidate audio acknowledgement.
The active set retains committed outcomes independently of the journal cursor.
Backwards diagnostic reads rebuild; normal forward reads do not scan the map.
This is the projection substrate for rendering, not the accepted final draw
protocol. Animation, static resources and WebGL command generation remain open.

## Remaining resource protocol

These definitions constrain the next implementation; they are not advertised
wire records or completed capabilities. Assign concrete new kinds when writers,
readers and conformance tests land together, preserving kinds 1–34.

- Creation reserves active indices, expiry ordering, feedback history, trail,
  instance output and mesh accounting with checked u64 arithmetic. Normal forward
  presentation uses arrival/expiry cursors plus the active set; arbitrary backward
  requests explicitly rebuild reusable indices without judging. Stable order is
  layer, source object order, component order, then primitive ordinal.
- A static-resource header identifies map identity, resource generation and total
  bytes. Relative spans carry vertex/index buffers, original atlas bytes and
  versioned Odin shader sources. A draw header identifies session epoch, resource
  generation, viewport and HUD; spans carry ordered batches and compact instances.
  Resource IDs are integers, never native pointers or WebGL handles.
- Every span has checked relative offset/count/stride and eight-byte alignment
  for record headers. Validate command opcode, resource reference, index range,
  instance range and finite uniforms before executing any batch. Unknown versions
  reject. Resource candidates publish only after all uploads succeed.
- Static resources belong to a prepared-map render attachment; four sessions may
  share them. GPU objects belong to the browser map/context generation. A lost
  context invalidates all GPU IDs; recreate once from owned immutable bytes.
  Frame spans expire on next render-output call. Output reserve is READY/PAUSED
  only and transactional; overflow reports required capacity without truncation.
- Quotas must bound active objects, instances, commands, mesh vertices/indices,
  texture dimensions/bytes, dynamic uploads and total arena bytes independently.
  Their concrete defaults require count-pass workload measurements; no capability
  can be enabled with an unbounded or unimplemented quota. No static mesh builds,
  shader compilation, allocation or memory growth in advance/render hot paths.


## Minimal attachment and bounded projection refinement

Kind 35 implements the immutable resource container using a small real payload.
Runtime creates it transactionally on explicit map-resource request, retains it
with the map and frees it with the last session/map owner. Session resource reads
only borrow existing storage. See the [ABI](interface-v2.md#minimal-immutable-render-attachment)
for payload and validation. Full draw output, dynamic reserve and W04 generation
remain open. No additional aggregate rendering capability is advertised.

Active projection now heap-sorts newly expanded membership, bounding reverse
reveal bursts to O(active*log(active)) without allocation; reads with no new
members do no ordering work. Debug projection retains its conservative policy;
circle draw membership separately expires misses at 100 ms and hits at 800 ms.
The borrowed simulation facade additionally exposes component results, retained
judgement feedback, cursor and semantic recording history. These views survive
journal acknowledgement and must be reacquired after mutation/reset/seek. They
feed reserved presentation-owned history indices. Watermarks consume each source
record once, independent of audio acknowledgement. Backward reads and epoch
changes rebuild membership. A one-second cursor history window is storage policy,
not an upstream trail duration or a completed trail producer.

## Reserved circle draw publication

Kinds 36–40 add an explicit circle-only count/reserve/fill protocol. A separate
session-owned arena holds instances and serialized batches; reserve is
READY/PAUSED-only and transactional, while draw output cannot acknowledge or
advance gameplay. Insufficient frame capacity reports the exact required count
without overwriting the prior frame. Mixed maps are rejected by reserve until
slider/spinner producers exist. Complete draw capability remains unavailable.

Circle approach scalar and vector interpolation preserve the pinned framework's
different precision and operation order. The retained findings compare 36
schedule observations exactly after f32 projection. Another 60 early/on-time/late
hit and miss feedback comparisons match main-piece alpha/scale at equal elapsed
time after the actual results; this isolates curves from miss-time quantisation.
135 shared native/WASM boundary cases exercise the circle producer. Broader A22
and upstream skin appearance remain open. W04 still owns
original glyph/analytic shader resources and execution. See the
[wire contract](interface-v2.md#reserved-circle-draw-transport).

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

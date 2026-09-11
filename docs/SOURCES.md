# Sources

## Primary code baselines

1. ppy. [osu! `2026.804.2-lazer`, commit `3c1c96f742e7aae2ff67a7361e058fe91ca3b955`](https://github.com/ppy/osu/tree/3c1c96f742e7aae2ff67a7361e058fe91ca3b955). Gameplay, decoding, scoring, health, replay, presentation, mods, skins, difficulty and pp behavior.
2. ppy. [osu!framework `2026.731.0`, commit `f02756c5aa5032e6d04729922702b8d56c4bc2eb`](https://github.com/ppy/osu-framework/tree/f02756c5aa5032e6d04729922702b8d56c4bc2eb). Drawable scheduling, path approximation, input, clocks and audio framework behavior.
3. peppy. [osu!stable reference, commit `08e3dafd525934cf48880b08e91c24ce4ad8b761`](https://github.com/peppy/osu-stable-reference/tree/08e3dafd525934cf48880b08e91c24ce4ad8b761). Used only through legacy-compatibility references in pinned lazer code.

Exact file/symbol links appear next to claims in each chapter. Locally retained upstream excerpts and SHA-256 values are inventoried in [`engine/reference/source-manifest.json`](../engine/reference/source-manifest.json).

## Platform standards and vendor evidence

4. W3C. [Web Audio API](https://www.w3.org/TR/webaudio/). Audio context time, scheduled sources and buffer-source lifecycle.
5. Khronos Group. [WebGL 2.0 Specification](https://registry.khronos.org/webgl/specs/2.0/). Browser graphics API and core capabilities.
6. W3C GPU for the Web Working Group. [WebGPU](https://www.w3.org/TR/webgpu/). Candidate modern backend considered but not selected for the initial runtime.
7. Google Chrome. [Overview of WebGPU](https://developer.chrome.com/docs/web-platform/webgpu/overview). Platform rollout evidence.
8. WebKit. [WebKit Features for Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/). Safari WebGPU rollout evidence.
9. Odin project. [`core:sys/wasm/js` package reference](https://pkg.odin-lang.org/core/sys/wasm/js/). Official `js_wasm32` browser bindings surface.

## Local experimental evidence

Historical local spikes informed the architecture; their implementations and raw reports are not distributed here. The [spike audit](compatibility/spike-audit.md) preserves the relevant findings. Historical measurements are context, not a reproducible public baseline or upstream compatibility evidence.

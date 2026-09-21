# GitHub CI

The Foundation checks workflow runs on pushes and pull requests. Production
hosting additionally requires every validation job to pass on `main`.

## Runner prerequisites

Engine tests reuse the compiled browser `Engine_Bridge` through
`engine/scripts/browser-runtime.mjs`. Install the pinned browser package with
`npm --prefix platform/browser-js ci` before foundation or complete-preparation
checks. Installing just the product shell is also insufficient: TypeScript
resolves the shell's imported browser sources against the browser package's own
`node_modules`. This is a test transport dependency, not an Odin package dependency.

On Ubuntu, run browser suites under `xvfb-run -a`, with `LIBGL_ALWAYS_SOFTWARE=1`
and the Mesa EGL/DRI libraries installed. Firefox runs headed inside Xvfb on Linux CI: merely supplying a display to
headless Firefox still produced intermittent WebGL2 creation failures.
Browser-foundation uses one runner per Chromium/Firefox/WebKit project; each
Playwright suite uses one worker in CI. This avoids concurrent renderer workloads
competing for the same software graphics resources. On Linux CI, Chromium selects ANGLE/OpenGL with Mesa using
`--use-angle=gl --ignore-gpu-blocklist`; the default ANGLE/SwiftShader backend
exceeded the long renderer workload budget. These flags only apply to CI on Linux.
The product suite also starts PulseAudio with a null output sink. Firefox needs
a live audio output for its real `AudioContext` clock to advance; without it,
playback remains at “Starting audio…”. This supplies an audio backend, not a
mock clock. Existing assertions, renderer workload lengths, and per-test timeouts are
unchanged. Replay setup now explicitly positions the pointer over its fixture
objects and waits on the observed audio clock before sending real DOM keys,
instead of assuming UI visibility establishes the beatmap-time origin. These are software-rendering
regression checks, not release hardware performance certification.

## Investigation: 2026-09-21

[Run 35461673290](https://github.com/Martin-Karsten/tapweave/actions/runs/35461673290)
failed on commit `55551d66230024beb4a3366d487d3a548e03e734`:

| Job | Observed failure | Correction |
| --- | --- | --- |
| foundation | `TS2307` resolving `fflate` in `archive.ts` | Install browser dependencies before the engine suite |
| preparation-reference | Same error in the nested foundation suite | Install browser dependencies before the upstream comparison |
| product-shell | Same error while checking sibling browser source | Install both browser and shell dependencies |
| browser-foundation | 11 Firefox WebGL2 failures, one Chromium interaction timeout, one Chromium 600-second workload timeout | Provide Xvfb/Mesa, isolate browser projects, and select Mesa OpenGL for Chromium |

Geometry and simulation reference jobs passed. Cloudflare authentication was
not involved; this run predates the uncommitted hosting workflow.

A clean temporary checkout reproduced the product-shell `fflate` error with only
the shell installed. Installing the locked browser dependencies then passed both
the shell typecheck and browser compilation.

A local Ubuntu 24.04 ARM64 container using Playwright 1.63.0 reproduced Firefox's
missing WebGL2 with no X display, including with `webgl.force-enabled`. Under
Xvfb and software rendering, the graphics-scenario and mixed-scene tests passed.
The Chromium graphics-scenario test also passed with one worker. Chromium's
default ANGLE/SwiftShader backend still exceeded 600 seconds in isolation, so CI
now selects Mesa OpenGL explicitly. One local container run lost its GPU context
while a concurrent build exhausted the Docker VM's memory (the container recorded
an OOM kill); subsequent graphics checks ran without competing builds. The GitHub Chromium
suite then passed all 18 tests, including all 10,795 long-workload frames in
5.3 minutes. The regular Firefox display path passed ten repeated workspace
and graphics tests locally; with PulseAudio running, all 60 Firefox product
browser tests passed in the Linux container.

The first repair run on GitHub passed foundation, complete preparation, and
geometry, then exposed a second product-build failure: the generated ZIP used a
UTC instant, but fflate serializes ZIP timestamps as local calendar fields. The
archive therefore differed between the developer's timezone and UTC runners.
The generator now pins the original ZIP wall time, preserving every existing
manifest hash. A subprocess regression verifies UTC, Berlin, Los Angeles, and
Tokyo without changing process-wide timezone state or weakening manifest checks.

After the infrastructure fixes, one replay test still recorded zero hits
intermittently. Its setup used wall-time delays after the UI appeared and did not
position the pointer. It now aims at the fixture heads and observes beatmap time
from the audio clock before sending real key presses. The nonzero live-score and
replay-equality assertions are unchanged. Both replay tests passed three repeats
in each of Chromium, Firefox, and WebKit (18 passes).

The engine regression suite and all 191 browser-service tests passed locally.
Linux container checks use Ubuntu ARM64; GitHub checks run on Ubuntu x64.
The CI-only repair is on `codex/fix-linux-ci`, independently of the pending
Cloudflare hosting implementation. All eight jobs passed on commit `1a1e8aa` in
[run 35594938489](https://github.com/Martin-Karsten/tapweave/actions/runs/35594938489):
foundation, geometry, preparation, simulation, all three browser-runtime projects,
and the complete product-shell job. This validates the CI repair branch; it has
not been merged into `main` and does not publish the pending hosting changes.

The product gate suite launches Chromium directly, so browser binaries must be
installed before the gates. The hosting change already moves that installation
ahead of the gate step.

## References

- [Playwright CI setup, worker count, and Xvfb](https://playwright.dev/docs/ci)
- [Current workflow](../.github/workflows/ci.yml)
- [Hosting setup and deployment](hosting.md)

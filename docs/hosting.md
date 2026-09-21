# Cloudflare hosting

Tapweave deploys the Solid product shell, a small room API Worker and one
SQLite-backed Durable Object per private room on Cloudflare Workers Free, at
`https://tapweave.<account-subdomain>.workers.dev`. No purchased domain, paid plan,
R2 or D1 is required. Solo assets continue to use direct static asset serving.
Production: [tapweave.mrtnkarsten.workers.dev](https://tapweave.mrtnkarsten.workers.dev).
The first deployment on 2026-09-21 used local Wrangler OAuth and the validated
static build from commit `dbaae2296cff2ce8edf12b22a8aef08d870668d4`;
Cloudflare version `8fb041c5-45b4-4351-8eae-e60d5f8294c3`.
The public hosting smoke passed, including engine initialization and demo start/pause.
The GitHub account variable is configured; automatic publishing still requires
the `CLOUDFLARE_API_TOKEN` secret. Hosting does not close upstream compatibility
or release-browser gates.

## First deployment

1. Create or select a Cloudflare Free account. In Workers & Pages, configure its
   free `workers.dev` subdomain. Do not enable a paid Workers subscription or
   connect a purchased domain. Reserve the Worker name `tapweave` for this app;
   verify it does not belong to an unrelated existing deployment.
2. Create an API token with Account / Workers Scripts / Edit permission, restricted
   to this account (the Edit Cloudflare Workers template can be narrowed to it).
   The token must also be able to read the account's Workers subdomain.
3. In this GitHub repository's Actions settings, add the secret
   `CLOUDFLARE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID`. Never commit the token.
4. Merge the hosting implementation into `main`. Its push runs every existing
   validation job. After all pass, deployment uploads the tested `product-site`
   artifact, discovers the account subdomain, and checks the public site in
   Chromium. The job summary records the URL, commit, and smoke outcome.
5. Open that URL in a fresh browser. Confirm audible demo playback, local map
   import, pause/retry, and results on real hardware. These manual checks remain
   necessary; a headless smoke cannot certify audible output.

Pull requests never deploy and need no Cloudflare credentials. Missing credentials
fail only the deployment job with a setup message. Production deployments share a
concurrency group; queued runs check the current `main` head immediately before
publishing and skip obsolete commits. An already publishing run finishes before
the next one starts. A failed public smoke marks the job failed but does not undo
an already published release: inspect it and roll back if needed.

## Local build and hosting preview

Use Node 24, the checksum-pinned Odin compiler, and the documented native/WASM
linkers (see the root README). From the repository root:

```sh
npm --prefix engine run setup
npm --prefix engine run build
npm --prefix platform/browser-js ci
npm --prefix platform/product-ui ci
npm --prefix platform/product-ui/worker-tests ci
npm exec --prefix platform/product-ui -- playwright install chromium firefox webkit
npm --prefix platform/product-ui run test:gates
npm --prefix platform/product-ui run test:browser
npm --prefix platform/product-ui run typecheck:worker
npm --prefix platform/product-ui run test:worker
npm --prefix platform/product-ui run build:deployment
npm --prefix platform/product-ui run test:multiplayer
npm --prefix platform/product-ui run test:hosting:assets
npm --prefix platform/product-ui run test:hosting
```

`test:hosting` starts a local Wrangler server, checks routing, headers, missing
assets, engine initialization, demo start and pause, then stops the server.
For interactive testing run `npm --prefix platform/product-ui run preview:hosting`
and open `http://127.0.0.1:8787`. Both commands serve the packaged `artifacts/deployment` without rebuilding.
Port 8787 must be free. Multiplayer browser tests use local HTTPS on port 8788
so Secure cookies behave consistently in Chromium, Firefox and WebKit.

To check an already deployed site:

```sh
npm --prefix platform/product-ui run test:hosting -- https://tapweave.YOUR-SUBDOMAIN.workers.dev
```

## Asset and routing contract

The deployment artifact includes the Worker bundle, SQLite migration configuration,
bindings and rollout flag, plus the product shell, fingerprinted JS/CSS/WASM and
original generated demo assets. Its `sha256.json` is verified before deployment. `/LICENSE.txt` and `/THIRD_PARTY_NOTICES.txt` retain the
project and bundled runtime dependency licences. Vite embeds the matching WASM URL into the JavaScript;
production does not load the old `/tapweave.wasm` path. The standalone browser
validation package retains its own asset arrangement.

Tracked `platform/product-ui/hosting/` files are copied into the generated public
assets during preparation. HTML and the fixed-name demo require revalidation;
content-addressed `/assets/` files are immutable. Unknown assets return 404.

The initial catch-all `single-page-application` setting returned HTTP 200 HTML for
missing JS/WASM in the pinned Wrangler asset-only runtime. Instead, `_redirects`
explicitly proxies `/`, `/menu`, `/select`, `/play`, `/results`, `/diagnostics`,
`/multiplayer` and `/room/:room_id`
to `/index.html` with status 200. `not_found_handling` and `html_handling` are both
`none`, preserving URLs and preventing canonical HTML redirects. Add new product
routes to the hosting rules and smoke checks. `/api/multiplayer/*` runs the Worker
first; all other existing assets bypass it. Unknown page paths return 404 as well.

Fingerprinting prevents an old JS bundle from silently loading a new incompatible
engine. It does not guarantee indefinite availability of retired release assets;
reload an old tab if a deployment removed an asset it had not yet fetched.

## Rollback and manual publishing

Use the Cloudflare dashboard's deployment history for `tapweave` to roll back to
a previously successful version, then run the public smoke above. Alternatively,
after authenticating Wrangler locally, use its pinned CLI:

```sh
cd platform/product-ui
npm exec -- wrangler login
npm exec -- wrangler deployments list
npm exec -- wrangler rollback VERSION_ID
```

For an intentional manual release, validate and package first, then run
`npm run verify:deployment` and `npm run deploy:artifact` from the same directory.
This uploads the checked artifact with bundling disabled; it does not rebuild or
run CI. Normal releases should use GitHub's serialized, validated deployment path.
Do not manually publish while a CI deployment is running. Fix or revert the bad
commit on `main` before the next automatic release.

## Cloudflare references

- [Static assets setup and free subdomains](https://developers.cloudflare.com/workers/static-assets/get-started/)
- [Static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Static redirects and proxying](https://developers.cloudflare.com/workers/static-assets/redirects/)
- [Static response headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [GitHub deployment credentials](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Deployment rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

## Multiplayer rollout and operation

`MULTIPLAYER_ENABLED` gates new room creation on the server. Set it to `false`
in `wrangler.jsonc`, package, validate and deploy to disable new rooms while
leaving existing rooms and solo assets usable. For an immediate incident response,
the same variable can be changed in the Cloudflare dashboard; reconcile that
change into the config before the next deployment. The release config enables it.

The initial `multiplayer-v1` migration declares `Multiplayer_Room` as SQLite-backed.
Do not change this to a key-value Durable Object or upgrade the account plan.
Free-tier quota exhaustion returns recoverable multiplayer errors and never
automatically upgrades billing. The deployment API token needs permission to
deploy Worker scripts and their Durable Object bindings/migrations.

Room data expires after 30 minutes of inactivity or four hours maximum. There is
no permanent leaderboard. Lifecycle/failure counters use structured Worker logs
without nicknames, invite URLs or credentials. Live scores are transient; first
terminal submissions are persisted. Physical two-device validation remains in
[MP-08](compatibility/multiplayer.md).

SQLite data and migrations are not undone by reverting JavaScript. After the
first migration, rollback to a version retaining the class/binding; disable room
creation first during a multiplayer incident. Do not assume the original
asset-only deployment can safely reverse a Durable Object migration.

The private-room deployment on 2026-09-21 published version
`f3ceaf0f-4a07-4197-8dc2-22beab46aafb` to the existing address with room creation
enabled. The checked artifact was uploaded without rebuilding; no billing-plan
change was made. Public hosting smoke passed. Two independent Chromium contexts
completed a real client-reported round, agreed on results and returned to the
lobby for rematch. This is browser automation on one machine, not two physical
devices; that acceptance check remains open by user request.

Release Worker SHA-256:
`c919d751bf617a64bfd3d85f6a5f03bb3e1a58b64d0a63ab75d4d3279690eb46`.
Deployment manifest SHA-256:
`2db0e8c7e1b2963509b97203dfb0ef2e9d49c834c3c4fe5ae869c4851a2e2511`.

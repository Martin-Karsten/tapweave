# Cloudflare hosting

Tapweave deploys the Solid product shell as static assets on Cloudflare Workers
Free, at `https://tapweave.<account-subdomain>.workers.dev`. No purchased domain,
Worker application code, Durable Objects, or other Cloudflare services are needed.
The actual production URL is recorded in the successful deployment job summary.
Initial deployment is pending account configuration; no public URL has yet been
verified. Hosting does not close upstream compatibility or release-browser gates.

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
npm exec --prefix platform/product-ui -- playwright install chromium firefox webkit
npm --prefix platform/product-ui run test:gates
npm --prefix platform/product-ui run test:browser
npm --prefix platform/product-ui run test:hosting:assets
npm --prefix platform/product-ui run test:hosting
```

`test:hosting` starts a local Wrangler server, checks routing, headers, missing
assets, engine initialization, demo start and pause, then stops the server.
For interactive testing run `npm --prefix platform/product-ui run preview:hosting`
and open `http://127.0.0.1:8787`. Both commands serve the existing `dist` without
rebuilding. Port 8787 must be free.

To check an already deployed site:

```sh
npm --prefix platform/product-ui run test:hosting -- https://tapweave.YOUR-SUBDOMAIN.workers.dev
```

## Asset and routing contract

The build includes only the product shell, fingerprinted JS/CSS/WASM, and original
generated demo assets. `/LICENSE.txt` and `/THIRD_PARTY_NOTICES.txt` retain the
project and bundled runtime dependency licences. Vite embeds the matching WASM URL into the JavaScript;
production does not load the old `/tapweave.wasm` path. The standalone browser
validation package retains its own asset arrangement.

Tracked `platform/product-ui/hosting/` files are copied into the generated public
assets during preparation. HTML and the fixed-name demo require revalidation;
content-addressed `/assets/` files are immutable. Unknown assets return 404.

The initial catch-all `single-page-application` setting returned HTTP 200 HTML for
missing JS/WASM in the pinned Wrangler asset-only runtime. Instead, `_redirects`
explicitly proxies `/`, `/menu`, `/select`, `/play`, `/results`, and `/diagnostics`
to `/index.html` with status 200. `not_found_handling` and `html_handling` are both
`none`, preserving URLs and preventing canonical HTML redirects. Add new product
routes to the hosting rules and smoke checks. This remains a static SPA with no
backend. Unknown page paths return 404 as well.

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

For an intentional manual release, validate the build first and run `npm run deploy`
from the same directory. This uploads the existing `dist`; it does not build or
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

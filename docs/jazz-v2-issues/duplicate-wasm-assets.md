# Draft: Vite emits the Jazz Wasm twice across page and worker builds

Status: issue draft, not submitted. Jazz `2.0.0-alpha.61`, Astro 5, Vite 7.

Alkalye's production first-load capture downloads two 8,812,317-byte binaries:
`jazz_wasm_bg-BazWJnU4.wasm` and `jazz_wasm_bg.BazWJnU4.wasm`.
Both hash to SHA-256
`793d17d49189ac682d527c4b119a19d0dd52c8276a6d70241f3de725e07c0aff`.
The two encoded transfers account for 17.63 MB of the 20.84 MB first visit.

The page imports `jazz-wasm/pkg/jazz_wasm.js`; its `new URL` emits an Astro
asset with a dotted hash. Jazz's prebundled `dist/worker/jazz-broker-worker.js`
contains another wasm-bindgen glue copy and a worker-local binary URL. Vite's
SharedWorker build emits that binary using its hyphenated default. PWA globbing
then precaches both distinct URLs. Package sources contain two binary copies,
but the bad outcome depends on the bundler giving identical bytes different
public URLs.

Jazz also references its broker worker as an ordinary `new URL` for identity,
and as `new SharedWorker(new URL(...))` for execution. Vite emits both a raw
worker asset and the processed worker chunk. Only the processed chunk executes.
Precache both and the unused raw worker adds about 0.89 MB to installation.

## Alkalye workaround

Set Vite worker `rollupOptions.output.assetFileNames` to
`_astro/[name].[hash][extname]`, matching Astro's page asset names. Both builds
then reference one Wasm asset. Exclude the
unused dotted broker worker asset from the PWA precache; keep the actual
hyphenated worker chunk and the single Wasm asset.

A separate capture still records two uncached transfers of the now-identical
URL, one per realm. Serial page initialization did not eliminate this. URL and
precache deduplication therefore do not by themselves reduce encoded first-load
bytes. This SDK startup behavior remains unresolved.

First-load measurements use a fresh isolated browser context with HTTP caching
enabled and service workers blocked. The original harness disabled caching on
every target, forcing repeat downloads of even an identical URL. The old files
remain unchanged. New results record this difference explicitly.

The Node standalone adapter serves Wasm uncompressed. The benchmark provisioner
now uses `serve-production.ts`, which negotiates Brotli/gzip for static JS, CSS
and `application/wasm`, while streaming Jazz requests unchanged. Set
`BENCH_COMPRESSION=identity` for the uncompressed comparison. Both response
modes preserve the original MIME type and immutable caching.

Vercel documents automatic Brotli/gzip negotiation and explicitly includes
`application/wasm` in its compression allowlist:
https://vercel.com/docs/how-vercel-cdn-works/compression

This confirms intended CDN behavior, not an observed Alkalye Vercel deployment.
Local Brotli quality 6 is an approximation; its exact encoded size is not a
prediction of Vercel's compression level. The report includes both local modes.

## Reproduction

Build with `ALKALYE_LOCAL_PREVIEW=1 bun x astro build`, list
`dist/client/_astro/*wasm`, inspect the broker worker URLs, and capture network
requests from both page and SharedWorker targets. Inspect CacheStorage after
service-worker installation; it must contain one Wasm and one executing broker
worker. The final report links raw measurements and offline browser evidence.

written with gpt-6.1-sol in T3 Code (Codex)

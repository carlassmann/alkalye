# Vite emits identical Jazz Wasm at separate page and worker URLs

Jazz `2.0.0-alpha.61`, Astro 5, Vite 7. Unsubmitted packaging issue.

## Observed result

Alkalye's original production preview used separate page and worker Wasm URLs,
with dotted and hyphenated asset hashes. Identical bytes at separate URLs caused
separate downloads and PWA precache entries.
The original raw first-load JS/Wasm was about 20.84 MB. See
[original results](../../bench/results/v2.json) and
[post-workaround raw control](../../bench/results/v2-optimized-load.json).
The final [asset diagnostic](../../bench/results/stock-diagnostics.json) records
SHA-256 `793d17d49189ac682d527c4b119a19d0dd52c8276a6d70241f3de725e07c0aff`
for the published Wasm.

The page's `jazz-wasm` glue and the prebundled Jazz broker worker each resolve a
Wasm URL. Vite's page and worker builds give it different names. Jazz also uses
an ordinary worker URL for identity and a `SharedWorker` URL for execution;
Vite emits a raw asset and a processed worker. See upstream
[asset URL resolution](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/runtime/runtime-config.ts)
and [SharedWorker connection](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/runtime/native-runtime/browser-shared-worker-connection.ts).
The generated package assets, rather than the source glue path, are what the
bundler consumes.

## Workaround

Alkalye's [Astro configuration](../../astro.config.ts) matches worker
`assetFileNames` to Astro's `_astro/[name].[hash][extname]` and excludes the unused
dotted broker-worker asset from precaching. It keeps the executing worker and
Wasm cached for offline startup.

Identical URLs alone did not remove repeated wire transfers in the uncompressed
control. In the final Brotli preview, each of five fresh contexts recorded one
Wasm wire transfer of about 2.518 MB and a zero-byte disk-cache read. Total
JS/Wasm is 3.46 MB, versus Classic's 2.96 MB. See
[stock asset captures](../../bench/results/stock-diagnostics.json) and
[benchmark report](../benchmarks/jazz-classic-vs-v2.md).

The old harness disabled HTTP caching; the final campaign enables it with fresh
contexts and blocks service workers for first-load measurements.
[scripts/bench/serve-production.ts](../../scripts/bench/serve-production.ts)
negotiates Brotli/gzip while preserving MIME types and caching. These local
measurements do not establish deployed Vercel transfer sizes.

## Reproduce and requested packaging

Build a Vite application importing `jazz-tools/local-first`, inspect the emitted
page and worker Wasm URLs, and precache JS/Wasm assets. In Alkalye, use
`ALKALYE_LOCAL_PREVIEW=1 bun x astro build`; remove the worker naming override
and broker-worker precache exclusion to inspect the original naming behavior.
Capture both page and SharedWorker requests with HTTP caching enabled.

Please provide a bundler-supported shared Wasm asset path and avoid emitting an
unused broker-worker copy. A documented Vite/PWA configuration would also let
applications avoid maintaining naming assumptions about package internals.

written with gpt-6.1-sol in T3 Code (Codex)

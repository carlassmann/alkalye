# Splash usability benchmark

This experiment removes the 700 ms splash minimum and 300 ms exit transition. The startup cover stays until Jazz has loaded the account and TanStack Router has committed its initial route. Later navigations do not restart the splash.

Baseline commit: `9e825483d818842b558959871347c86d6b003609`.

The measurement uses the same disposable anonymous account, 100 imported Markdown documents of about 8 KiB each, requested document, headless agent-browser session, viewport, and production server for both builds. Every sample clicks the editor, inserts a unique marker, verifies focus and the resulting text, undoes the edit, checks the original visible content, and allows 1.1 seconds for persistence. No personal documents or credentials are used.

`editorReadyMs` requires the requested document's URL, title, content, and visible editor. `uncoveredMs` also requires the editor to pass `elementFromPoint` at the click position. `interactiveMs` includes the actual mouse click and confirmed text insertion. Startup times use the document navigation's performance clock. Switching starts immediately before the destination document button receives mouse input, and requires the destination editor rather than the previous document. The app's automation-ready flag is not an endpoint.

Measurements use Chrome 153 through agent-browser on an Apple M5 Pro, macOS arm64, 1280×900, with 1× and 4× CDP CPU rates. Network is local HTTPS with no bandwidth or latency throttling. HTTP-cold runs clear Chrome's HTTP cache and bypass the service worker; cached HTTP runs retain the cache and still bypass the worker. Controlled and offline runs require an active service worker. Jazz IndexedDB remains populated in every mode. Offline mode disables network through CDP. Cached switching uses the sidebar to move from fixture 099 to fixture 100.

Seven samples per build, mode, and CPU rate. Median and nearest-rank p95 are reported; with seven samples, p95 is the maximum. The machine also ran other tasks, so this is not an isolated hardware benchmark. This task's builds and checks finished before final timing. Editor timing changes without a direct relationship to the splash should be treated as noise. These samples do not measure fresh account creation, empty IndexedDB, remote document fetching, mobile Safari, or physical-device PWA launch. Service-worker navigation is the PWA startup approximation.

To reproduce, keep baseline and changed production files in separate directories. Build each with the same `PUBLIC_JAZZ_SYNC_SERVER` and copy `.vercel/output/static`. Run the local sync server through `work`. Configure another `work` command to run `bun scripts/splash-benchmark/serve.ts`, setting `SPLASH_BUILD` to the production directory. The fixture server handles static files and app navigation; it does not emulate server APIs or production compression.

Use a fresh named agent-browser session. Set `SPLASH_SESSION` and `SPLASH_ORIGIN` when different from the script defaults. Run `bun scripts/splash-benchmark/seed.ts` once. With fixture 100 open, run `bun scripts/splash-benchmark/measure.ts baseline`. `SPLASH_DOCUMENT` can explicitly select its `/app/doc/...` path. The script uses CDP only on the browser launched by agent-browser, for timing, throttling, hit testing, and input.

Switch the server to the changed build. Unregister the old service worker and clear CacheStorage, preserving localStorage and IndexedDB. Navigate online, let the changed service worker activate, and verify the changed main bundle is loaded. Run `bun scripts/splash-benchmark/measure.ts changed`. JSON files preserve every raw sample. `SPLASH_RUNS` adjusts the sample count.

## Results

All times are milliseconds. Negative percentage changes mean faster. These are observations under shared-machine load, not isolated causal estimates.

| CPU | Mode           | Editor median before → after | Editor p95 before → after | Interactive median before → after | Change | Interactive p95 before → after | Change  |
| --- | -------------- | ---------------------------- | ------------------------- | --------------------------------- | ------ | ------------------------------ | ------- |
| 1×  | cold-http      | 248 → 809                    | 309 → 5806                | 1085 → 905                        | -16.6% | 1106 → 5885                    | +432.2% |
| 1×  | cached-http    | 280 → 687                    | 393 → 1527                | 1127 → 794                        | -29.5% | 1252 → 1721                    | +37.5%  |
| 1×  | service-worker | 317 → 597                    | 634 → 749                 | 1132 → 722                        | -36.3% | 1144 → 982                     | -14.1%  |
| 1×  | offline        | 416 → 384                    | 549 → 663                 | 1194 → 515                        | -56.9% | 1354 → 774                     | -42.8%  |
| 1×  | switch         | 251 → 279                    | 367 → 531                 | 322 → 343                         | +6.4%  | 506 → 661                      | +30.7%  |
| 4×  | cold-http      | 1144 → 850                   | 1579 → 1634               | 1828 → 1053                       | -42.4% | 2974 → 1960                    | -34.1%  |
| 4×  | cached-http    | 1084 → 663                   | 1836 → 792                | 2689 → 838                        | -68.8% | 2852 → 998                     | -65.0%  |
| 4×  | service-worker | 1057 → 644                   | 1271 → 745                | 2729 → 807                        | -70.4% | 3123 → 949                     | -69.6%  |
| 4×  | offline        | 888 → 581                    | 983 → 631                 | 2338 → 728                        | -68.9% | 2638 → 831                     | -68.5%  |
| 4×  | switch         | 802 → 387                    | 1249 → 644                | 1238 → 583                        | -52.9% | 1675 → 889                     | -46.9%  |

At 1× CPU, warm HTTP interaction improved by 333 ms and controlled interaction by 410 ms. The median delay between editor rendering and passing the hit test fell from 823 to 50 ms for warm HTTP, and from 800 to 46 ms for controlled startup. That gap is the measurement most directly related to splash removal.

Cold HTTP p95 rose to 5,885 ms, and warm HTTP p95 also increased. The changed build's editor itself loaded more slowly in several 1× runs. Conversely, untouched document switching improved by 53% at 4×. These differences show substantial background-load confounding. Do not attribute the full observed startup percentage changes, or the switching changes, to this patch. No bundle-size, rendering, or route-switching improvement is claimed.

## Validation

`VITEST_MAX_WORKERS=2 bun run check` passed lint, types, formatting, and all 945 tests across 78 files. The first unconstrained check had four failures in unrelated CLI, asset-menu, and Jazz space tests; all passed in an isolated 68-test rerun and the final full check. Both production builds passed.

Every benchmark sample confirmed a real edit and restored the visible fixture content. Three additional controlled reloads at 4× CPU sampled the screen on animation frames. They recorded 19, 20, and 23 loading frames, respectively, followed by ten editor frames each, with zero frames lacking both splash and editor. The not-found route displayed its message and navigation actions with no splash remaining. First use of Preview rendered fixture 100, and the Editor action returned to its editor. This patch introduces no deferred feature.

Written with GPT-6 in Codex.

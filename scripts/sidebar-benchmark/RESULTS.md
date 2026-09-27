# Results

Historical experiment: baseline `9e82548`, sidebar extraction `2cc3a2b`. These timings predate the splash and lazy-loading changes merged from `main` during delivery; they are not measurements of the final PR head.

Retain the sidebar extraction. In the 205-document library, observed median unobstructed destination times improved by 69–80% at normal CPU and 61–72% at 4× CPU. Typing confirmation improved by 28–40%, including browser-driver overhead. The list root remained mounted on every measured changed switch; the repeated baseline replaced it on every switch.

Small-library results were mixed. At 4× CPU, ordinary-document median paint regressed from 199.3 to 225.8 ms, while large-document median paint improved from 316.6 to 174.8 ms. These runs do not establish a universal navigation speedup.

Only the library sidebar and its app controls persist. Document-specific controls remain keyed with editor state. This avoids introducing shared mutable editor state or a cross-route shell abstraction.

## Navigation

All times are milliseconds. Negative change is faster. The first switch in each size group is excluded as warm-up. The 5-document library has 11 measured switches per cell; the 205-document library has 9. With these sample counts, nearest-rank p95 is the maximum measured sample.

| Library | CPU | Document | Endpoint    | Before median / p95 | After median / p95 | Median change | n each |
| ------- | --- | -------- | ----------- | ------------------: | -----------------: | ------------: | -----: |
| 5       | 1×  | small    | ready       |         42.8 / 52.9 |        33.5 / 38.8 |        -21.7% |     11 |
| 5       | 1×  | small    | paint       |         43.1 / 53.2 |        33.8 / 39.2 |        -21.6% |     11 |
| 5       | 1×  | small    | interactive |       831.2 / 883.4 |      794.1 / 814.4 |         -4.5% |     11 |
| 5       | 1×  | large    | ready       |         44.7 / 67.6 |        39.1 / 54.6 |        -12.5% |     11 |
| 5       | 1×  | large    | paint       |         45.1 / 68.0 |        39.3 / 54.8 |        -12.9% |     11 |
| 5       | 1×  | large    | interactive |       814.6 / 858.0 |      813.3 / 824.2 |         -0.2% |     11 |
| 5       | 4×  | small    | ready       |       198.0 / 319.6 |      223.8 / 245.3 |         13.0% |     11 |
| 5       | 4×  | small    | paint       |       199.3 / 321.8 |      225.8 / 245.9 |         13.3% |     11 |
| 5       | 4×  | small    | interactive |     1064.4 / 1319.0 |    1145.8 / 1289.1 |          7.6% |     11 |
| 5       | 4×  | large    | ready       |       314.2 / 425.9 |      173.8 / 365.9 |        -44.7% |     11 |
| 5       | 4×  | large    | paint       |       316.6 / 427.4 |      174.8 / 367.8 |        -44.8% |     11 |
| 5       | 4×  | large    | interactive |     1176.7 / 1368.9 |     973.4 / 1394.9 |        -17.3% |     11 |
| 205     | 1×  | small    | ready       |       262.3 / 577.8 |        52.9 / 90.4 |        -79.8% |      9 |
| 205     | 1×  | small    | paint       |       264.4 / 579.8 |        53.3 / 90.7 |        -79.8% |      9 |
| 205     | 1×  | small    | interactive |     1151.8 / 1559.3 |      812.5 / 890.4 |        -29.5% |      9 |
| 205     | 1×  | large    | ready       |       195.2 / 284.4 |       60.3 / 214.4 |        -69.1% |      9 |
| 205     | 1×  | large    | paint       |       196.9 / 286.1 |       60.6 / 214.8 |        -69.2% |      9 |
| 205     | 1×  | large    | interactive |     1142.7 / 1255.8 |      819.4 / 975.3 |        -28.3% |      9 |
| 205     | 4×  | small    | ready       |      952.4 / 1305.4 |      265.2 / 299.8 |        -72.2% |      9 |
| 205     | 4×  | small    | paint       |      959.2 / 1313.2 |      267.5 / 301.2 |        -72.1% |      9 |
| 205     | 4×  | small    | interactive |     1930.5 / 2320.1 |    1157.2 / 1238.6 |        -40.1% |      9 |
| 205     | 4×  | large    | ready       |      650.5 / 1120.1 |      257.5 / 388.8 |        -60.4% |      9 |
| 205     | 4×  | large    | paint       |      655.6 / 1126.5 |      259.0 / 391.4 |        -60.5% |      9 |
| 205     | 4×  | large    | interactive |     1491.3 / 2408.4 |    1030.3 / 1243.1 |        -30.9% |      9 |

## Startup

205 documents, 4× CPU, 3 samples per cache mode. IndexedDB retained. Median / nearest-rank p95 in milliseconds. These low sample counts and the shared host limit interpretation; no startup performance claim is made. Splash gating was unchanged.

| Cache          | Endpoint    | Before median / p95 | After median / p95 | Median change |
| -------------- | ----------- | ------------------: | -----------------: | ------------: |
| cold-http      | ready       |       638.9 / 768.6 |      545.2 / 630.4 |        -14.7% |
| cold-http      | paint       |     1638.5 / 1939.0 |    1444.5 / 1510.5 |        -11.8% |
| cold-http      | interactive |     2480.8 / 2573.4 |    2258.2 / 2322.0 |         -9.0% |
| cached-http    | ready       |       551.0 / 677.1 |      554.4 / 587.7 |          0.6% |
| cached-http    | paint       |     1801.2 / 1823.4 |    1654.3 / 1904.0 |         -8.2% |
| cached-http    | interactive |     2454.7 / 2572.4 |    2387.0 / 2627.9 |         -2.8% |
| service-worker | ready       |       554.2 / 718.0 |      486.2 / 582.7 |        -12.3% |
| service-worker | paint       |     1800.8 / 1864.9 |    1577.5 / 1700.5 |        -12.4% |
| service-worker | interactive |     2538.1 / 2597.7 |    2294.0 / 2401.9 |         -9.6% |

## Validation and limitations

- Full fixture strings matched after the navigation runs and runtime checks, including both 264,039-character documents.
- A save-boundary test activated another document 115 ms after input, below the 250 ms save debounce. The edit persisted in the original document; the destination contained no marker, and undo did not import the original document's history.
- The sidebar DOM root and its search text survived document switches in both personal and space routes. Personal/space transitions reset the sidebar and displayed the destination content.
- Space-document editing and undo isolation passed. Toggling comments on one space document did not change its neighbor. An uploaded PNG appeared only in its document and loaded again on return. ZIP import and editor find were also exercised.
- `bun run build` and `bun run check` passed. The latter included all 945 tests, lint, type checking and formatting. Initial CLI-test timeouts under contention did not recur in the final check.
- Service-worker-controlled offline reload, typing, persistence after another offline reload, fixture restoration and cached document switching passed.
- The persistent personal account subscriber and sidebar subscription owners no longer remount with each document. DOM retention was measured. Raw Jazz subscribe/unsubscribe calls were not instrumented, so no numerical subscription reduction is claimed.
- Initial attempted changed runs loaded the old service-worker build and were discarded. The final navigation harness verifies the app asset against the currently served HTML. Baseline asset: `main.BPJDHMeN.js`; changed asset: `main.D5I5lx6Q.js`.
- The initial baseline differed substantially from the repeated baseline under shared-host load. Small-library comparisons use the repeated baseline. Original raw baseline samples remain available for inspection; their original `sameList` probe tracked a row rather than the list root and is not used for mount claims.
- A longer baseline startup run stalled after repeated reloads. Both reported startup batches used a restarted disposable browser and three samples per mode. A later runtime automation attempt also lost its page; the successful save/search test was rerun after recovery.
- No new deferred features were introduced. Remote permission revocation, multi-user comments and remote asset sync were not runtime-tested in this anonymous navigation benchmark.

See README.md for hardware, browser, cache, CPU, fixture and endpoint definitions. The paint endpoint is an animation-frame/hit-test proxy, and typing includes CLI scheduling overhead.

written with gpt-6 in Codex

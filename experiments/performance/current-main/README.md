# Current rewrite versus main, 8 October 2026

Frozen application comparison: rewrite `aad445b6fdf3a2efe5679daa5a0e010d58785a61`, main `a749728a8f9a1cb984c980a5ea2daf984d60ae68`. Both production clients use their own actual local sync backend. Fresh signed accounts and fresh logical fixtures; 1 MiB fixtures use separate accounts/libraries. Later runs advance the same logical test edits; profiles/backend were not reset before every cell.

The rewrite loads faster, replaces 1,298 selections faster, and delivers online peer edits faster. It remains slower for 128 KiB search, warm document switching, offline reconnect, and some typing positions. **120 fps remains unmet:** ordinary input has occasional >8.33 ms work, multicursor tasks are much longer, and deferred persistence can stall for over a second.

## Confirmatory measurements

Median / maximum milliseconds. Five samples for normal journeys; three for large files, multicursor and sync. With these small sample counts, reported p95 is the maximum; it is not a stable population percentile. Input-to-two-rAF measurements describe paint opportunities, not measured displayed frames.

| Journey                                 |            Main |         Rewrite |
| --------------------------------------- | --------------: | --------------: |
| 2 KiB warm reload                       |   115.9 / 119.7 |     73.1 / 83.7 |
| 32 KiB warm reload                      |   176.3 / 182.3 |   123.6 / 128.0 |
| 128 KiB warm reload                     |   358.1 / 367.2 |   265.8 / 276.4 |
| 1 MiB warm reload                       | 2259.5 / 2279.9 | 1720.7 / 1720.9 |
| 2 KiB end typing → two rAF              |     22.7 / 30.6 |      9.0 / 18.8 |
| 128 KiB end typing → two rAF            |     24.0 / 32.3 |     28.2 / 34.0 |
| 128 KiB start typing → two rAF          |     26.0 / 31.8 |     26.6 / 30.3 |
| 128 KiB middle typing → two rAF         |     28.2 / 32.7 |     27.3 / 28.3 |
| 1 MiB end typing → two rAF              |     27.3 / 31.3 |     27.1 / 32.9 |
| 128 KiB Find matches → two rAF          |     30.4 / 43.6 |     40.5 / 50.7 |
| 128 KiB Find close → two rAF            |     34.2 / 35.1 |     32.7 / 34.5 |
| 128 KiB preview ready → two rAF         |     62.4 / 63.8 |     40.1 / 45.7 |
| Existing 128 KiB document switch        |    29.7 / 702.8 |    72.6 / 231.9 |
| Replace 1,298 matches, traced → two rAF |     87.6 / 88.8 |     43.2 / 49.9 |
| Socket edit → peer two rAF              |   308.6 / 321.2 |    74.7 / 102.7 |
| Offline socket reconnect → peer two rAF |     47.1 / 48.0 |     79.6 / 79.6 |
| Poll edit → peer two rAF                |     Unavailable |     75.8 / 77.1 |
| Offline poll reconnect → peer two rAF   |     Unavailable |     75.0 / 83.3 |

Main 1 MiB start-position readiness exceeded the harness's 20 s deadline; middle-position cells were consequently unavailable. This is a required-state failure, not proof of an application crash. Rewrite start/middle rows and all valid main end rows remain in `large.json`.

## Complete browser tasks and deferred work

No CPU sampling in these traces. `trace-summary.json` records complete enclosing main-thread `RunTask` durations, including microtasks, rather than only input listeners. Layout/Paint/GC use interval unions to avoid counting nested events twice. Trace digests preserve provenance; enormous raw traces remain in the disposable directory `/tmp/alkalye-fresh-matrix`.

| Traced workload, three trials                     | Main median / max | Rewrite median / max |
| ------------------------------------------------- | ----------------: | -------------------: |
| Multicursor initial enclosing input task          |       83.4 / 86.2 |          37.3 / 47.0 |
| Largest task during multicursor + 3 s aftermath   |   2622.8 / 3579.5 |       114.3 / 1535.6 |
| Burst initial enclosing input task                |         3.8 / 4.1 |            3.7 / 4.5 |
| Largest task during 25-edit burst + 3 s aftermath |       56.3 / 75.7 |          14.9 / 15.6 |

The rewrite's largest multicursor aftermath task begins 1848.5 ms after input and contains a 1535.6 ms `s.oncomplete` callback with repeated minor GC. The callback can resume downstream work; this trace does **not** establish that IndexedDB cloning itself caused the stall. Main also has multi-second aftermath tasks. A separate sampled investigation is needed for precise attribution.

Burst inputs are 25 sequential trusted browser insertions, not sustained human typing: median inter-input gaps main 0.8–0.9 ms, rewrite 2.5–2.7 ms; maximum gaps main 5.1–7.5 ms, rewrite 4.8–5.1 ms. All edits were observed. After 3 s, main's saved-source marker was present; rewrite showed `Saved on this device`, pending 19/19/20, so the strict server-accepted durability gate failed. Local-save UI and server acceptance must not be conflated. Later independent peer/poll journeys passed their observable delivery checks.

Trusted wheel trials cover top/middle/near-end starts on 128 KiB rich Markdown and 1 MiB long paragraphs, desktop and coarse-pointer emulation: 24 trials, all source-unchanged checks passed. Largest observed main-thread task main 1.02 ms, rewrite 10.04 ms. Coarse-pointer wheels are not physical touch-scroll measurements.

Separate later Find/switch traces retain every sample. Traced switch medians main 34.4 ms, rewrite 534.1 ms; maxima 2269.5/2812.5 ms. They followed more history edits and rewrite used polling after transport tests. Do not combine these with untraced socket rows or attribute their difference solely to tracing. No CPU sampler was enabled. In these traces rewrite Find-match enclosing tasks were 0.69–1.17 ms; largest aftermath tasks 3.30–4.32 ms. The longer two-rAF search result alone does not prove a 40 ms synchronous search handler.

## Bundle closures

Per-file gzip level 9, summed static dependency closures; dynamic imports excluded from initial JavaScript. Unused leftover chunks are excluded. These are emitted byte sizes, not network transfer timings.

| JavaScript           |       Main |   Rewrite |
| -------------------- | ---------: | --------: |
| Initial gzip         | 1250.3 KiB | 339.1 KiB |
| Lazy whiteboard gzip |  502.0 KiB | 578.3 KiB |

Initial JavaScript is about 73% smaller; the lazy whiteboard is about 15% larger. Exact graph files and SHA-256 hashes are in `bundles.json` / `metadata.json`.

## Failures and controls

- Main `bun run build` hit seven existing Astro type errors. Unchanged `astro build` produced the measured production assets; no baseline fixes applied.
- Initial normal rows used anonymous main versus connected rewrite: retained in `normal.json`, excluded from confirmatory comparison. `normal-confirmed.json` reran both signed in and connected.
- One journey rerun overlapped fixture setup, was aborted and excluded entirely.
- Main's 1 MiB import timed out in the driver. No second import; one later observation proved exact generated source and durable saved content.
- Rewrite Find handles Enter on the native close button as Find-next. Corrected measurements use pointer-close for both versions. Root fixes the keyboard defect separately after this freeze.
- Main switch initially focused a wrapper `li`. The corrected run targets its native anchor; original failures remain recorded.
- An extra 1 MiB enclosing-input trace could not start after a profile/daemon launch failure; no workload timing inferred. Existing n=3 listener/two-rAF cells remain valid.
- Multicursor source restoration uses the public whole-source editor boundary, excluded from timing. It is not a causal-undo test.
- Full 20+ writer capacity was not rerun. Earlier module tests cannot establish browser frame performance.

Fresh profiles and frozen emitted hash-named modules prevent changing code during the run. File hashes prove build contents, not an independent cryptographic capture of browser-executed bytes. Warm reload measures visible editable content; optional UI settling can finish later. Headless rAF is approximately 60 Hz, so these tests cannot verify 120 Hz display cadence.

## Reproduction

Use `work` to launch isolated production servers with fresh data: main Jazz on 4226, main static server on 4460, rewrite full backend on 4461. Never use a user's data directory. Fixed environment for **every** command: `AGENT_BROWSER_HEADED=false AGENT_BROWSER_DEFAULT_TIMEOUT=20000`.

Use the existing `../fixture.ts`, `../compare.ts`, `../continuous-native.ts`, `../bundles.ts`; adapters here provide configurable journey counts, native main scroll, pointer-close, native-anchor switching and scoped no-sampler traces.

```sh
BENCHMARK_JOURNEY_SAMPLES=5 bun experiments/performance/current-main/journeys.ts CONFIG.json JOURNEYS.json
BENCHMARK_ONLY=switch BENCHMARK_JOURNEY_SAMPLES=5 bun experiments/performance/current-main/journeys.ts CONFIG.json SWITCH.json
BENCHMARK_ONLY=trace BENCHMARK_TRACE=1 BENCHMARK_JOURNEY_SAMPLES=3 bun experiments/performance/current-main/journeys.ts CONFIG.json TRACED.json
BENCHMARK_SCROLL_SAMPLES=3 bun experiments/performance/current-main/scroll.ts SESSION PROFILE DOC_URL SCROLL.json desktop 0 trace original
BENCHMARK_PEER_SAMPLES=3 bun experiments/performance/current-main/peer.ts PEERS.json PEER-RESULTS.json
```

`metadata.json` lists provenance and limitations. Raw sample arrays are retained alongside sanitized trace summaries. No production changes in this artifact.

written with gpt-6 in codex

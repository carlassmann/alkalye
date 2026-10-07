# Native search highlights

CSS Custom Highlight reduces geometry work for inactive matches. This run did not show a consistent improvement in time to the next paint opportunity. First-next key handlers still exceeded the 8.33 ms frame budget in both modes.

Five trials per mode used identical production assets, separate disposable accounts and alternating order. The 35,018-character document contains 12,002 lowercase `e` matches. Native support was disabled before module initialization through the existing test proxy for the fallback runs. No production instrumentation was added.

| Median, milliseconds                      | Native | Fallback |
| ----------------------------------------- | -----: | -------: |
| Find, two animation-frame opportunities   |   45.5 |     40.3 |
| Scroll, two animation-frame opportunities |   27.6 |     27.1 |
| Next, two animation-frame opportunities   |   37.9 |     40.3 |
| Find, largest main-thread task            |  1.328 |    1.919 |
| Scroll, largest main-thread task          |  1.676 |    2.383 |
| Next, largest main-thread task            |  3.768 |    3.961 |
| Find, Layout total                        |  0.188 |    0.262 |
| Scroll, Layout total                      |  0.059 |    0.150 |
| Next, Layout total                        |  1.612 |    1.722 |
| Find, Paint total                         |  0.767 |    0.527 |
| Scroll, Paint total                       |  0.973 |    0.038 |
| Next, Paint total                         |  1.621 |    1.153 |

The first next action had a 13.879 ms native task and a 14.269 ms fallback task. Both were keydown handlers, with 4.802 and 4.904 ms of Layout inside the task and no GC. The trace shows nine Layout events and DOM expansion from 413 to 1,750 then 2,646 objects. Source inspection identifies synchronous viewport reveal/refinement and a transient full-document selection as candidates. This trace does not establish how much each function costs.

Source and selection correctness passed every measured trial. Native registered 217 source-window ranges plus one active overlay; fallback created 192 rectangle-filtered spans. These counts use different units. The browser clips native highlights; fallback filters rectangles in JavaScript. A range count alone does not prove equivalent visible coverage.

A separate post-scroll check found 288 native ranges, of which 216 intersected the editor bounds at scroll offset 600. The registry remained bounded and contained visible matches.

## Distant navigation experiment

Atomic selection rendering removes the expensive temporary full-document paint. With the same end-caret scenario, five alternating trials measured a largest-task median of 19.706 ms before and 4.114 ms after. The maximum fell from 25.191 to 4.371 ms. Layout totals fell from 5.204 to 0.537 ms. Two animation-frame opportunities changed from 43.7 to 40.3 ms.

The source projection and canonical selection now update together; the viewport reveals the target before painting. Long selections retain whole-document native input. A redundant second selection reveal was removed. After timing, a guard was added to preserve the complete selection if block refinement changes the final viewport bounds. That guard does not execute for the measured match at offsets 3 through 4. IME deferred renders retain the reveal option.

All ten measured trials retained exact source, selected offsets 3 through 4, restored search focus and returned to scroll offset zero. The asset source maps differ in exactly `source-textarea.ts` and `editor-viewport.ts`. `search-next-atomic-results.json` contains raw samples, relevant complete Chrome trace slices and asset hashes. These timings support this specific navigation improvement, not universal 120 fps.

Opus 5.5 reviewed the complete source through Claude Code with local tools disabled. It found no blockers and identified the deferred-render and post-refinement selection guards added above.

The first prototype revealed the target viewport before rendering the selected projection. The first-next spike reproduced when the source caret was collapsed at the document end, the viewport scrolled to 600, and Find Next wrapped to the first match. Five alternating trials per version compared identical current assets with and without this four-line prototype.

| Median, milliseconds              | Existing | Pre-reveal experiment |
| --------------------------------- | -------: | --------------------: |
| Largest next task                 |   16.722 |                16.481 |
| Maximum next task                 |   22.129 |                23.049 |
| Layout total                      |    5.124 |                 5.036 |
| Two animation-frame opportunities |     41.3 |                  39.4 |

Pre-revealing did not remove the slow path. The production change was reverted. Every trial preserved the exact source, selected offsets 3 through 4, restored search focus and scrolled back to the first match. Native and fallback Find, multicursor and viewport journeys passed, including one-megabyte persistence and undo. The new distant-Find behavior assertion remains.

An earlier start-caret control warmed the target block and did not reproduce the spike. Its task medians were 3.301 and 2.841 ms; it cannot support a claim that the experiment fixes cold navigation. `search-next-results.json` records the corrected end-caret trials. `search-next.ts` reproduces this narrower experiment with configuration entries containing `name`, `session` and `url`.

Headless Chrome ran near 60 Hz. Two animation frames establish a paint opportunity, not actual pixel presentation or 120 fps. Scroll used the public viewport setter, not a wheel gesture. Trace phases include overlapping main-thread `RunTask` slices, including the task enclosing the input marker. Nested task durations are never added. Layout and Paint totals describe the recorded phase window; paint events are not frames.

## Reproduce

Build production assets into a clean disposable directory. Start two isolated instances of `tests/browser-document-app.ts --serve`, both with `ALKALYE_TEST_ASSETS` pointing at those assets; set `TEST_SEARCH_HIGHLIGHTS=fallback` on only the fallback instance. Manage servers with `work`.

Create a configuration array with each instance's `mode`, disposable `session`, and printed `url`. Keep `AGENT_BROWSER_HEADED=false` and `AGENT_BROWSER_DEFAULT_TIMEOUT=20000` identical for every command, including setup and cleanup.

```sh
bun experiments/performance/search-highlights.ts CONFIG.json OUTPUT.json
```

The runner produces raw samples and Chrome trace files. `search-highlights-results.json` preserves the measured samples, phase summaries, outliers and frozen asset hashes. Hashes include unused stale chunks present in that directory and are not a bundle closure.

# Trusted scrolling

Twenty-four trials cover 32 KiB rich bidirectional Markdown, 128 KiB and 1 MiB line-based text, and a 1 MiB wrapped paragraph, on desktop and coarse-pointer Chromium. Every trial retains exact source, observes eight trusted wheel events and reaches stable scroll positions.

Measured viewport animation callbacks are short: largest 4.31 ms, layout 1.45 ms and paint 0.77 ms. Short individual tasks do not establish spare frame time: middle long-paragraph trials record roughly 280–317 ms of inclusive FunctionCall spans in about 416 ms. Totals can overlap and require a union-of-busy-intervals analysis before claiming utilization. Complete journeys still stall. The first rich 32 KiB reopen includes 592 and 291 ms IndexedDB continuation tasks. The first coarse-pointer wrapped 1 MiB run includes 17.1 and 10.6 ms tasks dominated by GC, after heap use reaches 1.58 GB. All samples remain in the results.

The eight wheel events often produce only two or three scroll events, with about 1200–1800 pixels of movement. They are verified trusted input events, not eight independent 600-pixel steps. The original observations lack individual wheel timestamps, targets and deltas; the next probe records them. The first IndexedDB stall may precede the first wheel and remains part of the setup-to-interaction journey.

The IndexedDB callback maps to `src/platform/indexeddb-journal.ts:585`; GC runs inside `src/client/scheduler.ts:28`. These locations resume fibers, so they do not identify the expensive downstream function. A sampled CPU profile is needed before changing production code. `Saved` and editable source do not establish background journal/checkpoint quiescence.

[Raw observations and scoped task totals](editor-scroll-results.json) record each trial. Traces remain under `/tmp/alkalye-scroll-current/`; the probe recreates raw observations and traces; scoped aggregate extraction was a separate analysis. Use a disposable profile and origin with prepared source, then run:

```sh
bun experiments/performance/editor-scroll.ts SESSION PROFILE URL OUTPUT.json desktop EXPECTED_CHARACTERS
bun experiments/performance/editor-scroll.ts SESSION PROFILE URL OUTPUT.json coarse EXPECTED_CHARACTERS
```

The copied bundle SHA matched the served response. Profiles came from the history-bearing benchmark account; copied service-worker/browser caches were cleared before boot. Edge sources were applied through the public editor, saved, then reopened. The account retained the other large documents. No accepted checkpoint cursor was captured when tracing began.

Tracing measures tasks on the renderer main thread between explicit interaction marks. RAF timestamps record frame opportunities; the headless browser runs near 60 Hz. They cannot prove 120 Hz painting. Coarse-pointer emulation uses a trusted wheel and cannot establish physical touch, WebKit or native selection-handle parity. No original-version comparison or production change follows from these samples.

## Sampled rich-document reproduction

A later logical-sequence reproduction identifies the downstream work. It is not the original retained history: that backend was reset before its snapshot. The replacement sequence was repeated from the same seed account/profile, with copied browser caches cleared; the rich document was saved, closed and reopened. Exact post-reproduction database/profile copies remain under `/tmp/alkalye-scroll-current/preserved-rich-repro-{data,profile}`.

[Sampled evidence](editor-scroll-cpu-results.json) retains per-wheel timestamps, frame gaps and source-mapped self/inclusive costs. The 1264 ms scope contains 1108 ms of non-overlapping renderer `RunTask` intervals (87.7% busy). Its two largest tasks take 652 and 334 ms; RAF gaps reach 317 and 633 ms. All eight wheels are trusted, 600-pixel deltas, unprevented; they yield only two scroll events and 1200 pixels of final movement. The sampled target IDs are empty, so exact target elements remain unknown.

The 652 ms task spends approximately 238 ms in `document-session.validateChanges → Replica.validate → prepare`, then 300 ms in `applyChanges → Replica.applyTogether → prepareApplication`. Visibility preparation contributes about 190 ms across those branches; identity checks contribute 106 ms self time and two schema parser nodes contribute 109 ms self time. The 334 ms task spends 255 ms in validation. GC contributes 18 and 16 ms respectively. These are actual sampled callees beneath the IndexedDB completion continuation, not attribution to IndexedDB itself. Inclusive times overlap and must not be added to self times.

This points to repeated synchronous validation/preparation of accepted changes, rather than scrolling geometry. No production correction ships with this investigation. CPU sampling changes timings; these numbers establish attribution, not a replacement benchmark or 120 Hz capability. `Saved` still does not establish background acceptance quiescence.

Reproduce with the same prepared source and frozen assets/source maps:

```sh
bun experiments/performance/editor-scroll.ts SESSION PROFILE URL OUTPUT.json desktop 32768 cpu
python3 experiments/performance/editor-scroll-cpu.py OUTPUT-0.trace.json ASSET_DIRECTORY SUMMARY.json
```

The optional `cpu` mode performs one trial with V8 CPU sampling. The decoder merges profile chunks by renderer/profile identity, maps zero-based sample locations through the copied bundle's source maps and unions task intervals to avoid double counting nested spans. Sample weights use recorded deltas, clipped to 1 ms so chunk gaps cannot become attributed function time. Raw sampled trace: `/tmp/alkalye-scroll-current/repro-rich-cpu-0.trace.json`; copied source maps: `/tmp/alkalye-scroll-current/assets`. Both are required to independently regenerate the summary. No browser/server from this probe remains running.

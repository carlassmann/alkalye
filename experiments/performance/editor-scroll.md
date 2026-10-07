# Trusted scrolling

Twenty-four trials cover 32 KiB rich bidirectional Markdown, 128 KiB and 1 MiB line-based text, and a 1 MiB wrapped paragraph, on desktop and coarse-pointer Chromium. Every trial retains exact source, observes eight trusted wheel events and reaches stable scroll positions.

Warm scrolling itself uses short tasks: largest renderer animation callback 4.31 ms, layout 1.45 ms and paint 0.77 ms. Complete journeys still stall. The first rich 32 KiB reopen includes 592 and 291 ms IndexedDB continuation tasks. The first coarse-pointer wrapped 1 MiB run includes 17.1 and 10.6 ms tasks dominated by GC, after heap use reaches 1.58 GB. All samples remain in the results.

The IndexedDB callback maps to `src/platform/indexeddb-journal.ts:585`; GC runs inside `src/client/scheduler.ts:28`. These locations resume fibers, so they do not identify the expensive downstream function. A sampled CPU profile is needed before changing production code. `Saved` and editable source do not establish background journal/checkpoint quiescence.

[Raw observations and scoped task totals](editor-scroll-results.json) record each trial. Traces remain under `/tmp/alkalye-scroll-current/`; the probe recreates them. Use a disposable profile and origin with prepared source, then run:

```sh
bun experiments/performance/editor-scroll.ts SESSION PROFILE URL OUTPUT.json desktop EXPECTED_CHARACTERS
bun experiments/performance/editor-scroll.ts SESSION PROFILE URL OUTPUT.json coarse EXPECTED_CHARACTERS
```

The copied bundle SHA matched the served response. Profiles came from the history-bearing benchmark account; copied service-worker/browser caches were cleared before boot. Edge sources were applied through the public editor, saved, then reopened. The account retained the other large documents. No accepted checkpoint cursor was captured when tracing began.

Tracing measures tasks on the renderer main thread between explicit interaction marks. RAF timestamps record frame opportunities; the headless browser runs near 60 Hz. They cannot prove 120 Hz painting. Coarse-pointer emulation uses a trusted wheel and cannot establish physical touch, WebKit or native selection-handle parity. No original-version comparison or production change follows from these samples.

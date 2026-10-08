# Syntax overlay coalescing

Frozen baseline: `4bbbca11c1097c84ff497f86d7e458f938110fef`. Candidate changes only editor syntax overlay updates: one native microtask per pending batch, synchronous flush before every geometry reader, abort guard on disposal. Every viewport paint/refinement remains.

Five alternating pairs, restored SQLite/blob and quiet browser profile per phase. Trusted `insertText`, exact source and causal undo, strictly newer accepted checkpoint with no pending/rejected actions. Complete enclosing `RunTask` includes microtasks. Three seconds of deferred work recorded separately; no CPU profiler.

| Fixture                | Input task median/max, before | After              | Largest task including aftermath, before | After              |
| ---------------------- | ----------------------------- | ------------------ | ---------------------------------------- | ------------------ |
| 128 KiB, one selection | 3.046 / 3.280 ms              | 3.068 / 3.306 ms   | 9.754 / 10.215 ms                        | 9.788 / 10.383 ms  |
| 1 MiB, one selection   | 3.920 / 4.039 ms              | 3.893 / 3.988 ms   | 10.038 / 10.224 ms                       | 9.903 / 10.907 ms  |
| 1 MiB, 2048 selections | 28.308 / 28.609 ms            | 26.836 / 27.394 ms | 53.804 / 54.300 ms                       | 53.051 / 53.835 ms |

All 30 samples passed exact source, selection-count and accepted edit/undo checks; no failed cells. The 1.47 ms median multicursor reduction includes the microtask work, rather than moving it outside the listener measurement. Single-selection controls were effectively unchanged. The 8.33 ms target remains unmet for extreme multicursor input and deferred work; this headless browser presents at roughly 60 Hz.

Public fixture checks synchronous far-away selection geometry, complete simulated DOM composition reconciliation, and disposal before queued callbacks. Production Find, viewport/full-document/Unicode/composition/offline, multicursor (including 512 Unicode cursors), and link prettification journeys passed. Composition events are simulated contracts, not trusted OS/device IME.

`results.json` retains all sanitized trace summaries. Relevant loaded chunk URL matched every frozen local file hash; this is not cryptographic verification of browser-loaded bytes. Raw traces and full disposable profiles remain outside the repository at `/tmp/alkalye-overlay-coalesce`.

written with gpt-6 in codex

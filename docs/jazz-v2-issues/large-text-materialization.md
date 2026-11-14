# Reduce full TEXT conversion, materialization and hashing during editing

Jazz `2.0.0-alpha.61`, upstream source `397c8b810d99dc9a20440f17decb2c63ddaf0cf6`.
Unsubmitted performance/API proposal. Alkalye ships published Jazz Wasm and SDK
query/write code, with only a [backend auth patch](../../patches/jazz-tools@2.0.0-alpha.61.patch).
[Asset verification](../../bench/results/stock-diagnostics.json) records the
published-package hashes. No engine experiment remains a runtime dependency.

## Stock-Jazz measurements

Five production runs of an 874,540-byte Markdown note, 200 edits each, measured
dispatch-to-double-rAF at 34.05 / 83.55 ms, median / p95. Classic measured
33.31 / 34.05 ms. Long tasks per case were 47 / 54 versus 1 / 1. The single
5,000-edit case measured 34.03 / 87.96 ms and 986 long tasks, versus Classic's
33.42 / 50.12 ms and 51 tasks. These are app timings with batching and local
backends. [Report and method](../benchmarks/jazz-classic-vs-v2.md),
[stock v2](../../bench/results/stock-v2.json),
[Classic](../../bench/results/stock-classic.json),
[v2 stress](../../bench/results/stock-v2-5000.json),
[Classic stress](../../bench/results/stock-classic-5000.json).

A separate stock CPU diagnostic found 3.93 ms/trace edit in page SHA-256,
1.71 in materialization, 0.98 in UTF-8 validation and 0.90 in JS encoding.
Page Wasm totaled 10.83 ms/trace edit. Worker Wasm ran in parallel.
These sampled leaf costs include cursor movement, verification and settling;
they are not input-handler timings and cannot be added to latency percentiles.
[CPU summary](../../bench/results/stock-typing-cpu.json).

## Current workaround

Alkalye selects metadata for the library and subscribes to the editor separately
with `{ splices: ["content"] }`. It retains equivalent React query results,
coalesces visible typing, and shares local durability receipts. Public splice
subscriptions still deliver complete row strings. Every replacement retains its
complete original `editedFrom` base. See
[content subscription](../../src/app/features/documents/hooks/use-document-content.ts),
[write queue](../../src/app/features/documents/lib/library.tsx),
[stable rows](../../src/app/hooks/use-stable-rows.ts) and
[write receipts](../../src/app/features/documents/lib/writes.ts).

`applyDiffs` describes positional edits against the current local row. It has no
atomic check of the editor's stale base for that same column. It therefore
cannot replace `editedFrom` safely in this concurrent editor. See upstream
[update lowering](https://github.com/garden-co/jazz/blob/v2.0.0-alpha.61/packages/jazz-tools/src/runtime/db.ts)
and Alkalye's [stale-base regression](../../src/app/features/documents/lib/library.test.ts).

## Removed engine experiment

A historical app-plus-engine experiment at Alkalye `94fc4ed` measured
large-note typing at 33.39 / 40.98 ms and 0 / 0 long tasks per 200-edit case.
Its contemporaneous Classic baseline was 33.32 / 33.78 ms and 1 / 1 tasks.
The experiment's 5,000-edit case still measured 41.57 / 82.90 ms and 1,077
long tasks. [Experimental v2](../../bench/results/final-v2.json),
[contemporaneous Classic](../../bench/results/final-classic.json),
[experimental stress](../../bench/results/final-v2-5000.json).

The experiment cached validated scalars by full immutable descriptor, rebuilt
whole-write text tails after 128 edits, accepted verified replacement hints
against `editedFrom`, and retained unchanged query snapshots. The implementation
was removed; the historical [engine patch](https://github.com/carlassmann/alkalye/blob/94fc4ed/patches/jazz-engine-alpha.61.patch)
and [CPU comparison](../../bench/results/final-typing-cpu.json) preserve the
proposal and measurements. The paired CPU profiles changed app/React work too;
these results do not isolate individual engine changes.

## Requested APIs and engine work

- Avoid repeated full-string conversion, authenticated materialization and
  hashing when the immutable descriptor or validated prefix is unchanged.
- Provide delta subscriptions that avoid full-scalar serialization/decoding.
- Provide an atomic, version-guarded splice write or a verified hint against
  `editedFrom`, with stale-base merging as fallback. Keep Unicode and descriptor
  validation.
- Preserve unchanged selected query snapshots without suppressing reset events.
  Consider moving optimistic engine work off the page thread.

These requests follow the stock profile and removed implementation above. The
experiment supports investigating them upstream; it does not establish that
stock Jazz meets Alkalye's typing target.

## Reproduction

[large-text-repro.ts](large-text-repro.ts) is a local-only diagnostic without
React. Serve it through Vite with `jazz-tools` and `jazz-wasm` excluded from
prebundling, then run each case separately in a browser console:

```js
let { runLargeTextRepro } =
	await import("/docs/jazz-v2-issues/large-text-repro.ts")
await runLargeTextRepro("whole")
await runLargeTextRepro("splices")
await runLargeTextRepro("none")
```

Each case waits for local durability and checks exact final content and terminal
subscription errors. The optional positional-write case is single-writer only.
Its fixed 128-unit range stays valid as the value grows. See the separate
[range-shrink repro](range-queries.md) for terminating subscriptions.

written with gpt-6.1-sol in T3 Code (Codex)

# Upstream proposal: avoid repeated large TEXT materialization

Status: proposal only, not submitted. Target is Jazz `2.0.0-alpha.61`,
source `397c8b810d99dc9a20440f17decb2c63ddaf0cf6`.

Alkalye uses the published Jazz SDK and Wasm binaries. The only SDK patch is
the auth patch from `fe49b12`. No browser engine, Rust build, replacement
worker, query-snapshot patch or splice-hint option ships here. The owner
decided against maintaining a Jazz fork.

## Evidence from the removed experiment

The experiment recorded at `94fc4ed` used app changes plus engine changes.
Its five production runs measured small-note dispatch-to-double-rAF at
33.30 / 34.86 ms and large-note typing at 33.39 / 40.98 ms, median / p95.
Classic measured 33.31 / 34.30 ms and 33.32 / 33.78 ms respectively.
The large-note 200-edit long-task count was 0 / 0, versus Classic's 1 / 1.
The single 5,000-edit case measured 41.57 / 82.90 ms and 1,077 long tasks,
versus Classic's 33.37 / 50.02 ms and 37 tasks.

Those numbers describe the removed engine experiment, not the stock-Jazz
implementation in the [current report](../benchmarks/jazz-classic-vs-v2.md).
The historical summaries remain in `bench/results/final-v2.json`,
`final-v2-5000.json` and `final-typing-cpu.json`. They do not establish
the isolated effect of each engine change.

Paired 200-edit profiles compared `fe49b12` and `5f0f339`. Large-note
main-page sampled CPU fell from 36.22 ms JS + 41.97 ms Wasm per edit to
10.78 + 10.43 ms. The earlier profile attributed 14.0 ms/edit to SHA-256
compression and 6.4 ms/edit to `materialize_attempt`, inside write lowering
and subscription fanout. The final profile retained 0.61 ms/edit in SHA-256.
React work also fell from 23.87 to 1.55 ms/edit, so the total improvement
cannot be credited to native materialization alone.

The changes worth considering upstream were:

- Cache one validated logical scalar per database, capped at 64 MiB and keyed
  by the complete immutable descriptor. Exact hits reuse validated bytes.
  Append-only tails apply edits to the validated prefix and update UTF-16
  metrics from edited fragments. Different roots, kinds, formats, hashes and
  divergent tails must take the original authenticated materialization path.
- Rebuild the canonical tree for whole-text replacements after a 128-edit
  tail, using the existing whole-write path. This bounded descriptor work
  before the format's 4,095-edit limit. Append/positional writes and the reader's
  accepted format stayed unchanged.
- Accept an advisory replacement hint against the full original
  `edited_from`. Verify that it reconstructs the exact replacement before
  skipping a second JS-to-Rust conversion. Invalid hints and surrogate splits
  must use the original decoder. A bounded conversion cache can reuse the
  previous Rust string only when its JS value exactly matches the original base.
  The removed SDK option was named `editedSplices`.
- Preserve unchanged selected query snapshots and notification counts.
  Subscription resets must still notify. Alkalye now retains equivalent
  projections at its own React boundary instead.

The experiment reported 132 large-value and 16 text-splice integration tests
passing, including concurrent/offline Unicode writers across the new rebuild
boundary. UTF-8, UTF-16, descriptor validation and stale-base tests passed.
These are historical validations, not a substitute for upstream review.

## Remaining engine costs

Even the removed experiment serialized full scalars for subscriptions requesting
public splices. JS decoding cost 1.56 ms/edit, exact string comparison 0.75,
native subscription serialization 1.05, native comparison 0.87 and UTF-8
validation 0.77 in its final large-note profile. A page optimistic database and
a worker durable database are separate instances by design.

The separate 5,000-edit profile attributed 23.60 ms/trace edit to page replication,
100.03 to durable-worker replication, and 7.52 to parked page transaction waits.
Worker allocation/freeing cost 18.72 and record/value validation 14.58.
CodeMirror's browser `Selection.collapse` calls cost 69.54 ms/trace edit across
26,401 Arrow movements. These whole-replay sampled averages include cursor
work. They cannot be added to dispatch latency or treated as proof of a leak.
They came from the patched experiment; stock-Jazz timings must be measured anew.

Delta subscriptions that avoid full-scalar conversion, and execution outside
the page thread, remain upstream opportunities. A version-guarded splice API
would need atomic comparison and mutation, with the original stale-base merge
as fallback.

## Merge safety and reproduction

Alkalye retains `editedFrom` with the complete editor base.
`applyDiffs` alone operates on the current local row and cannot atomically
check that base. It is unsuitable as a replacement for concurrent editor writes.
The stock implementation retains online, offline, rapid Unicode and reload
convergence tests.

`large-text-repro.ts` is a local-only, non-React diagnostic. Import it through
Vite with `jazz-tools` and `jazz-wasm` excluded from dependency optimization:

```js
let { runLargeTextRepro } =
	await import("/docs/jazz-v2-issues/large-text-repro.ts")
await runLargeTextRepro("whole")
await runLargeTextRepro("splices")
await runLargeTextRepro("none")
```

Run each case separately. Every case checks full final text and fails on terminal
subscription errors. The optional positional-write case is single-writer only.
The range case selects a fixed valid 128-unit window. These diagnostics include
a local-durability wait and are not production app timings.

written with gpt-6.1-sol in T3 Code (Codex)

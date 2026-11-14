# Large TEXT: materialization caching helps; full-value delivery remains

Status: local patch implemented, upstream issue not submitted. Jazz
`2.0.0-alpha.61`, source `397c8b810d99dc9a20440f17decb2c63ddaf0cf6`.

The final production comparison is in
[the benchmark report](../benchmarks/jazz-classic-vs-v2.md). The typing target is **not met**: large-note p95 is 40.98 ms versus Classic's 33.78 ms (7.21 ms slower). Small-note typing is 33.30 / 34.86 ms versus 33.31 / 34.30 ms. Large-note medians are 33.39 versus 33.32 ms. The 200-edit long-task counts are near Classic. The 5,000-edit case is 41.57 / 82.90 ms versus Classic's 33.37 / 50.02 ms, with 1077 versus 37 long tasks. Completed typing replays and collaboration checks pass; returning/offline failures are counted below.

A fresh, matched 200-edit profile of an 874,540-byte note attributed 14.0 ms/edit
to SHA-256 compression and 6.4 ms/edit to `materialize_attempt` on the main page.
This was native work inside write lowering and subscription fanout, despite
using the persistent SharedWorker and requesting subscription `splices`.

The committed engine patch caches one validated logical scalar per database,
capped at 64 MiB, keyed by its complete immutable descriptor. Exact hits reuse
validated bytes; append-only tails apply new edits and update metrics from their
fragments. Different bases and divergent tails use full authentication. UTF-8,
UTF-16, descriptor and stale-base tests pass. Materialization/hash CPU is much
lower; the patch preserves stored/sync formats and merge behavior.

Whole-text replacements rebuild their canonical tree after a 128-edit tail,
using the existing whole-write path. This bounds descriptor processing that
otherwise grows toward 4,095 edits and backpressures the durable worker.
Append/positional writes and the format acceptance limit remain unchanged.
Jazz's 132 large-value and 16 text-splice integration tests pass, including
concurrent/offline Unicode writers crossing the new boundary.

The Wasm bridge also accepts an optional replacement hint against `edited_from`.
It verifies that the hint reconstructs the exact replacement string before
avoiding its second full JS-to-Rust conversion. Invalid hints use the original
decoder. Both paths produce the original `LargeValueUpdate::TextEdit`, preserving
its full original base and stale-base merge. A per-database conversion cache reuses
the previous Rust string only when its JavaScript value exactly matches the base.
It retains at most 64 MiB. CodeMirror supplies the hint from
its ChangeSet; no whole-string JS diff is needed.

Final main-page sampled CPU is 10.8 ms JS + 10.4 ms Wasm per trace edit, versus
36.2 + 42.0 before. JS encoding/decoding, native serialization and comparisons still copy or scan
full values on the page; the CPU summary identifies their remaining cost.
The subscription still serializes and delivers a full scalar even when its
public notification includes splices. `editedFrom` still constructs a full replacement; mismatched cached bases use
the original full decoder. A main-thread optimistic database and a
worker-owned durable database are intentional separate runtime instances;
removing the page instance requires a different local-first execution path.

The separate 5,000-edit profile adds a sustained-load finding. Main-page
replication costs 23.60 ms/trace edit and the durable worker's replication costs
100.03 ms. Parked transaction-wait futures use 7.52 ms on the page. Worker
allocation/freeing uses 18.72 ms and record/value validation 14.58 ms. The page
also spends 69.54 ms in `Selection.collapse` through CodeMirror selection updates,
mostly across the trace's many individual arrow-key moves. This browser builtin
is included in the JS/API bucket. These full-replay averages include cursor work;
they cannot be added to dispatch latency or treated as proof of a waiter leak.
The benchmark's unprofiled stress result remains separate.

## Relevant source

- `packages/jazz-tools/src/runtime/db.ts`: `editedFrom` lowers to `text_edit`;
  the local SDK patch adds the optional advisory `editedSplices` field.
- `crates/jazz-wasm/src/lib.rs`: validates/reconstructs the hint, then produces
  the original core TextEdit.
- `crates/jazz/layers/db/src/large_ops.rs`: materializes the current cell and
  compares it with `edited_from`; a stale base uses the existing three-way merge.
- `crates/jazz/layers/db/src/large.rs` and
  `crates/jazz/layers/types/src/large_values/mod.rs`: validated materialization
  cache and append-only reuse.
- `patches/jazz-query-snapshots-alpha.61.patch`: unchanged selected projections
  retain their SDK snapshot identity; subscription resets still notify.

`applyDiffs` applies positions to the local current row, including staged writes,
then enters ordinary history/Markdown merge handling. It does not compare an
editor base. A notification sequence is not an atomic compare-and-write guard,
so the app retains `editedFrom`. Online concurrent typing and rapid offline
large Unicode typing converge exactly, survive reconnect and reload, and retain
both writers' text. Jazz's own text-splice integration tests also pass.

## Reproduction and further work

`large-text-repro.ts` remains a local-only, non-React diagnostic. Import it through
Vite with `jazz-tools` and `jazz-wasm` excluded from dependency optimization:

```js
let { runLargeTextRepro } =
	await import("/docs/jazz-v2-issues/large-text-repro.ts")
await runLargeTextRepro("whole")
await runLargeTextRepro("splices")
await runLargeTextRepro("none")
```

Run each case separately. Every case verifies final full text and fails on a
terminal subscription error. The optional `partialWrite=true` case is a
single-writer positional-write diagnostic, not the collaboration adapter.
`window` selects a fixed, valid 128-unit range, not a growing full editor body.
These include a local-durability wait and are not production typing timings.

Further engine work must remove full-scalar conversion from delta subscriptions
or execute the remaining query/write/replication work outside the page thread.
A version-guarded splice API would need its comparison and mutation in one native
operation, with the original editedFrom merge as fallback. The local cache,
bridge and UI fixes are already implemented; the benchmark report quantifies
the remaining gap and rejected experiments.

[The vendored runtime guide](../../vendor/README.md) pins and rebuilds the Wasm,
glue and worker used by CI/Vercel. Raw profiles remain local; the committed
CPU summary records categories and normalized sampled cost.

written with gpt-6.1-sol in T3 Code (Codex)
